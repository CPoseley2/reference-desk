"""Offline regression coverage for storyboard handoffs; no image API calls."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import location_editing
from image_generation import JobError


class RevisionContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.hash = 'a' * 64
        (root / 'manifest.json').write_text(json.dumps({
            'locations': [{'id': 'camp', 'name': 'Camp'}],
            'location_slots': [{'id': 'scene', 'label': 'Scene'}],
            'assets': [{'id': 'DESK-TEST', 'sha256': self.hash}],
        }))
        self.manager = SimpleNamespace(store=SimpleNamespace(root=root), dir=root / 'jobs')

    def request(self, shot):
        return {'job_kind': 'reference', 'location_id': 'camp', 'slot_id': 'scene',
                'session_id': '0' * 32, 'operation': 'refine', 'instruction': 'Adjust lighting.',
                'parent_asset': {'id': 'DESK-TEST', 'sha256': self.hash},
                'storyboard_context': {'storyboard_id': 'aaaaaaaaaaaaaaaa', 'shot_id': shot,
                    'slot_number': 45, 'song': 'Welcome Sight', 'title': 'Reed seated',
                    'prompt': 'Saved prompt', 'asset_id': 'DESK-TEST', 'sha256': self.hash,
                    'location_id': 'camp', 'slot_id': 'scene'}}

    def test_supported_shot_identifiers_reach_reference_validation(self):
        for shot in ('S001', 'WS045', 'CTS-V5-001', 'CWR072'):
            with self.subTest(shot=shot), patch('reference_generation.validate', side_effect=lambda m, r: ('test', r, [])) as validate:
                _, request, _ = location_editing.validate(self.manager, self.request(shot))
                validate.assert_called_once()
                self.assertEqual(request['storyboard_context']['shot_id'], shot)
                self.assertIn('Welcome Sight / ' + shot, request['prompt'])

    def test_rejects_invalid_identifiers(self):
        for shot in ('', '../x', '<script>', 'x' * 81):
            with self.subTest(shot=shot), self.assertRaises(JobError):
                location_editing.validate(self.manager, self.request(shot))

    def test_source_hash_and_slot_remain_enforced(self):
        for field, value in [('sha256', 'b' * 64), ('slot_number', True), ('slot_number', 0), ('slot_number', 10001)]:
            request = self.request('WS045')
            request['storyboard_context'][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(JobError):
                location_editing.validate(self.manager, request)


if __name__ == '__main__':
    unittest.main()
