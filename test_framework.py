"""Offline integration checks. Runs only against a disposable framework copy."""
import base64
import copy
import json
import os
import re
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import local_review_server
from manage_project import add_character, write_catalog
from library_store import empty_manifest

ROOT = Path(__file__).resolve().parent

class FrameworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reference-desk-test-')
        self.root = Path(self.temp.name)/'desk'
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns('.git', 'docs', '.state', '__pycache__', 'libraries', 'assets', 'thumbs', 'sources', 'prompts', 'catalog-history', 'generation-records'))
        write_catalog(self.root, empty_manifest())
        for name in ('exploration-actions.js','location-story-structure.js','requested-revisions.html'):
            shutil.copy2(ROOT/'library-templates'/name,self.root/name)
        self.server = local_review_server.create_server(self.root, self.root/'.state', 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, payload=None, authorized=True):
        headers={}
        if payload is not None:
            headers={'Content-Type':'application/json', 'Origin':self.server.origin}
            if authorized:
                headers['X-DESK-CSRF']=self.server.store.token
        request=urllib.request.Request(self.server.origin+path,
                    data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
        try:
            with urllib.request.urlopen(request) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    def post(self, path, payload):
        status, raw=self.request(path,payload)
        self.assertEqual(status,200,raw.decode())
        return json.loads(raw)

    def test_clean_start_and_static_dependencies(self):
        m=json.loads((self.root/'manifest.json').read_text())
        for key in ['characters','assets','locations','groups','sources','relationships','metadata_sources']:
            self.assertEqual(m[key],[],key)
        self.assertEqual(self.server.store.read()['choices']['items'],[])
        html=(self.root/'index.html').read_text()
        urls=re.findall(r'(?:src|href)="([^"#]+)"',html)
        for f in self.root.glob('*.css'):
            urls+=re.findall(r'url\([\"\x27]?([^\)\"\x27]+)',f.read_text())
        for url in urls:
            if not url.startswith(('http:','https:','data:','#','%23')):
                self.assertEqual(self.request('/'+url)[0],200,url)
        status, raw=self.request('/api/generation/config')
        self.assertEqual(status,200)
        self.assertEqual(json.loads(raw)['active_jobs'],[])

    def test_character_look_emotion_and_image_upload(self):
        m=json.loads((self.root/'manifest.json').read_text())
        c=add_character(m,'Test Character',age=28)
        write_catalog(self.root,m)
        result=self.post('/api/looks',{'character_id':c['id'],'name':'Test Outfit',
                          'garments':'Neutral jacket','request_id':str(uuid.uuid4())})
        self.assertTrue(result['look_id'])
        self.post('/api/emotions',{'character_id':c['id'],'name':'Thoughtful'})
        image=base64.b64encode((self.root/'ui-assets/canvas-v1.png').read_bytes()).decode()
        result=self.post('/api/references',{'character_id':c['id'],'type':'Portrait / likeness',
                          'asset_ids':[],'tags':['test'],'upload':{'name':'test.png','data':image}})
        self.assertEqual(result['new_images'],1)
        asset=result['assets'][0]
        self.assertEqual(asset['status'],'Candidate')
        self.assertEqual(self.request('/'+asset['asset'])[0],200)
        m=json.loads((self.root/'manifest.json').read_text())
        self.assertIn(asset['id'],m['characters'][0]['candidate_ids'])
        self.assertEqual(m,json.loads((self.root/'data.js').read_text().split('=',1)[1].strip().rstrip(';')))

    def test_create_character_api_and_retry(self):
        before=self.server.store.read()
        payload={'name':' New Character ','group':'New Cast','description':'A new role.',
                 'age':28,'request_id':str(uuid.uuid4())}
        result=self.post('/api/characters',payload)
        character=result['characters'][0]
        self.assertEqual(character['name'],'New Character')
        self.assertEqual(result['audit']['season1_entries'],1)
        self.assertEqual(character['candidate_ids'],[])
        self.assertEqual(self.post('/api/characters',payload)['characters'][0]['id'],character['id'])
        self.assertEqual(self.request('/api/characters',{**payload,'name':'Changed'})[0],409)
        self.assertEqual(self.request('/api/characters',{**payload,'request_id':str(uuid.uuid4())})[0],400)
        self.post('/api/characters',{**payload,'request_id':str(uuid.uuid4()),'name':'Second Character','group':'new cast','age':None})
        m=json.loads((self.root/'manifest.json').read_text())
        self.assertEqual(len(m['characters']),2)
        self.assertEqual(len(m['groups']),1)
        self.assertEqual(self.server.store.read(),before)
        self.assertEqual(m,json.loads((self.root/'data.js').read_text().split('=',1)[1].strip().rstrip(';')))

    def test_create_character_rejects_invalid_fields(self):
        base={'name':'Test','group':'Cast','description':'','age':None,'request_id':str(uuid.uuid4())}
        original=(self.root/'manifest.json').read_bytes()
        for invalid in [{'name':'  '},{'group':''},{'name':5},{'name':'x'*141},
                        {'description':[]},{'age':-1},{'age':1.5},{'age':True}]:
            self.assertEqual(self.request('/api/characters',{**base,**invalid})[0],400)
            self.assertEqual((self.root/'manifest.json').read_bytes(),original)
        self.assertEqual(self.request('/api/characters',base,authorized=False)[0],403)

    def test_location_and_selection_do_not_approve(self):
        result=self.post('/api/locations',{'name':'Test Studio','description':'Test only','tags':[]})
        lid=result['locations'][0]['id']
        image=base64.b64encode((self.root/'ui-assets/canvas-v1.png').read_bytes()).decode()
        result=self.post('/api/location-references',{'location_id':lid,'slot_id':'exterior-front',
                          'asset_ids':[],'tags':[],'upload':{'name':'test.png','data':image}})
        asset=result['assets'][0]
        result=self.post('/api/location-selection',{'location_id':lid,'slot_id':'exterior-front',
                          'asset_id':asset['id'],'source_sha256':asset['sha256'],'expected_selected_id':None})
        self.assertFalse(result['locations'][0].get('approvals'))
        result=self.post('/api/location-approval',{'location_id':lid,'slot_id':'exterior-front',
                          'asset_id':asset['id'],'source_sha256':asset['sha256'],
                          'approved':True,'expected_approval':None})
        self.assertTrue(result['locations'][0]['approvals'][asset['id']]['approved'])

    def test_save_conflict_history_and_restore(self):
        initial=self.server.store.read()
        choices=copy.deepcopy(initial['choices'])
        choices['collection_reviews']={'reference-desk':{'review':{'notes':'Test decision'},
                                    'review_updated_at':'2026-11-05T12:00:00Z'}}
        result=self.post('/api/review',{'base_revision':initial['revision'],
                           'mutation_id':str(uuid.uuid4()),'choices':choices})
        self.assertEqual(result['revision'],initial['revision']+1)
        self.assertEqual(self.request('/api/review',{'base_revision':initial['revision'],
                           'mutation_id':str(uuid.uuid4()),'choices':initial['choices']})[0],409)
        restored=self.post('/api/restore',{'base_revision':result['revision'],
                           'mutation_id':str(uuid.uuid4()),'restore_revision':initial['revision']})
        self.assertEqual(restored['choices'],initial['choices'])

    def test_storage_and_csrf_isolation(self):
        self.assertEqual(self.request('/.state/review-state.json')[0],404)
        self.assertEqual(self.request('/api/locations',{'name':'Bad'},authorized=False)[0],403)
        self.assertTrue(self.server.store.dir.is_relative_to(self.root.resolve()))

if __name__=='__main__':
    unittest.main()
