#!/usr/bin/env python3
"""Explicit start/stop only. No login item, launch agent, or public listener."""
import argparse,json,os,signal,subprocess,sys,time,urllib.request,urllib.error,webbrowser
from pathlib import Path
ROOT=Path(__file__).resolve().parent
STATE=Path(__file__).resolve().parent/'.state'
URL='http://127.0.0.1:8876'
def health():
 try:
  with urllib.request.urlopen(URL+'/api/health',timeout=2)as r:
   x=json.load(r)
   if x.get('service')!='desk.local-review' or Path(x.get('asset_root','')).resolve()!=ROOT:raise RuntimeError('Port 8876 belongs to a different service; nothing changed.')
   return x
 except urllib.error.URLError as e:
  if isinstance(e,urllib.error.HTTPError):raise RuntimeError('Port 8876 is occupied by another service; nothing changed.')
  return None
 except (ConnectionResetError,ConnectionRefusedError,TimeoutError):return None

def main():
 p=argparse.ArgumentParser();p.add_argument('--stop',action='store_true');p.add_argument('--no-open',action='store_true');a=p.parse_args();STATE.mkdir(exist_ok=True,parents=True)
 h=health();record=STATE/'server-instance.json'
 if a.stop:
  if not h:print('DESK autosave server is already stopped.');return
  if not record.exists():raise RuntimeError('No matching launcher record; refusing to stop an unidentified process.')
  old=json.loads(record.read_text())
  if old.get('instance_id')!=h.get('instance_id')or old.get('pid')!=h.get('pid'):raise RuntimeError('Server differs from recorded instance; nothing stopped.')
  os.kill(h['pid'],signal.SIGTERM)
  for _ in range(30):
   if not health():print('Stopped. Saved choices and backups remain in',STATE);return
   time.sleep(.1)
  raise RuntimeError('Stop requested; server has not yet exited.')
 if not h:
  log=(STATE/'server.log').open('ab')
  child=subprocess.Popen([sys.executable,'-B',str(ROOT/'local_review_server.py'),'--root',str(ROOT),'--state-dir',str(STATE),'--port','8876'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,close_fds=True);log.close()
  for _ in range(50):
   h=health()
   if h:break
   if child.poll()is not None:raise RuntimeError('Server did not start. See '+str(STATE/'server.log'))
   time.sleep(.1)
  if not h:raise RuntimeError('Server start outcome uncertain. Check server.log before retrying.')
  record.write_text(json.dumps(h,indent=2)+'\n')
 print('DESK index:',URL,'\nServing:',h['asset_root'],'\nLibraries:',ROOT/'libraries','\nRuns until Stop Reference Desk.command or Mac shutdown. No automatic startup.')
 if not a.no_open:webbrowser.open(URL)
if __name__=='__main__':
 try:main()
 except Exception as e:print(str(e),file=sys.stderr);sys.exit(1)
