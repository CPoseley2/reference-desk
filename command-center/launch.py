#!/usr/bin/env python3
import sys,os,subprocess,time,json,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
URL='http://127.0.0.1:8899/'
def healthy():
 try:
  d=json.load(urllib.request.urlopen(URL+'library-api/health',timeout=1))
  return d.get('service')=='owl-storyboard-library-v1' and d.get('root')==str(ROOT)
 except Exception:return False
if not healthy():
 try:
  urllib.request.urlopen(URL+'library-api/health',timeout=1)
 except (OSError, ValueError):pass
 else:raise SystemExit('Port 8899 belongs to another workspace. Stop it before launching this copy.')
 from catalog import build
 build()
 log=open(ROOT/'server.log','ab',buffering=0)
 subprocess.Popen([sys.executable,str(ROOT/'server.py')],cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True,close_fds=True)
 for _ in range(40):
  if healthy():break
  time.sleep(.15)
if not healthy():
 try:
  urllib.request.urlopen(URL+'library-api/health',timeout=1)
 except (OSError, ValueError):pass
 else:raise SystemExit('Port 8899 belongs to another workspace. Stop it before launching this copy.')
 from catalog import build
 build()
 print('Library server could not start. Port 8899 may be occupied. Offline index will open; disk saving is unavailable. See server.log.')
 target=str(ROOT/'index.html')
else:target=URL
if '--no-open' not in sys.argv:subprocess.run(['open','-g','-a','Safari',target],check=False)
print(target)
