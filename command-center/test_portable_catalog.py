import json, tempfile, unittest, hashlib, threading, urllib.request, urllib.error
from pathlib import Path
from unittest.mock import patch
import catalog, server

class PortableCatalogTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name).resolve();self.app=self.root/'app';self.app.mkdir()
  self.image=self.root/'frame.png';self.image.write_bytes(b'neutral fixture')
  self.source=self.root/'story.json';self.source.write_text(json.dumps({'title':'Example','shots':[{'id':'S1','title':'Opening','image':'frame.png','start':0,'end':3}],'characters':[{'id':'keeper','name':'Keeper','images':['frame.png']}],'locations':['frame.png']}))
 def register(self):
  (self.app/'sources.json').write_text(json.dumps({'sources':[{'path':str(self.source)}]}))
  with patch.object(catalog,'ROOT',self.app):return catalog.build(self.app)['entries'][0]['id']
 def test_empty_start_contains_no_sources(self):
  self.assertEqual(catalog.build(self.app)['entries'],[])
  self.assertEqual(json.loads((self.app/'allowlist.json').read_text()),{'files':[],'dirs':[]})
 def test_registration_seeds_editable_workspace_without_changing_source(self):
  before=self.source.read_bytes();eid=self.register()
  cfg=json.loads((self.app/'shot-workspace-data'/f'{eid}.json').read_text())
  self.assertEqual(cfg['shots'][0]['script_text'],'Opening');self.assertEqual(cfg['characters'][0]['name'],'Keeper')
  self.assertEqual(len(cfg['location_ids']),1);self.assertEqual(self.source.read_bytes(),before)
  allowed=json.loads((self.app/'allowlist.json').read_text());self.assertEqual(allowed['dirs'],[])
  self.assertEqual(set(allowed['files']),{str(self.source),str(self.image)})
  state=self.app/'feedback/arrangements'/f'{eid}.json';state.write_text('{"revision":4,"assignments":{"S1":null}}')
  self.register();self.assertEqual(json.loads(state.read_text())['revision'],4)
 def test_invalid_source_leaves_previous_inventory_intact(self):
  self.register();before=(self.app/'inventory.json').read_bytes()
  self.source.write_text('{"shots":[{"id":"same"},{"id":"same"}]}')
  with self.assertRaisesRegex(ValueError,'unique'):catalog.build(self.app)
  self.assertEqual((self.app/'inventory.json').read_bytes(),before)
 def test_hidden_network_and_nonmedia_paths_rejected(self):
  for value in ['https://example.com/image.png','file://remote/image.png','.secret.png','notes.txt']:
   with self.subTest(value=value),self.assertRaises(ValueError):catalog.registered_path(value,self.root,set())
 def test_http_exposes_only_registered_media_and_public_assets(self):
  eid=self.register();(self.app/'index.html').write_text('<h1>Example</h1>')
  (self.app/'.state').mkdir();(self.app/'.state/private.json').write_text('{}')
  http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  with patch.object(server,'ROOT',self.app),patch.object(server,'PORT',http.server_port):
   thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
   try:
    def get(path):
     try:
      with urllib.request.urlopen(f'http://127.0.0.1:{http.server_port}'+path) as response:return response.status,response.read()
     except urllib.error.HTTPError as error:return error.code,error.read()
    self.assertEqual(get('/')[0],200)
    for path in ['/sources.json','/allowlist.json','/.state/private.json','/catalog.py']:
     self.assertIn(get(path)[0],(403,404),path)
    self.assertEqual(get('/files'+str(self.image))[0],200)
    self.assertNotEqual(get('/files'+str(self.root/'unregistered.png'))[0],200)
    status,body=get('/library-api/shot-workspace?id='+eid)
    self.assertEqual(status,200);self.assertEqual(json.loads(body)['config']['shots'][0]['id'],'S1')
   finally:http.shutdown();http.server_close();thread.join()
if __name__=='__main__':unittest.main()
