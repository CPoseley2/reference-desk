"""Read-only public YouTube publication checks for the local Command Center."""
import json
import os
import re
import subprocess
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

COOLDOWN_SECONDS = 60
MAX_AGE_SECONDS = 86400
MAX_VIDEOS = 1000
_monitors = {}
_monitors_lock = threading.Lock()


class CheckError(ValueError):
    pass


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def normalize(title):
    title = unicodedata.normalize('NFKD', title).casefold()
    title = title.replace('&', ' and ').replace('’', '').replace("'", '')
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', title).split())


def title_key(title, collection_title=None):
    """Strip presentation suffixes, preserving reprise/return identity."""
    parts = re.split(r'\s*[|—–]\s*|\s+-\s+', title)
    core = parts[0].strip()
    core = re.sub(r'\((?:demo|official|official video|lyric video|music video|storyboard|theatrical version)\)', '', core, flags=re.I)
    key = normalize(core)
    if re.search(r'\breprise\b', normalize(title)) and 'reprise' not in key.split():
        key += ' reprise'
    if re.search(r'\breturn\b', normalize(title)) and 'return' not in key.split():
        suffix = re.search(r'\bact (?:v|5) return\b|\breturn\b', normalize(title))
        key += ' ' + suffix.group()
    if re.search(r'\b(?:trailer|teaser|excerpt|interview|reaction)\b|behind the scenes', normalize(title)):
        return ''
    # The musical name in a subtitle is never a match for its title song.
    if collection_title and key == normalize(collection_title) and len(parts) > 1:
        suffix = normalize(' '.join(parts[1:]))
        if not re.fullmatch(r'(?:(?:demo|official|music|video|lyric|cinematic|theatrical|version|storyboard|draft|an|american|frontier|musical|\d+)\s*)+', suffix):
            return ''
    return key


def load_config(root):
    config = json.loads((root / 'youtube-channel.json').read_text())
    if not re.fullmatch(r'https://www\.youtube\.com/@[A-Za-z0-9_.-]+/videos', config.get('url', '')):
        raise CheckError('Configure a YouTube channel Videos URL.')
    if not re.fullmatch(r'UC[A-Za-z0-9_-]{22}', config.get('channel_id', '')):
        raise CheckError('Configure the verified YouTube channel ID.')
    aliases = config.get('aliases', {})
    if not isinstance(aliases, dict) or any(not isinstance(v, list) or any(not isinstance(a, str) for a in v) for v in aliases.values()):
        raise CheckError('YouTube title aliases must be lists of titles.')
    return config


def parse_listing(data, config):
    if data.get('channel_id') != config['channel_id']:
        raise CheckError('YouTube returned a different channel; publication status was not changed.')
    entries = data.get('entries')
    if not isinstance(entries, list) or not entries:
        raise CheckError('YouTube returned no complete public video listing.')
    if len(entries) > MAX_VIDEOS:
        raise CheckError('The channel exceeds the current scan limit; no unpublished results were inferred.')
    if data.get('playlist_count') is not None and data['playlist_count'] != len(entries):
        raise CheckError('YouTube returned an incomplete video listing.')
    videos = []
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not re.fullmatch(r'[A-Za-z0-9_-]{11}', entry.get('id', '')) or not isinstance(entry.get('title'), str) or not entry['title'].strip():
            raise CheckError('A public video could not be read; retry the channel check.')
        if entry.get('channel_id') not in (None, config['channel_id']):
            raise CheckError('Unexpected channel in the public video listing.')
        if entry.get('availability') not in (None, 'public') or entry.get('live_status') in ('is_upcoming', 'is_live', 'post_live'):
            continue
        if entry.get('release_timestamp') and entry['release_timestamp'] > time.time():
            continue
        if entry['id'] not in seen:
            seen.add(entry['id'])
            videos.append({'id': entry['id'], 'title': entry['title'], 'url': 'https://www.youtube.com/watch?v=' + entry['id']})
    return videos


def fetch_videos(root, config):
    python = root / '.venv-youtube/bin/python'
    if not python.is_file():
        raise CheckError('YouTube checker is not installed. See README.txt.')
    command = [str(python), '-m', 'yt_dlp', '--ignore-config', '--no-plugin-dirs',
               '--flat-playlist', '--skip-download', '--dump-single-json', '--abort-on-error',
               '--socket-timeout', '15', '--extractor-retries', '1', '--retries', '1',
               '--playlist-end', str(MAX_VIDEOS + 1), config['url']]
    try:
        result = subprocess.run(command, capture_output=True, timeout=90, check=False)
    except subprocess.TimeoutExpired as error:
        raise CheckError('YouTube check timed out. Refresh to retry.') from error
    incomplete_warning = re.search(rb'WARNING:.*(?:incomplete|Unable to|Failed|Skipping|giving up)', result.stderr, re.I)
    if result.returncode or b'ERROR:' in result.stderr or incomplete_warning:
        raise CheckError('YouTube could not be checked. Check your connection and refresh; the checker may need an update.')
    if len(result.stdout) > 12_000_000:
        raise CheckError('YouTube returned an oversized listing.')
    try:
        return parse_listing(json.loads(result.stdout), config)
    except (ValueError, TypeError) as error:
        if isinstance(error, CheckError):
            raise
        raise CheckError('YouTube returned an unreadable listing. Refresh to retry.') from error


def match_films(films, videos, config):
    indexed = {}
    for video in videos:
        key = title_key(video['title'], config.get('collection_title'))
        if key:
            indexed.setdefault(key, []).append(video)
    results = {}
    for film in films:
        names = [film['title'], *config.get('aliases', {}).get(film['id'], [])]
        # Distinct occurrences must not inherit the base song's publication.
        occurrence = re.search(r'\breprise\b|\breturn\b', normalize(film['title']))
        if film.get('catalog_song') and not occurrence:
            names.append(film['catalog_song'])
        matches = []
        seen = set()
        for name in names:
            for video in indexed.get(normalize(name), []):
                if video['id'] not in seen:
                    seen.add(video['id'])
                    matches.append(video)
        # Channel listing is newest-first, even when more than one alias matched.
        positions = {video['id']: i for i, video in enumerate(videos)}
        matches.sort(key=lambda video: positions[video['id']])
        results[film['id']] = {'state': 'published' if matches else 'not_found', 'matches': matches}
    return results


class Monitor:
    def __init__(self, root, fetcher=fetch_videos):
        self.root = Path(root)
        self.fetcher = fetcher
        self.lock = threading.RLock()
        self.running = False
        self.last_attempt = None
        self.error = None
        self.cache = {}
        try:
            cached = json.loads(self.cache_path.read_text())
            if cached.get('schema') == 1 and isinstance(cached.get('videos'), list):
                self.cache = cached
        except (OSError, ValueError, TypeError):
            pass

    @property
    def cache_path(self):
        return self.root / 'feedback/youtube-status.json'

    def refresh(self, force=False):
        with self.lock:
            if self.running or (not force and self.last_attempt is not None and time.monotonic() - self.last_attempt < COOLDOWN_SECONDS):
                return False
            self.running = True
            self.last_attempt = time.monotonic()
            self.error = None
        threading.Thread(target=self._run, name='youtube-publication-check', daemon=True).start()
        return True

    def _run(self):
        try:
            config = load_config(self.root)
            videos = self.fetcher(self.root, config)
            data = {'schema': 1, 'channel_id': config['channel_id'], 'channel_url': config['url'],
                    'checked_at': utc_now(), 'checked_epoch': time.time(), 'videos': videos}
            self.cache_path.parent.mkdir(exist_ok=True, parents=True)
            temporary = self.cache_path.with_suffix('.tmp')
            with temporary.open('w') as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.cache_path)
            with self.lock:
                self.cache = data
        except Exception as error:
            with self.lock:
                self.error = str(error) if isinstance(error, CheckError) else 'YouTube check is unavailable. Refresh to retry.'
        finally:
            with self.lock:
                self.running = False

    def status(self):
        with self.lock:
            config = load_config(self.root)
            catalog = json.loads((self.root / 'command-center.json').read_text())
            films = [film for act in catalog['acts'] for film in act['films']]
            valid = (self.cache.get('channel_id') == config['channel_id'] and self.cache.get('channel_url') == config['url'])
            age = time.time() - self.cache.get('checked_epoch', 0)
            fresh = valid and age < MAX_AGE_SECONDS and not self.error and not self.running
            matches = match_films(films, self.cache.get('videos', []) if valid else [], config)
            for item in matches.values():
                if not fresh:
                    item['previous_state'] = item['state'] if valid else None
                    item['state'] = 'checking' if self.running else 'unavailable'
            return {'channel': config.get('name', config['channel_id']), 'channel_url': config['url'],
                    'refreshing': self.running, 'error': self.error, 'fresh': fresh,
                    'checked_at': self.cache.get('checked_at') if valid else None,
                    'video_count': len(self.cache.get('videos', [])) if valid else 0, 'films': matches}


def monitor(root):
    key = str(Path(root).resolve())
    with _monitors_lock:
        if key not in _monitors:
            _monitors[key] = Monitor(root)
        return _monitors[key]


def refresh(root, force=False):
    return monitor(root).refresh(force=force)


def status(root):
    return monitor(root).status()
