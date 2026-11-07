"""Standalone image generation with optional exact inputs and explicit catalogue links."""
import base64,copy,fcntl,json,mimetypes,time,uuid
import reference_catalog,location_catalog
ROLES={'reference','identity','costume','location','composition','style'}

def validate(manager,value):
 from image_generation import JobError,SIZES,sha
 r=copy.deepcopy(value);root=manager.store.root
 try:jid=uuid.UUID(r['request_id']).hex
 except Exception:raise JobError('A unique request ID is required.') from None
 def text(key,limit,required=False):
  v=r.get(key,'')
  if not isinstance(v,str) or len(v)>limit or (required and not v.strip()):raise JobError('Enter '+key+' (up to '+str(limit)+' characters).')
  return v.strip()
 r['prompt']=text('prompt',30000,True);r['title']=text('title',180,True)
 r['camera']=text('camera',160);r['expression']=text('expression',300);r['time_of_day']=text('time_of_day',100);r['weather']=text('weather',100)
 if r.get('quality') not in ['medium','high'] or r.get('aspect') not in SIZES:raise JobError('Choose a supported quality and format.')
 try:r['tags']=reference_catalog.tags(r.get('tags',[]))
 except ValueError as e:raise JobError(str(e)) from None
 if len(r['tags'])>38:raise JobError('Use up to 38 custom tags.')
 m=json.loads((root/'manifest.json').read_text());aa={a['id']:a for a in m['assets']}
 c=next((c for c in m['characters'] if c['id']==r.get('character_id')),None)
 loc=next((l for l in m.get('locations',[]) if l['id']==r.get('location_id')),None)
 look=next((l for l in (c or {}).get('looks',[]) if l['id']==r.get('look_id') and l.get('active_story') is not False),None)
 for key,item in [('character_id',c),('location_id',loc),('look_id',look)]:
  if r.get(key) and not item:raise JobError('Choose a valid '+key.replace('_id','')+'.')
 if r.get('reference_type') not in reference_catalog.TYPES:raise JobError('Choose a reference category.')
 refs=r.get('input_references');normalized=[];snapshots=[];seen=set()
 if not isinstance(refs,list) or len(refs)>8:raise JobError('Attach up to eight exact images.')
 for ref in refs:
  if not isinstance(ref,dict) or ref.get('role') not in ROLES:raise JobError('Choose a valid purpose for each input image.')
  a=aa.get(ref.get('id'));h=ref.get('sha256')
  if not a or not isinstance(h,str):raise JobError('Unknown reference image.')
  if a['id'] in seen:raise JobError('Attach each image only once.')
  seen.add(a['id'])
  if location_catalog.obsolete(manager.store,a):raise JobError('An attached image has been set aside. Remove it or choose another.')
  version=a if a.get('sha256')==h else next((v for v in a.get('previous_versions',[]) if v.get('sha256')==h),None)
  if not version:raise JobError('Exact input version is unavailable: '+a['id'])
  try:
   from linked_media import reference_path
   p=reference_path(root,version['asset'])
  except (ValueError,OSError) as error:raise JobError(str(error)) from None
  raw=p.read_bytes()
  if len(raw)>20*1024*1024 or sha(raw)!=version.get('file_sha256',h):raise JobError('Input image hash or size is invalid: '+a['id'])
  normalized.append({'id':a['id'],'sha256':h,'file_sha256':sha(raw),'role':ref['role'],'title':a['title'],'asset':version['asset']});snapshots.append((p.suffix,mimetypes.guess_type(str(p))[0],raw))
 r['input_references']=normalized;r['character_name']=c['name'] if c else None;r['look_name']=look['name'] if look else None;r['location_name']=loc['name'] if loc else None
 labels='\n'.join(f"Image {i+1}: {ref['role']} — {ref['id']} — SHA256 {ref['sha256']}" for i,ref in enumerate(normalized))
 r['api_prompt']='Generate one image only. '+('Use only the attached input images in this order:\n'+labels if normalized else 'No image references are attached; use the written direction.')+'\nDo not access localhost URLs or perform catalogue operations.\n\n'+r['prompt']
 if len(r['api_prompt'])>32000:raise JobError('Prompt plus reference labels exceeds the API limit.')
 return jid,r,snapshots

def register(manager,job):
 from image_generation import JobError,sha,atomic_bytes
 store=manager.store;root=store.root;r=job['request'];raw=(manager.dir/job['id']/'output.png').read_bytes();aid='DESK-'+sha(raw)[:12].upper()
 if sha(raw)!=job.get('output_sha256'):raise JobError('Output hash changed; saving stopped.')
 job.update(status='saving',message='Saving image, tags and exact input provenance…');manager.save(job)
 with store.lock,(store.dir/'catalog-write.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);path=root/'manifest.json';before=path.read_bytes();m=json.loads(before)
  a=next((a for a in m['assets'] if a['id']==aid),None)
  if a and a.get('generation_job_id')!=job['id']:raise JobError('Identical image already exists; its references and tags were preserved.')
  c=next((c for c in m['characters'] if c['id']==r.get('character_id')),None);loc=next((l for l in m.get('locations',[]) if l['id']==r.get('location_id')),None)
  look=next((l for l in (c or {}).get('looks',[]) if l['id']==r.get('look_id')),None)
  if (r.get('character_id') and not c) or (r.get('look_id') and not look) or (r.get('location_id') and not loc):raise JobError('A save destination is no longer available; the image remains saved locally.')
  source='sources/'+aid+'-generation.json';promptfile='prompts/recovered/'+aid+'.txt'
  if not a:
   item=reference_catalog.image_file(root,{'name':r['title']+'.png','data':base64.b64encode(raw).decode()})
   a={**item,'title':r['title'],'character_ids':[c['id']] if c else [],'primary_character_ids':[c['id']] if c else [],'type':r['reference_type'],'status':'Candidate','approval':'Unapproved generation; review required.','stage':look['name'] if look else 'Unspecified','emotion':r.get('expression',''),'tags':reference_catalog.tags(r['tags']+['Generated candidate','Image Generation']),'generation_job_id':job['id'],'generated_candidate':True,'input_references':r['input_references'],'reference_ids':[x['id'] for x in r['input_references']],'generation_provenance':source,'original_prompt_text_file':promptfile,'original_prompts':[{'text':r['api_prompt'],'source':source,'locator':'$.request.api_prompt'}],'original_prompt_status':'Exact API prompt recorded','metadata_sources':[source],'sources':['OpenAI Images API job '+job['id']],'identity_basis':'User-selected optional references; proposed image for review.','visually_reviewed':False,'asset_encoding':'Generated original PNG bytes unchanged','neutral_full_body_eligible':r['reference_type']=='Full-body / costume','mannequin_outfit_eligible':r['reference_type']=='Mannequin outfit study','uploaded_at':time.time()}
   m['assets'].append(a)
   for key in ['indexed_unique_images','indexed_provenance_paths','review_records']:
    if isinstance(m.get('audit',{}).get(key),int):m['audit'][key]+=1
  if c:
   if aid not in c.setdefault('candidate_ids',[]):c['candidate_ids'].append(aid)
   a['reference_links']=[{'character_id':c['id'],'type':r['reference_type']}]
   key=reference_catalog.KEYS[reference_catalog.TYPES.index(r['reference_type'])]
   slot=c.setdefault('reference_audit',{}).setdefault(key,{'category':r['reference_type'],'status':'Candidate','candidate_ids':[],'confirmed_ids':[],'obsolete_ids':[]})
   if aid not in slot.setdefault('candidate_ids',[]):slot['candidate_ids'].append(aid)
   if slot.get('status')=='Missing':slot['status']='Candidate'
   c['missing_reference_types']=[x for x in c.get('missing_reference_types',[]) if x!=r['reference_type']]
  if look:
   a.update(look_id=look['id'],look_ids=[look['id']],look_links=[{'character_id':c['id'],'look_id':look['id']}])
   key={'Full-body / costume':'full_body','Mannequin outfit study':'mannequin'}.get(r['reference_type'])
   if key:
    slot=look.setdefault(key,{'status':'Candidate','candidate_ids':[],'confirmed_ids':[],'obsolete_ids':[]})
    if aid not in slot.setdefault('candidate_ids',[]):slot['candidate_ids'].append(aid)
    if slot.get('status')=='Missing':slot['status']='Candidate'
   elif aid not in look.setdefault('supporting_reference_ids',[]):look['supporting_reference_ids'].append(aid)
  if loc:
   a['location_ids']=[loc['id']]
   refs=loc.setdefault('references',{}).setdefault('scene-references',[])
   if aid not in refs:refs.append(aid)
  record={'schema':'desk.generation-provenance','job_id':job['id'],'created_at':job['created_at'],'tool':'OpenAI Images API','request':r,'input_references':r['input_references'],'output_sha256':sha(raw),'api':job.get('metadata',{}),'approved':False}
  (root/'sources').mkdir(exist_ok=True);store.atomic(root/source,record);atomic_bytes(root/promptfile,r['api_prompt'].encode())
  history=root/'catalog-history';history.mkdir(exist_ok=True);atomic_bytes(history/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json'),before)
  store.atomic(path,m);atomic_bytes(root/'data.js',('window.DESK_DATA = '+json.dumps(m,ensure_ascii=False)+';\n').encode())
  if look and (root/'looks.json').exists():
   looks=json.loads((root/'looks.json').read_text());looks['looks']=[look if l['id']==look['id'] else l for l in looks.get('looks',[])];store.atomic(root/'looks.json',looks)
 job.update(status='completed',message='Saved as an unapproved candidate with your tags.',asset_id=aid);manager.save(job)
