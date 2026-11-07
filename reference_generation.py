"""Single reference jobs for character, wardrobe, location and scene brief views."""
import base64,copy,fcntl,json,mimetypes,re,time,uuid
import reference_catalog,location_catalog

def validate(manager,v):
    from image_generation import JobError,SIZES,sha
    r=copy.deepcopy(v);root=manager.store.root
    try:jid=uuid.UUID(r['request_id']).hex
    except Exception:raise JobError('A unique request ID is required.') from None
    m=json.loads((root/'manifest.json').read_text());aa={a['id']:a for a in m['assets']};cid=r.get('character_id');lid=r.get('look_id');locid=r.get('location_id');typ=r.get('reference_type')
    if typ not in reference_catalog.TYPES:raise JobError('Choose a known reference category.')
    if r.get('quality') not in ['medium','high'] or r.get('aspect') not in SIZES:raise JobError('Choose a supported quality and format.')
    if not isinstance(r.get('prompt'),str) or not 1<=len(r['prompt'].strip())<=30000:raise JobError('Use a prompt between 1 and 30,000 characters.')
    if bool(cid)==bool(locid):raise JobError('Choose one character or one location for this reference.')
    c=next((c for c in m['characters'] if c['id']==cid),None);loc=next((l for l in m.get('locations',[]) if l['id']==locid),None)
    look=next((l for l in (c or {}).get('looks',[]) if l['id']==lid and l.get('active_story') is not False),None)
    if cid and not c:raise JobError('Unknown character.')
    if lid and not look:raise JobError('Choose an active look for this character.')
    if typ in ['Full-body / costume','Mannequin outfit study'] and not look:raise JobError('Choose a costume stage before generating.')
    if locid and (not loc or r.get('slot_id') not in location_catalog.SLOT_IDS or typ!='Scene reference'):raise JobError('Choose a valid location and reference slot.')
    if typ=='Individual emotion' and r.get('emotion') is not None:
        import emotion_slots
        try:r['emotion']=emotion_slots.name(r['emotion'])
        except ValueError as e:raise JobError(str(e)) from None
    refs=r.get('input_references');normalized=[];snapshots=[];seen=set()
    if not isinstance(refs,list) or len(refs)>16:raise JobError('Use at most 16 exact reference images.')
    for ref in refs:
        if not isinstance(ref,dict):raise JobError('Invalid reference record.')
        a=aa.get(ref.get('id'));h=ref.get('sha256');role=ref.get('role')
        if role not in ['identity','costume','body','emotion','hairstyle','location']:raise JobError('Unknown reference role.')
        if not a:raise JobError('Unknown reference image.')
        if (a['id'],h) in seen:continue
        seen.add((a['id'],h))
        version=a if a.get('sha256')==h else next((x for x in a.get('previous_versions',[]) if x.get('sha256')==h),None)
        if not version:raise JobError('Exact reference version is unavailable: '+a['id'])
        try:
            from linked_media import reference_path
            p=reference_path(root,version['asset'])
        except (ValueError,OSError) as error:raise JobError(str(error)) from None
        raw=p.read_bytes()
        if len(raw)>20*1024*1024 or sha(raw)!=version.get('file_sha256',h):raise JobError('Reference file hash or size is invalid: '+a['id'])
        normalized.append({'id':a['id'],'sha256':h,'file_sha256':sha(raw),'role':role,'asset':version['asset'],'title':a['title']});snapshots.append((p.suffix,mimetypes.guess_type(str(p))[0],raw))
    choices=manager.store.read()['choices'];selected=choices.get('canonical_references',{}).get(cid,{}).get('likeness')
    needs_face=typ in ['Full-body / costume','Emotion map','Individual emotion','Hairstyle study']
    if cid and needs_face:
        if typ=='Individual emotion' and r.get('provisional_identity') is True:
            identities=[x for x in normalized if x['role']=='identity']
            if len(identities)!=1 or len(normalized)!=1:raise JobError('A provisional emotion study requires exactly one portrait identity reference.')
            identity=identities[0];asset=aa[identity['id']]
            if asset.get('type')!='Portrait / likeness':raise JobError('Choose a portrait / likeness for a provisional emotion study.')
            item=next((x for x in choices.get('items',[]) if x.get('id')==identity['id']),{})
            if item.get('preference')=='Reject':raise JobError('The provisional likeness was rejected. Choose another candidate.')
            r['reference_mode']='provisional-identity'
        elif r.get('explicit_reference_choices') is True and typ=='Full-body / costume':
            identities=[x for x in normalized if x['role']=='identity'];costumes=[x for x in normalized if x['role']=='costume']
            if len(identities)>1 or len(costumes)>1 or len(normalized)!=len(identities)+len(costumes):raise JobError('Use at most one optional portrait and one optional costume seed, then regenerate the prompt.')
            r['reference_mode']='portrait-and-costume' if identities and costumes else 'portrait-only' if identities else 'costume-only' if costumes else 'text-only'
            if identities and aa[identities[0]['id']].get('type')!='Portrait / likeness' and not (selected and identities[0]['id']==selected['id'] and identities[0]['sha256']==selected['source_sha256']):raise JobError('Choose a portrait / likeness for the face reference.')
        elif not selected or not any(x['role']=='identity' and x['id']==selected['id'] and x['sha256']==selected['source_sha256'] for x in normalized):raise JobError('Save a selected likeness and refresh the request before generating this character.')
    for x in normalized:
        a=aa[x['id']]
        revision_source=r.get('storyboard_context') or {}
        explicit_revision_parent=(r.get('generation_mode')=='location-beta' and r.get('operation')=='refine'
                                  and revision_source.get('asset_id')==x['id'] and revision_source.get('sha256')==x['sha256']
                                  and r.get('parent_asset')=={'id':x['id'],'sha256':x['sha256']})
        if location_catalog.obsolete(manager.store,a) and not explicit_revision_parent:raise JobError('A reference was set aside. Refresh the request before generating.')
        if cid and cid not in a.get('character_ids',[]):raise JobError('Reference belongs to a different character.')
        if loc:
            allowed={i for ids in loc.get('references',{}).values() for i in ids};allowed.add(loc.get('canonical_source',{}).get('id'))
            if x['id'] not in allowed:raise JobError('Reference is not linked to this location.')
    if loc and not normalized:
        if r.get('design_proposal') is not True or len(r.get('design_direction','').strip())<20:raise JobError('This location has no continuity reference. Add references, or explicitly describe and request a new design proposal.')
    scene_key=r.get('scene_key')
    if scene_key:
        plan=(loc or {}).get('production',{}).get('scenes',{}).get(scene_key)
        requirement=next((x for x in (plan or {}).get('requirements',[]) if x['id']==r.get('requirement_id')),None)
        if not plan or plan.get('source_sha256')!=loc.get('script_source',{}).get('sha256') or r.get('script_sha256')!=plan['source_sha256']:raise JobError('Review and save this scene brief against the current script first.')
        if plan.get('usage')!='on-screen' or plan.get('decisions','').strip() or not requirement:raise JobError('Resolve the scene brief and its image requirement before generation.')
        if requirement.get('reuse') and r.get('generation_mode')!='location-beta':raise JobError('This requirement reuses an existing image; no generation is needed.')
        if requirement!=r.get('requirement_snapshot') or plan!=r.get('scene_plan_snapshot'):raise JobError('Scene requirements changed. Reopen the image brief.')
        if r['slot_id']!=requirement['slot_id']:raise JobError('Reference slot does not match this requirement.')
    r.update(input_references=normalized,character_name=c['name'] if c else None,look_name=look['name'] if look else None,location_name=loc['name'] if loc else None)
    r['title']=(c['name'] if c else loc['name'])+' — '+(look['name']+' — ' if look else '')+typ
    if typ=='Individual emotion' and r.get('emotion'):r['title']+=' — '+r['emotion']
    if loc:r['title']=loc['name']+' — '+next(s[1] for s in location_catalog.SLOTS if s[0]==r['slot_id'])
    labels='\n'.join('Image '+str(i+1)+': '+x['role']+' — '+x['id']+' — SHA256 '+x['sha256'] for i,x in enumerate(normalized))
    r['api_prompt']='Generate one image only. The application saves the result for review. '+('Use only the attached images as the exact visual references. ' if normalized else 'No input images are attached; generate from the text direction only. ')+ 'Do not access localhost URLs or perform file/catalog operations.\n'+labels+'\n\n'+r['prompt']
    if r.get('reference_mode')=='provisional-identity':r['api_prompt']+='\n\nThis is an unapproved provisional identity study, not a selected or approved likeness. Preserve the one attached face exactly; do not blend with other likenesses.'
    if r.get('design_proposal'):r['api_prompt']+='\n\nUser explicitly requests an unapproved initial location design proposal: '+r['design_direction']
    if len(r['api_prompt'])>32000:raise JobError('Prompt plus reference labels exceeds the API limit.')
    return jid,r,snapshots

def register(manager,job):
    from image_generation import JobError,sha,atomic_bytes
    store=manager.store;req=job['request'];raw=(manager.dir/job['id']/'output.png').read_bytes();aid='DESK-'+sha(raw)[:12].upper()
    if sha(raw)!=job.get('output_sha256'):raise JobError('Saved output hash changed; registration stopped.')
    if not job.get('catalog_registration_started'):
        m=json.loads((store.root/'manifest.json').read_text())
        if any(a['id']==aid for a in m['assets']):raise JobError('Identical image already exists; existing reference preserved.')
        job['catalog_registration_started']=True;manager.save(job)
    job.update(status='saving',message='Saving an unapproved reference with exact input provenance…');manager.save(job)
    upload={'name':req['title'][:230]+'.png','data':base64.b64encode(raw).decode()}
    if req.get('character_id'):
        reference_catalog.mutate(store,'/api/references',{'character_id':req['character_id'],'look_id':req.get('look_id'),'type':req['reference_type'],'tags':['Generated candidate'],'upload':upload})
    else:reference_catalog.mutate(store,'/api/location-references',{'location_id':req['location_id'],'slot_id':req['slot_id'],'tags':['Generated candidate'],'upload':upload})
    with store.lock,(store.dir/'catalog-write.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX);path=store.root/'manifest.json';before=path.read_bytes();m=json.loads(before);a=next(a for a in m['assets'] if a['id']==aid)
        source='sources/'+aid+'-generation.json';promptfile='prompts/recovered/'+aid+'.txt';(store.root/'sources').mkdir(exist_ok=True)
        record={'schema':'desk.generation-provenance','job_id':job['id'],'created_at':job['created_at'],'tool':'OpenAI Responses API' if req.get('generation_mode')=='location-beta' else 'OpenAI Images API','request':req,'input_references':req['input_references'],'output_sha256':sha(raw),'api':job.get('metadata',{}),'status':'Candidate','approved':False}
        store.atomic(store.root/source,record);atomic_bytes(store.root/promptfile,req['api_prompt'].encode())
        a.update(title=req['title'],generation_job_id=job['id'],generated_candidate=True,input_references=req['input_references'],reference_ids=[x['id'] for x in req['input_references']],generation_provenance=source,original_prompt_text_file=promptfile,original_prompt_status='Exact API prompt recorded',original_prompts=[{'text':req['api_prompt'],'source':source,'locator':'$.request.api_prompt'}],metadata_sources=[source],sources=['OpenAI Images API job '+job['id']])
        if req.get('reference_mode')=='provisional-identity':
            a['provisional_identity']=True
            a['tags']=list(dict.fromkeys(a.get('tags',[])+['Provisional identity study']))
        if req.get('generation_mode')=='location-beta':
            a['image_editing']={k:req.get(k) for k in ['session_id','parent_turn_id','parent_asset','operation']}
            a['sources']=['OpenAI Responses API job '+job['id']]
        if req.get('generation_mode')=='location-beta' and req.get('storyboard_context'):
            context=req['storyboard_context']
            a['storyboard_appearances']=[{k:context[k] for k in ['storyboard_id','song','shot_id','slot_number']}]
            a['storyboard_revision_source']={k:context[k] for k in ['asset_id','sha256']}
            a['tags']=reference_catalog.tags(a.get('tags',[])+[context['song'],context['shot_id'],'Storyboard revision'])
        if req.get('reference_type')=='Individual emotion' and req.get('emotion'):
            a['emotion']=req['emotion'];a['tags']=reference_catalog.tags(a.get('tags',[])+['Emotion: '+req['emotion']])
        if req.get('look_id'):a.update(look_id=req['look_id'],look_ids=[req['look_id']],stage=req['look_name'])
        if req.get('scene_key'):
            link={k:req[k] for k in ['location_id','scene_key','requirement_id','script_sha256']}
            if link not in a.setdefault('scene_requirement_links',[]):a['scene_requirement_links'].append(link)
        history=store.root/'catalog-history';history.mkdir(exist_ok=True);atomic_bytes(history/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json'),before)
        store.atomic(path,m);atomic_bytes(store.root/'data.js',('window.DESK_DATA = '+json.dumps(m,ensure_ascii=False)+';\n').encode())
    job.update(status='completed',message='Saved as an unapproved candidate. Review before selecting or assigning it.',asset_id=aid);manager.save(job)
