"""Build a neutral dashboard from explicitly registered sources."""
import json
from datetime import datetime, timezone
from pathlib import Path

def storyboard_status(primary,movie,entries):
    if movie:
        if movie.get('archive'):return 'Earlier film available'
        return 'HD export' if movie.get('height',0)>=1080 else 'Film export'
    if primary:return 'Storyboard in progress' if primary['available_slots']<primary['slots'] else 'Storyboard available'
    return 'Storyboard versions available' if entries else 'Not yet made'

def build(root):
    root=Path(root);catalog=json.loads((root/'inventory.json').read_text())
    config=json.loads((root/'sources.json').read_text()) if (root/'sources.json').exists() else {}
    acts={};by_song={}
    for entry in catalog['entries']:by_song.setdefault(entry['song'],[]).append(entry)
    for order,(song,entries) in enumerate(by_song.items(),1):
        selected=next((e for e in entries if e['primary']),entries[0]);act=selected.get('act',1)
        fid=f'a{act}-{len(acts.get(act,[]))+1:02d}'
        gaps=[]
        if selected['available_slots']<selected['slots']:gaps.append('Some planned images are unavailable.')
        film={'id':fid,'title':song,'catalog_song':song,'act':act,'order':order,'episode':1,
              'entry_id':selected['id'],'versions':[e['id'] for e in entries],'movie':None,'archived_movies':[],
              'slots':selected['slots'],'available_slots':selected['available_slots'],
              'status':storyboard_status(selected,None,entries),'context':selected.get('note',''),
              'source_line':0,'scene':selected['title'],'audio_candidates':[],'assets':[],'gaps':gaps,
              'next_step':'Review the selected storyboard, refine the shots, and save your decisions.',
              'brief':'production-briefs/'+fid+'.txt'}
        (root/film['brief']).write_text(song+'\n'+film['status']+'\n\n'+film['next_step']+'\n')
        acts.setdefault(act,[]).append(film)
    data={'checked_at':datetime.now(timezone.utc).isoformat(),'source':{'version':config.get('name','Your production'),'path':'Explicitly registered local sources','current_hash_matches':True},
          'acts':[{'act':act,'films':films} for act,films in sorted(acts.items())],'movies':{},'planned_count':len(by_song),'feedback_mapping':'source-index.json'}
    (root/'command-center.json').write_text(json.dumps(data,indent=2)+'\n')
    (root/'command-center-data.js').write_text('window.COMMAND_CENTER='+json.dumps(data)+';\n')
    (root/'EPISODIC-MAPPING.txt').write_text('\n'.join(f"Act {a['act']}: "+', '.join(f['title'] for f in a['films']) for a in data['acts']) or 'Register your own storyboard sources to begin.\n')
