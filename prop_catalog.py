"""Named character prop groups; references retain their existing approval and provenance."""
import copy
import time
import uuid


def update(character, assets, request):
    from reference_catalog import Conflict
    name = request.get('name')
    if not isinstance(name, str) or not name.strip() or len(name) > 140:
        raise ValueError('Enter a prop name of up to 140 characters')
    name = ' '.join(name.split())
    ids = request.get('reference_ids')
    if not isinstance(ids, list) or any(not isinstance(aid, str) for aid in ids):
        raise ValueError('Choose reference images')
    ids = list(dict.fromkeys(ids))
    cid = character['id']
    for aid in ids:
        a = assets.get(aid)
        if not a or not (
            a.get('type') == 'Supporting prop / map' and cid in a.get('primary_character_ids', a.get('character_ids', []))
            or any(r.get('character_id') == cid and r.get('type') == 'Supporting prop / map' for r in a.get('reference_links', []))
        ):
            raise ValueError('Choose images from this character’s Supporting prop / map section')
    props = character.setdefault('props', [])
    prop_id = request.get('prop_id')
    if prop_id:
        prop = next((p for p in props if p['id'] == prop_id), None)
        if not prop:
            raise ValueError('Choose a prop belonging to this character')
        if 'expected' not in request or request['expected'] != prop:
            raise Conflict('This prop changed elsewhere. Reopen it before saving; your draft is retained.')
    else:
        try:
            token = str(uuid.UUID(request.get('request_id', '')))
        except (ValueError, AttributeError, TypeError):
            raise ValueError('Supply a valid creation request ID') from None
        context = {'name': name, 'reference_ids': ids}
        previous = next((p for p in props if p.get('creation_request_id') == token), None)
        if previous:
            if previous.get('creation_request_context') != context:
                raise Conflict('This creation request was already saved with different prop details')
            return previous
        prop = None
    if any(p is not prop and p['name'].casefold() == name.casefold() for p in props):
        raise ValueError('A prop with this name already exists for this character')
    if prop is None:
        prop = {'id': 'prop-'+uuid.uuid4().hex, 'created_at': time.time(),
                'creation_request_id': token, 'creation_request_context': copy.deepcopy(context)}
        props.append(prop)
    prop.update(name=name, reference_ids=ids, updated_at=time.time())
    return prop
