"""Read-only, exact-image handoff from a registered storyboard to Generate Beta."""
import hashlib
import json
from pathlib import Path
from related_images import snapshot, resolve_media_path, DESK_URL


def revision_context(root, catalog, state, eid, shot_id, asset_id, path_allowed):
    slot = next((s for s in catalog['slots'] if s['id'] == shot_id), None)
    if not slot:
        raise ValueError('Unknown shot slot.')
    desk, _ = snapshot()
    candidates = {a['id']: a for a in catalog['assets'] + state.get('related_assets', []) + desk}
    asset = candidates.get(asset_id)
    if not asset:
        raise ValueError('This image is no longer in the library. Refresh the images first.')
    if asset.get('crop') not in (None, [0, 0, 1, 1]):
        raise ValueError('This shot uses a cropped panel. Save that panel as a standalone Reference Desk image before revising it.')
    image = resolve_media_path(asset['image'])
    if not path_allowed(image) or not image.is_file() or image.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('The exact image file is unavailable for revision.')
    digest = hashlib.sha256(image.read_bytes()).hexdigest()
    matches = [a for a in desk if a.get('sha256') == digest and a.get('location_ids')]
    source = next((a for a in matches if a['id'] == asset_id), matches[0] if matches else None)
    if not source:
        raise ValueError('Add this exact image to a location in the Reference Desk before using Generate Beta. The original is unchanged.')
    raw = (root / 'view-data' / (eid + '.js')).read_text()
    view = json.loads(raw.split('=', 1)[1].strip().rstrip(';'))
    shot = next((s for s in view['shots'] if s['id'] == shot_id), {})
    prompt = slot.get('generation_prompt') or shot.get('generation_prompt') or shot.get('prompt') or slot.get('action') or ''
    if len(prompt) > 18000:
        raise ValueError('This saved prompt is too long for a revision handoff. Shorten the shot prompt first.')
    # Prefer a source's catalog location; never guess a location from title text.
    from related_images import DESK_ROOT
    manifest = json.loads((DESK_ROOT / 'manifest.json').read_text())
    original = next(a for a in manifest['assets'] if a['id'] == source['desk_id'])
    lids = list(dict.fromkeys(original.get('location_ids', []) + source['location_ids']))
    locations = {l['id']: l for l in manifest.get('locations', [])}
    location = next((locations[lid] for lid in lids if lid in locations and
                     any(source['desk_id'] in ids for ids in locations[lid].get('references', {}).values())), None)
    if not location:
        raise ValueError('Link this exact image to a location reference view before revising it.')
    slots = [s for s, ids in location['references'].items() if source['desk_id'] in ids]
    return {
        'desk_url': DESK_URL + 'index.html', 'version': 1, 'storyboard_id': eid, 'shot_id': shot_id,
        'slot_number': catalog['slots'].index(slot) + 1,
        'song': view.get('song', 'Storyboard'), 'title': slot['title'], 'prompt': prompt,
        'asset_id': source['desk_id'], 'sha256': digest, 'location_id': location['id'],
        'slot_id': 'scene-references' if 'scene-references' in slots else slots[0],
    }
