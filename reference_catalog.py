"""Additive local reference library; never writes review choices."""
import base64, binascii, copy, fcntl, hashlib, json, os, subprocess, tempfile, time, uuid
from pathlib import Path
TYPES=['Portrait / likeness','Full-body / costume','Emotion map','Individual emotion','Scene reference','Supporting prop / map','Mannequin outfit study','Hairstyle study']
KEYS=['portrait','neutral_full_body','emotion_map','individual_emotion','scene_reference','supporting_prop_map','mannequin_outfit','hairstyle']
class Conflict(ValueError): pass

def tags(value):
 if not isinstance(value,list) or len(value)>40: raise ValueError('Use up to 40 tags')
 result=[]; seen=set()
 for item in value:
  if not isinstance(item,str): raise ValueError('Tags must be text')
  item=' '.join(item.split())
  if len(item)>80: raise ValueError('Each tag must be 80 characters or less')
  if item and item.casefold() not in seen: result.append(item);seen.add(item.casefold())
 return result

def image_file(root, upload):
 if not isinstance(upload,dict): raise ValueError('Invalid image upload')
 name=upload.get('name','')
 if not isinstance(name,str) or not name or len(name)>250: raise ValueError('Invalid filename')
 try: raw=base64.b64decode(upload.get('data',''),validate=True)
 except (ValueError,binascii.Error): raise ValueError('Invalid image data')
 if not 0<len(raw)<=20*1024*1024: raise ValueError('Each image must be at most 20 MB')
 ext='.png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else '.jpg' if raw.startswith(b'\xff\xd8\xff') else '.webp' if raw[:4]==b'RIFF' and raw[8:12]==b'WEBP' else None
 if not ext: raise ValueError('Upload PNG, JPEG or WebP images')
 h=hashlib.sha256(raw).hexdigest(); aid='DESK-'+h[:12].upper()
 with tempfile.TemporaryDirectory() as temp:
  src=Path(temp)/('source'+ext);src.write_bytes(raw)
  p=subprocess.run(['sips','-g','pixelWidth','-g','pixelHeight',str(src)],capture_output=True,text=True,timeout=15)
  try:
   size={line.split(':')[0].strip():int(line.split(':')[1]) for line in p.stdout.splitlines() if 'pixelWidth:' in line or 'pixelHeight:' in line}
   w,ht=size['pixelWidth'],size['pixelHeight']
   if p.returncode or min(w,ht)<1 or max(w,ht)>30000 or w*ht>100000000: raise ValueError()
  except (ValueError,KeyError): raise ValueError('Image cannot be decoded or is too large')
  asset='assets/'+aid+ext;thumb='thumbs/'+aid+'.jpg'
  for folder in ['assets','thumbs']: (root/folder).mkdir(exist_ok=True)
  target=root/asset
  if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=h: raise ValueError('Image ID collision')
  if not target.exists():
   with target.open('xb') as f:f.write(raw)
  if not (root/thumb).exists():
   out=Path(temp)/'thumb.jpg'
   subprocess.run(['sips','-s','format','jpeg','-Z','600',str(src),'--out',str(out)],check=True,capture_output=True,timeout=20)
   (root/thumb).write_bytes(out.read_bytes())
 return {'id':aid,'sha256':h,'asset':asset,'thumbnail':thumb,'width':w,'height':ht,'title':Path(name).name}

def mutate(store,route,request):
 root=store.root
 with store.lock,(store.dir/'catalog-write.lock').open('a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  original=(root/'manifest.json').read_bytes(); m=json.loads(original)
  aa={a['id']:a for a in m['assets']};cc={c['id']:c for c in m['characters']}
  changed=[];chars=[];new_count=0;locations=[];look_id=None
  if route=='/api/characters':
   from manage_project import add_character
   token=str(uuid.UUID(request.get('request_id','')))
   context={k:request.get(k,default) for k,default in [('name',''),('group','Characters'),('description',''),('age',None)]}
   existing=next((c for c in m['characters'] if c.get('creation_request_id')==token),None)
   if existing:
    if existing.get('creation_request_context')!=context:raise Conflict('This request was already saved with different character details.')
    return {'characters':[existing],'groups':m['groups'],'audit':m['audit']}
   c=add_character(m,**context);c['creation_request_id']=token;c['creation_request_context']=context;chars=[c]
  elif route in ['/api/locations','/api/location-references','/api/location-selection','/api/location-approval','/api/location-adopt','/api/location-production']:
   import location_catalog
   changed,locations,new_count=location_catalog.mutate(store,m,aa,route,request)
  elif route=='/api/props':
   import prop_catalog
   c=cc.get(request.get('character_id'))
   if not c:raise ValueError('Choose a known character')
   prop_catalog.update(c,aa,request);chars=[c]
  elif route=='/api/emotions':
   import emotion_slots
   c=cc.get(request.get('character_id'))
   if not c:raise ValueError('Choose a known character')
   emotion_slots.create(c,request);chars=[c]
  elif route=='/api/looks':
   import custom_looks
   c=cc.get(request.get('character_id'))
   if not c:raise ValueError('Choose a known character')
   look_id=custom_looks.create(c,request)['id'];chars=[c]
  elif route=='/api/reference-tags':
   a=aa.get(request.get('id'))
   if not a: raise ValueError('Unknown image')
   if request.get('expected_tags')!=a.get('tags',[]): raise Conflict('Tags changed elsewhere. Reopen the tag editor before saving.')
   a['tags']=tags(request.get('tags'));changed=[a]
  else:
   cid=request.get('character_id');typ=request.get('type');c=cc.get(cid)
   if not c or typ not in TYPES: raise ValueError('Choose a known character and reference type')
   lid=request.get('look_id');look=next((l for l in c.get('looks',[]) if l['id']==lid and l.get('active_story') is not False),None) if lid else None
   if lid and not look:raise ValueError('Choose an active look for this character')
   extra=tags(request.get('tags',[]));ids=request.get('asset_ids',[])
   if not isinstance(ids,list) or len(ids)>200 or any(not isinstance(x,str) or x not in aa for x in ids):raise ValueError('Unknown image selection')
   if request.get('upload') is not None:
    item=image_file(root,request['upload']);aid=item['id']
    if aid in aa and aa[aid]['sha256']!=item['sha256']:raise ValueError('Image ID collision')
    if aid not in aa:
     a={**item,'character_ids':[cid],'primary_character_ids':[cid],'type':typ,'status':'Candidate','approval':'Unapproved upload; no selection or rating changed.','stage':'Unspecified — verify before use','emotion':'','sources':['Local upload: '+item['title']],'metadata_sources':[],'identity_basis':'User upload; identity and usage require review','visually_reviewed':False,'asset_encoding':'Uploaded original bytes unchanged','neutral_full_body_eligible':typ=='Full-body / costume','mannequin_outfit_eligible':typ=='Mannequin outfit study','original_prompts':[],'original_prompt_status':'Not supplied with upload','uploaded_at':time.time()}
     aa[aid]=a;m['assets'].append(a);new_count+=1
    ids=list(dict.fromkeys(ids+[aid]))
   if not ids:raise ValueError('Select images or upload a file')
   for aid in ids:
    a=aa[aid];a.setdefault('primary_character_ids',list(a['character_ids']))
    link={'character_id':cid,'type':typ}
    if link not in a.setdefault('reference_links',[]):a['reference_links'].append(link)
    if cid not in a['character_ids']:a['character_ids'].append(cid)
    if aid not in c['candidate_ids']:c['candidate_ids'].append(aid)
    a['tags']=tags(a.get('tags',[])+extra)
    slot=c.setdefault('reference_audit',{}).setdefault(KEYS[TYPES.index(typ)],{'category':typ,'status':'Candidate','confirmed_ids':[],'candidate_ids':[],'obsolete_ids':[]})
    if aid not in slot.setdefault('candidate_ids',[]):slot['candidate_ids'].append(aid)
    if slot.get('status')=='Missing':slot['status']='Candidate'
    c['missing_reference_types']=[x for x in c.get('missing_reference_types',[]) if x!=typ]
    if look is not None:
     use={'character_id':cid,'look_id':lid}
     if use not in a.setdefault('look_links',[]):a['look_links'].append(use)
     target='full_body' if a['type']=='Full-body / costume' else 'mannequin' if a['type']=='Mannequin outfit study' else None
     if target:
      ls=look.setdefault(target,{'status':'Candidate','candidate_ids':[],'confirmed_ids':[],'obsolete_ids':[]})
      if aid not in ls.setdefault('candidate_ids',[]):ls['candidate_ids'].append(aid)
      if ls.get('status')=='Missing':ls['status']='Candidate'
     else:
      if aid not in look.setdefault('supporting_reference_ids',[]):look['supporting_reference_ids'].append(aid)
    changed.append(a)
   chars=[c]
  if new_count:
   for key in ['indexed_unique_images','indexed_provenance_paths','review_records']:
    if isinstance(m.get('audit',{}).get(key),int):m['audit'][key]+=new_count
  # Never touch review-state or rankings; keep a recoverable pre-edit catalogue snapshot.
  if (root/'manifest.json').read_bytes()!=original:raise Conflict('Catalogue changed during this operation. Please retry.')
  backup=root/'catalog-history';backup.mkdir(exist_ok=True)
  (backup/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.json')).write_bytes(original)
  store.atomic(root/'manifest.json',m)
  tmp=root/('.data-'+uuid.uuid4().hex+'.js');tmp.write_text('window.DESK_DATA = '+json.dumps(m,ensure_ascii=False)+';');os.replace(tmp,root/'data.js')
  if chars and (root/'looks.json').exists():
   looks=json.loads((root/'looks.json').read_text());updated={l['id']:l for c in chars for l in c.get('looks',[])}
   existing={l['id'] for l in looks.get('looks',[])}
   looks['looks']=[updated.get(l['id'],l) for l in looks.get('looks',[])]+[l for lid,l in updated.items() if lid not in existing];store.atomic(root/'looks.json',looks)
  return {'look_id':look_id,'assets':changed,'characters':chars,'locations':locations,'new_images':new_count,'review_choices_changed':False,**({'groups':m['groups'],'audit':m['audit']} if route=='/api/characters' else {})}
