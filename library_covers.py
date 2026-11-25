"""Library card artwork, kept separate from reference catalogs and linked originals."""
import base64
import binascii
import fcntl
import json
import os
import re
import subprocess
import tempfile
import uuid
from pathlib import Path

MAX_IMAGE = 12 * 1024 * 1024
MAX_BODY = 17 * 1024 * 1024

class Conflict(ValueError):
    pass

def read(root):
    path = Path(root)/'.state/library-cover/cover.json'
    return json.loads(path.read_text()) if path.exists() else {'revision': None, 'filename': None}

def public(root, lid):
    record = read(root)
    return {'revision': record['revision'], 'url': '/api/libraries/'+lid+'/cover?v='+record['revision'] if record['filename'] else None}

def image_path(root):
    record = read(root)
    name = record.get('filename')
    if not name or not re.fullmatch(r'[a-f0-9]{32}\.jpg', name): return None
    return Path(root)/'.state/library-cover'/name

def decode(upload, directory):
    if not isinstance(upload, dict) or not isinstance(upload.get('data'), str):
        raise ValueError('Choose a PNG, JPEG, or WebP image.')
    if len(upload['data']) > MAX_IMAGE * 4 // 3 + 4: raise ValueError('Choose an image smaller than 12 MB.')
    try: raw = base64.b64decode(upload['data'], validate=True)
    except (ValueError, binascii.Error): raise ValueError('Invalid image data.')
    if not 0 < len(raw) <= MAX_IMAGE: raise ValueError('Choose an image smaller than 12 MB.')
    ext = '.png' if raw.startswith(b'\x89PNG\r\n\x1a\n') else '.jpg' if raw.startswith(b'\xff\xd8\xff') else '.webp' if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP' else None
    if ext is None: raise ValueError('Choose a PNG, JPEG, or WebP image.')
    src = directory/('upload'+ext); src.write_bytes(raw)
    try:
        result = subprocess.run(['/usr/bin/sips','-g','pixelWidth','-g','pixelHeight',str(src)],capture_output=True,text=True,timeout=15)
        sizes = {line.split(':')[0].strip():int(line.split(':')[1]) for line in result.stdout.splitlines() if 'pixelWidth:' in line or 'pixelHeight:' in line}
        w, h = sizes['pixelWidth'], sizes['pixelHeight']
        if result.returncode or min(w,h) < 1 or max(w,h) > 30000 or w*h > 40000000: raise ValueError()
        out = directory/'cover.jpg'
        subprocess.run(['/usr/bin/sips','-s','format','jpeg','-s','formatOptions','85','-Z','1600',str(src),'--out',str(out)],capture_output=True,check=True,timeout=25)
        data = out.read_bytes()
        if not data.startswith(b'\xff\xd8\xff'): raise ValueError()
        return data
    except (ValueError, KeyError, subprocess.SubprocessError):
        raise ValueError('This image could not be read or is too large. Choose a PNG, JPEG, or WebP up to 40 megapixels.')

def mutate(root, request):
    from library_store import atomic_json
    if not isinstance(request, dict) or request.get('action') not in ('set', 'remove'):
        raise ValueError('Choose an image or remove the existing cover.')
    if 'base_revision' not in request: raise ValueError('Reload the library list before changing its cover.')
    folder = Path(root)/'.state/library-cover'; folder.mkdir(parents=True, exist_ok=True)
    with (folder/'write.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = read(root)
        if current['revision'] != request['base_revision']:
            raise Conflict('The cover changed in another window. Close this dialog and reopen it to see the latest cover.')
        revision = uuid.uuid4().hex
        filename = None
        if request['action'] == 'set':
            with tempfile.TemporaryDirectory(prefix='.upload-', dir=folder) as temp:
                data = decode(request.get('upload'), Path(temp))
                filename = revision+'.jpg'
                staged = Path(temp)/'saved.jpg'
                with staged.open('xb') as stream:
                    stream.write(data); stream.flush(); os.fsync(stream.fileno())
                os.replace(staged, folder/filename)
        # Old versions remain private, so removing a cover never deletes a source image.
        atomic_json(folder/'cover.json', {'revision': revision, 'filename': filename})
