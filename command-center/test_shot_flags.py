import json
import tempfile
import unittest
from pathlib import Path
import shot_flags

class ShotFlagsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.eid='a'*16
        self.catalog={'slots':[{'id':'S1'},{'id':'S2'}]}
    def save(self,sid,flagged=True,stamp=3.25,expected=None,eid=None):
        def atomic(path,data):path.write_text(json.dumps(data))
        return shot_flags.save(self.root,self.catalog,{'id':eid or self.eid,'shot_id':sid,'flagged':flagged,'timestamp':stamp,'expected':expected},atomic)
    def test_exact_timestamp_reload_unflag_and_isolation(self):
        first=self.save('S1');self.assertEqual(shot_flags.read(self.root,self.eid)['flags']['S1']['timestamp'],3.25)
        self.assertEqual(shot_flags.read(self.root,'b'*16)['flags'],{})
        self.assertEqual(self.save('S1',False,expected=first['flags']['S1'])['flags'],{})
    def test_independent_shots_merge_and_retries_are_idempotent(self):
        self.save('S1');second=self.save('S2')
        self.assertEqual(len(second['flags']),2)
        self.assertEqual(self.save('S2')['revision'],second['revision'])
    def test_same_shot_conflict_does_not_overwrite(self):
        first=self.save('S1')
        with self.assertRaises(shot_flags.FlagConflict):self.save('S1',False)
        self.assertEqual(shot_flags.read(self.root,self.eid),first)
    def test_invalid_shot_timestamp_and_path(self):
        for stamp in [-1,float('nan'),float('inf'),True,'3',86401]:
            with self.subTest(stamp=stamp),self.assertRaises(ValueError):self.save('S1',stamp=stamp)
        with self.assertRaises(ValueError):self.save('unknown')
        with self.assertRaises(ValueError):self.save('S1',eid='../nope')
        self.assertFalse((self.root/'feedback').exists())
    def test_untimed_shots_can_still_be_flagged(self):
        self.assertIsNone(self.save('S1',stamp=None)['flags']['S1']['timestamp'])

class FlagHTTPTests(unittest.TestCase):
    def test_authentication_and_durable_endpoint(self):
        import threading, urllib.request, urllib.error
        import server
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();(root/'image-libraries').mkdir()
            eid='b'*16
            (root/'image-libraries'/f'{eid}.json').write_text(json.dumps({'slots':[{'id':'S1'}]}))
            http=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
            origin=f'http://127.0.0.1:{http.server_port}'
            thread=threading.Thread(target=http.serve_forever,daemon=True)
            with patch.object(server,'ROOT',root),patch.object(server,'PORT',http.server_port):
                thread.start()
                def request(body=None,auth=True):
                    url=origin+'/library-api/shot-flags'+('?id='+eid if body is None else '')
                    headers={'Content-Type':'application/json','Origin':origin}
                    if auth:headers['X-OWL-CSRF']=server.TOKEN
                    req=urllib.request.Request(url,data=json.dumps(body).encode() if body else None,headers=headers)
                    try:
                        with urllib.request.urlopen(req) as result:return result.status,json.load(result)
                    except urllib.error.HTTPError as error:return error.code,json.load(error)
                try:
                    body={'id':eid,'shot_id':'S1','flagged':True,'timestamp':4.125,'expected':None}
                    self.assertEqual(request(body,False)[0],403)
                    self.assertEqual(request()[1]['flags'],{})
                    code,saved=request(body);self.assertEqual(code,200)
                    self.assertEqual(request()[1]['flags']['S1']['timestamp'],4.125)
                    self.assertEqual(request(dict(body,flagged=False))[0],409)
                    code,cleared=request(dict(body,flagged=False,expected=saved['flags']['S1']))
                    self.assertEqual(code,200);self.assertEqual(cleared['flags'],{})
                finally:http.shutdown();http.server_close();thread.join()

if __name__=='__main__':unittest.main()
