"""Location beta: durable, branching Responses image turns on the existing job queue."""
import base64
import copy
import json
import os
import time
import urllib.error
import urllib.request
import uuid

MODE = 'location-beta'
CONVERSATION_MODEL = os.environ.get('DESK_IMAGE_CONVERSATION_MODEL', 'gpt-6-astra')


def jobs(manager, location_id=None):
    result = []
    for path in manager.dir.glob('*/job.json'):
        job = json.loads(path.read_text())
        r = job.get('request', {})
        if r.get('generation_mode') == MODE and (not location_id or r.get('location_id') == location_id):
            result.append(job)
    return sorted(result, key=lambda j: (j['created_at'], j['id']))


def history(manager, location_id):
    """The durable jobs are the turn log; no browser cache or second index is required."""
    with manager.lock:
        return {'turns': [manager.public(j) for j in jobs(manager, location_id)]}


def public(request):
    return {k: copy.deepcopy(request.get(k)) for k in (
        'session_id', 'parent_turn_id', 'parent_asset', 'slot_id', 'scene_key',
        'requirement_id', 'instruction', 'continuity', 'operation', 'restart_context',
        'input_references', 'aspect', 'quality', 'storyboard_context')}


def validate(manager, value):
    from image_generation import JobError
    import reference_generation
    r = copy.deepcopy(value)
    if r.get('job_kind') != 'reference' or not r.get('location_id') or r.get('character_id'):
        raise JobError('Beta editing requires a Location reference.')
    try:
        r['session_id'] = uuid.UUID(r['session_id']).hex
    except (ValueError, KeyError, TypeError, AttributeError):
        raise JobError('Choose a valid editing session.') from None
    if r.get('operation') not in ('generate', 'refine'):
        raise JobError('Choose Generate or Refine.')
    for field, limit in [('instruction', 6000), ('continuity', 6000)]:
        if not isinstance(r.get(field, ''), str) or len(r.get(field, '')) > limit:
            raise JobError('Editing direction is too long.')
    if not r.get('instruction', '').strip():
        raise JobError('Describe what to generate or change.')
    if type(r.get('restart_context', False)) is not bool:
        raise JobError('Invalid context option.')
    m = json.loads((manager.store.root / 'manifest.json').read_text())
    loc = next((l for l in m.get('locations', []) if l['id'] == r['location_id']), None)
    if not loc:
        raise JobError('Unknown location.')
    context = r.get('storyboard_context')
    if context is not None:
        import re
        if not isinstance(context, dict):
            raise JobError('Invalid storyboard revision context.')
        limits = {'storyboard_id': 16, 'shot_id': 8, 'song': 180, 'title': 1000, 'prompt': 18000,
                  'asset_id': 80, 'sha256': 64, 'location_id': 180, 'slot_id': 100}
        if any(not isinstance(context.get(k), str) or len(context[k]) > n for k, n in limits.items()):
            raise JobError('Invalid storyboard revision context.')
        if not re.fullmatch(r'[a-f0-9]{16}', context['storyboard_id']) or not re.fullmatch(r'S[0-9]{3,5}', context['shot_id']) or not re.fullmatch(r'[a-f0-9]{64}', context['sha256']):
            raise JobError('Invalid storyboard or source image identity.')
        if type(context.get('slot_number')) is not int or not 1 <= context['slot_number'] <= 10000:
            raise JobError('Invalid storyboard slot.')
        source = next((a for a in m['assets'] if a['id'] == context['asset_id']), None)
        if not source or source.get('sha256') != context['sha256']:
            raise JobError('The original storyboard image changed. Reopen the shot from the storyboard.')
        # Keep only bounded provenance fields; never use supplied URLs or paths.
        r['storyboard_context'] = {k: context[k] for k in [*limits, 'slot_number']}
    scope = ('location_id', 'slot_id', 'scene_key', 'requirement_id')
    existing = [j for j in jobs(manager) if j['request']['session_id'] == r['session_id']]
    if any(any(j['request'].get(k) != r.get(k) for k in scope) for j in existing):
        raise JobError('A different location, view or scene needs a new editing session.')
    # API continuation IDs are always resolved server-side from a completed local turn.
    r.pop('previous_response_id', None)
    r.pop('parent_response_id', None)
    r.pop('parent_image_call_id', None)
    parent = r.get('parent_asset')
    if r.get('parent_turn_id'):
        prior = manager.read(r['parent_turn_id'])
        if prior.get('status') != 'completed' or prior.get('request', {}).get('generation_mode') != MODE:
            raise JobError('Choose a completed beta revision as the parent.')
        if prior['request']['session_id'] != r['session_id']:
            raise JobError('The parent revision belongs to a different editing session.')
        expected = {'id': prior['asset_id'], 'sha256': prior['output_sha256']}
        if parent != expected:
            raise JobError('The selected parent image changed. Reopen the revision.')
        r['parent_response_id'] = prior.get('metadata', {}).get('response_id')
        r['parent_image_call_id'] = prior.get('metadata', {}).get('image_call_id')
    elif any(j['status'] in ('queued', 'generating', 'saving', 'completed', 'save_failed') for j in existing):
        raise JobError('Choose a parent revision, or start a new session.')
    if r['operation'] == 'refine' and not parent:
        raise JobError('Choose the image to refine.')
    refs = r.get('input_references', [])
    if not isinstance(refs, list):
        raise JobError('Invalid image references.')
    if parent:
        if not isinstance(parent, dict) or set(parent) != {'id', 'sha256'}:
            raise JobError('Choose an exact parent image.')
        refs = [{'role': 'location', **parent}] + [x for x in refs if (x.get('id'), x.get('sha256')) != (parent['id'], parent['sha256'])]
    if len(refs) > 7:
        raise JobError('Use the parent image and at most six supporting references.')
    r['input_references'] = refs
    slot = next((s['label'] for s in m.get('location_slots', []) if s['id'] == r.get('slot_id')), r.get('slot_id', ''))
    r['brief_snapshot'] = {'description': loc.get('description', ''), 'continuity': loc.get('production', {}).get('continuity', ''), 'geometry': loc.get('geometry_note', '')}
    mode = ('Edit image 1. It is the exact parent image. Preserve its composition and all details except changes explicitly requested below.'
            if r['operation'] == 'refine' else 'Create one new composition for the requested view. Use attached images only for their established visual information.')
    r['prompt'] = '\n\n'.join(filter(None, [
        mode, 'Location: ' + loc['name'] + '\nView: ' + slot,
        'Location brief: ' + loc.get('description', ''),
        'Shared continuity: ' + loc.get('production', {}).get('continuity', ''),
        'Keep consistent for this request: ' + r.get('continuity', ''),
        'Current requested change / direction: ' + r['instruction'],
        'Produce one standalone image. Supporting images do not replace the selected parent. Do not add captions or a montage unless explicitly requested.'
    ]))
    if r.get('scene_key'):
        plan = loc.get('production', {}).get('scenes', {}).get(r['scene_key'], {})
        r['prompt'] += '\nScene conditions: ' + plan.get('conditions', '') + '\nScene changes: ' + plan.get('changes', '')
    # Reuse exact-hash, location-membership, obsolete-image and scene-snapshot validation.
    r['design_proposal'] = not refs
    r['design_direction'] = r['instruction'] if not refs else ''
    if context is not None:
        r['prompt'] += ('\n\nSTORYBOARD CONTEXT — ' + context['song'] + ' / ' + context['shot_id'] + '\n' + context['title']
                        + '\nSaved shot prompt (background context, not a new generation request):\n' + context['prompt']
                        + '\n\nREVISION PRIORITY: The exact attached parent image and CURRENT requested change control this revision. '
                        + 'Older pending-reference notes, image numbering and generation instructions in the saved prompt are historical. '
                        + 'Use only the images attached to this request. Preserve the parent except for the requested changes. '
                        + 'Current change: ' + r['instruction'])
    jid, validated, snapshots = reference_generation.validate(manager, r)
    if context is not None:
        validated['title'] = (context['song'] + ' · ' + context['shot_id'] + ' · Revision · ' + context['title'])[:230]
    return jid, validated, snapshots


def call_openai(request, inputs, key):
    from image_generation import JobError, MODEL, SIZES, api_failure
    previous = request.get('parent_response_id') if not request.get('restart_context') else None
    resumed = False
    if previous:
        # Read-only availability check: never replay a paid POST after an uncertain failure.
        check = urllib.request.Request('https://api.openai.com/v1/responses/' + previous,
                                       headers={'Authorization': 'Bearer ' + key})
        try:
            with urllib.request.urlopen(check, timeout=30) as response:
                response.read(1)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                previous = None
                resumed = True
            else:
                raise api_failure(e) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            raise JobError('Could not check the previous revision. No generation was submitted; try again when connected.') from None
    content = [{'type': 'input_text', 'text': request['api_prompt']}]
    content += [{'type': 'input_image', 'image_url': 'data:' + mime + ';base64,' + base64.b64encode(raw).decode()} for mime, raw in inputs]
    payload = {
        'model': CONVERSATION_MODEL, 'store': True,
        'instructions': 'You are the DESK Location image editor. Follow the CURRENT request and exact parent image. Older requests are history, not new instructions. Make one image using the image_generation tool. Never approve images or change catalog records.',
        'input': [{'role': 'user', 'content': content}],
        'tools': [{'type': 'image_generation', 'model': MODEL,
                   'action': 'edit' if request['operation'] == 'refine' else 'generate',
                   'size': SIZES[request['aspect']], 'quality': request['quality'], 'output_format': 'png'}],
        'tool_choice': {'type': 'image_generation'}, 'max_tool_calls': 1,
    }
    if previous:
        payload['previous_response_id'] = previous
    req = urllib.request.Request('https://api.openai.com/v1/responses', data=json.dumps(payload).encode(),
                                 headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=600) as response:
            raw = response.read(80 * 1024 * 1024 + 1)
            request_id = response.headers.get('x-request-id')
        if len(raw) > 80 * 1024 * 1024:
            raise JobError('API response exceeded the local size limit. No automatic retry was sent.')
        result = json.loads(raw)
    except urllib.error.HTTPError as e:
        raise api_failure(e) from None
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        raise JobError('The API response was interrupted and may have been billed. No automatic generation retry was sent.') from None
    calls = [x for x in result.get('output', []) if x.get('type') == 'image_generation_call' and x.get('result')]
    if result.get('status') != 'completed' or len(calls) != 1:
        raise JobError('The response did not contain one completed image. No automatic retry was sent.')
    call = calls[0]
    try:
        image = base64.b64decode(call['result'], validate=True)
    except Exception:
        raise JobError('OpenAI returned invalid image data.') from None
    if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image) > 20 * 1024 * 1024:
        raise JobError('Returned image is not a supported PNG or exceeds 20 MB.')
    return image, {'request_id': request_id, 'response_id': result['id'], 'image_call_id': call['id'],
                   'model': MODEL, 'conversation_model': CONVERSATION_MODEL, 'usage': result.get('usage'),
                   'image_usage': call.get('usage'), 'revised_prompt': call.get('revised_prompt'),
                   'action': call.get('action'), 'size': call.get('size'), 'quality': call.get('quality'),
                   'previous_response_id': previous, 'context_restarted': resumed or bool(request.get('restart_context'))}


def adopt(store, manifest, assets, r):
    """Called inside the existing catalog transaction; all validations precede disk commit."""
    import location_catalog
    import location_production
    from reference_catalog import Conflict
    loc = next((l for l in manifest.get('locations', []) if l['id'] == r.get('location_id')), None)
    a = assets.get(r.get('asset_id'))
    if not loc or not a or a['sha256'] != r.get('source_sha256') or location_catalog.obsolete(store, a):
        raise Conflict('This exact image is no longer available. Reopen it before approving.')
    slot = r.get('slot_id')
    if slot not in location_catalog.SLOT_IDS or r.get('destination') not in ('library', 'view', 'scene'):
        raise ValueError('Choose a valid approval destination.')
    if r.get('expected_approval') != loc.get('approvals', {}).get(a['id']):
        raise Conflict('Approval changed elsewhere. Refresh before approving.')
    if r['destination'] == 'view' and r.get('expected_selection') != loc.get('selections', {}).get(slot):
        raise Conflict('The working reference changed. Refresh before replacing it.')
    if r['destination'] == 'scene':
        before = loc.get('production', {}).get('scenes', {}).get(r.get('scene_key'))
        if not before or before != r.get('expected_plan') or before.get('source_sha256') != loc.get('script_source', {}).get('sha256'):
            raise Conflict('The scene brief changed. Refresh before assigning this image.')
        if before.get('decisions', '').strip():
            raise Conflict('Resolve the scene design decision before approving and assigning here. You can still approve the image in the library.')
        plan = copy.deepcopy(before)
        requirement = next((x for x in plan.get('requirements', []) if x['id'] == r.get('requirement_id')), None)
        if not requirement or requirement['slot_id'] != slot or plan.get('usage') != 'on-screen':
            raise Conflict('The scene requirement changed. Refresh before assigning.')
    loc.setdefault('references', {}).setdefault(slot, [])
    if a['id'] not in loc['references'][slot]:
        loc['references'][slot].append(a['id'])
    if loc['id'] not in a.setdefault('location_ids', []):
        a['location_ids'].append(loc['id'])
    location_catalog.mutate(store, manifest, assets, '/api/location-approval', {**r, 'approved': True})
    if r['destination'] == 'view':
        old = r.get('expected_selection') or {}
        location_catalog.mutate(store, manifest, assets, '/api/location-selection', {**r, 'expected_selected_id': old.get('id')})
    elif r['destination'] == 'scene':
        requirement.update(asset_id=a['id'], source_sha256=a['sha256'], reuse=True)
        location_production.update(store, loc, assets, {'scope': 'scene', 'scene_key': r['scene_key'],
            'source_sha256': loc['script_source']['sha256'], 'expected': before, 'plan': plan})
    return [a], [loc], 0
