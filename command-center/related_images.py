"""Read-only bridge to Reference Desk imagery; no approval or catalog writes."""
import hashlib
import importlib.util
import functools
import json
import re
import threading
from pathlib import Path

SETTINGS_PATH = Path(__file__).resolve().parent / 'desk-connection.json'
SETTINGS = json.loads(SETTINGS_PATH.read_text()) if SETTINGS_PATH.exists() else {}
FRAMEWORK_ROOT = Path(SETTINGS.get('framework_root', Path(__file__).resolve().parent.parent)).resolve()
LIBRARY_ID = SETTINGS.get('library_id', '')
if LIBRARY_ID and not re.fullmatch(r'[a-f0-9]{32}', LIBRARY_ID):
    raise ValueError('Invalid Reference Desk library ID in desk-connection.json')
DESK_ROOT = FRAMEWORK_ROOT / 'libraries' / (LIBRARY_ID or 'unconfigured')
REVIEW_PATH = DESK_ROOT / '.state/review-state.json'
DESK_ORIGIN = 'http://127.0.0.1:8876'
DESK_URL = DESK_ORIGIN + '/libraries/' + DESK_ROOT.name + '/'
LEGACY_ROOTS = ()

@functools.lru_cache(maxsize=1)
def media_module():
    spec = importlib.util.spec_from_file_location('storyboard_linked_media', FRAMEWORK_ROOT / 'linked_media.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

@functools.lru_cache(maxsize=4)
def catalog_media(manifest, modified, size):
    data = json.loads(Path(manifest).read_text())
    return {a.get(k) for a in data.get('assets', []) for k in ('asset', 'thumbnail') if a.get(k)}

def resolve_media_path(value):
    """Keep saved URLs/assignments valid after migration, for exact catalog media only."""
    path = Path(value).resolve()
    roots = [DESK_ROOT, *LEGACY_ROOTS]
    try:
        spec = media_module().config(DESK_ROOT)
        if spec: roots.append(Path(spec['source_root']))
        for root in roots:
            if not path.is_relative_to(root.resolve()): continue
            relative = path.relative_to(root.resolve()).as_posix()
            manifest = DESK_ROOT / 'manifest.json'
            stat = manifest.stat()
            if relative not in catalog_media(str(manifest), stat.st_mtime_ns, stat.st_size):
                return path
            return desk_path(relative) or path
    except (OSError, ValueError, KeyError):
        pass
    return path
_cache_key = None
_cache = None
_lock = threading.RLock()


def normalized(value):
    return re.sub(r'[^a-z0-9]+', ' ', str(value).lower()).strip()


def match_reasons(asset, locations=()):
    tags = {normalized(t) for t in asset.get('tags', [])}
    tags.update(normalized(l.get('name', '')) for l in locations)
    wanted = SETTINGS.get('match_tags', [])
    return [tag for tag in wanted if normalized(tag) in tags]


def desk_path(value):
    if not isinstance(value, str) or not value:
        return None
    if Path(value).suffix.lower() not in {'.png', '.jpg', '.jpeg', '.webp', '.gif'}:
        return None
    try:
        return media_module().resolve_read(DESK_ROOT, value)
    except (OSError, ValueError, KeyError):
        return None



def snapshot():
    global _cache_key, _cache
    if not LIBRARY_ID:return [], set()
    manifest = DESK_ROOT / 'manifest.json'
    with _lock:
        key = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.exists() else None for p in (manifest, REVIEW_PATH, DESK_ROOT / '.state/linked-media.json'))
        if key == _cache_key and _cache is not None:
            return _cache
        data = json.loads(manifest.read_text())
        review = json.loads(REVIEW_PATH.read_text()) if REVIEW_PATH.exists() else {}
        choices = {a['id']: a for a in review.get('choices', {}).get('items', [])}
        by_location = {l['id']: l for l in data.get('locations', [])}
        reverse_locations = {}
        for location in by_location.values():
            for ids in location.get('references', {}).values():
                for aid in ids:
                    reverse_locations.setdefault(aid, set()).add(location['id'])
        assets, paths = [], set()
        for position, source in enumerate(data.get('assets', [])):
            lids = set(source.get('location_ids', [])) | reverse_locations.get(source['id'], set())
            locations = [by_location[lid] for lid in sorted(lids) if lid in by_location]

            image = desk_path(source.get('asset'))
            thumb = desk_path(source.get('thumbnail'))
            # Only exact catalog paths are exposed, never an entire directory.
            for p in (image, thumb):
                if p:
                    paths.add(str(p))
            reasons = match_reasons(source, locations)
            if not image or not image.is_file():
                continue
            choice = choices.get(source['id'], {})
            obsolete = bool(choice.get('obsolete')) or source.get('status', '').lower() == 'obsolete'
            approved_locations = [l['name'] for l in locations
                                  if l.get('approvals', {}).get(source['id'], {}).get('approved') is True
                                  and l['approvals'][source['id']].get('source_sha256') == source.get('sha256')]
            generated = bool(source.get('generated_candidate') or source.get('generation_job_id')
                             or any(str(v).endswith('-generation.json') for v in source.get('metadata_sources', [])))
            assets.append({
                'id': 'desk-' + source['id'], 'desk_id': source['id'],
                'image': str(image), 'thumbnail': str(thumb) if thumb and thumb.is_file() else str(image),
                'title': source.get('title') or source['id'], 'version': 'Reference Desk',
                'source_paths': source.get('sources', []), 'tags': source.get('tags', []), 'matches': reasons, 'obsolete': obsolete,
                'source_status': 'Obsolete' if obsolete else ('Approved location reference' if approved_locations else source.get('status', 'Needs review')),
                'location_names': [l['name'] for l in locations], 'location_ids': sorted(lids),
                'location_tags': list(dict.fromkeys(t for l in locations for t in l.get('tags', []))),
                'approved_locations': approved_locations, 'generated': generated, 'added_order': position,
                'preference': choice.get('preference', 'Unreviewed'), 'sha256': source.get('sha256'),
            })
        assets.sort(key=lambda a: (a['obsolete'], -a['added_order'], a['id']))
        _cache_key, _cache = key, (assets, paths)
        return _cache


def related_assets(eid, scope='related'):
    if not LIBRARY_ID:
        return [], None
    try:
        return [a for a in snapshot()[0] if scope == 'all' or a['matches']], None
    except (OSError, ValueError, KeyError, TypeError):
        return [], 'Reference Desk is unavailable. Existing storyboard images remain available.'


def approved_desk_path(path):
    try:
        return str(path.resolve()) in snapshot()[1]
    except (OSError, ValueError, KeyError, TypeError):
        return False


_hash_cache = {}
def with_storyboard_aliases(assets, catalog):
    """Recognize imported copies without changing any original asset IDs."""
    by_path = {}
    for asset in catalog['assets']:
        if not asset.get('crop'):
            by_path.setdefault(str(resolve_media_path(asset['image'])), []).append(asset['id'])
    result = []
    for asset in assets:
        aliases = []
        for path in [asset['image']] + asset.get('source_paths', []):
            path = str(resolve_media_path(path))
            if path not in by_path:
                continue
            try:
                p = Path(path)
                stat = p.stat()
                key = (path, stat.st_mtime_ns, stat.st_size)
                with _lock:
                    if key not in _hash_cache:
                        with p.open('rb') as f:
                            _hash_cache[key] = hashlib.file_digest(f, 'sha256').hexdigest()
                    if _hash_cache[key] == asset.get('sha256'):
                        aliases.extend(by_path[path])
            except OSError:
                pass
        result.append(dict(asset, equivalent_ids=aliases))
    return result
