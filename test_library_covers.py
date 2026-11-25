"""Cover persistence, validation, isolation and concurrent-window protection."""
import base64
import concurrent.futures
import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from library_server import create_app_server
from library_store import LibraryRegistry

SOURCE=Path(__file__).resolve().parent

class CoverTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='desk-cover-test-')
        self.root=Path(self.temp.name)
        shutil.copytree(SOURCE/'library-templates',self.root/'library-templates')
        self.server=create_app_server(self.root,self.root/'.state',0)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.lid=self.server.libraries.catalog['default_library_id']
        self.other=self.server.libraries.create({'name':'Other','request_id':str(uuid.uuid4())})['id']
        self.path='/api/libraries/'+self.lid+'/cover'
        self.upload={'data':base64.b64encode((SOURCE/'ui-assets/canvas-v1.png').read_bytes()).decode()}
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def request(self,path,payload=None,token=None,origin=None):
        headers={'Origin':origin or self.server.origin,'X-DESK-CSRF':token or self.server.app_token,'Content-Type':'application/json'}
        req=urllib.request.Request(self.server.origin+path,headers=headers,data=None if payload is None else json.dumps(payload).encode())
        try:
            with urllib.request.urlopen(req) as response:return response.status,response.read(),dict(response.headers)
        except urllib.error.HTTPError as error:return error.code,error.read(),dict(error.headers)
    def cover(self,lid=None):return next(x for x in self.server.libraries.list() if x['id']==(lid or self.lid))['cover']
    def set_cover(self,revision=None,upload=None):return self.request(self.path,{'action':'set','base_revision':revision,'upload':upload or self.upload})
    def test_add_replace_remove_survive_restart_and_preserve_catalogs(self):
        originals={lid:(self.root/'libraries'/lid/'manifest.json').read_bytes() for lid in (self.lid,self.other)}
        self.assertEqual(self.request(self.path)[0],404)
        self.assertEqual(self.set_cover()[0],200)
        first=self.cover();self.assertTrue(first['url'])
        code,data,headers=self.request(first['url']);self.assertEqual(code,200);self.assertTrue(data.startswith(b'\xff\xd8\xff'));self.assertEqual(headers['Content-Type'],'image/jpeg')
        self.assertIsNone(self.cover(self.other)['url'])
        self.assertEqual(self.set_cover(first['revision'])[0],200)
        second=self.cover();self.assertNotEqual(first['revision'],second['revision'])
        reopened=LibraryRegistry(self.root,self.root/'.state')
        self.assertEqual(next(x for x in reopened.list() if x['id']==self.lid)['cover'],second)
        self.assertEqual(self.request(self.path,{'action':'remove','base_revision':second['revision']})[0],200)
        self.assertIsNone(self.cover()['url']);self.assertEqual(self.request(self.path)[0],404)
        for lid,data in originals.items():self.assertEqual((self.root/'libraries'/lid/'manifest.json').read_bytes(),data)
        self.assertEqual(len(list((self.root/'libraries'/self.lid/'.state/library-cover').glob('*.jpg'))),2)
        self.assertIn(self.request('/libraries/'+self.lid+'/.state/library-cover/cover.json')[0],(403,404))
    def test_rejects_invalid_input_and_unauthorized_mutations(self):
        self.assertEqual(self.request(self.path,{'action':'remove','base_revision':None},token='invalid')[0],403)
        self.assertEqual(self.request(self.path,{'action':'remove','base_revision':None},origin='http://untrusted.example')[0],403)
        for upload in ({'data':'not base64'},{'data':base64.b64encode(b'<svg></svg>').decode()},{'data':base64.b64encode(b'\x89PNG\r\n\x1a\ninvalid').decode()}):
            self.assertEqual(self.set_cover(upload=upload)[0],400)
        self.assertEqual(self.request(self.path,{'action':'remove'})[0],400)
        self.assertEqual(self.request('/api/libraries/'+'0'*32+'/cover',{'action':'remove','base_revision':None})[0],404)
        self.assertIsNone(self.cover()['url'])
    def test_two_windows_cannot_silently_replace_each_others_cover(self):
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            codes=list(pool.map(lambda _:self.set_cover()[0],range(2)))
        self.assertEqual(sorted(codes),[200,409])
        self.assertEqual(self.request(self.path,{'action':'remove','base_revision':None})[0],409)
        self.assertTrue(self.cover()['url'])

if __name__=='__main__':unittest.main()
