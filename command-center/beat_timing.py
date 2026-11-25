"""Version-scoped editable cut timing. Image assignments and originals remain separate."""
import json,re,time
from pathlib import Path
class TimingConflict(ValueError):pass
def config(root,eid):
 if not isinstance(eid,str) or not re.fullmatch(r'[a-f0-9]{16}',eid):raise ValueError('Unknown beat edit')
 p=root/'beat-edits'/(eid+'.json')
 if not p.is_file():raise ValueError('This storyboard has no editable beat timeline')
 return json.loads(p.read_text())
def read(root,eid):
 c=config(root,eid);p=root/'feedback/timings'/(eid+'.json')
 state=json.loads(p.read_text()) if p.exists() else {'revision':0,'end_frames':c['initial_end_frames']}
 return dict(state,config=c)
def validate(c,ends):
 if not isinstance(ends,list) or len(ends)!=len(c['shot_ids']) or any(type(v) is not int for v in ends):raise ValueError('One integer end frame is required for every shot')
 if ends[-1]!=c['picture_end_frame']:raise ValueError('Keep the original picture endpoint and audio tail')
 if any(not 1<=b-a<=c['max_hold_frames'] for a,b in zip([0]+ends,ends)):raise ValueError('Each shot must have a positive duration under three seconds')
 if any(ends[i]!=c['baseline_end_frames'][i] for i in c['locked_indices']):raise ValueError('Section, spoken-passage and pending-coverage boundaries are locked')
def save(root,data,atomic):
 eid=data.get('id');s=read(root,eid);c=s['config'];ends=data.get('end_frames');validate(c,ends)
 if data.get('audio_sha256')!=c['audio_sha256'] or data.get('beat_map_sha256')!=c['beat_map_sha256']:raise ValueError('The recording or beat map changed. Reload before editing')
 if type(data.get('revision')) is not int:raise ValueError('Revision is required')
 if ends==s['end_frames']:return s
 if data['revision']!=s['revision']:raise TimingConflict('Timing changed in another tab. Your edits are still on screen; export them or reload the saved timing.')
 folder=root/'feedback/timings';folder.mkdir(exist_ok=True,parents=True);history=folder/'history';history.mkdir(exist_ok=True)
 old={k:v for k,v in s.items() if k!='config'};atomic(history/(eid+'-'+str(s['revision'])+'.json'),old)
 new={'revision':s['revision']+1,'end_frames':ends,'saved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'review_status':'Editable draft; musical alignment awaits review'}
 atomic(folder/(eid+'.json'),new);return dict(new,config=c)
