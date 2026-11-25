#!/usr/bin/env python3
"""Index explicitly registered JSON storyboards. Never scans or rewrites source files."""
import argparse
import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
MEDIA = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.tif', '.tiff', '.wav', '.mp3', '.m4a', '.aiff', '.flac', '.ogg', '.mp4', '.mov'}

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temp, path)

def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def stamp():
    return datetime.now(timezone.utc).isoformat()

def registered_path(value, base, files, suffixes=MEDIA):
    if not value:
        return None
    if not isinstance(value, str):
        raise ValueError('Media paths must be strings')
    if value.startswith(('data:image/', 'data:audio/')):
        return value
    parsed = urlsplit(value)
    if parsed.scheme not in ('', 'file') or parsed.netloc not in ('', 'localhost'):
        raise ValueError('Only local files or embedded image/audio inputs are supported')
    path = Path(unquote(parsed.path))
    path = (base / path).resolve() if not path.is_absolute() else path.resolve()
    if path.suffix.lower() not in suffixes or any(part.startswith('.') for part in path.parts):
        raise ValueError('Unsupported or hidden reference file: ' + path.name)
    files.add(str(path))
    return str(path)

def snapshot(record, files):
    source = Path(record['path']).expanduser().resolve()
    if source.suffix.lower() != '.json':
        raise ValueError('Register a JSON storyboard; see sources.example.json and README.txt')
    raw = source.read_bytes()
    data = json.loads(raw)
    if not isinstance(data, dict) or not isinstance(data.get('shots'), list):
        raise ValueError('Storyboard JSON must contain a shots array')
    digest = hashlib.sha256(raw).hexdigest()
    eid = hashlib.sha256(str(source).encode()).hexdigest()[:16]
    shots, seen = [], set()
    for i, item in enumerate(data['shots']):
        if not isinstance(item, dict):
            raise ValueError('Each shot must be an object')
        sid = str(item.get('id', 'S%03d' % (i + 1)))
        if not sid or len(sid)>100 or sid in seen:
            raise ValueError('Shot IDs must be unique and no longer than 100 characters')
        seen.add(sid)
        image = registered_path(item.get('image'), source.parent, files)
        shot = {**item, 'id':sid, 'image':image, 'title':str(item.get('title', sid)),
                'prompt':str(item.get('prompt', item.get('direction', ''))),
                'available':bool(image and (image.startswith('data:') or Path(image).is_file())),
                'status':str(item.get('status', 'Source reference'))}
        for field in ('start', 'end'):
            value=item.get(field)
            if value is not None and (type(value) not in (int,float) or not math.isfinite(value) or value<0):
                raise ValueError('Shot times must be nonnegative finite numbers or null')
            shot[field]=value
        if shot['start'] is not None and shot['end'] is not None and shot['end']<=shot['start']:raise ValueError('Shot end must follow its start')
        shots.append(shot)
    registered_path(data.get('script'),source.parent,files,{'.txt','.fountain','.md'})
    for character in data.get('characters',[]):
        for image in character.get('images',[]):registered_path(image,source.parent,files)
    for image in data.get('locations',[]):registered_path(image,source.parent,files)
    audio=data.get('audio', [])
    if isinstance(audio,str):audio=[audio]
    audio=[registered_path(value,source.parent,files) for value in audio]
    files.add(str(source))
    title=record.get('title') or data.get('title') or source.stem
    song=record.get('production') or data.get('production') or title
    entry={'id':eid,'song':song,'title':title,'path':str(source),'primary':record.get('primary',True),
           'sha256':digest,'source_signature':{str(source):[source.stat().st_size,source.stat().st_mtime_ns]},
           'modified':datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),'unique_referenced_images':len({s['image'] for s in shots if s['image']}),'slots':len(shots),'available_slots':sum(s['available'] for s in shots),
           'missing_dependencies':[p for p in [*(s['image'] for s in shots),*audio] if p and not p.startswith('data:') and not Path(p).is_file()],
           'note':record.get('note',''),'viewer':'viewer.html?id='+eid,'duplicate_of':None,'act':record.get('act',1)}
    view={**entry,'source':str(source),'shots':shots,'audio':audio,'original_html':None,
          'beat_timing_configured':(ROOT/'beat-edits'/f'{eid}.json').is_file()}
    return entry,view,data

def seed_workspace(root,entry,view,data,files):
    """Create direction controls once; keep subsequent user edits independent."""
    from editable_catalogs import create_only
    from shot_structure import empty_default
    target=root/'shot-workspace-data'/f"{entry['id']}.json"
    if target.exists():return
    script = registered_path(data.get('script'), Path(entry['path']).parent, files, {'.txt','.fountain','.md'})
    if script:
        source=Path(script);text=source.read_text()
    else:
        source=root/'shot-workspace-data'/f"{entry['id']}-script.txt"
        text='\n'.join(shot['title'] for shot in view['shots'])+'\n'
        source.write_text(text)
    lines=text.splitlines()
    catalog=read(root/'image-libraries'/f"{entry['id']}.json")
    assets=[{**asset,'character_ids':[],'original_prompt':'','url':'/files'+asset['image'] if not asset['image'].startswith('data:') else asset['image']} for asset in catalog['assets']]
    characters=[]
    by_image={a['image']:a for a in assets}
    for i,character in enumerate(data.get('characters',[])):
        cid=str(character.get('id',f'C{i+1:03d}'))
        refs=[]
        for image in character.get('images',[]):
            path=registered_path(image,Path(entry['path']).parent,files)
            if path not in by_image:
                aid=hashlib.sha256(path.encode()).hexdigest()[:20]
                asset={'id':aid,'image':path,'url':path if path.startswith('data:') else '/files'+path,'title':character.get('name',cid),'character_ids':[],'original_prompt':''}
                assets.append(asset);by_image[path]=asset
            by_image[path]['character_ids'].append(cid);refs.append(by_image[path]['id'])
        characters.append({'id':cid,'name':character.get('name',cid),'status':character.get('status','Reference'),'description':character.get('description',''),'reference_ids':refs})
    locations=[]
    for image in data.get('locations',[]):
        path=registered_path(image,Path(entry['path']).parent,files)
        if path not in by_image:
            aid=hashlib.sha256(path.encode()).hexdigest()[:20]
            asset={'id':aid,'image':path,'url':path if path.startswith('data:') else '/files'+path,'title':Path(path).stem,'character_ids':[],'original_prompt':''}
            assets.append(asset);by_image[path]=asset
        locations.append(by_image[path]['id'])
    rows=[]
    for i,shot in enumerate(view['shots']):
        lo,hi=(shot.get('script_start'),shot.get('script_end')) if script else (i+1,i+1)
        if lo is not None and (type(lo)is not int or type(hi)is not int or not 1<=lo<=hi<=len(lines)):
            raise ValueError('Invalid script range for '+shot['id'])
        default=empty_default();default['video_prompt']=shot['prompt']
        rows.append({'id':shot['id'],'title':shot['title'],'direction':shot['prompt'],
                     'script_start':lo,'script_end':hi,'script_text':'\n'.join(lines[lo-1:hi]) if lo else '',
                     'cast_note':'Select references for this shot.','default':default})
    create_only(target,{'version':1,'entry_id':entry['id'],'source':{'title':entry['title'],'path':str(source),'sha':hashlib.sha256(source.read_bytes()).hexdigest(),'note':'Registered script; shot text is a workspace snapshot.'},
                        'shots':rows,'characters':characters,'initial_included_character_ids':[c['id'] for c in characters],'assets':assets,'location_ids':locations})

def build(root=None):
    root=Path(root or ROOT).resolve()
    for name in ['feedback','view-data','image-libraries','shot-workspace-data','beat-edits','production-briefs']:
        (root/name).mkdir(parents=True,exist_ok=True)
    config=read(root/'sources.json',{'name':'Your production','sources':[]})
    entries=[];files=set();views=[]
    for record in config['sources']:
        entry,view,data=snapshot(record,files)
        if any(e['id']==entry['id'] for e in entries):raise ValueError('Source registered more than once')
        entries.append(entry);views.append((entry,view,data))
    # Validate all registrations before replacing the public inventory.
    for entry,view,data in views:
        (root/'view-data'/f"{entry['id']}.js").write_text('window.VIEW='+json.dumps(view,ensure_ascii=False)+';\n')
    inventory={'generated_at':stamp(),'roots':[],'root_status':[],'scan_errors':[], 'entries':entries,
               'support':[],'excluded':[],'source_notes':[],'songs':list(dict.fromkeys(e['song'] for e in entries)), 'missing_primary':[]}
    write(root/'inventory.json',inventory)
    (root/'inventory.js').write_text('window.CATALOG='+json.dumps(inventory,ensure_ascii=False)+';\n')
    from editable_catalogs import ensure
    ensure(root)
    for entry,view,data in views:seed_workspace(root,entry,view,data,files)
    write(root/'source-index.json',{'generated_at':stamp(),'feedback_scope':'Central workspace notes','entries':entries})
    write(root/'allowlist.json',{'files':sorted(files),'dirs':[]})
    for name,empty in [('supplemental-collections.json',{'collections':[]}),('crescendo-analysis.json',{'records':[]})]:
        if not (root/name).exists():write(root/name,empty)
    (root/'supplemental-data.js').write_text('window.SUPPLEMENTAL_COLLECTIONS='+json.dumps(read(root/'supplemental-collections.json'))+';\n')
    from command_center import build as build_center
    build_center(root)
    return inventory

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['build','add'],nargs='?',default='build')
    parser.add_argument('path',nargs='?');parser.add_argument('--title');parser.add_argument('--production');parser.add_argument('--act',type=int,default=1)
    args=parser.parse_args()
    if args.action=='add':
        if not args.path:parser.error('add requires a JSON storyboard path')
        if not 1<=args.act<=5:parser.error('act must be 1–5')
        record={'path':str(Path(args.path).expanduser().resolve()),'act':args.act,'primary':True}
        if args.title:record['title']=args.title
        if args.production:record['production']=args.production
        snapshot(record,set())
        config=read(ROOT/'sources.json',{'name':'Your production','sources':[]})
        if any(r['path']==record['path'] for r in config['sources']):raise SystemExit('This source is already registered.')
        config['sources'].append(record);write(ROOT/'sources.json',config)
    print('Indexed',len(build()['entries']),'storyboards. Original files unchanged.')
