"""Pinned, role/stage-specific user choices. No image writes."""
import copy
import emotion_slots
from linked_media import reference_info

def key(role,look=None):return role+('@'+look if look else '')
def role_family(role):return 'emotion' if role in ['emotion-map','individual-emotion'] or emotion_slots.valid_role(role) else role
def song_names(m):return {x['song'] for a in m['assets'] for x in a.get('song_appearances',[]) if x.get('song')}
def allowed(a,role):
 if emotion_slots.valid_role(role):return a['type']=='Individual emotion'
 if isinstance(role,str) and role.startswith('song:'):return bool(role[5:])
 return a['type'] in {'likeness':['Portrait / likeness','Scene reference','Full-body / costume'],'body':['Full-body / costume'],'emotion':['Individual emotion','Emotion map'],'emotion-map':['Emotion map'],'individual-emotion':['Individual emotion'],'scene':['Scene reference'],'prop':['Supporting prop / map'],'wardrobe':['Mannequin outfit study'],'hair':['Hairstyle study']}.get(role,[])
def destination_allowed(role):
 # User-selected destinations are independent of the image's library category.
 if emotion_slots.valid_role(role):return True
 if isinstance(role,str) and role.startswith('song:'):return bool(role[5:])
 return isinstance(role,str) and role in ['likeness','body','emotion','emotion-map','individual-emotion','scene','prop','wardrobe','hair']
def validate(v,m):
 aa={a['id']:a for a in m['assets']};cc={c['id']:c for c in m['characters']}
 refs=v.get('canonical_references',{});hist=v.get('canon_history',[])
 if not isinstance(refs,dict)or not isinstance(hist,list)or len(hist)>10000:raise ValueError('Invalid canon references/history')
 def record(cid,slot,r):
  from datetime import datetime
  if not isinstance(r,dict):raise ValueError('Invalid canon record')
  a=aa.get(r.get('id'));c=cc.get(cid);role=r.get('role');look=r.get('look_id')
  if not a or not c or cid not in a['character_ids']or not destination_allowed(role):raise ValueError('Invalid canon identity or role')
  if role.startswith('song:') and role[5:] not in song_names(m):raise ValueError('Unknown musical number')
  if r.get('source_sha256')not in [a['sha256']]+[x['sha256']for x in a.get('previous_versions',[])]:raise ValueError('Canon source hash mismatch')
  if look is not None and look not in [l['id']for l in c.get('looks',[])]:raise ValueError('Unknown canon look')
  if role not in ['body','wardrobe']and look:raise ValueError('Identity/emotion cannot be a wardrobe stage')
  if role=='wardrobe'and not look:raise ValueError('Wardrobe requires look')
  if slot!=key(role,look)or not isinstance(r.get('selection_id'),str)or len(r['selection_id'])>150:raise ValueError('Invalid canon slot/selection')
  datetime.fromisoformat(r['selected_at'].replace('Z','+00:00'))
 for cid,slots in refs.items():
  if not isinstance(slots,dict):raise ValueError('Invalid canon slots')
  for slot,r in slots.items():record(cid,slot,r)
 for e in hist:
  if not isinstance(e,dict)or not isinstance(e.get('event_id'),str)or len(e['event_id'])>150:raise ValueError('Invalid canon history')
  record(e['character_id'],e['slot'],e['next'])
  if e.get('previous'):record(e['character_id'],e['slot'],e['previous'])

 approvals=v.get('reference_approvals',{})
 if not isinstance(approvals,dict):raise ValueError('Invalid image approvals')
 from datetime import datetime
 for cid,items in approvals.items():
  if cid not in cc or not isinstance(items,dict):raise ValueError('Invalid approval character')
  for id,r in items.items():
   a=aa.get(id)
   if not isinstance(r,dict)or not a or cid not in a['character_ids']or not destination_allowed(r.get('role'))or type(r.get('approved'))is not bool:raise ValueError('Invalid image approval')
   if r['role'].startswith('song:') and r['role'][5:] not in song_names(m):raise ValueError('Unknown musical number')
   if r.get('source_sha256')not in [a['sha256']]+[x['sha256']for x in a.get('previous_versions',[])]:raise ValueError('Approval source hash mismatch')
   if not isinstance(r.get('updated_at'),str):raise ValueError('Invalid approval timestamp')
   datetime.fromisoformat(r['updated_at'].replace('Z','+00:00'))

def current(c,v,aa):
 out={};pair=c.get('prompt_reference_pair',{})
 for role,id in {'likeness':pair.get('likeness_id'),'body':pair.get('full_body_id')}.items():
  a=aa.get(id)
  if a and a['status']=='Confirmed':out[role]={'id':id,'role':role,'look_id':None,'source_sha256':a['sha256'],'selected_at':'2026-10-24T00:00:00Z','selection_id':'documented-'+c['id']+'-'+role,'basis':'Documented user selection'}
 items={n['id']:n for n in v.get('items',[])}
 for role,id in v.get('character_roles',{}).get(c['id'],{}).items():
  a=aa.get(id)
  if a and allowed(a,role):out[role]={'id':id,'role':role,'look_id':None,'source_sha256':items.get(id,{}).get('source_sha256',a['sha256']),'selected_at':items.get(id,{}).get('updated_at')or'2026-10-24T00:00:00Z','selection_id':'legacy-'+c['id']+'-'+role,'basis':'Earlier explicit role choice'}
 out.update(v.get('canonical_references',{}).get(c['id'],{}));return out

def derive(state,m,root):
 aa={a['id']:a for a in m['assets']};v=state['choices'];items={x['id']:x for x in v.get('items',[])};chars=[]
 for c in m['characters']:
  refs=[]
  for slot,r in current(c,v,aa).items():
   a=aa[r['id']];im=a if r['source_sha256']==a['sha256']else next(x for x in a.get('previous_versions',[])if x['sha256']==r['source_sha256'])
   obsolete=items.get(a['id'],{}).get('obsolete',a['status']=='Obsolete');look=next((l for l in c.get('looks',[])if l['id']==r.get('look_id')),None);usable=not obsolete and (not look or look.get('active_story')is not False)
   refs.append({**r,'slot':slot,'asset':im['asset'],**reference_info(root,im['asset']),'source_paths':a['sources'],'usable':usable,'blocked_reason':'Obsolete image or inactive story stage'if not usable else None,'revision_is_current':r['source_sha256']==a['sha256'],'source_status':a['status']})
  derived=[]
  anchors={x['id']:x['source_sha256']for x in refs if x['role']=='likeness'and x['usable']}
  for a in m['assets']:
   if c['id']not in a['character_ids']or a.get('derived_from_likeness')not in anchors:continue
   if a.get('derived_from_likeness_sha256')!=anchors[a['derived_from_likeness']]:continue
   derived.append({'id':a['id'],'type':a['type'],'emotion':a.get('emotion'),'source_sha256':a['sha256'],'asset':a['asset'],**reference_info(root,a['asset']),'source_paths':a['sources'],'status':('Approved image' if v.get('reference_approvals',{}).get(c['id'],{}).get(a['id'],{}).get('approved') and v['reference_approvals'][c['id']][a['id']]['source_sha256']==a['sha256'] else 'Derived candidate — not separately user-approved'),'obsolete':items.get(a['id'],{}).get('obsolete',a['status']=='Obsolete'),'likeness_id':a['derived_from_likeness'],'usage_note':a.get('usage_note','')})
  chars.append({'id':c['id'],'name':c['name'],'references':refs,'image_approvals':v.get('reference_approvals',{}).get(c['id'],{}),'derived_candidates':derived,'missing_explicit_roles':[r for r in ['likeness','body','emotion']if not any(role_family(x['role'])==r and x['usable']for x in refs)]})
 return {'schema':'desk.director-references','version':1,'review_revision':state['revision'],'review_payload_hash':state['payload_hash'],'characters':chars,'rule':'Use a usable pinned full-body costume for the correct stage plus an appropriate emotion. A likeness or mannequin alone does not satisfy the body role. Numeric ranks are not canon. This file is derived; edit choices through the review API.'}

def preserve_and_check(choices,old,m):
 """Old clients must never erase the new extension by omission."""
 v=copy.deepcopy(choices);prior=old['choices']
 for field in ['canonical_references','canon_history','reference_approvals']:
  if field not in v and field in prior:v[field]=copy.deepcopy(prior[field])
 aa={a['id']:a for a in m['assets']};items={x['id']:x for x in v['items']}
 for cid,slots in v.get('canonical_references',{}).items():
  for slot,r in slots.items():
   before=prior.get('canonical_references',{}).get(cid,{}).get(slot)
   if before!=r and items.get(r['id'],{}).get('obsolete',aa[r['id']]['status']=='Obsolete'):raise ValueError('Restore obsolete image explicitly before canon selection')
 return v
