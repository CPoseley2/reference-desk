"""Three-way review merge. Missing/default records never erase another writer."""
import copy

def merge(base,local,remote,manifest,resolutions=None):
 out=copy.deepcopy(remote);conflicts=[];resolutions=resolutions or {};assets={a['id']:a for a in manifest['assets']}
 def choose(key,b,l,r):
  if l==b or l==r:return r
  if r==b:return l
  decision=resolutions.get(key)
  if decision=='local':return l
  if decision=='disk':return r
  conflicts.append({'key':key,'local':l,'disk':r,'base':b});return r
 bm={x['id']:x for x in base.get('items',[])};lm={x['id']:x for x in local.get('items',[])};rm={x['id']:x for x in out.get('items',[])}
 for id,l in lm.items():
  if not l.get('updated_at'):continue
  b=bm.get(id,{});r=rm.get(id)
  if r is None:r=copy.deepcopy(l);out['items'].append(r);rm[id]=r
  changed=False
  for field,default in [('rank',None),('obsolete',False),('notes',''),('role',''),('preference','Unreviewed')]:
   bv=b.get(field,default);lv=l.get(field,default);rv=r.get(field,default)
   # Rank is merged atomically per complete character/category below when scoped.
   if field=='rank'and any(id in rs for rs in local.get('character_rankings',{}).values()):continue
   v=choose('item:'+id+':'+field,bv,lv,rv)
   if v!=rv:r[field]=v;changed=True
  if changed:r['updated_at']=l['updated_at']
 # Full category order is one conflict unit: no interleaved duplicate positions.
 for cid,rs in local.get('character_rankings',{}).items():
  types={assets[id]['type']for id in rs}
  for typ in types:
   def group(v):return {id:x.get('rank')for id,x in v.get('character_rankings',{}).get(cid,{}).items()if assets[id]['type']==typ}
   b=group(base);l=group(local);r=group(remote);chosen=choose('ranks:'+cid+':'+typ,b,l,r)
   if chosen==r:continue
   target=out.setdefault('character_rankings',{}).setdefault(cid,{})
   for id in list(target):
    if assets[id]['type']==typ and id not in chosen:del target[id]
   for id,rank in chosen.items():
    target[id]=copy.deepcopy(rs[id]);item=rm.get(id)
    if item and len(assets[id]['character_ids'])==1:item.update(rank=rank,updated_at=rs[id]['updated_at'])
 for field in ['character_roles','canonical_references','reference_approvals']:
  for cid,slots in local.get(field,{}).items():
   for slot,l in slots.items():
    b=base.get(field,{}).get(cid,{}).get(slot);r=out.get(field,{}).get(cid,{}).get(slot)
    chosen=choose(field+':'+cid+':'+slot,b,l,r)
    if chosen is not None:out.setdefault(field,{}).setdefault(cid,{})[slot]=copy.deepcopy(chosen)
 for cid,l in local.get('collection_reviews',{}).items():
  if not l.get('review_updated_at'):continue
  b=base.get('collection_reviews',{}).get(cid,{});r=out.setdefault('collection_reviews',{}).setdefault(cid,{'review':{},'review_updated_at':None})
  for field,lv in l.get('review',{}).items():
   rv=r['review'].get(field,'');v=choose('collection:'+cid+':'+field,b.get('review',{}).get(field,''),lv,rv)
   if v!=rv:r['review'][field]=v;r['review_updated_at']=l['review_updated_at']
 events={e['event_id']:e for e in out.get('canon_history',[])}
 for e in local.get('canon_history',[]):
  if e['event_id']in events and events[e['event_id']]!=e:raise ValueError('Canon history event collision')
  if e['event_id']not in events:out.setdefault('canon_history',[]).append(copy.deepcopy(e));events[e['event_id']]=e
 return out,conflicts
