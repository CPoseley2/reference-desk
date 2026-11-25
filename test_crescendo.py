"""Exercise uploads, actual analysis, playback, and isolated review saves in a disposable app."""
import io
import json
import math
import os
import shutil
import struct
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import wave
from pathlib import Path
from library_server import create_app_server
from crescendo_store import CrescendoStore

SOURCE = Path(__file__).resolve().parent


class CrescendoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name) / 'app'
        shutil.copytree(SOURCE, cls.root, ignore=shutil.ignore_patterns('.git', 'docs', 'command-center', 'libraries', '.state', '.git', '__pycache__', '.venv*'))
        python = CrescendoStore(SOURCE, SOURCE / '.state', 'test').python()
        (cls.root / '.state').mkdir(exist_ok=True)
        (cls.root / '.state/crescendo-python').write_text(python)
        cls.server = create_app_server(cls.root, cls.root / '.state', 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.origin = cls.server.origin
        cls.first = cls.server.libraries.list()[0]['id']
        cls.second = cls.server.libraries.create({'name': 'Other', 'request_id': '11111111-1111-4111-8111-111111111111'})['id']
        cls.base = '/libraries/' + cls.first + '/'
        cls.token = cls.server.libraries.context(cls.first).store.token
        # A local synthetic recording verifies the pipeline, not musical accuracy.
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setparams((1, 2, 22050, 0, 'NONE', 'not compressed'))
            samples = [int(18000 * math.sin(i * 2 * math.pi * 220 / 22050) * math.exp(-(i % 11025) / 160)) for i in range(22050 * 4)]
            wav.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
        cls.audio = output.getvalue()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def request(self, path, data=None, headers=None):
        req = urllib.request.Request(self.origin + path, data=data, headers=headers or {})
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, response.headers, response.read()

    def post(self, path, value, token=None):
        return self.request(path, json.dumps(value).encode(), {'Content-Type': 'application/json', 'Origin': self.origin, 'X-DESK-CSRF': token or self.token})

    def test_pipeline_and_saved_review(self):
        headers = {'Origin': self.origin, 'X-DESK-CSRF': self.token, 'Content-Type': 'application/octet-stream'}
        status, _, data = self.request(self.base + 'api/crescendo?title=Click+test&filename=click.wav&fps=24&offset=2', self.audio, headers)
        self.assertEqual(status, 202, data)
        job = json.loads(data)
        store = CrescendoStore(self.root, self.server.libraries.context(self.first).store.dir, self.server.instance_id)
        deadline = time.time() + 180
        while time.time() < deadline:
            job = store.read(job['id'])
            if job['status'] not in ('queued', 'analyzing'):
                break
            time.sleep(.25)
        if job['status'] != 'ready':
            self.fail(str(job) + (store.directory(job['id']) / 'analysis.log').read_text())
        prefix = self.base + 'crescendo/' + job['id'] + '/'
        status, _, html = self.request(prefix + 'index.html')
        self.assertEqual(status, 200)
        self.assertIn(b'Save review', html)
        self.assertNotIn(b'__DATA__', html)
        self.assertIn(b'window.DESKAutosave', html)
        status, headers, part = self.request(prefix + 'audio-preview.wav', headers={'Range': 'bytes=0-31'})
        self.assertEqual(status, 206)
        self.assertEqual(len(part), 32)
        self.assertTrue(part.startswith(b'RIFF'))
        self.assertTrue(headers['Content-Range'].startswith('bytes 0-31/'))
        self.assertEqual(self.request(prefix + 'audio-preview.wav', headers={'Range': 'bytes=999999999-'})[0], 416)
        original = json.loads(self.request(prefix + 'beat-map.json')[2])
        self.assertEqual(original['source']['samples'], 4 * 22050)
        self.assertEqual(original['timing']['fps'], 24)
        self.assertEqual(original['timing']['film_offset_seconds'], 2)
        edited = json.loads(json.dumps(original))
        self.assertTrue(edited['beats'])
        edited['beats'][0]['status'] = 'confirmed'
        edited['revision'] = 1
        review_url = self.base + 'api/crescendo/' + job['id'] + '/review'
        payload = {'saved_revision': 0, 'map': edited}
        status, _, data = self.post(review_url, payload)
        self.assertEqual(status, 200, data)
        self.assertEqual(json.loads(data)['saved_revision'], 1)
        self.assertEqual(self.post(review_url, payload)[0], 409)
        self.assertEqual(json.loads(self.request(prefix + 'beat-map.json')[2]), original)
        self.assertIn(b'"saved_revision": 1', self.request(prefix + 'index.html')[2])
        payload['saved_revision'] = 1
        edited['beats'][0]['provenance'] = None
        self.assertEqual(self.post(review_url, payload)[0], 400)
        edited['beats'][0]['provenance'] = original['beats'][0]['provenance']
        edited['source']['sha256'] = 'wrong'
        self.assertEqual(self.post(review_url, payload)[0], 400)
        self.assertEqual(self.request('/libraries/' + self.second + '/crescendo/' + job['id'] + '/index.html')[0], 404)
        self.assertEqual(self.request(prefix + 'source.wav')[0], 404)
        self.assertEqual(self.request(self.base + '.state/crescendo/' + job['id'] + '/job.json')[0], 404)

    def test_favorites_persist_and_share_without_changing_analysis(self):
        import concurrent.futures
        import importlib.util
        from unittest.mock import patch
        from crescendo_store import moment_id
        store = CrescendoStore(self.root, self.server.libraries.context(self.first).store.dir, self.server.instance_id)
        jid = 'b' * 32
        directory = store.directory(jid)
        (directory / 'result').mkdir(parents=True)
        original = {'schema_version': 1, 'source': {'sha256': 'c' * 64, 'duration_seconds': 60},
                    'timing': {'fps': 25, 'film_offset_seconds': 2}, 'beats': [],
                    'dynamics': {'swells': [{'kind': 'swell', 'seconds': 12.5, 'start_seconds': 7.2, 'end_seconds': 12.5, 'status': 'unreviewed'}],
                                 'impacts': [{'kind': 'impact', 'seconds': 20.3, 'status': 'unreviewed'}],
                                 'breaks': [{'kind': 'break', 'seconds': 40.1, 'end_seconds': 44.9, 'status': 'unreviewed'}]}}
        (directory / 'job.json').write_text(json.dumps({'id': jid, 'status': 'ready', 'created_at': 0}))
        source = directory / 'result/beat-map.json'
        source.write_text(json.dumps(original))
        before = source.read_bytes()
        route = self.base + 'api/crescendo/' + jid + '/favorites'
        self.assertEqual(json.loads(self.request(route)[2])['moments'], [])
        cues = [original['dynamics'][key][0] for key in ('swells','impacts','breaks')]
        payloads = [{'cue_id': moment_id(c), 'source_sha256': original['source']['sha256'], 'favorite': True, 'seconds': 999} for c in cues]
        other_token = self.server.libraries.context(self.second).store.token
        self.assertEqual(self.post(route, payloads[0], other_token)[0], 403)
        self.assertEqual(self.request(route, json.dumps(payloads[0]).encode(), {'Content-Type':'application/json','Origin':'https://example.org','X-DESK-CSRF':self.token})[0], 403)
        self.assertEqual(self.post(route, {**payloads[0], 'source_sha256': 'wrong'})[0], 400)
        self.assertEqual(self.post(route, {**payloads[0], 'cue_id': 'invented'})[0], 400)
        self.assertEqual(self.post(route, {**payloads[0], 'favorite': 'yes'})[0], 400)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            results = list(executor.map(lambda payload:self.post(route,payload), payloads))
        self.assertTrue(all(result[0] == 200 for result in results), results)
        saved = json.loads(self.request(route)[2])
        self.assertEqual(saved['revision'], 3)
        self.assertEqual([c['seconds'] for c in saved['moments']], [12.5,20.3,40.1])
        self.assertTrue(all(c['status'] == 'unreviewed' for c in saved['moments']))
        self.assertEqual(self.post(route, payloads[0])[0], 200)
        self.assertEqual(json.loads(self.request(route)[2])['revision'], 3)
        restarted = CrescendoStore(self.root, self.server.libraries.context(self.first).store.dir, 'new-instance')
        self.assertEqual(restarted.favorites(jid), saved)
        foreign = '/libraries/' + self.second + '/api/crescendo/' + jid + '/favorites'
        self.assertEqual(self.request(foreign)[0], 404)
        self.assertEqual(self.post(foreign, payloads[0], other_token)[0], 404)
        # The storyboard bridge consumes exactly the same saved moments, with source binding.
        bridge_path = SOURCE / 'command-center/crescendo_bridge.py'
        spec = importlib.util.spec_from_file_location('favorite_bridge_test', bridge_path)
        bridge = importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
        brief_root = Path(self.tmp.name) / 'storyboard-favorites';brief_root.mkdir()
        record = {'id':'a1-01','entry_id':'1'*16,'library_id':self.first,'job_id':jid,
                  'analysis_sha256':'c'*64,'source_path':'test.wav','original_sha256':'c'*64,
                  'selection_basis':'Test recording','timing_basis':'Test timing'}
        (brief_root / 'crescendo-analysis.json').write_text(json.dumps({'records':[record]}))
        with patch.object(bridge, 'APP', self.root):
            self.assertEqual(bridge.index(brief_root)['records'][0]['favorite_moments'], saved['moments'])
            self.assertEqual(bridge.current_map(brief_root,'a1-01')['storyboard_integration']['favorite_moments'],saved['moments'])
            self.assertEqual(self.post(route, {**payloads[0], 'favorite':False})[0], 200)
            self.assertEqual(len(bridge.index(brief_root)['records'][0]['favorite_moments']),2)
        self.assertEqual(source.read_bytes(), before)
        self.assertFalse((directory/'review.json').exists())

    def test_tokens_validation_and_empty_library(self):
        other = self.server.libraries.context(self.second).store.token
        path = self.base + 'api/crescendo?title=test&filename=test.wav'
        self.assertEqual(self.request(path, self.audio, {'Origin': self.origin, 'X-DESK-CSRF': other})[0], 403)
        self.assertEqual(self.request(path, self.audio, {'Origin': 'https://example.org', 'X-DESK-CSRF': self.token})[0], 403)
        bad = self.base + 'api/crescendo?title=test&filename=test.exe'
        self.assertEqual(self.request(bad, b'bad', {'Origin': self.origin, 'X-DESK-CSRF': self.token})[0], 400)
        for value in ('nan', '-3', '999'):
            self.assertEqual(self.request(path + '&fps=' + value, b'bad', {'Origin': self.origin, 'X-DESK-CSRF': self.token})[0], 400)
        second_jobs = json.loads(self.request('/libraries/' + self.second + '/api/crescendo')[2])
        self.assertEqual(second_jobs['jobs'], [])
        self.assertEqual(self.request(self.base + 'crescendo.html')[0], 200)

    def test_interrupted_jobs_survive_restart(self):
        state = Path(self.tmp.name) / 'interrupted'
        store = CrescendoStore(self.root, state, 'new-instance')
        path = store.directory('a' * 32)
        path.mkdir(parents=True)
        (path / 'job.json').write_text(json.dumps({'id': 'a' * 32, 'instance': 'old-instance', 'status': 'analyzing', 'created_at': 0}))
        self.assertEqual(store.listing()['jobs'][0]['status'], 'interrupted')
        with self.assertRaises(ValueError):
            store.directory('../other')


if __name__ == '__main__':
    unittest.main()
