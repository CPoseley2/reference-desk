"""Local, library-scoped Crescendo jobs. Audio never leaves this computer."""
import json
import math
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path

MAX_AUDIO = 256 * 1024 * 1024
FILES = {'index.html', 'audio-preview.wav', 'beat-map.json', 'beat-map.csv', 'edit-cues.csv'}
_slots = threading.Semaphore(1)
_lock = threading.RLock()


class ReviewConflict(ValueError):
    pass


def atomic(path, value):
    tmp = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
    try:
        with tmp.open('x') as f:
            json.dump(value, f, ensure_ascii=False, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def moment_id(cue):
    """Identity stays tied to measured source timing, not display order."""
    return ':'.join([cue['kind']] + [format(cue.get(key, cue['seconds']), '.6f')
                                   for key in ('seconds', 'start_seconds', 'end_seconds')])


class CrescendoStore:
    def __init__(self, app, state, instance):
        self.app = Path(app)
        self.root = Path(state) / 'crescendo'
        self.instance = instance

    def python(self):
        config = self.app / '.state/crescendo-python'
        return os.environ.get('CRESCENDO_PYTHON') or (config.read_text().strip() if config.exists()
                else str(self.app / '.venv-crescendo/bin/python'))

    def directory(self, job_id):
        if not re.fullmatch('[a-f0-9]{32}', job_id):
            raise ValueError('Invalid analysis ID')
        return self.root / job_id

    def read(self, job_id):
        record = json.loads((self.directory(job_id) / 'job.json').read_text())
        if record['status'] in ('queued', 'analyzing') and record['instance'] != self.instance:
            record.update(status='interrupted', error='The service restarted before analysis finished. Import the song again to retry.')
        return record

    def listing(self):
        jobs = [self.read(p.parent.name) for p in self.root.glob('*/job.json')]
        return {'jobs': sorted(jobs, key=lambda v: v['created_at'], reverse=True),
                'available': Path(self.python()).is_file(), 'max_audio_bytes': MAX_AUDIO}

    def submit(self, stream, size, query):
        if not 0 < size <= MAX_AUDIO:
            raise ValueError('Choose an audio file up to 256 MB.')
        title = query.get('title', '').strip()
        if not title or len(title) > 160:
            raise ValueError('Enter a song title up to 160 characters.')
        suffix = Path(query.get('filename', '')).suffix.lower()
        if suffix not in ('.wav', '.aif', '.aiff', '.flac', '.mp3', '.ogg'):
            raise ValueError('Choose WAV, AIFF, FLAC, MP3, or OGG audio.')
        fps, offset = float(query.get('fps', '25')), float(query.get('offset', '0'))
        if not math.isfinite(fps) or not 1 <= fps <= 240 or not math.isfinite(offset) or not 0 <= offset <= 86400:
            raise ValueError('FPS must be 1–240 and film offset must be 0–86400 seconds.')
        if not Path(self.python()).is_file():
            raise ValueError('Run Set Up Crescendo.command in the Reference Desk folder, then reload.')
        job_id = uuid.uuid4().hex
        directory = self.directory(job_id)
        directory.mkdir(parents=True)
        source = directory / ('source' + suffix)
        try:
            with source.open('xb') as target:
                remaining = size
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ValueError('Audio upload was interrupted. Choose the file again.')
                    target.write(chunk)
                    remaining -= len(chunk)
            record = {'id': job_id, 'title': title, 'filename': Path(query.get('filename', '')).name,
                      'fps': fps, 'offset': offset, 'status': 'queued', 'created_at': time.time(),
                      'instance': self.instance}
            atomic(directory / 'job.json', record)
        except Exception:
            source.unlink(missing_ok=True)
            directory.rmdir()
            raise
        threading.Thread(target=self.run, args=(record, source), daemon=True).start()
        return record

    def run(self, record, source):
        directory = source.parent
        record = dict(record)
        with _slots:
            try:
                record['status'] = 'analyzing'
                atomic(directory / 'job.json', record)
                command = [self.python(), '-B', str(self.app / 'crescendo-engine/scripts/worker.py'),
                           str(source), str(directory / 'result'), record['title'], str(record['fps']), str(record['offset'])]
                with (directory / 'analysis.log').open('w') as log:
                    result = subprocess.run(command, stdout=log, stderr=log, timeout=1800)
                if result.returncode:
                    raise ValueError('Audio could not be analyzed. Check the format or run Set Up Crescendo.command. Details are in this analysis’s local analysis.log.')
                beat_map = json.loads((directory / 'result/beat-map.json').read_text())
                record.update(status='ready', duration=beat_map['source']['duration_seconds'],
                              beats=len(beat_map['beats']), source_sha256=beat_map['source']['sha256'])
            except subprocess.TimeoutExpired:
                record.update(status='failed', error='Analysis exceeded 30 minutes. Try a shorter recording.')
            except Exception as error:
                record.update(status='failed', error=str(error))
            atomic(directory / 'job.json', record)

    def review(self, job_id):
        path = self.directory(job_id) / 'review.json'
        return json.loads(path.read_text()) if path.exists() else {'saved_revision': 0, 'map': None}

    def favorite_source(self, job_id):
        if self.read(job_id)['status'] != 'ready':
            raise ValueError('Analysis is not ready.')
        return json.loads((self.directory(job_id) / 'result/beat-map.json').read_text())

    def favorites(self, job_id):
        original = self.favorite_source(job_id)
        path = self.directory(job_id) / 'favorites.json'
        if not path.exists():
            return {'schema_version': 1, 'source_sha256': original['source']['sha256'],
                    'revision': 0, 'moments': []}
        saved = json.loads(path.read_text())
        if (saved.get('schema_version') != 1 or saved.get('source_sha256') != original['source']['sha256']
                or type(saved.get('revision')) is not int or not isinstance(saved.get('moments'), list)):
            raise ValueError('Saved favorites do not match this recording. Keep the saved file for recovery.')
        return saved

    def save_favorite(self, job_id, request):
        # Set one moment at a time so different windows cannot overwrite one another's lists.
        with _lock:
            original = self.favorite_source(job_id)
            if request.get('source_sha256') != original['source']['sha256']:
                raise ValueError('Favorite must match this recording.')
            key, wanted = request.get('cue_id'), request.get('favorite')
            if not isinstance(key, str) or type(wanted) is not bool:
                raise ValueError('Choose a moment and whether to favorite it.')
            dynamics = original.get('dynamics', {})
            cues = [cue for group in ('swells', 'impacts', 'breaks') for cue in dynamics.get(group, [])]
            cue = next((cue for cue in cues if moment_id(cue) == key), None)
            if cue is None:
                raise ValueError('This moment is not in the recording analysis.')
            saved = self.favorites(job_id)
            present = any(moment['id'] == key for moment in saved['moments'])
            if wanted == present:
                return saved
            moments = [moment for moment in saved['moments'] if moment['id'] != key]
            if wanted:
                moments.append({**cue, 'id': key, 'favorited_at': time.time()})
            moments.sort(key=lambda moment: (moment.get('start_seconds', moment['seconds']), moment['id']))
            result = {**saved, 'revision': saved['revision'] + 1, 'moments': moments}
            atomic(self.directory(job_id) / 'favorites.json', result)
            return result

    def save_review(self, job_id, request):
        directory = self.directory(job_id)
        if self.read(job_id)['status'] != 'ready':
            raise ValueError('Analysis is not ready.')
        original = json.loads((directory / 'result/beat-map.json').read_text())
        value = request.get('map')
        if not isinstance(value, dict) or value.get('source') != original['source'] or value.get('timing') != original['timing'] or value.get('schema_version') != original['schema_version']:
            raise ValueError('Review must match this recording and its timing.')
        beats = value.get('beats')
        if not isinstance(beats, list) or len(beats) > 100000:
            raise ValueError('Invalid beat map')
        ids, previous = set(), -1
        for beat in beats:
            if not isinstance(beat, dict):
                raise ValueError('Invalid beat')
            bid, seconds = beat.get('id'), beat.get('seconds')
            if not isinstance(bid, str) or not bid or bid in ids or type(seconds) not in (float, int) or not math.isfinite(seconds) or not 0 <= seconds < original['source']['duration_seconds'] or seconds < previous or beat.get('status') not in ('uncertain', 'confirmed'):
                raise ValueError('Invalid beat identity, time, ordering, or review status')
            confidence = beat.get('confidence')
            if not isinstance(beat.get('provenance'), str) or not beat['provenance'] or type(beat.get('manual_override')) is not bool or (confidence is not None and (type(confidence) not in (float, int) or not math.isfinite(confidence) or not 0 <= confidence <= 1)):
                raise ValueError('Invalid beat metadata')
            fps, offset = original['timing']['fps'], original['timing']['film_offset_seconds']
            beat.update(song_frame=math.floor(seconds * fps + .5), film_seconds=seconds + offset,
                        film_frame=math.floor((seconds + offset) * fps + .5))
            ids.add(bid)
            previous = seconds
        if not isinstance(value.get('manual_history'), list) or type(value.get('revision')) is not int or value['revision'] < 0:
            raise ValueError('Invalid review history')
        # Analysis evidence and recording provenance cannot be rewritten by a review.
        merged = {**original, **{k: value[k] for k in ('beats', 'manual_history', 'revision')}}
        with _lock:
            old = self.review(job_id)
            if request.get('saved_revision') != old['saved_revision']:
                raise ReviewConflict('This review changed in another window. Export your JSON before reloading to compare the saved review.')
            saved = {'saved_revision': old['saved_revision'] + 1, 'map': merged}
            if old['map'] is not None:
                history = directory / 'review-history'
                history.mkdir(exist_ok=True)
                atomic(history / (str(old['saved_revision']) + '.json'), old)
            atomic(directory / 'review.json', saved)
            return {'saved_revision': saved['saved_revision']}
