import json
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import youtube_status as y

CHANNEL = 'UC' + 'a' * 22
CONFIG = {'name': 'Example channel', 'url': 'https://www.youtube.com/@Example/videos', 'channel_id': CHANNEL, 'aliases': {}, 'collection_title': 'Example Musical'}


def video(title, number=1, **extra):
    return {'id': f'{number:011d}', 'title': title, **extra}


def listing(*entries):
    return {'channel_id': CHANNEL, 'entries': list(entries), 'playlist_count': len(entries)}


class MatchingTests(unittest.TestCase):
    def match(self, title, uploads, **extra):
        videos = y.parse_listing(listing(*uploads), CONFIG)
        return y.match_films([{'id': 'song', 'title': title, **extra}], videos, CONFIG)['song']

    def test_typography_and_demo_suffix(self):
        self.assertEqual(self.match('Keepin’ Time', [video('Keepin Time - Example Musical (Demo)')])['state'], 'published')
        self.assertEqual(self.match('Go! Now!', [video('Go Now — Demo')])['state'], 'published')

    def test_subtitles_and_substrings_are_not_song_matches(self):
        self.assertEqual(self.match('Example Musical', [video('New Horizons | Example Musical — Demo')])['state'], 'not_found')
        self.assertEqual(self.match('Carry It', [video('Don’t Carry It — Demo')])['state'], 'not_found')
        self.assertEqual(self.match('Example Musical', [video('Example Musical | New Horizons')])['state'], 'not_found')
        self.assertEqual(self.match('Example Musical', [video('Example Musical — Demo')])['state'], 'published')

    def test_reprise_and_return_are_distinct(self):
        self.assertEqual(self.match('Lantern Line (Reprise)', [video('Lantern Line — Demo')], catalog_song='Lantern Line')['state'], 'not_found')
        self.assertEqual(self.match('Lantern Line', [video('Lantern Line — Reprise')])['state'], 'not_found')
        self.assertEqual(self.match('Lantern Line (Reprise)', [video('Lantern Line — Reprise')])['state'], 'published')
        self.assertEqual(self.match('Opening Number', [video('Opening Number | Act V return')])['state'], 'not_found')
        self.assertEqual(self.match('Opening Number (Act V return)', [video('Opening Number | Act V return')])['state'], 'published')

    def test_aliases_preserve_listing_order_and_deduplicate(self):
        config = {**CONFIG, 'aliases': {'song': ['Alternate title']}}
        videos = y.parse_listing(listing(video('Alternate title — Demo', 2), video('Original title | Music Video', 1)), CONFIG)
        result = y.match_films([{'id': 'song', 'title': 'Original title', 'catalog_song': 'Original title'}], videos, config)['song']
        self.assertEqual([v['id'] for v in result['matches']], ['00000000002', '00000000001'])

    def test_trailers_not_full_song_matches(self):
        self.assertEqual(self.match('New Horizons', [video('New Horizons — Trailer')])['state'], 'not_found')

    def test_scheduled_private_and_live_are_excluded(self):
        items = [video('Song', 1, live_status='is_upcoming'), video('Song', 2, availability='private'), video('Song', 3, live_status='is_live'), video('Song', 4, release_timestamp=time.time()+3600), video('Song', 5, availability='public')]
        self.assertEqual([v['id'] for v in y.parse_listing(listing(*items), CONFIG)], ['00000000005'])

    def test_wrong_channel_incomplete_and_malformed_fail(self):
        cases = [listing(), {**listing(video('Song')), 'channel_id': 'UC'+'b'*22}, {**listing(video('Song')), 'playlist_count': 2}, listing(None), listing(video('Song', channel_id='UC'+'b'*22)), listing(video('Song', id='invalid'))]
        for data in cases:
            with self.subTest(data=data), self.assertRaises(y.CheckError):
                y.parse_listing(data, CONFIG)

    def test_scan_limit_never_implies_unpublished(self):
        with self.assertRaises(y.CheckError):
            y.parse_listing(listing(*[video('Song', n) for n in range(y.MAX_VIDEOS+1)]), CONFIG)


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root/'youtube-channel.json').write_text(json.dumps(CONFIG))
        (self.root/'command-center.json').write_text(json.dumps({'acts': [{'films': [{'id': 'song', 'title': 'Song'}, {'id': 'missing', 'title': 'Missing'}]}]}))
        self.videos = y.parse_listing(listing(video('Song — Demo')), CONFIG)

    def test_success_cached_failure_keeps_last_success_but_no_orange(self):
        monitor = y.Monitor(self.root, lambda *_: self.videos)
        monitor._run()
        self.assertEqual(monitor.status()['films']['song']['state'], 'published')
        self.assertEqual(monitor.status()['films']['missing']['state'], 'not_found')
        original = monitor.cache_path.read_bytes()
        def failed(*_): raise y.CheckError('Offline')
        monitor.fetcher = failed
        monitor._run()
        status = monitor.status()
        self.assertEqual(status['films']['song']['state'], 'unavailable')
        self.assertEqual(status['films']['song']['previous_state'], 'published')
        self.assertEqual(status['films']['missing']['state'], 'unavailable')
        self.assertEqual(monitor.cache_path.read_bytes(), original)

    def test_refresh_coalesces_and_has_explicit_force(self):
        started, release = threading.Event(), threading.Event()
        def fetch(*_):
            started.set(); release.wait(3); return self.videos
        monitor = y.Monitor(self.root, fetch)
        self.assertTrue(monitor.refresh())
        self.assertTrue(started.wait(1))
        self.assertEqual(monitor.status()['films']['song']['state'], 'checking')
        self.assertFalse(monitor.refresh(force=True))
        release.set()
        for _ in range(100):
            if not monitor.running: break
            time.sleep(.01)
        self.assertFalse(monitor.running)
        self.assertFalse(monitor.refresh())
        with patch('youtube_status.threading.Thread') as thread:
            self.assertTrue(monitor.refresh(force=True))
            thread.return_value.start.assert_called_once()

    def test_changed_channel_and_old_cache_are_unknown(self):
        monitor = y.Monitor(self.root, lambda *_: self.videos); monitor._run()
        monitor.cache['checked_epoch'] = time.time()-y.MAX_AGE_SECONDS-1
        self.assertFalse(monitor.status()['fresh'])
        monitor.cache['checked_epoch'] = time.time()
        (self.root/'youtube-channel.json').write_text(json.dumps({**CONFIG, 'channel_id': 'UC'+'b'*22}))
        self.assertEqual(monitor.status()['films']['song']['state'], 'unavailable')

    def test_restart_reads_cache_and_corrupt_cache_is_safe(self):
        monitor = y.Monitor(self.root, lambda *_: self.videos); monitor._run()
        self.assertEqual(y.Monitor(self.root).status()['films']['song']['state'], 'published')
        monitor.cache_path.write_text('{bad')
        self.assertEqual(y.Monitor(self.root).status()['films']['song']['state'], 'unavailable')

    def test_fetch_is_metadata_only_and_rejects_partial_process_output(self):
        python = self.root/'.venv-youtube/bin/python'; python.parent.mkdir(parents=True); python.touch()
        result = subprocess.CompletedProcess([], 0, json.dumps(listing(video('Song'))).encode(), b'')
        with patch('youtube_status.subprocess.run', return_value=result) as run:
            self.assertEqual(len(y.fetch_videos(self.root, CONFIG)), 1)
            command = run.call_args.args[0]
            for flag in ['--ignore-config', '--no-plugin-dirs', '--skip-download', '--flat-playlist', '--abort-on-error']: self.assertIn(flag, command)
            self.assertNotIn('--cookies-from-browser', command)
        result.stderr = b'WARNING: Incomplete data received'
        with patch('youtube_status.subprocess.run', return_value=result), self.assertRaises(y.CheckError): y.fetch_videos(self.root, CONFIG)
        with patch('youtube_status.subprocess.run', side_effect=subprocess.TimeoutExpired([], 90)), self.assertRaises(y.CheckError): y.fetch_videos(self.root, CONFIG)

    def test_invalid_config_cannot_request_arbitrary_url(self):
        (self.root/'youtube-channel.json').write_text(json.dumps({**CONFIG, 'url': 'https://example.com/private'}))
        with self.assertRaises(y.CheckError): y.load_config(self.root)


if __name__ == '__main__':
    unittest.main()
