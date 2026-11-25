"""Exact-image storyboard approvals, separate from reference canon and shot placement."""
import hashlib
import json
import time
import uuid
from image_info import resolve

class ApprovalConflict(ValueError):
    pass

def identity(catalog, state, asset_id, path_allowed):
    asset, path, digest, source = resolve(catalog, state, asset_id, path_allowed)
    crop = asset.get('crop')
    if crop == [0, 0, 1, 1]:
        crop = None
    key = digest + (':' + hashlib.sha256(json.dumps(crop, separators=(',', ':')).encode()).hexdigest() if crop else '')
    return key, digest, crop, bool(source and source.get('obsolete'))

def read(root, catalog, state, asset_id, path_allowed):
    key, digest, crop, obsolete = identity(catalog, state, asset_id, path_allowed)
    path = root / 'feedback' / 'image-approvals.json'
    saved = json.loads(path.read_text()) if path.exists() else {}
    record = saved.get(key)
    return {'key': key, 'sha256': digest, 'crop': crop, 'record': record,
            'approved': bool(record and record.get('approved')), 'obsolete': obsolete}

def save(root, catalog, state, data, path_allowed, atomic):
    current = read(root, catalog, state, data.get('asset'), path_allowed)
    if data.get('key') != current['key'] or data.get('sha256') != current['sha256']:
        raise ApprovalConflict('This image changed. Reopen its review before approving.')
    if type(data.get('approved')) is not bool or 'expected_record' not in data:
        raise ValueError('Approval and the previously loaded review are required.')
    if current['record'] != data['expected_record']:
        raise ApprovalConflict('Approval changed in another tab. Reopen this image to see the saved status.')
    if data['approved'] and current['obsolete']:
        raise ValueError('This image is set aside. Restore it in the Reference Desk before approving.')
    if current['approved'] == data['approved']:
        return current
    folder = root / 'feedback'
    path = folder / 'image-approvals.json'
    saved = json.loads(path.read_text()) if path.exists() else {}
    history = folder / 'image-approval-history'
    history.mkdir(parents=True, exist_ok=True)
    record = {'approved': data['approved'], 'sha256': current['sha256'], 'crop': current['crop'],
              'revision': (current['record'] or {}).get('revision', 0) + 1,
              'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
              'storyboard_id': data['id'], 'asset_id': data['asset'], 'scope': 'storyboard-image'}
    atomic(history / (str(uuid.uuid4()) + '.json'), {'key': current['key'], 'before': current['record'], 'after': record})
    saved[current['key']] = record
    atomic(path, saved)
    return dict(current, record=record, approved=data['approved'])
