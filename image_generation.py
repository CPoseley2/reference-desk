"""Local image jobs. Only explicit submissions call OpenAI; never auto-approve."""
import base64, copy, fcntl, hashlib, json, mimetypes, os, re, threading, time, urllib.request, urllib.error, uuid
from pathlib import Path
import reference_catalog

MODEL='gpt-image-2.5-sunburst'
SIZES={'3:2 landscape':'1536x1024','2:3 portrait':'1024x1536','16:9 widescreen':'1536x864','1:1 square':'1024x1024'}
ACTIVE={'queued','generating','saving'}
LANE_CAPACITY={'character':1,'location':4}
class JobError(ValueError):
    def __init__(self,message,diagnostics=None):
        super().__init__(message);self.diagnostics=diagnostics

def api_failure(response):
    """Keep bounded diagnostic fields, never raw errors, headers or credentials."""
    try:
        payload=json.loads(response.read(65536));error=payload.get('error',{})
        if not isinstance(error,dict):error={}
    except Exception:error={}
    def identifier(value):
        return value if isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,128}',value) else None
    headers=response.headers or {}
    code=identifier(error.get('code'));kind=identifier(error.get('type'))
    diagnostics={'http_status':response.code,'code':code,'type':kind,'request_id':identifier(headers.get('x-request-id'))}
    details=error.get('moderation_details')
    if code=='moderation_blocked' and isinstance(details,dict):
        stage=details.get('moderation_stage')
        categories=details.get('categories')
        safe={}
        if stage in ['input','output','unknown']:safe['moderation_stage']=stage
        if isinstance(categories,list):safe['categories']=[c for c in categories[:16] if identifier(c)]
        if safe:diagnostics['moderation_details']=safe
    wait=headers.get('Retry-After','')
    if isinstance(wait,str) and re.fullmatch(r'\d{1,6}(\.\d{1,3})?',wait):diagnostics['retry_after_seconds']=float(wait)
    messages={401:'API key was rejected. Update the server key.',403:'This API project does not have access to the image model. Check project access and verification.',400:'OpenAI could not process this image request. Review the prompt and selected references before submitting again.'}
    if code=='moderation_blocked':
        message='OpenAI blocked this image request during a safety check. This is not an API sign-in or billing error.'
        details=diagnostics.get('moderation_details',{})
        if details.get('moderation_stage')=='input':message+=' The check flagged the prompt or input images.'
        elif details.get('moderation_stage')=='output':message+=' The check flagged the generated output.'
        else:message+=' OpenAI did not specify whether the prompt, input images or generated output caused the block.'
    elif response.code==429:
        billing={
            'credit_balance_exhausted':'The API organization has no credits remaining. Check API Billing and activate eligible subscription credits or add API credits in the organization used by this key.',
            'organization_spend_limit_exceeded':'The API organization reached its spending limit. Review its limit and usage in API Platform Billing before submitting again.',
            'project_spend_limit_exceeded':'This API project reached its spending limit. Review the selected project’s limits and usage before submitting again.',
            'organization_usage_limit_exceeded':'The API organization reached its approved usage limit. Check organization Limits; a higher approved limit may be needed.',
            'insufficient_quota':'OpenAI reports insufficient API quota. Check available credits and limits in the organization/project used by this API key.'}
        if code in billing:message=billing[code]
        elif code in ['rate_limit_exceeded','slow_down'] or kind in ['rate_limit_error','rate_limit_exceeded']:
            message='OpenAI temporarily rate-limited this image request. '+('Wait at least '+str(diagnostics['retry_after_seconds'])+' seconds before trying again.' if 'retry_after_seconds' in diagnostics else 'Check the image model’s rate limits in API Platform Limits before trying again.')
        elif kind=='insufficient_quota':message=billing['insufficient_quota']
        else:message='OpenAI returned HTTP 429 without a recognized cause. Check API Billing and the image model’s Limits before another submission.'
        if code:message+=' API code: '+code+'.'
    else:message=messages.get(response.code,'OpenAI returned HTTP '+str(response.code)+'.')
    return JobError(message+' No automatic retry was sent.',diagnostics)

def sha(raw): return hashlib.sha256(raw).hexdigest()
def atomic_bytes(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex)
    with temp.open('xb') as f: f.write(raw);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)

def api_key(state_dir):
    key=os.environ.get('OPENAI_API_KEY','').strip()
    path=state_dir/'image-api-key'
    if not key and path.is_file():
        if path.stat().st_mode & 0o077: raise JobError('API key file must be private (permissions 600). Run Set Up Image API.command again.')
        key=path.read_text().strip()
    if not key: raise JobError('Run Set Up Image API.command to configure the server API key, then refresh connection status.')
    if len(key)<20 or any(c.isspace() for c in key): raise JobError('API key format is invalid. Run Set Up Image API.command again.')
    return key

def call_openai(request,inputs,key):
    if request.get('generation_mode')=='location-beta':
        import location_editing
        return location_editing.call_openai(request,inputs,key)
    payload={'model':MODEL,'prompt':request['api_prompt'],'images':[{'image_url':'data:'+mime+';base64,'+base64.b64encode(raw).decode()} for mime,raw in inputs], 'size':SIZES[request['aspect']], 'quality':request['quality'],'n':1,'output_format':'png'}
    endpoint='edits' if inputs else 'generations'
    if not inputs:payload.pop('images')
    req=urllib.request.Request('https://api.openai.com/v1/images/'+endpoint,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'},method='POST')
    # Deliberately no automatic retry: a lost response may still have been billed.
    try:
        with urllib.request.urlopen(req,timeout=300) as response:
            raw=response.read(80*1024*1024+1)
            if len(raw)>80*1024*1024: raise JobError('API response exceeded the local size limit. No automatic retry was sent.')
            result=json.loads(raw)
            request_id=response.headers.get('x-request-id')
    except urllib.error.HTTPError as e:
        raise api_failure(e) from None
    except (urllib.error.URLError,TimeoutError,ConnectionError):
        raise JobError('The API response was interrupted. The request may have been processed or billed; no automatic retry was sent. Check API usage before starting another generation.') from None
    data=result.get('data') or []
    if len(data)!=1 or not data[0].get('b64_json'): raise JobError('OpenAI returned no single image. No automatic retry was sent.')
    try: image=base64.b64decode(data[0]['b64_json'],validate=True)
    except Exception: raise JobError('OpenAI returned invalid image data.') from None
    if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image)>20*1024*1024: raise JobError('Returned image is not a supported PNG or exceeds 20 MB.')
    return image,{'request_id':request_id,'model':MODEL,'usage':result.get('usage'),'size':result.get('size',payload['size']),'quality':result.get('quality',payload['quality'])}

class Manager:
    def __init__(self,store,transport=call_openai):
        self.store=store;self.transport=transport;self.dir=store.dir/'image-generation-jobs';self.dir.mkdir(exist_ok=True)
        self.lock=threading.RLock();self.registration_lock=threading.RLock();self.active_jobs={};self.job_lanes={};self.queue=[];waiting=[]
        self.cooldown_until=0;self.wake_timer=None
        for file in self.dir.glob('*/job.json'):
            job=json.loads(file.read_text())
            self.job_lanes[job['id']]=self.lane(job['request'])
            if job['status']=='queued' and not job.get('started_at'):
                waiting.append(job)
            elif job['status'] in ACTIVE:
                job['status']='save_failed' if (file.parent/'output.png').exists() else 'interrupted'
                job['message']='Saved output can be registered without another API call.' if job['status']=='save_failed' else 'Server stopped during generation. No automatic retry was sent; check API usage before a new submission.'
                self.save(job)
        self.queue=[j['id'] for j in sorted(waiting,key=lambda j:(j['created_at'],j['id']))]
        with self.lock:self.start_next()
    @staticmethod
    def lane(request):
        return 'location' if request.get('location_id') and not request.get('character_id') else 'character'
    @property
    def active(self):
        # Compatibility for older clients that display only one active request.
        return next(iter(self.active_jobs.values()),None)
    def wake(self):
        with self.lock:
            self.wake_timer=None
            self.start_next()
    def start_next(self):
        # Called under self.lock. FIFO per location, bounded workers per collection.
        if self.cooldown_until>time.time():
            if self.wake_timer is None:
                self.wake_timer=threading.Timer(self.cooldown_until-time.time(),self.wake)
                self.wake_timer.daemon=True;self.wake_timer.start()
            return
        for lane,capacity in LANE_CAPACITY.items():
            for index in range(capacity):
                slot=lane if index==0 else lane+':'+str(index+1)
                if slot in self.active_jobs:continue
                busy_locations={self.read(i)['request'].get('location_id') for i in self.active_for_lane('location')}
                for jid in list(self.queue):
                    if self.job_lanes[jid]!=lane:continue
                    job=self.read(jid)
                    if job['status']!='queued':
                        self.queue.remove(jid);continue
                    # Different locations may run together; views of one location stay ordered.
                    if lane=='location' and job['request'].get('location_id') in busy_locations:continue
                    job.update(status='generating',started_at=time.time(),message='Generating one image from the exact saved references…')
                    self.save(job);self.queue.remove(jid);self.active_jobs[slot]=jid
                    threading.Thread(target=self.run,args=(jid,),daemon=True).start()
                    break
    def active_for_lane(self,lane):
        return [jid for slot,jid in self.active_jobs.items() if slot.split(':')[0]==lane]
    def release_job(self,jid):
        for slot,value in list(self.active_jobs.items()):
            if value==jid:self.active_jobs.pop(slot)
    def config(self):
        try: api_key(getattr(self.store,'api_state_dir',self.store.dir));ready=True;message='Server key configured. API access and available credits are checked by OpenAI when you generate.'
        except JobError as e: ready=False;message=str(e)
        with self.lock:
            active=self.active;active_jobs=list(self.active_jobs.values());queued=list(self.queue)
            lanes={lane:{'active_job':next(iter(self.active_for_lane(lane)),None),'active_jobs':self.active_for_lane(lane),'capacity':capacity,'queued_jobs':[i for i in queued if self.job_lanes[i]==lane]} for lane,capacity in LANE_CAPACITY.items()}
            cooldown_until=self.cooldown_until
        return {'configured':ready,'location_beta':True,'model':MODEL,'qualities':['medium','high'],'sizes':SIZES,'message':message,'active_job':active,'active_jobs':active_jobs,'concurrency':sum(LANE_CAPACITY.values()),'generation_lanes':lanes,'cooldown_until':cooldown_until,'queue_supported':True,'queued_jobs':queued,'queue_length':len(queued),'billing_url':'https://platform.openai.com/settings/organization/billing/overview'}
    def save(self,job):
        job['updated_at']=time.time();self.store.atomic(self.dir/job['id']/'job.json',job)
    def read(self,jid):
        if not isinstance(jid,str) or not re.fullmatch(r'[a-f0-9]{32}',jid): raise JobError('Invalid generation job ID.')
        p=self.dir/jid/'job.json'
        if not p.exists(): raise JobError('Generation job not found.')
        return json.loads(p.read_text())
    def public(self,job):
        out={k:job.get(k) for k in ['id','status','message','created_at','updated_at','asset_id','metadata','api_error']}
        if job['request'].get('generation_mode')=='location-beta':
            import location_editing
            out['editing']=location_editing.public(job['request'])
        out['character_id']=job['request'].get('character_id');out['look_id']=job['request'].get('look_id');out['job_kind']=job['request'].get('job_kind','exploration');out['location_id']=job['request'].get('location_id')
        out['queue_lane']=self.job_lanes.get(job['id'],self.lane(job['request']))
        with self.lock:
            if job['status']=='queued' and job['id'] in self.queue:
                out['queue_position']=[i for i in self.queue if self.job_lanes[i]==out['queue_lane']].index(job['id'])+1
                out['message']='Queued · '+out['queue_lane'].title()+' lane · position '+str(out['queue_position'])+' · starts when this lane is available.'
        if job.get('asset_id'):
            m=json.loads((self.store.root/'manifest.json').read_text());a=next((a for a in m['assets'] if a['id']==job['asset_id']),None)
            if a:
                out['assets']=[a];out['characters']=[c for c in m['characters'] if c['id']==out['character_id']];out['locations']=[l for l in m.get('locations',[]) if l['id']==job['request'].get('location_id')]
        return out
    def validate(self,v):
        if not isinstance(v,dict): raise JobError('Invalid generation request.')
        if v.get('generation_mode')=='location-beta':
            import location_editing
            return location_editing.validate(self,v)
        if v.get('job_kind')=='studio':
            import studio_generation
            return studio_generation.validate(self,v)
        if v.get('job_kind')=='reference':
            import reference_generation
            return reference_generation.validate(self,v)
        if v.get('job_kind','exploration')!='exploration':raise JobError('Unknown generation job kind.')
        request=copy.deepcopy(v)
        try: jid=uuid.UUID(request['request_id']).hex
        except Exception: raise JobError('A unique request ID is required.') from None
        m=json.loads((self.store.root/'manifest.json').read_text());aa={a['id']:a for a in m['assets']}
        c=next((c for c in m['characters'] if c['id']==request.get('character_id')),None)
        look=next((l for l in (c or {}).get('looks',[]) if l['id']==request.get('look_id') and l.get('active_story') is not False),None)
        if not c or not look: raise JobError('Choose a known character and active costume look.')
        prompt=request.get('prompt')
        if not isinstance(prompt,str) or not 1<=len(prompt.strip())<=30000: raise JobError('Prompt must be between 1 and 30,000 characters.')
        if request.get('aspect') not in SIZES or request.get('quality') not in ['medium','high']: raise JobError('Choose a supported format and quality.')
        if request.get('setting_mode') not in ['location','limbo']: raise JobError('Choose a setting.')
        if request['setting_mode']=='location':
            if not any(l['id']==request.get('location_id') for l in m.get('locations',[])): raise JobError('Unknown location.')
        elif request.get('limbo_id') not in ['warm-gray','cream','dark','white']: raise JobError('Choose a supported studio setting.')
        else: request['location_id']=None
        action=request.get('action',{});known=None;library=None
        for name in ['exploration-actions.js']:
            path=self.store.root/name
            if not path.exists(): continue
            bank=json.loads(path.read_text().split('=',1)[1].strip().rstrip(';'))
            found=next((a for a in bank['actions'] if a['id']==action.get('id')),None)
            if found: known=found;library=bank['schema']+' v'+str(bank['version']);break
        if not known: raise JobError('Choose an action from the current action library.')
        request['action']={k:known[k] for k in ['id','text','category']};request['action_library']=library
        refs=request.get('input_references');roles=set();snapshots=[];normalized=[]
        if not isinstance(refs,list) or not 2<=len(refs)<=6: raise JobError('Supply exact likeness and costume references, plus any continuity, hair, expression and location references.')
        for ref in refs:
            if not isinstance(ref,dict): raise JobError('Invalid reference record.')
            role=ref.get('role');a=aa.get(ref.get('id'));h=ref.get('sha256')
            if role not in ['identity','costume','body','hairstyle','emotion','location'] or role in roles: raise JobError('Invalid or repeated reference role.')
            roles.add(role)
            if not a: raise JobError('Unknown reference image.')
            version=a if a.get('sha256')==h else next((p for p in a.get('previous_versions',[]) if p.get('sha256')==h),None)
            if not version: raise JobError('Exact reference version is unavailable: '+a['id'])
            try:
                from linked_media import reference_path
                path=reference_path(self.store.root,version['asset'])
            except (ValueError,OSError) as error:raise JobError(str(error)) from None
            raw=path.read_bytes()
            if len(raw)>20*1024*1024 or sha(raw)!=version.get('file_sha256',h): raise JobError('Reference file hash or size is invalid: '+a['id'])
            normalized.append({'id':a['id'],'sha256':h,'file_sha256':sha(raw),'role':role,'asset':version['asset'],'title':a['title']})
            snapshots.append((path.suffix,mimetypes.guess_type(str(path))[0],raw))
        if not {'identity','costume'}<=roles or (request['setting_mode']=='location' and 'location' not in roles): raise JobError('Required exact reference images are missing.')
        request['input_references']=normalized;request['character_name']=c['name'];request['look_name']=look['name']
        visual_prompt=prompt.split('\n\nCreate the image here in this conversation, then add it to the local reference desk')[0]
        roles_text='\n'.join('Image '+str(i+1)+': '+r['role']+' — '+r['id']+' — SHA256 '+r['sha256'] for i,r in enumerate(normalized))
        request['api_prompt']='Create one image using these attached references in this exact order:\n'+roles_text+'\n\n'+visual_prompt
        if len(request['api_prompt'])>32000: raise JobError('Prompt is too long with reference labels.')
        return jid,request,snapshots
    def submit(self,v):
        # Hash the original request before resolving references so an identical lost-response retry is safe.
        fingerprint=sha(json.dumps(v,sort_keys=True,separators=(',',':')).encode())
        try: jid=uuid.UUID(v['request_id']).hex
        except Exception: raise JobError('A unique request ID is required.') from None
        with self.lock:
            if (self.dir/jid/'job.json').exists():
                job=self.read(jid)
                if job['fingerprint']!=fingerprint: raise JobError('Request ID already used with different content.')
                return self.public(job)
            api_key(getattr(self.store,'api_state_dir',self.store.dir))
            jid,request,snapshots=self.validate(v)
            folder=self.dir/jid;folder.mkdir();inputs=[]
            for i,(ext,mime,raw) in enumerate(snapshots):
                name='input-'+str(i)+ext;atomic_bytes(folder/name,raw);inputs.append({'file':name,'mime':mime,'sha256':sha(raw)})
            job={'id':jid,'fingerprint':fingerprint,'request':request,'inputs':inputs,'status':'queued','message':'Queued for generation','created_at':time.time()}
            self.save(job);self.job_lanes[jid]=self.lane(request);self.queue.append(jid);self.start_next()
            return self.public(self.read(jid))
    def run(self,jid):
        job=self.read(jid)
        try:
            key=api_key(getattr(self.store,'api_state_dir',self.store.dir))
            inputs=[]
            for x in job['inputs']:
                raw=(self.dir/jid/x['file']).read_bytes()
                if sha(raw)!=x['sha256']: raise JobError('A job reference snapshot changed; generation stopped.')
                inputs.append((x['mime'],raw))
            output,metadata=self.transport(job['request'],inputs,key)
            atomic_bytes(self.dir/jid/'output.png',output)
            job['metadata']=metadata;job['output_sha256']=sha(output);self.save(job)
            with self.registration_lock:self.register(job)
        except Exception as e:
            if isinstance(e,JobError) and e.diagnostics:
                job['api_error']=e.diagnostics
                if e.diagnostics.get('http_status')==429 and (e.diagnostics.get('code') in ('rate_limit_exceeded','slow_down') or e.diagnostics.get('type') in ('rate_limit_error','rate_limit_exceeded')):
                    with self.lock:self.cooldown_until=max(self.cooldown_until,time.time()+max(1,e.diagnostics.get('retry_after_seconds',30)))
            job['status']='save_failed' if (self.dir/jid/'output.png').exists() else 'failed'
            job['message']=('Image saved locally, but gallery registration failed. Retry saving without generating again.' if job['status']=='save_failed' else str(e) if isinstance(e,JobError) else 'Generation failed unexpectedly. No automatic retry was sent; check API usage before a new submission.')
            self.save(job)
        finally:
            with self.lock:
                self.release_job(jid)
                self.start_next()
    def register(self,job):
        if job['request'].get('job_kind')=='studio':
            import studio_generation
            return studio_generation.register(self,job)
        if job['request'].get('job_kind')=='reference':
            import reference_generation
            return reference_generation.register(self,job)
        job.update(status='saving',message='Saving image, provenance and gallery links…');self.save(job)
        req=job['request'];raw=(self.dir/job['id']/'output.png').read_bytes();cid=req['character_id'];lid=req['look_id'];act=req['action'];aid='DESK-'+sha(raw)[:12].upper()
        if job.get('output_sha256') and sha(raw)!=job['output_sha256']: raise JobError('Saved output hash changed; registration stopped.')
        if not job.get('catalog_registration_started'):
            m=json.loads((self.store.root/'manifest.json').read_text())
            if any(a['id']==aid for a in m['assets']): raise JobError('Identical output already exists; existing reference preserved.')
            job['catalog_registration_started']=True;self.save(job)
        title=req['character_name']+' — '+act['id']+' — '+act['text']
        result=reference_catalog.mutate(self.store,'/api/references',{'character_id':cid,'look_id':lid,'type':'Scene reference','tags':[act['id'],act['category'],'Exploration candidate',req['look_name'][:80]],'upload':{'name':title[:230]+'.png','data':base64.b64encode(raw).decode()}})
        if req.get('location_id'): reference_catalog.mutate(self.store,'/api/location-references',{'location_id':req['location_id'],'slot_id':'scene-references','asset_ids':[aid]})
        with self.store.lock,(self.store.dir/'catalog-write.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            path=self.store.root/'manifest.json';original=path.read_bytes();m=json.loads(original);a=next(a for a in m['assets'] if a['id']==aid)
            provenance='sources/'+aid+'-generation.json';promptfile='prompts/recovered/'+aid+'.txt'
            (self.store.root/'sources').mkdir(exist_ok=True)
            record={'schema':'desk.generation-provenance','created_at':job['created_at'],'tool':'OpenAI Images API','job_id':job['id'],'character_id':cid,'look_id':lid,'location_id':req.get('location_id'),'setting_mode':req['setting_mode'],'limbo_id':req.get('limbo_id'),'action_id':act['id'],'action':act['text'],'action_category':act['category'],'action_library':req['action_library'],'input_references':req['input_references'],'prompt':req['prompt'],'api_prompt':req['api_prompt'],'output_sha256':sha(raw),'status':'Candidate','approved':False,'api':job.get('metadata',{}),'review_state':'Unapproved, unranked; no selected reference changed'}
            self.store.atomic(self.store.root/provenance,record);atomic_bytes(self.store.root/promptfile,req['api_prompt'].encode())
            a.update({'title':title,'generation_job_id':job['id'],'stage':req['look_name'],'look_id':lid,'look_ids':[lid],'action_id':act['id'],'action_library':req['action_library'],'action_category':act['category'],'action_poses':[act['text']],'setting_mode':req['setting_mode'],'limbo_id':req.get('limbo_id'),'location_id':req.get('location_id'),'input_references':req['input_references'],'reference_ids':[r['id'] for r in req['input_references']],'generation_provenance':provenance,'metadata_sources':[provenance],'generated_candidate':True,'original_prompt_status':'Exact API prompt recorded','original_prompt_text_file':promptfile,'original_prompts':[{'text':req['api_prompt'],'source':provenance,'locator':'$.api_prompt'}],'identity_basis':'Exact input IDs and SHA-256 values validated and snapshotted before generation.','visually_reviewed':False,'usage_note':'Creative exploration; user review required before adoption.','sources':['OpenAI Images API job '+job['id']]})
            hair=next((r for r in req['input_references'] if r['role']=='hairstyle'),None)
            if hair:a.update(hairstyle_reference_id=hair['id'],hairstyle_reference_sha256=hair['sha256'])
            history=self.store.root/'catalog-history';history.mkdir(exist_ok=True);atomic_bytes(history/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json'),original)
            self.store.atomic(path,m);atomic_bytes(self.store.root/'data.js',('window.DESK_DATA = '+json.dumps(m,ensure_ascii=False)+';\n').encode())
        job.update(status='completed',message='Saved as an unapproved candidate.',asset_id=aid);self.save(job)
    def retry_save(self,jid):
        with self.lock:
            job=self.read(jid)
            if job['status']=='completed':return self.public(job)
            if job['status']!='save_failed' or not (self.dir/jid/'output.png').exists(): raise JobError('No saved image is available for gallery registration.')
            lane=self.job_lanes.setdefault(jid,self.lane(job['request']))
            slots=[lane if i==0 else lane+':'+str(i+1) for i in range(LANE_CAPACITY[lane])]
            slot=next((s for s in slots if s not in self.active_jobs),None)
            busy=lane=='location' and any(self.read(i)['request'].get('location_id')==job['request'].get('location_id') for i in self.active_for_lane(lane))
            if slot is None or busy:raise JobError('Wait for the current '+lane+' image job to finish.')
            self.active_jobs[slot]=jid
        try:
            with self.registration_lock:self.register(job)
        except Exception:
            job.update(status='save_failed',message='Gallery registration failed again. The generated image remains saved locally.');self.save(job)
        finally:
            with self.lock:
                self.release_job(jid)
                self.start_next()
        return self.public(job)
