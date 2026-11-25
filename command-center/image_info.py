"""Exact-file metadata and editable tags for registered storyboard images."""
import hashlib
import json
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from related_images import snapshot, DESK_ROOT, DESK_URL, DESK_ORIGIN, resolve_media_path

class TagConflict(ValueError):
    pass

def clean_tags(values):
    if not isinstance(values, list) or len(values) > 40:
        raise ValueError('Use up to 40 tags.')
    result = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError('Tags must be text.')
        value = ' '.join(value.split())
        if len(value) > 80:
            raise ValueError('Each tag must be 80 characters or less.')
        if value and value.casefold() not in {t.casefold() for t in result}:
            result.append(value)
    return result

def resolve(catalog, state, asset_id, path_allowed):
    try:
        desk, _ = snapshot()
    except (OSError, ValueError, KeyError):
        desk = []
    assets = {a['id']: a for a in catalog['assets'] + state.get('related_assets', []) + desk}
    asset = assets.get(asset_id)
    if not asset:
        raise ValueError('Unknown image. Refresh the storyboard library.')
    path = resolve_media_path(asset['image'])
    if not path_allowed(path) or not path.is_file() or path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('The registered image file is unavailable.')
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    source = next((a for a in desk if a.get('sha256') == digest), None)
    return asset, path, digest, source

def image_info(root, catalog, state, asset_id, path_allowed):
    asset, path, digest, source = resolve(catalog, state, asset_id, path_allowed)
    dimensions = {}
    proc = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', str(path)], capture_output=True, text=True, timeout=15)
    for line in proc.stdout.splitlines():
        key, _, value = line.strip().partition(':')
        if key in ('pixelWidth', 'pixelHeight') and value.strip().isdigit():
            dimensions[key] = int(value)
    sidecar = root / 'feedback' / 'image-tags.json'
    stored = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    tags = source['tags'] if source else stored.get(digest, asset.get('tags', []))
    return {'asset_id': asset_id, 'name': source['title'] if source else asset['title'],
            'filename': path.name, 'width': dimensions.get('pixelWidth'), 'height': dimensions.get('pixelHeight'),
            'bytes': path.stat().st_size, 'sha256': digest, 'tags': tags,
            'desk_id': source['desk_id'] if source else None, 'tag_store': 'Reference Desk' if source else 'Storyboard Library',
            'crop': asset.get('crop')}

def add_tags(root, catalog, state, data, path_allowed, atomic):
    asset, path, digest, source = resolve(catalog, state, data.get('asset'), path_allowed)
    if data.get('sha256') != digest:
        raise TagConflict('The image changed. Reopen image info before adding tags.')
    additions = clean_tags(data.get('add_tags', []))
    removals = {t.casefold() for t in clean_tags(data.get('remove_tags', []))}
    if not additions and not removals:
        raise ValueError('Add or remove at least one tag.')
    sidecar = root / 'feedback' / 'image-tags.json'
    stored = json.loads(sidecar.read_text()) if sidecar.exists() else {}
    current = source['tags'] if source else stored.get(digest, asset.get('tags', []))
    if current != data.get('expected_tags'):
        raise TagConflict('Tags changed elsewhere. Reopen image info to load them; your new tags have not been saved.')
    merged = clean_tags([t for t in current if t.casefold() not in removals] + additions)
    if source and merged != current:
        # Reuse the Desk's own catalog lock, history and conflict protection.
        # Destination and operation are fixed; no caller-controlled URL or route.
        try:
            with urllib.request.urlopen(DESK_URL + 'api/review', timeout=10) as response:
                token = json.load(response)['csrf_token']
            payload = {'id': source['desk_id'], 'expected_tags': current, 'tags': merged}
            request = urllib.request.Request(DESK_URL + 'api/reference-tags',
                data=json.dumps(payload).encode(), method='POST', headers={
                    'Content-Type': 'application/json', 'Origin': DESK_ORIGIN, 'X-DESK-CSRF': token})
            with urllib.request.urlopen(request, timeout=15) as response:
                json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 409:
                raise TagConflict('Tags changed elsewhere. Reopen image info before saving.') from None
            raise ValueError('Reference Desk could not save these tags. Reopen image info to check their current state.') from None
        except (urllib.error.URLError, TimeoutError, KeyError):
            raise ValueError('Reference Desk is unavailable. Reopen image info to check whether the tags saved before trying again.') from None
    elif not source and merged != current:
        stored[digest] = merged
        sidecar.parent.mkdir(parents=True, exist_ok=True)
        atomic(sidecar, stored)
    return {'ok': True, 'tags': merged, 'tag_store': 'Reference Desk' if source else 'Storyboard Library'}
