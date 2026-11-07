"""Read-only source and writable imported-library integration tests; no paid API calls."""
import base64
import copy
import hashlib
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
from import_linked_library import prepare, normalize_choices
from library_store import empty_manifest, write_seed
from library_server import create_app_server
from local_review_server import Store
from manage_project import add_character
from reference_catalog import mutate
from linked_media import resolve_read, reference_info

CODE=Path(__file__).resolve().parent

def snapshot(root):
    return {str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}

class LinkedLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='desk-linked-test-')
        base=Path(self.temp.name);self.app=base/'app';self.source=base/'original'
        self.app.mkdir();self.source.mkdir()
        for p in CODE.iterdir():
            if p.is_file() and p.suffix in ('.py','.html','.js','.css','.json'):shutil.copy2(p,self.app/p.name)
        shutil.copytree(CODE/'library-templates',self.app/'library-templates')
        shutil.copytree(CODE/'ui-assets',self.app/'ui-assets')
        m=empty_manifest('Original OWL');add_character(m,'Original Person');write_seed(self.source,m)
        store=Store(self.source,self.source/'.state')
        self.raw=(CODE/'ui-assets/canvas-v1.png').read_bytes()
        response=mutate(store,'/api/references',{'character_id':'original-person','type':'Portrait / likeness','tags':['Original'],
            'upload':{'name':'portrait.png','data':base64.b64encode(self.raw).decode()}})
        self.asset=response['assets'][0]
        for name in ('exploration-actions.js','location-story-structure.js'):
            (self.source/name).write_text('window.OWL_DATA = '+json.dumps({'schema':'owl.actions','version':1,'actions':[],'episodes':[]})+';')
        m=json.loads((self.source/'manifest.json').read_text())
        if self._testMethodName == 'test_converted_source_hashes':
            m['assets'][0]['sha256']='a'*64
            m['assets'][0]['asset_encoding']='Lossless PNG conversion from TIFF; source SHA-256 retained'
            self.asset=m['assets'][0]
        m['characters'][0]['scope']='Season 1 roster'
        m['review_defaults']['schema']='owl.character-choices';m['review_defaults']['collection']='one-warm-line-s1';write_seed(self.source,m)
        saved=json.loads(store.file.read_text());saved['schema']='owl.local-review-state';saved['choices']['schema']='owl.character-choices';saved['choices']['collection']='one-warm-line-s1'
        saved['choices']['collection_reviews']={'one-warm-line-s1':{'review':{'notes':'Original global review'}}}
        saved['payload_hash']=store.digest(saved['choices']);store.file.write_text(json.dumps(saved))
        (self.source/'assets/unlisted.png').write_bytes(b'not part of imported catalog')
        self.before=snapshot(self.source)
        self.server=create_app_server(self.app,self.app/'.state',0);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        receipt=prepare(self.app,self.source,store.file,progress=lambda _:None);self.lid=receipt['id']
        self.request('/api/libraries/import',{'import_id':self.lid},status=201)
        self.root=self.app/'libraries'/self.lid
        self.context=self.server.libraries.context(self.lid)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def request(self,path,payload=None,status=200,token=None):
        headers={}
        if payload is not None:
            headers={'Origin':self.server.origin,'Content-Type':'application/json','X-DESK-CSRF':token or (self.context.store.token if path.startswith('/libraries/') else self.server.app_token)}
        req=urllib.request.Request(self.server.origin+path,data=json.dumps(payload).encode() if payload is not None else None,headers=headers)
        try:
            with urllib.request.urlopen(req) as response:code,raw=response.status,response.read()
        except urllib.error.HTTPError as error:code,raw=error.code,error.read()
        self.assertEqual(code,status,raw[:1000]);return raw

    def api(self,path,payload=None,status=200):return json.loads(self.request('/libraries/'+self.lid+'/api/'+path,payload,status))
    def image(self,path,status=200):return self.request('/libraries/'+self.lid+'/'+path,status=status)
    def unchanged(self):self.assertEqual(snapshot(self.source),self.before)

    def test_import_preserves_choices_without_copying_images_or_links(self):
        old=json.loads(self.before['.state/review-state.json'])
        new=self.context.store.read()
        self.assertEqual(new['choices'],normalize_choices(old['choices'],self.lid))
        self.assertEqual(new['revision'],old['revision'])
        manifest=json.loads((self.root/'manifest.json').read_text())
        self.assertEqual(manifest['characters'][0]['scope'],'Project roster')
        self.assertEqual(manifest['characters'][0]['imported_scope'],'Season 1 roster')
        self.assertEqual(list((self.root/'assets').iterdir()),[])
        self.assertEqual(list((self.root/'thumbs').iterdir()),[])
        self.assertFalse(any(p.is_symlink() for p in self.root.rglob('*')))
        self.assertEqual(self.image(self.asset['asset']),self.raw)
        self.assertEqual(self.image(self.asset['thumbnail']),self.before[self.asset['thumbnail']])
        self.unchanged()

    def test_unlisted_paths_traversal_and_private_config_are_blocked(self):
        for relative in ['assets/unlisted.png','.state/linked-media.json','%2e%2e/%2e%2e/original/manifest.json','assets/%2e%2e/.state/linked-media.json']:
            status=403 if '%2e%2e' in relative else 404
            self.image(relative,status=status)
        other=self.server.libraries.catalog['default_library_id']
        self.request('/libraries/'+other+'/'+self.asset['asset'],status=404)
        self.request('/api/libraries/import',{'import_id':self.lid},status=403,token='invalid')
        self.unchanged()

    def test_edits_uploads_and_review_only_change_the_import(self):
        self.api('reference-tags',{'id':self.asset['id'],'expected_tags':['Original'],'tags':['Imported edit']})
        saved=self.api('review');choices=copy.deepcopy(saved['choices']);choices['collection_reviews']={'reference-desk':{'review':{'notes':'New library only'}}}
        self.api('review',{'choices':choices,'base_revision':saved['revision'],'mutation_id':str(uuid.uuid4())})
        upload=(CODE/'ui-assets/walnut-v1.png').read_bytes()
        out=self.api('references',{'character_id':'original-person','type':'Portrait / likeness','tags':[],
            'upload':{'name':'new.png','data':base64.b64encode(upload).decode()}})
        new=out['assets'][0];self.assertEqual((self.root/new['asset']).read_bytes(),upload)
        self.assertFalse((self.source/new['asset']).exists());self.assertEqual(self.image(self.asset['asset']),self.raw)
        self.unchanged()

    def test_source_changes_and_escape_symlinks_are_not_silently_served(self):
        path=self.source/self.asset['asset'];path.write_bytes(b'changed original fixture')
        self.image(self.asset['asset'],status=404)
        outside=self.source.parent/'outside.png';outside.write_bytes(self.raw);path.unlink();path.symlink_to(outside)
        self.image(self.asset['asset'],status=404)

    def test_local_replacement_is_independent_and_old_source_stays_unchanged(self):
        replacement=b'local replacement fixture';(self.root/self.asset['asset']).write_bytes(replacement)
        self.assertEqual(self.image(self.asset['asset']),replacement)
        self.assertFalse(reference_info(self.root,self.asset['asset'])['linked_read_only'])
        self.unchanged()

    def test_offline_source_leaves_catalog_and_new_files_available(self):
        moved=self.source.with_name('moved');self.source.rename(moved)
        self.image(self.asset['asset'],status=404)
        libraries=json.loads(self.request('/api/libraries'))['libraries']
        self.assertFalse(next(x for x in libraries if x['id']==self.lid)['linked_source_available'])
        (self.root/'assets/new.png').write_bytes(b'new local image')
        self.assertEqual(self.image('assets/new.png'),b'new local image')
        self.api('review')
        moved.rename(self.source);self.unchanged()

    def test_converted_source_hashes(self):
        import studio_generation, reference_generation
        a=json.loads((self.root/'manifest.json').read_text())['assets'][0]
        self.assertEqual(a['sha256'],'a'*64)
        self.assertEqual(a['file_sha256'],hashlib.sha256(self.raw).hexdigest())
        request={'request_id':str(uuid.uuid4()),'title':'Converted image test','prompt':'Use imported portrait',
                 'character_id':'original-person','aspect':'1:1 square','quality':'medium','reference_type':'Portrait / likeness',
                 'input_references':[{'id':a['id'],'sha256':a['sha256'],'role':'identity'}],'tags':[]}
        for validate in [studio_generation.validate,reference_generation.validate]:
            _,normalized,inputs=validate(self.context.generation,request)
            self.assertEqual(inputs[0][2],self.raw)
            self.assertEqual(normalized['input_references'][0]['sha256'],'a'*64)
            self.assertEqual(normalized['input_references'][0]['file_sha256'],a['file_sha256'])
        self.unchanged()

    def test_generation_reads_linked_input_and_writes_output_locally(self):
        import studio_generation
        from image_generation import sha
        output=(CODE/'ui-assets/walnut-v1.png').read_bytes();seen=[]
        def transport(request,inputs,key):
            seen.extend(inputs)
            return output,{'model':'local-test'}
        self.context.generation.transport=transport
        with patch('image_generation.api_key',return_value='test-placeholder'):
            job=self.api('generation/jobs',{'request_id':str(uuid.uuid4()),'job_kind':'studio','prompt':'Local isolation test',
                'title':'New image','aspect':'1:1 square','quality':'medium','reference_type':'Scene reference',
                'input_references':[{'id':self.asset['id'],'sha256':self.asset['sha256'],'role':'identity'}],'tags':[]},status=202)
            until=time.monotonic()+10
            while time.monotonic()<until:
                done=self.context.generation.read(job['id'])
                if done['status'] not in ('queued','generating','saving'):break
                time.sleep(.05)
            self.assertEqual(done['status'],'completed',done.get('message'))
        self.assertEqual(seen[0][1],self.raw)
        manifest=json.loads((self.root/'manifest.json').read_text());new=next(a for a in manifest['assets'] if a['sha256']==sha(output))
        self.assertTrue((self.root/new['asset']).is_file());self.assertFalse((self.source/new['asset']).exists())
        self.unchanged()

if __name__=='__main__':unittest.main()
