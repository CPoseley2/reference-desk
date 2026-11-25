"""Shot script/reference workspace. Separate from arrangements, source prompts and notes."""
import copy,json,re,time
class WorkspaceConflict(ValueError):pass
FIELDS={'character_ids','location_ids','placements','start_frame','end_frame','angle','video_prompt','seam_note','feedback'}
ANGLES={'','high angle','eye level','low angle','overhead','over the shoulder'}
def config(root,eid):
 if not isinstance(eid,str) or not re.fullmatch(r'[a-f0-9]{16}',eid):raise ValueError('Invalid storyboard ID.')
 p=root/'shot-workspace-data'/(eid+'.json')
 if not p.is_file():raise ValueError('Script workspace is not configured for this storyboard.')
 import shot_structure
 return shot_structure.apply_workspace(root,eid,json.loads(p.read_text()))
def stored(root,eid):
 p=root/'feedback'/'shot-workspaces'/(eid+'.json')
 return json.loads(p.read_text()) if p.exists() else {'version':1,'revision':0,'shots':{}}
def read(root,eid):
 c=config(root,eid);s=stored(root,eid)
 return {'config':c,'revision':s['revision'],'shots':{x['id']:s['shots'].get(x['id'],x['default']) for x in c['shots']}}
def validate(c,v):
 if not isinstance(v,dict) or set(v)!=FIELDS:raise ValueError('Invalid shot workspace fields.')
 def ids(value,allowed,limit):
  if not isinstance(value,list) or len(value)>limit or any(not isinstance(x,str) or x not in allowed for x in value) or len(set(value))!=len(value):raise ValueError('Unknown or duplicate reference selection.')
 chars={x['id'] for x in c['characters']};assets={x['id'] for x in c['assets']};locations=set(c['location_ids'])
 ids(v['character_ids'],chars,150);ids(v['location_ids'],locations,60)
 if not isinstance(v['placements'],dict) or len(v['placements'])>60:raise ValueError('Invalid character/location pairings.')
 for aid,cids in v['placements'].items():
  if aid not in v['location_ids']:raise ValueError('Pairing must use a selected location.')
  ids(cids,set(v['character_ids']),150)
 for k in ['start_frame','end_frame']:
  if not isinstance(v[k],str) or (v[k] and v[k] not in assets):raise ValueError('Unknown frame reference.')
 if not isinstance(v['angle'],str) or v['angle'] not in ANGLES:raise ValueError('Unknown camera angle.')
 for k,limit in [('video_prompt',30000),('seam_note',10000),('feedback',10000)]:
  if not isinstance(v[k],str) or len(v[k])>limit:raise ValueError('Prompt or note exceeds its text limit.')
 return copy.deepcopy(v)
def save(root,data,atomic):
 eid=data.get('id');c=config(root,eid);sid=data.get('shot_id');slot=next((x for x in c['shots'] if x['id']==sid),None)
 if not slot:raise ValueError('Unknown shot.')
 value=validate(c,data.get('value'));s=stored(root,eid);current=s['shots'].get(sid,slot['default'])
 if current==value:return {'revision':s['revision'],'shot_id':sid,'value':current}
 if 'expected' not in data or data['expected']!=current:raise WorkspaceConflict('This shot changed in another window. Your draft is retained; review the saved version before retrying.')
 folder=root/'feedback'/'shot-workspaces';folder.mkdir(parents=True,exist_ok=True);history=folder/'history'/eid;history.mkdir(parents=True,exist_ok=True)
 atomic(history/(f"revision-{s['revision']:06}.json"),s)
 s['shots'][sid]=value;s['revision']+=1;s['saved_at']=time.time();atomic(folder/(eid+'.json'),s)
 return {'revision':s['revision'],'shot_id':sid,'value':value}
