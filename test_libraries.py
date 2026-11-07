"""Isolation, migration, concurrency, and background-job checks; no external API calls."""
import base64
import concurrent.futures
import copy
import json
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from unittest.mock import patch

from library_server import create_app_server
from library_store import LibraryRegistry, empty_manifest, write_seed
from local_review_server import Store
from manage_project import add_character

SOURCE = Path(__file__).resolve().parent

class LibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desk-libraries-test-')
        self.root = Path(self.temp.name).resolve()/'app'
        shutil.copytree(SOURCE, self.root, ignore=shutil.ignore_patterns('.git', 'docs', '.state','libraries','__pycache__','assets','thumbs','sources','prompts','catalog-history','generation-records'))
        m = empty_manifest('Existing Project')
        add_character(m, 'Existing Character')
        write_seed(self.root, m)
        store = Store(self.root, self.root/'.state')
        self.original_state = store.file.read_bytes()
        (self.root/'assets').mkdir(exist_ok=True)
        (self.root/'assets/legacy.txt').write_text('preserved file')
        self.server = create_app_server(self.root, self.root/'.state', 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.first = self.server.libraries.catalog['default_library_id']

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self, path, payload=None, token=None):
        headers={}
        if payload is not None:
            headers={'Origin':self.server.origin,'Content-Type':'application/json','X-DESK-CSRF':token or self.server.app_token}
        req=urllib.request.Request(self.server.origin+path,data=None if payload is None else json.dumps(payload).encode(),headers=headers)
        try:
            with urllib.request.urlopen(req) as response:return response.status,response.read()
        except urllib.error.HTTPError as error:return error.code,error.read()

    def json_request(self,path,payload=None,token=None,status=200):
        code,raw=self.request(path,payload,token);self.assertEqual(code,status,raw.decode());return json.loads(raw)

    def new(self,name='New Project'):
        return self.json_request('/api/libraries',{'name':name,'request_id':str(uuid.uuid4())},status=201)['library']['id']

    def api(self,lid,path,payload=None,status=200,token=None):
        return self.json_request('/libraries/'+lid+'/api/'+path,payload,token or self.server.libraries.context(lid).store.token,status)

    def manifest(self,lid):return json.loads((self.root/'libraries'/lid/'manifest.json').read_text())

    def test_migration_preserves_current_library_and_private_backup(self):
        self.assertEqual(self.manifest(self.first)['characters'][0]['name'],'Existing Character')
        self.assertEqual((self.root/'libraries'/self.first/'.state/review-state.json').read_bytes(),self.original_state)
        self.assertEqual((self.root/'libraries'/self.first/'assets/legacy.txt').read_text(),'preserved file')
        self.assertFalse((self.root/'manifest.json').exists())
        self.assertEqual((self.root/'.state/legacy-library-backup/.state/review-state.json').read_bytes(),self.original_state)
        self.assertEqual(self.request('/manifest.json')[0],404)
        self.assertEqual(self.request('/.state/legacy-library-backup/manifest.json')[0],404)

    def test_new_library_is_empty_separate_and_creation_is_idempotent(self):
        payload={'name':'Second Library','request_id':str(uuid.uuid4())}
        a=self.json_request('/api/libraries',payload,status=201)['library']
        b=self.json_request('/api/libraries',payload,status=201)['library']
        self.assertEqual(a['id'],b['id'])
        m=self.manifest(a['id'])
        for key in ['characters','assets','locations','groups','sources','relationships']:self.assertEqual(m[key],[])
        self.assertEqual(self.api(a['id'],'review')['choices']['library_id'],a['id'])
        self.assertEqual(self.request('/api/libraries',{**payload,'request_id':str(uuid.uuid4())})[0],400)
        self.assertEqual(len(self.server.libraries.list()),2)

    def test_registry_reopen_keeps_existing_ids_and_content(self):
        second=self.new()
        before=(self.root/'libraries'/self.first/'manifest.json').read_bytes()
        reopened=LibraryRegistry(self.root,self.root/'.state')
        self.assertEqual(reopened.catalog['default_library_id'],self.first)
        self.assertEqual({r['id'] for r in reopened.list()},{self.first,second})
        self.assertEqual((self.root/'libraries'/self.first/'manifest.json').read_bytes(),before)

    def test_clean_install_creates_an_empty_first_library(self):
        fresh=self.root.parent/'fresh'
        fresh.mkdir();shutil.copytree(self.root/'library-templates',fresh/'library-templates')
        registry=LibraryRegistry(fresh,fresh/'.state');lid=registry.catalog['default_library_id']
        m=json.loads((fresh/'libraries'/lid/'manifest.json').read_text())
        self.assertEqual(m['characters'],[])
        self.assertEqual(m['review_defaults']['library_id'],lid)
        self.assertFalse((fresh/'.state/legacy-library-backup').exists())

    def test_concurrent_tabs_write_to_their_own_manifests(self):
        second=self.new()
        def add(lid):return self.api(lid,'characters',{'name':'Shared Name','group':'Cast','request_id':str(uuid.uuid4())})
        with concurrent.futures.ThreadPoolExecutor(2) as pool:results=list(pool.map(add,[self.first,second]))
        self.assertEqual(results[0]['characters'][0]['id'],results[1]['characters'][0]['id'])
        self.assertEqual(len(self.manifest(self.first)['characters']),2)
        self.assertEqual(len(self.manifest(second)['characters']),1)
        image=base64.b64encode((self.root/'ui-assets/canvas-v1.png').read_bytes()).decode()
        result=self.api(self.first,'references',{'character_id':'shared-name','type':'Portrait / likeness','tags':[],
                    'upload':{'name':'test.png','data':image}})
        asset=result['assets'][0]['asset']
        self.assertEqual(self.request('/libraries/'+self.first+'/'+asset)[0],200)
        self.assertEqual(self.request('/libraries/'+second+'/'+asset)[0],404)
        self.assertEqual(self.manifest(second)['assets'],[])
        payload={'name':'Wrong token','request_id':str(uuid.uuid4())}
        self.api(second,'characters',payload,status=403,token=self.server.libraries.context(self.first).store.token)

    def test_review_history_and_exports_remain_separate(self):
        second=self.new();before=self.api(second,'review');a=self.api(self.first,'review')
        choices=copy.deepcopy(a['choices']);choices['library_id']=self.first
        choices['collection_reviews']={'reference-desk':{'review':{'notes':'Only in first library'},'review_updated_at':'2026-11-05T20:00:00Z'}}
        self.api(self.first,'review',{'choices':choices,'base_revision':a['revision'],'mutation_id':str(uuid.uuid4())})
        self.assertEqual(self.api(second,'review'),before)
        self.assertEqual(self.api(second,'history')['revisions'],[])
        self.assertTrue(self.api(self.first,'history')['revisions'])
        self.api(second,'review',{'choices':choices,'base_revision':before['revision'],'mutation_id':str(uuid.uuid4())},status=400)
        self.assertEqual(self.api(second,'director-references')['characters'],[])

    def test_routes_do_not_expose_sibling_or_private_files(self):
        second=self.new()
        for path in ['/api/review','/libraries/unknown/manifest.json',
                     '/libraries/'+self.first+'/.state/review-state.json',
                     '/libraries/'+self.first+'/%2e%2e/'+second+'/manifest.json']:
            self.assertIn(self.request(path)[0],(403,404),path)
        self.assertEqual(self.request('/')[0],200)
        self.assertEqual(self.request('/libraries/'+self.first+'/')[0],200)
        self.assertIn(self.first.encode(),self.request('/libraries/'+self.first+'/library-context.js')[1])
        self.assertEqual(self.request('/api/libraries',{'name':'No token','request_id':str(uuid.uuid4())},token='wrong')[0],403)

    def test_running_job_keeps_its_library_when_another_is_opened(self):
        started=threading.Event();release=threading.Event();manager=self.server.libraries.context(self.first).generation
        def fake_transport(request,inputs,key):
            started.set()
            if not release.wait(10):raise RuntimeError('Test timed out')
            return (self.root/'ui-assets/canvas-v1.png').read_bytes(),{'model':'local-test'}
        manager.transport=fake_transport
        with patch('image_generation.api_key',return_value='local-test-placeholder'):
            try:
                result=self.api(self.first,'generation/jobs',{'request_id':str(uuid.uuid4()),'job_kind':'studio',
                    'prompt':'Test image','title':'Test image','aspect':'1:1 square','quality':'medium',
                    'reference_type':'Scene reference','input_references':[],'tags':[]},status=202)
                self.assertTrue(started.wait(3));second=self.new('Opened while generating');self.api(second,'review');release.set()
                deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    job=manager.read(result['id'])
                    if job['status'] not in ('queued','generating','saving'):break
                    time.sleep(.05)
                self.assertEqual(job['status'],'completed',job.get('message'))
                self.assertEqual(len(self.manifest(self.first)['assets']),1)
                self.assertEqual(self.manifest(second)['assets'],[])
                self.assertEqual(self.api(second,'generation/config')['active_jobs'],[])
                self.assertEqual(self.request('/libraries/'+second+'/api/generation/jobs/'+result['id'])[0],400)
            finally:release.set()

if __name__=='__main__':unittest.main()
