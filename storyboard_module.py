"""Connect the existing, separately stored Storyboard Command Center."""
import json
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

ORIGIN = 'http://127.0.0.1:8899'
LOCK = threading.Lock()


def config(root):
    path = Path(root) / '.state/storyboard-module.json'
    return json.loads(path.read_text()) if path.exists() else {}


def status(root):
    settings = config(root)
    try:
        with urllib.request.urlopen(ORIGIN + '/library-api/health', timeout=2) as response:
            data = json.load(response)
        if data.get('service') != 'owl-storyboard-library-v1':
            return {'online': False, 'error': 'Port 8899 is running a different service.'}
        if settings.get('root') and Path(data.get('root', '')).resolve() != Path(settings['root']).resolve():
            return {'online': False, 'error': 'Port 8899 is serving a different storyboard workspace.'}
        return {'online': True, 'url': ORIGIN + '/index.html'}
    except (OSError, ValueError):
        return {'online': False, 'error': 'Storyboard Command Center is offline.', 'configured': bool(settings.get('root'))}


def connect(root):
    with LOCK:
        result = status(root)
        if result['online'] or 'configured' not in result:
            return result
        settings = config(root)
        if not settings.get('root'):
            return {**result, 'error': 'Open your Storyboard Command Center launcher, then choose Reconnect.'}
        source = Path(settings['root']).resolve()
        python = Path(settings.get('python', '/usr/bin/python3'))
        if not (source / 'server.py').is_file() or not python.is_file():
            return {**result, 'error': 'The configured Storyboard Command Center folder or Python is unavailable.'}
        log = Path(root) / '.state/storyboard-service.log'
        with log.open('ab') as output:
            subprocess.Popen([str(python), '-B', str(source / 'server.py')], cwd=source,
                             stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=True)
        for _ in range(30):
            time.sleep(.15)
            result = status(root)
            if result['online'] or 'configured' not in result:
                return result
        return {**result, 'error': 'Storyboard Command Center could not start. Check its launcher and reconnect.'}


def get(handler, path):
    if path != '/api/storyboard':
        return False
    try:
        handler.reply(200, {**status(handler.server.app_root), 'csrf_token': handler.store.token})
    except (OSError, ValueError) as error:
        handler.reply(500, {'error': str(error)})
    return True


def post(handler, path):
    if path != '/api/storyboard/connect':
        return False
    if not handler.hostok() or handler.headers.get('Origin') != handler.server.origin or handler.headers.get('X-DESK-CSRF') != handler.store.token:
        handler.reply(403, {'error': 'Same-origin library token required'})
        return True
    try:
        result = connect(handler.server.app_root)
        handler.reply(200 if result['online'] else 503, result)
    except (OSError, ValueError) as error:
        handler.reply(500, {'error': str(error)})
    return True
