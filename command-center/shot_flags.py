"""Per-storyboard review flags, separate from source shots and image assignments."""
import json
import math
import re
import time

class FlagConflict(ValueError):
    pass


def path_for(root, eid):
    if not isinstance(eid, str) or not re.fullmatch(r'[a-f0-9]{16}', eid):
        raise ValueError('Invalid storyboard ID.')
    return root/'feedback'/'shot-flags'/(eid+'.json')


def read(root, eid):
    path = path_for(root, eid)
    return json.loads(path.read_text()) if path.exists() else {'revision':0, 'flags':{}}


def save(root, catalog, data, atomic):
    eid = data.get('id')
    path = path_for(root, eid)
    sid = data.get('shot_id')
    if not isinstance(sid, str) or sid not in {str(s['id']) for s in catalog['slots']}:
        raise ValueError('Unknown shot in this storyboard.')
    flagged = data.get('flagged')
    stamp = data.get('timestamp')
    if type(flagged) is not bool or 'expected' not in data:
        raise ValueError('A flag state and expected saved value are required.')
    if stamp is not None and (type(stamp) not in (float, int) or not math.isfinite(stamp) or not 0 <= stamp <= 86400):
        raise ValueError('Timestamp must be between 0 and 86400 seconds.')
    state = read(root, eid)
    current = state['flags'].get(sid)
    # Explicit desired states make a retry safe if a response was lost.
    if (not flagged and current is None) or (flagged and current is not None and current['timestamp'] == stamp):
        return state
    if data['expected'] != current:
        raise FlagConflict('This shot’s flag changed in another window. Saved flags have been refreshed; review them and try again.')
    if flagged:
        state['flags'][sid] = {'timestamp':stamp, 'updated_at':time.time()}
    else:
        state['flags'].pop(sid, None)
    state['revision'] += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic(path, state)
    return state
