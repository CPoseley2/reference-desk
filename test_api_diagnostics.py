"""Offline checks; no real credentials or paid image calls."""
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch, MagicMock
import api_diagnostics as diagnostics
from image_generation import MODEL, api_key, JobError

class DiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.key = 'sk-' + 'private-fixture-credential-123456'
        self.write_key(self.key)
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.addCleanup(self.temp.cleanup)
        diagnostics._cache.clear()

    def write_key(self, key):
        path = self.state/'image-api-key'
        path.write_text(key)
        path.chmod(0o600)

    def failure(self, status, code):
        return urllib.error.HTTPError('https://api.openai.com', status, 'error',
            {'x-request-id':'req_test'}, io.BytesIO(json.dumps({'error':{
                'code':code, 'message':'DO NOT EXPOSE '+self.key}}).encode()))

    def test_invalid_format_blocks_without_network(self):
        self.write_key('not-an-api-credential')
        with patch('urllib.request.urlopen') as network:
            result = diagnostics.status(self.state, MODEL, True)
        self.assertFalse(result['configured'])
        self.assertEqual(result['state'], 'needs_setup')
        network.assert_not_called()
        with self.assertRaises(JobError): api_key(self.state)

    def test_missing_private_file_and_environment_precedence(self):
        (self.state/'image-api-key').chmod(0o644)
        self.assertFalse(diagnostics.status(self.state, MODEL)['configured'])
        with patch.dict(os.environ, {'OPENAI_API_KEY':self.key}):
            result = diagnostics.status(self.state, MODEL)
            self.assertTrue(result['configured'])
            self.assertIn('environment', result['credential_source'])
        (self.state/'image-api-key').unlink()
        self.assertEqual(diagnostics.status(self.state, MODEL)['state'], 'needs_setup')

    def test_no_charge_check_and_key_change_invalidates_cache(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({'id':MODEL}).encode()
        with patch('urllib.request.urlopen', return_value=response) as network:
            result = diagnostics.status(self.state, MODEL, True)
            req = network.call_args.args[0]
            self.assertEqual(req.get_method(), 'GET')
            self.assertIsNone(req.data)
            self.assertIn('/v1/models/', req.full_url)
        self.assertEqual(result['state'], 'verified')
        self.assertNotIn(self.key, json.dumps(result))
        self.assertEqual(diagnostics.status(self.state, MODEL)['state'], 'verified')
        self.write_key('sk-' + 'another-private-fixture-credential')
        self.assertEqual(diagnostics.status(self.state, MODEL)['state'], 'unverified')

    def test_auth_denied_and_actionable_statuses(self):
        for status, code in ((401,'invalid_api_key'), (403,'forbidden'), (404,'model_not_found'), (429,'insufficient_quota'), (500,'server_error')):
            with self.subTest(status=status), patch('urllib.request.urlopen', side_effect=self.failure(status,code)):
                result = diagnostics.status(self.state, MODEL, True)
                self.assertEqual(result['configured'], status != 401)
                self.assertEqual(result['api_error']['http_status'], status)
                self.assertEqual(result['api_error']['request_id'], 'req_test')
                self.assertNotIn(self.key, json.dumps(result))
                self.assertNotIn('DO NOT EXPOSE', json.dumps(result))

    def test_network_failure_and_unexpected_payload(self):
        with patch('urllib.request.urlopen', side_effect=urllib.error.URLError('secret '+self.key)):
            result = diagnostics.status(self.state, MODEL, True)
        self.assertEqual(result['state'], 'unreachable')
        self.assertNotIn(self.key, json.dumps(result))
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{}'
        with patch('urllib.request.urlopen', return_value=response):
            self.assertEqual(diagnostics.status(self.state, MODEL, True)['state'], 'check_failed')

    def test_report_omits_request_and_reference_content(self):
        job = self.state/'jobs'/'a'/'job.json'
        job.parent.mkdir(parents=True)
        job.write_text(json.dumps({'id':'abc','status':'failed','message':'Safe message',
             'request':{'prompt':'private prompt'},'inputs':['private image']}))
        report = diagnostics.recent_job(self.state/'jobs')
        self.assertNotIn('private', json.dumps(report))

if __name__ == '__main__': unittest.main()
