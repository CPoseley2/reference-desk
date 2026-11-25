"""Create version-scoped editor catalogs without changing source shots or existing edits."""
import hashlib,json,os
from pathlib import Path

def create_only(path,data):
 path.parent.mkdir(parents=True,exist_ok=True)
 try:
  with path.open('x') as f:
   json.dump(data,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
  return True
 except FileExistsError:return False

def ensure(root):
 root=Path(root);result={'created':[],'existing':[],'empty':[]}
 entries=json.loads((root/'inventory.json').read_text())['entries']
 for entry in entries:
  eid=entry['id'];target=root/'image-libraries'/(eid+'.json')
  if target.exists():result['existing'].append(eid);continue
  text=(root/'view-data'/(eid+'.js')).read_text()
  view=json.loads(text.removeprefix('window.VIEW=').rstrip(';\n'))
  shots=view['shots']
  if not shots:result['empty'].append(eid)
  ids=[str(s['id']) for s in shots]
  if len(ids)!=len(set(ids)):raise ValueError('Duplicate shot IDs: '+eid)
  assets={};slots=[];assignments={}
  for shot in shots:
   sid=str(shot['id']);aid=None
   if shot.get('image') and shot.get('available'):
    key=json.dumps([shot['image'],shot.get('crop')],sort_keys=True)
    aid=hashlib.sha256(key.encode()).hexdigest()[:20]
    assets.setdefault(aid,{'id':aid,'image':shot['image'],'title':shot.get('title') or sid,'crop':shot.get('crop'),'version':view['title'],'tags':[]})
   slot={'id':sid,'title':shot.get('title') or sid,'action':shot.get('prompt') or shot.get('status') or '', 'recommended':[aid] if aid else []}
   for field in ('start','end','generation_prompt','source_lines'):
    if field in shot:slot[field]=shot[field]
   if isinstance(shot.get('start'),(int,float)) and isinstance(shot.get('end'),(int,float)):slot['duration']=shot['end']-shot['start']
   slots.append(slot);assignments[sid]=aid
  catalog={'assets':list(assets.values()),'slots':slots,'source_sha256':view.get('sha256'),'source':view.get('source'),'editor_origin':'source snapshot; edits saved separately'}
  # Seed only absent state. Existing user edits are never replaced.
  create_only(root/'feedback/arrangements'/(eid+'.json'),{'revision':0,'assignments':assignments})
  if create_only(target,catalog):result['created'].append(eid)
 return result

if __name__=='__main__':print(json.dumps(ensure(Path(__file__).resolve().parent),indent=2))
