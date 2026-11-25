#!/usr/bin/env python3
import os,json,time,secrets,hashlib,fcntl,urllib.parse,threading,mimetypes,re
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from catalog import ROOT,build
from related_images import related_assets, approved_desk_path, with_storyboard_aliases, resolve_media_path
PORT=int(os.environ.get('STORYBOARD_PORT', '8899'))
TOKEN=secrets.token_urlsafe(32)
LOCK=threading.RLock()
def atomic(p,data):
 b=json.dumps(data,ensure_ascii=False,indent=2).encode();tmp=p.with_suffix('.tmp')
 with open(tmp,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
 fd=os.open(str(p.parent),os.O_RDONLY);os.fsync(fd);os.close(fd)
def state():
 p=ROOT/'feedback'/'review-state.json'
 return json.loads(p.read_text()) if p.exists() else {'revision':0,'notes':{},'mutations':{}}
def config():return json.loads((ROOT/'allowlist.json').read_text())
def approved(p):
 p=p.resolve();c=config()
 return approved_desk_path(p) or str(p) in c['files'] or any(p.is_relative_to(Path(x).resolve()) for x in c['dirs'])
def arrangement_catalog(eid):
 if not isinstance(eid,str) or not re.fullmatch(r'[a-f0-9]{16}',eid):return None
 p=ROOT/'image-libraries'/(eid+'.json')
 if not p.exists():return None
 import shot_structure
 return shot_structure.apply_catalog(ROOT,eid,json.loads(p.read_text()))
def arrangement_state(eid,catalog):
 p=ROOT/'feedback'/'arrangements'/(eid+'.json')
 s=json.loads(p.read_text()) if p.exists() else {'revision':0,'assignments':{}}
 s['assignments']={slot['id']:s['assignments'].get(slot['id']) for slot in catalog['slots']}
 return s
def public_file(path):
 path=Path(path).resolve()
 if not path.is_relative_to(ROOT):return False
 parts=path.relative_to(ROOT).parts
 if any(part.startswith('.') for part in parts):return False
 if len(parts)==1:
  return path.suffix in {'.html','.css','.js'} or path.name in {'README.txt','inventory.json','source-index.json','command-center.json','EPISODIC-MAPPING.txt'}
 return parts[0] in {'view-data','image-imports','production-briefs','beat-analysis','crescendo-records','exports'} and path.suffix.lower() in {'.js','.json','.txt','.png','.jpg','.jpeg','.webp','.gif','.wav','.mp3','.m4a','.zip','.fcpxml','.html'}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def valid_host(self):return self.headers.get('Host') in [f'127.0.0.1:{PORT}',f'localhost:{PORT}']
 def respond(self,obj,code=200):
  data=json.dumps(obj).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
 def do_HEAD(self):self.do_GET(head=True)
 def do_GET(self,head=False):
  if not self.valid_host():return self.respond({'error':'Host rejected'},403)
  u=urllib.parse.urlsplit(self.path);route=urllib.parse.unquote(u.path)
  if re.fullmatch(r'/image-libraries/[a-f0-9]{16}\.json',route):
   catalog=arrangement_catalog(Path(route).stem)
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   tag_path=ROOT/'feedback/image-tags.json'
   if tag_path.exists():
    stored=json.loads(tag_path.read_text())
    for asset in catalog['assets']:
     digest=asset.get('sha256')
     if not digest and stored:
      path=resolve_media_path(asset['image'])
      if approved(path) and path.is_file():digest=hashlib.sha256(path.read_bytes()).hexdigest()
     if digest in stored:asset['tags']=stored[digest]
   return self.respond(catalog)
  if route in ('/library-api/crescendo','/library-api/crescendo-map'):
   from crescendo_bridge import index,current_map
   try:
    result=index(ROOT) if route=='/library-api/crescendo' else current_map(ROOT,urllib.parse.parse_qs(u.query).get('film',[''])[0])
    return self.respond(result)
   except (OSError,ValueError,KeyError) as error:return self.respond({'error':str(error)},400)
  if route=='/library-api/beat-timing':
   from beat_timing import read
   try:
    with LOCK:result=read(ROOT,urllib.parse.parse_qs(u.query).get('id',[''])[0])
    return self.respond(dict(result,csrf_token=TOKEN))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route in ('/library-api/final-cut-export/options','/library-api/final-cut-export/status'):
   import final_cut_export as fcx
   try:
    query=urllib.parse.parse_qs(u.query)
    if route.endswith('/status'):return self.respond(fcx.job_status(ROOT,query.get('job',[''])[0]))
    result=fcx.options(ROOT,query.get('id',[''])[0])
    history=[]
    for p in sorted((ROOT/'feedback/final-cut-exports').glob('*.json'),key=lambda p:p.stat().st_mtime,reverse=True):
     record=fcx.job_status(ROOT,p.stem)
     if record.get('entry_id')==result['id']:history.append(record)
     if len(history)==5:break
    return self.respond(dict(result,csrf_token=TOKEN,history=history))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/youtube-status':
   import youtube_status
   try:return self.respond(dict(youtube_status.status(ROOT),csrf_token=TOKEN))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':'YouTube status configuration unavailable.'},400)
  if route=='/library-api/health':return self.respond({'service':'owl-storyboard-library-v1','root':str(ROOT),'pid':os.getpid()})
  if route=='/library-api/source-status':
   eid=urllib.parse.parse_qs(u.query).get('id',[''])[0]
   e=next((e for e in json.loads((ROOT/'inventory.json').read_text())['entries'] if e['id']==eid),None)
   if not e:return self.respond({'error':'Unknown source'},404)
   changed=[];missing=[]
   for sp,old in e.get('source_signature',{}).items():
    q=Path(sp)
    if not q.exists():missing.append(sp)
    elif [q.stat().st_size,q.stat().st_mtime_ns]!=old:changed.append(sp)
   return self.respond({'changed':changed,'missing':missing,'inventory_time':json.loads((ROOT/'inventory.json').read_text())['generated_at']})
  if route=='/library-api/director-feedback':
   with LOCK:s=state()
   mapping=json.loads((ROOT/'source-index.json').read_text());byid={e['id']:e for e in mapping['entries']}
   feedback=[]
   for key,value in s['notes'].items():
    if not value:continue
    eid,scope=key.split(':',1);e=byid.get(eid,{})
    feedback.append({'key':key,'text':value,'scope':scope,'song':e.get('song'),'source_path':e.get('source_path'),'source_sha256_at_current_index':e.get('source_sha256'),'saved_context':s.get('contexts',{}).get(key),'viewer':e.get('viewer')})
   return self.respond({'scope':mapping['feedback_scope'],'revision':s['revision'],'saved_at':s.get('saved_at'),'mapping':'/source-index.json','feedback':feedback})
  if route=='/library-api/image-import-options':
   from image_library_import import options
   query=urllib.parse.parse_qs(u.query)
   try:
    with LOCK:result=options(ROOT,query.get('id',[''])[0],query.get('q',[''])[0],query.get('offset',['0'])[0])
    return self.respond(dict(result,csrf_token=TOKEN))
   except (ValueError,OSError,KeyError,TypeError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/related-images':
   eid=urllib.parse.parse_qs(u.query).get('id',[''])[0]
   if arrangement_catalog(eid) is None:return self.respond({'error':'Unknown storyboard'},404)
   scope=urllib.parse.parse_qs(u.query).get('scope',['related'])[0]
   if scope not in ['related','all']:return self.respond({'error':'Unknown image scope'},400)
   assets,error=related_assets(eid,scope)
   return self.respond({'assets':with_storyboard_aliases(assets,arrangement_catalog(eid)),'error':error})
  if route=='/library-api/image-approval':
   query=urllib.parse.parse_qs(u.query);eid=query.get('id',[''])[0];catalog=arrangement_catalog(eid)
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   from image_approval import read
   try:
    with LOCK:result=read(ROOT,catalog,arrangement_state(eid,catalog),query.get('asset',[''])[0],approved)
    return self.respond(dict(result,csrf_token=TOKEN))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/image-info':
   query=urllib.parse.parse_qs(u.query);eid=query.get('id',[''])[0];catalog=arrangement_catalog(eid)
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   from image_info import image_info
   try:
    with LOCK:result=image_info(ROOT,catalog,arrangement_state(eid,catalog),query.get('asset',[''])[0],approved)
    return self.respond(result)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/revision-context':
   query=urllib.parse.parse_qs(u.query);eid=query.get('id',[''])[0];catalog=arrangement_catalog(eid)
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   from revision_context import revision_context
   try:
    with LOCK:s=arrangement_state(eid,catalog)
    context=revision_context(ROOT,catalog,s,eid,query.get('slot',[''])[0],query.get('asset',[''])[0],approved)
    return self.respond(context)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/shot-flags':
   import shot_flags
   eid=urllib.parse.parse_qs(u.query).get('id',[''])[0]
   if arrangement_catalog(eid) is None:return self.respond({'error':'Unknown storyboard'},404)
   with LOCK:result=shot_flags.read(ROOT,eid)
   return self.respond(dict(result,csrf_token=TOKEN))
  if route=='/library-api/arrangement':
   eid=urllib.parse.parse_qs(u.query).get('id',[''])[0]
   catalog=arrangement_catalog(eid)
   if catalog is None:return self.respond({'error':'Storyboard editor unavailable'},404)
   with LOCK:s=arrangement_state(eid,catalog)
   return self.respond(dict(s,csrf_token=TOKEN))
  if route in ('/inventory.json','/inventory.js','/supplemental-data.js'):
   import shot_structure
   if route=='/supplemental-data.js':
    result=shot_structure.supplemental(ROOT,json.loads((ROOT/'supplemental-collections.json').read_text()));prefix='window.SUPPLEMENTAL_COLLECTIONS='
   else:
    result=shot_structure.inventory(ROOT,json.loads((ROOT/'inventory.json').read_text()));prefix='window.CATALOG='
   if route.endswith('.json'):return self.respond(result)
   raw=(prefix+json.dumps(result,ensure_ascii=False)+';').encode();self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.end_headers()
   if not head:self.wfile.write(raw)
   return
  if route=='/library-api/shot-structure':
   import shot_structure
   try:
    with LOCK:result=shot_structure.read(ROOT,urllib.parse.parse_qs(u.query).get('id',[''])[0])
    return self.respond(dict(result,csrf_token=TOKEN))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/shot-workspace':
   import shot_workspace
   try:
    with LOCK:result=shot_workspace.read(ROOT,urllib.parse.parse_qs(u.query).get('id',[''])[0])
    return self.respond(dict(result,csrf_token=TOKEN))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if route=='/library-api/review':
   with LOCK:s=state()
   return self.respond({'revision':s['revision'],'notes':s['notes'],'csrf_token':TOKEN,'disk_path':str(ROOT/'feedback'/'review-state.json')})
  if route.startswith('/api/'):return self.respond({'error':'Original storyboard API belongs to its independent server. Use the Library feedback panel for central disk notes.'},409)
  if route.startswith('/files/'):
   p=resolve_media_path(route[len('/files'):])
   if not approved(p):return self.respond({'error':'Unregistered source path'},403)
  else:
   p=(ROOT/route.lstrip('/')).resolve() if route!='/' else ROOT/'index.html'
   if not public_file(p):return self.respond({'error':'Private state; use the application API'},403)
  if not p.is_file():return self.respond({'error':'Source is absent or drive unavailable','path':str(p)},404)
  try:
   size=p.stat().st_size;start=0;end=size-1;status=200
   ran=self.headers.get('Range','');m=re.fullmatch(r'bytes=(\d*)-(\d*)',ran)
   if m:
    if m[1]:start=int(m[1]);end=min(int(m[2]) if m[2] else end,end)
    elif m[2]:start=max(0,size-int(m[2]))
    if start>end or start>=size:return self.respond({'error':'Invalid range'},416)
    status=206
   self.send_response(status);self.send_header('Content-Type',mimetypes.guess_type(str(p))[0] or 'application/octet-stream');self.send_header('Content-Length',str(end-start+1));self.send_header('Accept-Ranges','bytes');self.send_header('Cache-Control','no-cache');self.send_header('X-Content-Type-Options','nosniff')
   if status==206:self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
   self.end_headers()
   if not head:
    with open(p,'rb') as f:
     f.seek(start);remaining=end-start+1
     while remaining:
      b=f.read(min(256*1024,remaining))
      if not b:break
      self.wfile.write(b);remaining-=len(b)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_POST(self):
  if not self.valid_host() or self.headers.get('Origin') not in [f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'] or self.headers.get('X-OWL-CSRF')!=TOKEN:return self.respond({'error':'Origin/token rejected'},403)
  if self.headers.get('Content-Type')!='application/json':return self.respond({'error':'JSON required'},415)
  try:n=int(self.headers.get('Content-Length','0'))
  except ValueError:return self.respond({'error':'Invalid body length'},400)
  limit=29*1024*1024 if self.path=='/library-api/image-import' else 200000
  if not 0<n<limit:return self.respond({'error':'Body too large or empty'},413)
  try:data=json.loads(self.rfile.read(n))
  except ValueError:return self.respond({'error':'Invalid JSON'},400)
  if not isinstance(data,dict):return self.respond({'error':'JSON object required'},400)
  if self.path=='/library-api/shot-structure':
   import shot_structure
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.shot-structure.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX);result=shot_structure.save(ROOT,data,atomic)
    return self.respond(dict(result,ok=True))
   except shot_structure.StructureConflict as e:
    with LOCK:current=shot_structure.read(ROOT,data['id'])
    return self.respond({'error':str(e),'current':current},409)
   except (ValueError,OSError,KeyError,TypeError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/shot-workspace':
   import shot_workspace
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.shot-workspace.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX);result=shot_workspace.save(ROOT,data,atomic)
    return self.respond(dict(result,ok=True))
   except shot_workspace.WorkspaceConflict as e:
    with LOCK:disk=shot_workspace.read(ROOT,data['id'])['shots'].get(data.get('shot_id'))
    return self.respond({'error':str(e),'disk_value':disk},409)
   except (ValueError,OSError,KeyError,TypeError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/image-import':
   from image_library_import import add
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.image-import.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX);result=add(ROOT,data,atomic)
    return self.respond(dict(result,ok=True))
   except (ValueError,OSError,KeyError,TypeError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/youtube-status/refresh':
   import youtube_status
   try:
    youtube_status.refresh(ROOT)
    return self.respond(youtube_status.status(ROOT))
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':'YouTube status configuration unavailable.'},400)
  if self.path in ('/library-api/final-cut-export/preflight','/library-api/final-cut-export/create'):
   import final_cut_export as fcx
   try:
    if self.path.endswith('/create'):return self.respond(fcx.start_job(ROOT,data,approved,resolve_media_path,atomic,LOCK),202)
    with LOCK:result=fcx.snapshot(ROOT,data,approved,resolve_media_path)
    return self.respond(fcx.summary(result))
   except fcx.Conflict as e:return self.respond({'error':str(e)},409)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/beat-timing':
   from beat_timing import save,TimingConflict
   try:
    folder=ROOT/'feedback/timings';folder.mkdir(exist_ok=True)
    with LOCK,open(folder/'.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX);result=save(ROOT,data,atomic)
    return self.respond(dict(result,csrf_token=TOKEN))
   except TimingConflict as e:return self.respond({'error':str(e)},409)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/image-approval':
   catalog=arrangement_catalog(data.get('id'))
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   from image_approval import save,ApprovalConflict
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.image-approval.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX)
     result=save(ROOT,catalog,arrangement_state(data['id'],catalog),data,approved,atomic)
    return self.respond(dict(result,csrf_token=TOKEN))
   except ApprovalConflict as e:return self.respond({'error':str(e)},409)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/image-tags':
   catalog=arrangement_catalog(data.get('id'))
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   from image_info import add_tags,TagConflict
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.image-tags.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX)
     result=add_tags(ROOT,catalog,arrangement_state(data['id'],catalog),data,approved,atomic)
    return self.respond(result)
   except TagConflict as e:return self.respond({'error':str(e)},409)
   except (ValueError,OSError,KeyError) as e:return self.respond({'error':str(e)},400)
  if self.path=='/library-api/shot-flags':
   import shot_flags
   catalog=arrangement_catalog(data.get('id'))
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   folder=ROOT/'feedback';folder.mkdir(exist_ok=True)
   try:
    with LOCK,open(folder/'.shot-flags.lock','a') as lock:
     fcntl.flock(lock,fcntl.LOCK_EX)
     result=shot_flags.save(ROOT,catalog,data,atomic)
    return self.respond(dict(result,csrf_token=TOKEN))
   except shot_flags.FlagConflict as error:
    with LOCK:result=shot_flags.read(ROOT,data['id'])
    return self.respond(dict(result,error=str(error),csrf_token=TOKEN),409)
   except (ValueError,OSError,KeyError):return self.respond({'error':'Flag could not be saved. Check the shot and reconnect before trying again.'},400)
  if self.path=='/library-api/arrangement':
   eid=data.get('id');catalog=arrangement_catalog(eid)
   if catalog is None:return self.respond({'error':'Unknown storyboard'},404)
   assignments=data.get('assignments');revision=data.get('revision')
   slotids={s['id'] for s in catalog['slots']}
   related,error=related_assets(eid,'all')
   with LOCK:previous=arrangement_state(eid,catalog)
   extra={a['id']:a for a in previous.get('related_assets',[])}
   extra.update({a['id']:a for a in related})
   assetids={a['id'] for a in catalog['assets']} | set(extra)
   if type(revision) is not int or not isinstance(assignments,dict) or set(assignments)!=slotids or any(v is not None and (not isinstance(v,str) or v not in assetids) for v in assignments.values()):return self.respond({'error':'Invalid shot assignments'},400)
   folder=ROOT/'feedback'/'arrangements';folder.mkdir(parents=True,exist_ok=True)
   with LOCK,open(folder/'.lock','a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX);s=arrangement_state(eid,catalog)
    if s['assignments']==assignments:return self.respond(dict(s,ok=True))
    if revision!=s['revision']:return self.respond(dict(s,error='Arrangement changed in another tab. Your changes are retained locally.'),409)
    history=folder/'history';history.mkdir(exist_ok=True)
    atomic(history/(eid+'-'+str(s['revision'])+'.json'),s)
    s={'revision':s['revision']+1,'assignments':assignments,'related_assets':[a for aid,a in extra.items() if aid in assignments.values()],'saved_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    atomic(folder/(eid+'.json'),s)
   return self.respond(dict(s,ok=True))
  if self.path=='/library-api/refresh':
   # Reload registrations saved by concurrent production tasks before rebuilding.
   import importlib, catalog
   with LOCK,open(ROOT/'feedback'/'.lock','a') as catalog_lock:
    fcntl.flock(catalog_lock,fcntl.LOCK_EX)
    importlib.invalidate_caches()
    importlib.reload(catalog).build()
   import youtube_status
   if (ROOT/'youtube-channel.json').is_file():youtube_status.refresh(ROOT,force=True)
   return self.respond({'ok':True,'refreshed':time.time()})
  if self.path!='/library-api/merge':return self.respond({'error':'Only library feedback writes are supported'},404)
  key=data.get('key');value=data.get('value');base=data.get('base');mid=data.get('mutation_id')
  ids={e['id'] for e in json.loads((ROOT/'inventory.json').read_text())['entries']}
  if not isinstance(key,str) or key.split(':')[0] not in ids or len(key)>180 or not isinstance(value,str) or len(value)>50000 or not isinstance(base,str) or not isinstance(mid,str) or len(mid)>80:return self.respond({'error':'Invalid note schema'},400)
  folder=ROOT/'feedback';folder.mkdir(exist_ok=True);(folder/'history').mkdir(exist_ok=True)
  with LOCK,open(folder/'.lock','a') as lock:
   fcntl.flock(lock,fcntl.LOCK_EX);s=state();digest=hashlib.sha256(json.dumps([key,base,value]).encode()).hexdigest()
   if mid in s['mutations']:
    if s['mutations'][mid]!=digest:return self.respond({'error':'Mutation ID reused with different content'},400)
    return self.respond({'ok':True,'revision':s['revision'],'value':s['notes'].get(key,''),'replayed':True})
   current=s['notes'].get(key,'')
   if current!=base and current!=value:return self.respond({'error':'This note changed on disk. Review both versions before saving.','disk_value':current,'revision':s['revision']},409)
   if current!=value:
    atomic(folder/'history'/f"revision-{s['revision']:06}.json",s)
    s['notes'][key]=value
    e=next(e for e in json.loads((ROOT/'inventory.json').read_text())['entries'] if e['id']==key.split(':')[0])
    s.setdefault('contexts',{})[key]={'source_path':e['path'],'source_sha256':e['sha256'],'inventory_time':json.loads((ROOT/'inventory.json').read_text())['generated_at']}
    s['revision']+=1;s['saved_at']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
   s['mutations'][mid]=digest;atomic(folder/'review-state.json',s)
   self.respond({'ok':True,'revision':s['revision'],'value':value,'saved_at':s.get('saved_at')})
if __name__=='__main__':
 import youtube_status
 build()
 if (ROOT/'youtube-channel.json').is_file():youtube_status.refresh(ROOT)
 ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
