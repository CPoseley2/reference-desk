#!/usr/bin/env python3
"""Local-only DESK review storage. No network services beyond loopback; stdlib only."""
import argparse,copy,fcntl,hashlib,json,mimetypes,os,secrets,threading,time,uuid,urllib.parse
from pathlib import Path
from datetime import datetime
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import canon_manifest
import review_merge
import reference_catalog
import image_generation
MAX=4*1024*1024
class Store:
 def __init__(self,root,state):
  self.root=Path(root).resolve();self.dir=Path(state).resolve();self.dir.mkdir(parents=True,exist_ok=True);self.file=self.dir/'review-state.json';self.history=self.dir/'history';self.history.mkdir(exist_ok=True);self.lock=threading.RLock();self.token=secrets.token_urlsafe(32)
  if not self.file.exists():
   seed=json.loads((self.root/'manifest.json').read_text()).get('review_defaults',{'schema':'desk.character-choices','version':1,'collection':'reference-desk','items':[],'character_roles':{},'character_rankings':{}})
   self.validate(seed);self.atomic(self.file,{'schema':'desk.local-review-state','version':1,'revision':1,'saved_at':time.time(),'choices':seed,'mutation_id':'initial-seed','payload_hash':self.digest(seed)})
  self.refresh_director(self.read())
 def refresh_director(self,state):
  value=canon_manifest.derive(state,json.loads((self.root/'manifest.json').read_text()),self.root)
  self.atomic(self.dir/'director-reference-manifest.json',value)
  return value
 def digest(self,v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 def atomic(self,path,v):
  tmp=path.with_name('.'+path.name+'.'+uuid.uuid4().hex+'.tmp')
  try:
   with tmp.open('x')as f:json.dump(v,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
   os.replace(tmp,path);fd=os.open(str(path.parent),os.O_RDONLY);os.fsync(fd);os.close(fd)
  finally:
   if tmp.exists():tmp.unlink()
 def read(self):
  v=json.loads(self.file.read_text());assert v['schema']=='desk.local-review-state' and v.get('version')==1 and type(v['revision'])is int and v['revision']>0;self.validate(v['choices']);assert v.get('payload_hash')==self.digest(v['choices']),'Review checksum mismatch; preserve file and recover from history';return v
 def validate(self,v):
  if not isinstance(v,dict)or v.get('schema')!='desk.character-choices'or (type(v.get('version'))is not int or v.get('version')!=1) or v.get('collection')!='reference-desk':raise ValueError('Expected global desk.character-choices version 1')
  m=json.loads((self.root/'manifest.json').read_text());
  if v.get('library_id') and m.get('library_id') and v['library_id']!=m['library_id']:raise ValueError('Review belongs to another library')
  aa={a['id']:a for a in m['assets']};cc={c['id']:c for c in m['characters']};items=v.get('items');seen=set()
  if not isinstance(items,list)or len(items)>len(aa):raise ValueError('Invalid items')
  def known(id,h):
   a=aa.get(id) if isinstance(id,str) else None
   if not a or h not in [a['sha256']]+[p['sha256']for p in a.get('previous_versions',[])]:raise ValueError('Unknown ID or source hash: '+str(id))
   return a
  def timestamp(t):
   if t is not None:
    if not isinstance(t,str):raise ValueError('Invalid timestamp')
    try:datetime.fromisoformat(t.replace('Z','+00:00'))
    except ValueError:raise ValueError('Invalid timestamp')
  def rank(r):
   if r is not None and(type(r)is not int or r<1 or r>100000):raise ValueError('Invalid rank')
  for n in items:
   if not isinstance(n,dict)or not isinstance(n.get('id'),str)or n.get('id')in seen:raise ValueError('Duplicate/invalid item')
   timestamp(n.get('updated_at'));seen.add(n.get('id'));known(n.get('id'),n.get('source_sha256'));rank(n.get('rank'))
   if type(n.get('obsolete'))is not bool:raise ValueError('Invalid obsolete flag')
   for key in ['notes','role']:
    if not isinstance(n.get(key,''),str)or len(n.get(key,''))>20000:raise ValueError('Invalid text field')
   if n.get('preference','Unreviewed')not in ['Unreviewed','Prefer','Reject']:raise ValueError('Invalid preference')
  if not isinstance(v.get('character_roles',{}),dict) or not isinstance(v.get('character_rankings',{}),dict):raise ValueError('Roles and rankings must be objects')
  for cid,pairs in v.get('character_roles',{}).items():
   if cid not in cc or not isinstance(pairs,dict):raise ValueError('Invalid character roles')
   for role,id in pairs.items():
    if role not in ['body','emotion','likeness']or not isinstance(id,str)or id not in aa or cid not in aa[id]['character_ids']:raise ValueError('Invalid role reference')
  for cid,items in v.get('character_rankings',{}).items():
   if cid not in cc or not isinstance(items,dict):raise ValueError('Invalid rankings')
   for id,r in items.items():
    if not isinstance(r,dict):raise ValueError('Invalid rank record')
    timestamp(r.get('updated_at'));a=known(id,r.get('source_sha256'));rank(r.get('rank'))
    if cid not in a['character_ids']:raise ValueError('Rank belongs to different character')
  cr=v.get('collection_reviews',{})
  if not isinstance(cr,dict):raise ValueError('Invalid collection reviews')
  for cid,r in cr.items():
   if cid not in cc and cid!='reference-desk':raise ValueError('Unknown review collection')
   if not isinstance(r,dict)or not isinstance(r.get('review'),dict):raise ValueError('Invalid collection review')
   for k,t in r['review'].items():
    if k not in ['face','hair','costume','notes']or not isinstance(t,str)or len(t)>20000:raise ValueError('Invalid collection review text')
  canon_manifest.validate(v,m)
  if len(json.dumps(v).encode())>MAX:raise ValueError('Payload too large')
 def save(self,base,mutation,choices,merge_request_hash=None):
  self.validate(choices)
  if not isinstance(mutation,str)or len(mutation)>100 or not mutation:raise ValueError('Invalid mutation ID')
  with self.lock, (self.dir/'review-write.lock').open('a') as lockfile:
   fcntl.flock(lockfile,fcntl.LOCK_EX)
   old=self.read();m=json.loads((self.root/'manifest.json').read_text());choices=canon_manifest.preserve_and_check(choices,old,m);self.validate(choices);h=self.digest(choices)
   if old.get('mutation_id')==mutation:
    if old.get('payload_hash')!=h:raise ValueError('Mutation ID reused with different content')
    return old,False
   if type(base)is not int or base!=old['revision']:return old,True
   self.atomic(self.history/f"revision-{old['revision']:08}.json",old)
   new={'schema':'desk.local-review-state','version':1,'revision':old['revision']+1,'saved_at':time.time(),'choices':choices,'mutation_id':mutation,'payload_hash':h}
   if merge_request_hash:new['merge_request_hash']=merge_request_hash
   self.atomic(self.file,new)
   try:self.refresh_director(new)
   except Exception:pass # Durable review remains authoritative; GET regenerates the derived view.
   return new,False
 def merge_save(self,request):
  local=request.get('choices');self.validate(local);base=request.get('base_revision');resolutions=request.get('resolutions')or{}
  mutation=request.get('mutation_id')
  if not isinstance(mutation,str)or not mutation or len(mutation)>100:raise ValueError('Invalid mutation ID')
  if type(base)is not int or base<1:raise ValueError('A saved base revision is required; keep pending edits and recover them before saving')
  if not isinstance(resolutions,dict)or any(v not in ['local','disk']for v in resolutions.values()):raise ValueError('Invalid conflict decisions')
  with self.lock:
   current=self.read()
   fingerprint=self.digest({k:request.get(k)for k in ['base_revision','choices','resolutions','expected_revision']})
   if current.get('mutation_id')==request.get('mutation_id'):
    if current.get('merge_request_hash')!=fingerprint:raise ValueError('Mutation ID reused with different content')
    return current,[],False
   if base==current['revision']:baseline=current
   else:
    p=self.history/f'revision-{base:08}.json'
    if not p.exists():raise ValueError('Base revision unavailable; pending edits retained')
    baseline=json.loads(p.read_text())
   if resolutions and request.get('expected_revision')!=current['revision']:return current,[{'key':'revision','local':'Retry conflict review','disk':'Disk changed again'}],True
   merged,conflicts=review_merge.merge(baseline['choices'],local,current['choices'],json.loads((self.root/'manifest.json').read_text()),resolutions)
   if conflicts:return current,conflicts,True
   if merged==current['choices']:return current,[],False
   saved,conflict=self.save(current['revision'],request.get('mutation_id'),merged,merge_request_hash=fingerprint)
   return saved,[],conflict
class Handler(BaseHTTPRequestHandler):
 @property
 def store(self):return self.server.store
 @property
 def generation(self):return self.server.generation
 def static_root(self,rel):return self.store.root
 def log_message(self,fmt,*a):print(time.strftime('%Y-%m-%d %H:%M:%S'),fmt%a,flush=True)
 def write_bytes(self,data):
  try:self.wfile.write(data)
  except (BrokenPipeError,ConnectionResetError):pass
 def reply(self,status,v):
  data=json.dumps(v).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.write_bytes(data)
 def hostok(self):return self.headers.get('Host')==self.server.origin.split('://')[1]
 def do_GET(self):
  if not self.hostok():return self.reply(403,{'error':'Invalid Host'})
  parsed=urllib.parse.urlsplit(self.path);path=urllib.parse.unquote(parsed.path)
  if path=='/api/health':return self.reply(200,{'service':'desk.local-review','bulk_approvals':True,'image_generation':True,'instance_id':self.server.instance_id,'pid':os.getpid(),'asset_root':str(self.store.root)})
  if path=='/api/location-editing':
   import location_editing
   return self.reply(200,location_editing.history(self.generation,urllib.parse.parse_qs(parsed.query).get('location_id',[None])[0]))
  if path=='/api/generation/config':return self.reply(200,self.generation.config())
  if path.startswith('/api/generation/jobs/'):
   try:return self.reply(200,self.generation.public(self.generation.read(path.removeprefix('/api/generation/jobs/'))))
   except image_generation.JobError as e:return self.reply(400,{'error':str(e)})
  if path=='/api/review':
   with self.store.lock:v=self.store.read()
   return self.reply(200,{**v,'csrf_token':self.store.token})
  if path=='/api/director-references':
   with self.store.lock:
    state=self.store.read();value=self.store.refresh_director(state)
   return self.reply(200,value)
  if path=='/api/history':return self.reply(200,{'revisions':[p.stem for p in sorted(self.store.history.glob('revision-*.json'))]})
  if path.startswith('/api/revisions/'):
   suffix=path.removeprefix('/api/revisions/')
   if not suffix.isdigit():return self.reply(400,{'error':'Invalid revision'})
   p=self.store.history/f'revision-{int(suffix):08}.json'
   if not p.is_file():return self.reply(404,{'error':'Revision unavailable'})
   return self.reply(200,json.loads(p.read_text()))
  if path.startswith('/api/'):return self.reply(404,{'error':'Not found'})
  if '\x00'in path or '\\'in path or any(x in ['..','.']for x in path.split('/')):return self.reply(403,{'error':'Invalid path'})
  rel=path.lstrip('/')or'index.html';root=self.static_root(rel)
  try:
   import linked_media
   p=linked_media.resolve_read(root,rel)
  except (ValueError,OSError):return self.reply(404,{'error':'File unavailable; linked originals may be offline or changed'})
  if any(x.startswith('.')for x in Path(rel).parts)or p.suffix.lower()not in ['.html','.js','.css','.json','.csv','.txt','.png','.jpg','.jpeg','.webp','.gif','.svg','.pdf','.woff','.woff2','.fountain']or not p.is_file():return self.reply(404,{'error':'Not found'})
  data=p.read_bytes();self.send_response(200);self.send_header('Content-Type',mimetypes.guess_type(str(p))[0]or'application/octet-stream');self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY');self.end_headers();self.write_bytes(data)
 def do_POST(self):
  if not self.hostok()or self.headers.get('Origin')!=self.server.origin or self.headers.get('X-DESK-CSRF')!=self.store.token:return self.reply(403,{'error':'Same-origin token required'})
  if self.headers.get('Content-Type','').split(';')[0]!='application/json':return self.reply(415,{'error':'JSON required'})
  try:
   n=int(self.headers.get('Content-Length','0'))
   if not 0<n<=(29*1024*1024 if self.path in ['/api/references','/api/location-references'] else MAX):return self.reply(413,{'error':'Invalid payload size'})
   v=json.loads(self.rfile.read(n))
   if not isinstance(v,dict):raise ValueError('Request must be an object')
   if self.path=='/api/generation/jobs':return self.reply(202,self.generation.submit(v))
   if self.path.startswith('/api/generation/jobs/') and self.path.endswith('/retry-save'):
    return self.reply(200,self.generation.retry_save(self.path.removeprefix('/api/generation/jobs/').removesuffix('/retry-save')))
   if self.path in ['/api/characters','/api/emotions','/api/looks','/api/props','/api/references','/api/reference-tags','/api/locations','/api/location-references','/api/location-selection','/api/location-approval','/api/location-adopt','/api/location-production']:
    try:return self.reply(200,reference_catalog.mutate(self.store,self.path,v))
    except reference_catalog.Conflict as e:return self.reply(409,{'error':str(e)})
   if self.path=='/api/review':new,conflict=self.store.save(v.get('base_revision'),v.get('mutation_id'),v.get('choices'))
   elif self.path=='/api/merge':
    new,conflicts,conflict=self.store.merge_save(v)
    return self.reply(409 if conflict else 200,{**new,'csrf_token':self.store.token,'conflict':conflict,'conflicts':conflicts})
   elif self.path=='/api/restore':
    revision=v.get('restore_revision')
    if type(revision)is not int or revision<1:raise ValueError('Invalid restore revision')
    p=self.store.history/f'revision-{revision:08}.json'
    if not p.exists():return self.reply(404,{'error':'Backup not found'})
    choices=json.loads(p.read_text())['choices'];choices.setdefault('canonical_references',{});choices.setdefault('canon_history',[]);new,conflict=self.store.save(v.get('base_revision'),v.get('mutation_id'),choices)
   else:return self.reply(404,{'error':'Not found'})
   self.reply(409 if conflict else 200,{**new,'csrf_token':self.store.token,'conflict':conflict})
  except (ValueError,TypeError,KeyError,AssertionError,AttributeError)as e:self.reply(400,{'error':str(e)})
  except Exception:self.reply(500,{'error':'Save failed; previous durable state retained. Check server log.'})
 def do_OPTIONS(self):self.reply(403,{'error':'Cross-origin requests are not allowed'})
def create_server(root,state,port):
 s=ThreadingHTTPServer(('127.0.0.1',port),Handler);s.store=Store(root,state);s.generation=image_generation.Manager(s.store);s.instance_id=uuid.uuid4().hex;s.origin=f'http://127.0.0.1:{s.server_port}';return s
if __name__=='__main__':
 from library_server import create_app_server
 p=argparse.ArgumentParser();p.add_argument('--root',default=str(Path(__file__).parent));p.add_argument('--state-dir',default=str(Path(__file__).resolve().parent/'.state'));p.add_argument('--port',type=int,default=8876);p.add_argument('--open',action='store_true');a=p.parse_args();s=create_app_server(a.root,a.state_dir,a.port);print('DESK local index:',s.origin,'\nReview state:',s.libraries.root,'\nKeep this terminal open. Ctrl-C stops; rerun Start command to resume.',flush=True)
 if a.open:
  import webbrowser
  threading.Timer(.5,lambda:webbrowser.open(s.origin)).start()
 try:s.serve_forever()
 except KeyboardInterrupt:pass
 finally:s.server_close()
