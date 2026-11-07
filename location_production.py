"""Validated scene plans, stored through the existing atomic catalogue writer."""
import copy, time

def update(store, location, assets, request):
    from reference_catalog import Conflict
    from location_catalog import clean_text, SLOT_IDS, obsolete
    production = location.setdefault('production', {})
    if request.get('scope') == 'template':
        value = request.get('template')
        if value is not None and value not in ('ext', 'int'):
            raise ValueError('Choose EXT, INT, or automatic script inheritance')
        if 'template' not in request or 'expected' not in request:
            raise ValueError('Supply the template and its previous value')
        if request['expected'] != production.get('template'):
            raise Conflict('Template changed elsewhere. Reload this location before choosing again.')
        if value is None:
            production.pop('template', None)
        else:
            production['template'] = value
    elif request.get('scope') == 'continuity':
        if request.get('expected') != production.get('continuity', ''):
            raise Conflict('Continuity notes changed elsewhere. Reopen before saving; your draft is retained.')
        production['continuity'] = clean_text(request.get('notes'), 6000)
    elif request.get('scope') == 'scene':
        key = request.get('scene_key')
        scene = next((s for s in location.get('script_sources', [])
                      if key == f"{s['episode']}:{s['line']}"), None)
        if scene is None:
            raise ValueError('Choose a scene linked to this location')
        source = location.get('script_source', {}).get('sha256')
        if not source or request.get('source_sha256') != source:
            raise Conflict('Script version changed. Review the current scene before saving.')
        scenes = production.setdefault('scenes', {})
        if request.get('expected') != scenes.get(key):
            raise Conflict('This scene plan changed elsewhere. Reopen before saving; your draft is retained.')
        raw = request.get('plan')
        if not isinstance(raw, dict) or raw.get('usage') not in ('on-screen', 'reference-only', 'undecided'):
            raise ValueError('Choose how this location is used in this scene')
        plan = {k: clean_text(raw.get(k, ''), 6000) for k in ('conditions', 'changes', 'decisions')}
        plan.update(usage=raw['usage'], source_sha256=source, updated_at=time.time())
        requirements = raw.get('requirements')
        if not isinstance(requirements, list) or len(requirements) > 30:
            raise ValueError('Use up to 30 required images per scene')
        if raw['usage'] == 'on-screen' and not requirements:
            raise ValueError('Add an image requirement, or choose Reference only / No image needed')
        if raw['usage'] != 'on-screen' and requirements:
            raise ValueError('Only on-screen scenes can require images')
        allowed = {i for ids in location.get('references', {}).values() for i in ids}
        allowed.add(location.get('canonical_source', {}).get('id'))
        checked = []; seen = set()
        for r in requirements:
            if not isinstance(r, dict):
                raise ValueError('Invalid image requirement')
            rid = clean_text(r.get('id'), 100)
            view = clean_text(r.get('view'), 1500)
            if not rid or rid in seen or not view or r.get('slot_id') not in SLOT_IDS:
                raise ValueError('Every image needs a unique ID, view and reference category')
            seen.add(rid)
            if type(r.get('reuse')) is not bool:
                raise ValueError('Choose create or reuse')
            item = dict(id=rid, view=view, slot_id=r['slot_id'], reuse=r['reuse'], asset_id='', source_sha256='')
            aid = r.get('asset_id', '')
            if aid:
                a = assets.get(aid)
                if aid not in allowed or not a or obsolete(store, a):
                    raise ValueError('Choose an active image already attached to this location')
                if r.get('source_sha256') != a['sha256']:
                    raise Conflict('Image version changed. Review it before assigning it to this scene.')
                approval = location.get('approvals', {}).get(aid, {})
                canonical = location.get('canonical_source', {})
                approved = (approval.get('approved') is True and approval.get('source_sha256') == a['sha256']) or (canonical.get('id') == aid and canonical.get('source_sha256') == a['sha256'])
                if r['reuse'] and not approved:
                    raise ValueError('Reuse requires an approved or exact canonical image')
                item.update(asset_id=aid, source_sha256=a['sha256'])
            elif r['reuse']:
                raise ValueError('Choose an approved image to reuse')
            checked.append(item)
        plan['requirements'] = checked
        scenes[key] = copy.deepcopy(plan)
    else:
        raise ValueError('Unknown production plan scope')
    location['updated_at'] = time.time()
