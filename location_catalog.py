"""Location coverage metadata. Adding or choosing never approves an image."""
import re,time,uuid
SLOTS=[
 ('exterior-front','Exterior wide · Front','Exterior',True),('exterior-back','Exterior wide · Back','Exterior',True),('exterior-left','Exterior wide · Left','Exterior',True),('exterior-right','Exterior wide · Right','Exterior',True),
 ('aerial-overhead','Aerial · Directly overhead, with environment','Aerial',True),('aerial-oblique','Aerial · Orthographic / oblique, with environment','Aerial',True),
 ('interior-floorplan','Interior floorplan','Interior',True),('interior-front','Interior wide · Toward front','Interior',True),('interior-back','Interior wide · Toward back','Interior',True),('interior-left','Interior wide · Left','Interior',True),('interior-right','Interior wide · Right','Interior',True),
 ('furniture-details','Furniture / detail references','Details',True),('geometry-studies','Elevations / geometry studies','Studies',False),('scene-references','Storyboard / scene references','Scenes',False),('landscape-wide','Landscape / environment wide','Landscape',True),('supporting-maps','Supporting maps / geographic references','Maps',False)]
SLOT_IDS={s[0] for s in SLOTS}
def slot_definitions():return [{'id':i,'label':label,'group':group,'required':required} for i,label,group,required in SLOTS]
def clean_text(value,limit):
 if not isinstance(value,str) or len(value)>limit:raise ValueError('Invalid location text')
 return value.strip()
def obsolete(store,a):
 choices=store.read()['choices'];item=next((i for i in choices.get('items',[]) if i['id']==a['id']),{})
 return item.get('obsolete') is True or (item.get('obsolete') is not False and a.get('status')=='Obsolete')
def mutate(store,m,aa,route,r):
 from reference_catalog import tags,image_file,Conflict
 locations=m.setdefault('locations',[]);m.setdefault('location_slots',slot_definitions());changed=[];new_count=0
 if route=='/api/locations':
  name=clean_text(r.get('name'),140)
  if not name:raise ValueError('Enter a location name')
  if any(l['name'].casefold()==name.casefold() for l in locations):raise Conflict('A location with that name already exists')
  slug=re.sub('[^a-z0-9]+','-',name.lower()).strip('-')[:60] or 'location'
  lid=slug+'-'+uuid.uuid4().hex[:8]
  loc={'id':lid,'name':name,'description':clean_text(r.get('description',''),3000),'tags':tags(r.get('tags',[])),'references':{},'selections':{},'created_at':time.time()};locations.append(loc)
 else:
  loc=next((l for l in locations if l['id']==r.get('location_id')),None)
  if not loc:raise ValueError('Unknown location')
  if route=='/api/location-adopt':
   import location_editing
   return location_editing.adopt(store,m,aa,r)
  if route=='/api/location-production':
   from location_production import update
   update(store,loc,aa,r)
   return [],[loc],0
  slot=r.get('slot_id')
  if slot not in SLOT_IDS:raise ValueError('Choose a known coverage slot')
  refs=loc.setdefault('references',{}).setdefault(slot,[])
  if route=='/api/location-approval':
   aid=r.get('asset_id');a=aa.get(aid)
   if not a or aid not in refs:raise ValueError('Add the image to this coverage slot first')
   if type(r.get('approved')) is not bool:raise ValueError('Approval must be true or false')
   old=loc.setdefault('approvals',{}).get(aid)
   if r.get('expected_approval')!=old:raise Conflict('Approval changed elsewhere. Reopen this image before saving.')
   if r.get('source_sha256')!=a['sha256']:raise Conflict('Image version changed; review it again')
   if r['approved'] and obsolete(store,a):raise ValueError('This image is obsolete. Restore it before approving.')
   entry={'approved':r['approved'],'source_sha256':a['sha256'],'updated_at':time.time(),'decision_id':uuid.uuid4().hex}
   loc['approvals'][aid]=entry
   loc.setdefault('approval_history',[]).append({'asset_id':aid,'previous':old,'decision':entry.copy()})
  elif route=='/api/location-selection':
   old=loc.setdefault('selections',{}).get(slot)
   if r.get('expected_selected_id')!=(old or {}).get('id'):raise Conflict('Selection changed elsewhere. Reopen this location.')
   aid=r.get('asset_id')
   if aid is None:loc['selections'].pop(slot,None)
   else:
    a=aa.get(aid)
    if not a or aid not in refs:raise ValueError('Add the image to this coverage slot first')
    if obsolete(store,a):raise ValueError('This image is obsolete. Choose an active image; adding does not restore it.')
    if r.get('source_sha256')!=a['sha256']:raise Conflict('Image version changed; review it again')
    loc['selections'][slot]={'id':aid,'source_sha256':a['sha256'],'selected_at':time.time(),'approval':'Selection only; does not approve inferred geometry'}
  else:
   extra=tags(r.get('tags',[]));ids=r.get('asset_ids',[])
   if not isinstance(ids,list) or len(ids)>200 or any(not isinstance(x,str) or x not in aa for x in ids):raise ValueError('Unknown image selection')
   if r.get('upload') is not None:
    item=image_file(store.root,r['upload']);aid=item['id']
    if aid in aa and aa[aid]['sha256']!=item['sha256']:raise ValueError('Image ID collision')
    if aid not in aa:
     a={**item,'character_ids':[],'primary_character_ids':[],'type':'Scene reference','status':'Candidate','approval':'Unapproved location upload','stage':'Location study','emotion':'','sources':['Local upload: '+item['title']],'metadata_sources':[],'identity_basis':'Location reference; no character identity assigned','visually_reviewed':False,'asset_encoding':'Uploaded original bytes unchanged','neutral_full_body_eligible':False,'mannequin_outfit_eligible':False,'original_prompts':[],'original_prompt_status':'Not supplied with upload','uploaded_at':time.time()};aa[aid]=a;m['assets'].append(a);new_count+=1
    ids=list(dict.fromkeys(ids+[aid]))
   if not ids:raise ValueError('Select images or upload a file')
   for aid in ids:
    a=aa[aid];a.setdefault('location_ids',[])
    if loc['id'] not in a['location_ids']:a['location_ids'].append(loc['id'])
    a['tags']=tags(a.get('tags',[])+extra)
    if aid not in refs:refs.append(aid)
    changed.append(a)
 loc['updated_at']=time.time()
 return changed,[loc],new_count
