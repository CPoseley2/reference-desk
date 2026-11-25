"""Durable shot insertions and editable metadata. Original sources and cut timing stay intact."""
import copy,json,re,time,math,hashlib
class StructureConflict(ValueError):pass
EDIT_FIELDS={'title','direction','planning_duration','script_start','script_end'}
def configured(root,eid):
 if not isinstance(eid,str) or not re.fullmatch(r'[a-f0-9]{16}',eid):raise ValueError('Invalid storyboard ID.')
 p=root/'shot-workspace-data'/(eid+'.json')
 if not p.is_file():raise ValueError('Shot editing is not enabled for this storyboard.')
 return json.loads(p.read_text())
def state(root,eid):
 c=configured(root,eid);p=root/'feedback'/'shot-structures'/(eid+'.json')
 return json.loads(p.read_text()) if p.exists() else {'version':1,'revision':0,'order':[s['id'] for s in c['shots']],'edits':{},'added':{},'mutations':{}}
def base_catalog(root,eid):return json.loads((root/'image-libraries'/(eid+'.json')).read_text())
def effective_edit(catalog,c,sid):
 a=next((s for s in c['shots'] if s['id']==sid),None);slot=next((s for s in catalog['slots'] if s['id']==sid),{})
 if not a:return None
 return {'title':a['title'],'direction':a['direction'],'planning_duration':slot.get('duration'),'script_start':a.get('script_start'),'script_end':a.get('script_end')}
def script_lines(c):
 from pathlib import Path
 p=Path(c['source']['path']);raw=p.read_bytes()
 if hashlib.sha256(raw).hexdigest()!=c['source']['sha256']:raise ValueError('The source script changed. Review and reimport it before changing script ranges.')
 return raw.decode('utf-8').splitlines()
def read(root,eid):
 c=configured(root,eid);s=state(root,eid);cat=base_catalog(root,eid);lines=script_lines(c)
 edits={sid:s['edits'].get(sid) or s['added'].get(sid) or effective_edit(cat,c,sid) for sid in s['order']}
 return {'revision':s['revision'],'order':s['order'],'edits':edits,'script_lines':lines,'source':c['source']}
def validate(c,value):
 if not isinstance(value,dict) or set(value)!=EDIT_FIELDS:raise ValueError('Invalid shot details.')
 if not isinstance(value['title'],str) or not 1<=len(value['title'].strip())<=240:raise ValueError('Enter a shot title (up to 240 characters).')
 if not isinstance(value['direction'],str) or len(value['direction'])>15000:raise ValueError('Shot direction is limited to 15,000 characters.')
 duration=value['planning_duration']
 if duration is not None and (type(duration) not in (int,float) or not math.isfinite(duration) or not 0<duration<=3600):raise ValueError('Planning duration must be blank or greater than 0, up to 3,600 seconds.')
 lo,hi=value['script_start'],value['script_end']
 if lo is not None or hi is not None:
  lines=script_lines(c)
  if type(lo) is not int or type(hi) is not int or not 1<=lo<=hi<=len(lines) or hi-lo>1000:raise ValueError('Choose a valid script line range (up to 1,001 lines), or leave both blank.')
 return copy.deepcopy(value)
def apply_catalog(root,eid,catalog):
 if not (root/'shot-workspace-data'/(eid+'.json')).is_file():return catalog
 s=state(root,eid);c=configured(root,eid);out=copy.deepcopy(catalog);original={x['id']:x for x in catalog['slots']};slots=[]
 for sid in s['order']:
  slot=copy.deepcopy(original.get(sid,{'id':sid,'recommended':[],'start':None,'end':None,'duration':None,'inserted':True}))
  v=s['edits'].get(sid) or s['added'].get(sid)
  if v:
   slot.update(title=v['title'],action=v['direction'],planning_duration=v['planning_duration'],source_lines=f"{v['script_start']}–{v['script_end']}" if v['script_start'] is not None else '',script_start=v['script_start'],script_end=v['script_end'])
   slot['duration_label']=(f"{v['planning_duration']:g}s planned" if v['planning_duration'] is not None else 'Untimed')
  slots.append(slot)
 out['slots']=slots;out['structure']={'revision':s['revision'],'enabled':True};return out
def empty_default():return {'character_ids':[],'location_ids':[],'placements':{},'start_frame':'','end_frame':'','angle':'','video_prompt':'','seam_note':'','feedback':''}
def apply_workspace(root,eid,c):
 s=state(root,eid);out=copy.deepcopy(c);original={x['id']:x for x in c['shots']};rows=[];lines=None
 for sid in s['order']:
  row=copy.deepcopy(original.get(sid,{'id':sid,'title':'New shot','direction':'','script_start':None,'script_end':None,'script_text':'','cast_note':'New shot. Choose script lines and references; no inherited identity or route.','default':empty_default()}));v=s['edits'].get(sid) or s['added'].get(sid)
  if v:
   row.update({k:v[k] for k in ['title','direction','script_start','script_end']});lo,hi=v['script_start'],v['script_end']
   if lo is None:row['script_text']='No script excerpt assigned yet.'
   else:
    if lines is None:lines=script_lines(c)
    row['script_text']='\n'.join(lines[lo-1:hi])
  rows.append(row)
 out['shots']=rows;return out
def save(root,data,atomic):
 eid=data.get('id');c=configured(root,eid);s=state(root,eid);op=data.get('operation');mid=data.get('mutation_id')
 if not isinstance(mid,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,80}',mid):raise ValueError('A unique mutation ID is required.')
 digest=hashlib.sha256(json.dumps(data,sort_keys=True).encode()).hexdigest()
 if mid in s['mutations']:
  prev=s['mutations'][mid]
  if prev['digest']!=digest:raise ValueError('Mutation ID reused with different content.')
  return {'revision':s['revision'],'shot_id':prev['shot_id'],'replayed':True}
 value=validate(c,data.get('value'));sid=data.get('shot_id')
 if op=='insert':
  if type(data.get('expected_revision')) is not int or data['expected_revision']!=s['revision']:raise StructureConflict('Shot order changed elsewhere. Review the latest order, then retry your insertion.')
  if not isinstance(sid,str) or not re.fullmatch(r'YB-I-[a-f0-9]{12}',sid) or sid in s['order']:raise ValueError('A new unique shot ID is required.')
  after,before=data.get('after'),data.get('before')
  if after is not None and after not in s['order']:raise StructureConflict('The insertion boundary changed.')
  index=0 if after is None else s['order'].index(after)+1
  if (s['order'][index] if index<len(s['order']) else None)!=before:raise StructureConflict('The neighboring shots changed. Review the insertion position.')
  if len(s['order'])>=500:raise ValueError('This board has reached 500 shots.')
  s['order'].insert(index,sid);s['added'][sid]=value
 elif op=='edit':
  if sid not in s['order']:raise ValueError('Unknown shot.')
  current=s['edits'].get(sid) or s['added'].get(sid) or effective_edit(base_catalog(root,eid),c,sid)
  if data.get('expected')!=current and value!=current:raise StructureConflict('Shot details changed elsewhere. Review the saved values before retrying.')
  s['edits'][sid]=value
 else:raise ValueError('Unsupported shot action.')
 folder=root/'feedback'/'shot-structures';history=folder/'history'/eid;history.mkdir(parents=True,exist_ok=True)
 # Snapshot the exact prior record; writes are serialized by the endpoint lock.
 atomic(history/(f"revision-{s['revision']:06}.json"),state(root,eid))
 s['revision']+=1;s['mutations'][mid]={'digest':digest,'shot_id':sid};s['saved_at']=time.time();atomic(folder/(eid+'.json'),s)
 return {'revision':s['revision'],'shot_id':sid}
def counts(root,eid):
 catalog=apply_catalog(root,eid,base_catalog(root,eid));p=root/'feedback'/'arrangements'/(eid+'.json');assignments=json.loads(p.read_text()).get('assignments',{}) if p.exists() else {};return len(catalog['slots']),sum(bool(assignments.get(s['id'])) for s in catalog['slots'])
def inventory(root,data):
 out=copy.deepcopy(data)
 for e in out.get('entries',[]):
  if (root/'feedback'/'shot-structures'/(e['id']+'.json')).exists():
   total,filled=counts(root,e['id']);e['slots']=total;e['available_slots']=filled
 return out
def supplemental(root,data):
 out=copy.deepcopy(data)
 for c in out.get('collections',[]):
  m=re.search(r'(?:[?&])id=([a-f0-9]{16})',c.get('viewer_href',''))
  if m and (root/'feedback'/'shot-structures'/(m[1]+'.json')).exists():
   total,filled=counts(root,m[1]);c.setdefault('checkpoint',{}).update(planned=total,image_count=filled);c['status']=f'{total} editable shot slots · {filled} assigned references'
 return out
