import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import storyboard_module as module
from install_storyboard_bridge import install, EDITS


class StoryboardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / '.state').mkdir()

    def health(self, **overrides):
        return io.BytesIO(json.dumps({'service': 'owl-storyboard-library-v1', 'root': str(self.root), **overrides}).encode())

    def test_identity_and_root(self):
        with patch.object(module.urllib.request, 'urlopen', return_value=self.health()):
            self.assertTrue(module.status(self.root)['online'])
        with patch.object(module.urllib.request, 'urlopen', return_value=self.health(service='other')):
            self.assertIn('different service', module.status(self.root)['error'])
        (self.root / '.state/storyboard-module.json').write_text(json.dumps({'root': str(self.root / 'other')}))
        with patch.object(module.urllib.request, 'urlopen', return_value=self.health()):
            self.assertIn('different storyboard', module.status(self.root)['error'])

    def test_offline_without_config_does_not_launch(self):
        with patch.object(module.urllib.request, 'urlopen', side_effect=OSError()), patch.object(module.subprocess, 'Popen') as launch:
            self.assertFalse(module.connect(self.root)['online'])
            launch.assert_not_called()

    def test_configured_start_and_collision(self):
        (self.root / 'server.py').touch()
        (self.root / 'python').touch()
        (self.root / '.state/storyboard-module.json').write_text(json.dumps({'root': str(self.root), 'python': str(self.root / 'python')}))
        with patch.object(module, 'status', side_effect=[{'online': False, 'configured': True}, {'online': True}]), patch.object(module.time, 'sleep'), patch.object(module.subprocess, 'Popen') as launch:
            self.assertTrue(module.connect(self.root)['online'])
            self.assertEqual(launch.call_args.args[0], [str(self.root / 'python'), '-B', str((self.root / 'server.py').resolve())])
        with patch.object(module, 'status', return_value={'online': False, 'error': 'Port occupied'}), patch.object(module.subprocess, 'Popen') as launch:
            self.assertFalse(module.connect(self.root)['online'])
            launch.assert_not_called()

    def test_start_requires_same_origin_and_library_token(self):
        handler = SimpleNamespace(server=SimpleNamespace(origin='http://127.0.0.1:8876', app_root=self.root), store=SimpleNamespace(token='correct'), hostok=lambda: True, headers={}, reply=Mock())
        with patch.object(module, 'connect', return_value={'online': True}) as connect:
            module.post(handler, '/api/storyboard/connect')
            self.assertEqual(handler.reply.call_args.args[0], 403)
            connect.assert_not_called()
            handler.headers = {'Origin': handler.server.origin, 'X-DESK-CSRF': 'other-library'}
            module.post(handler, '/api/storyboard/connect')
            connect.assert_not_called()
            handler.headers['X-DESK-CSRF'] = 'correct'
            module.post(handler, '/api/storyboard/connect')
            self.assertEqual(handler.reply.call_args.args[0], 200)
            connect.assert_called_once_with(self.root)

    def test_installer_validates_before_writing_and_is_idempotent(self):
        for name, edits in EDITS.items():
            (self.root / name).write_text('\n'.join(old for old, new in edits if old))
        self.assertEqual(install(self.root), 6)
        self.assertEqual(install(self.root), 0)
        (self.root / 'viewer.js').write_text('unsupported version')
        snapshot = (self.root / 'index.html').read_bytes()
        with self.assertRaises(ValueError):
            install(self.root)
        self.assertEqual((self.root / 'index.html').read_bytes(), snapshot)


if __name__ == '__main__':
    unittest.main()
