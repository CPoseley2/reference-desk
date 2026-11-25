"""Narrow HTTP routes for audio jobs, review saves, and ranged local playback."""
import json
import mimetypes
import re
import urllib.parse
from crescendo_store import CrescendoStore, ReviewConflict, FILES, MAX_AUDIO


def store(handler):
    return CrescendoStore(handler.server.app_root, handler.store.dir, handler.server.instance_id)


def get(handler, path):
    if path == '/api/crescendo':
        handler.reply(200, {**store(handler).listing(), 'csrf_token': handler.store.token})
        return True
    favorite = re.fullmatch(r'/api/crescendo/([a-f0-9]{32})/favorites', path)
    if favorite:
        try:
            handler.reply(200, store(handler).favorites(favorite[1]))
        except FileNotFoundError:
            handler.reply(404, {'error': 'Analysis not found'})
        except (ValueError, KeyError, TypeError):
            handler.reply(409, {'error': 'Saved favorites could not be loaded for this recording.'})
        except OSError:
            handler.reply(500, {'error': 'Could not read saved favorites. Try again.'})
        return True
    match = re.fullmatch(r'/crescendo/([a-f0-9]{32})/([^/]+)', path)
    if not match:
        return False
    job_id, filename = match.groups()
    if filename not in FILES:
        handler.reply(404, {'error': 'Not found'})
        return True
    try:
        current = store(handler)
        if current.read(job_id)['status'] != 'ready':
            raise FileNotFoundError()
        file = current.directory(job_id) / 'result' / filename
        if filename == 'index.html':
            review = json.dumps(current.review(job_id), ensure_ascii=False).replace('<', '\\u003c')
            html = file.read_text()
            if '../../storyboard.html' not in html:
                html = html.replace('<a data-desk-leave href="../../crescendo.html"', '<a data-desk-leave href="../../storyboard.html">Storyboards</a><a data-desk-leave href="../../crescendo.html"', 1)
            data = html.replace('const DESK_REVIEW={"saved_revision":0,"map":null};', 'const DESK_REVIEW=' + review + ';').encode()
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/html; charset=utf-8')
            handler.send_header('Content-Length', str(len(data)))
            handler.send_header('Cache-Control', 'no-store')
            handler.send_header('X-Frame-Options', 'SAMEORIGIN')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.end_headers()
            handler.write_bytes(data)
        else:
            send_media(handler, file)
    except (FileNotFoundError, ValueError):
        handler.reply(404, {'error': 'Analysis not found'})
    return True


def post(handler, path):
    match = re.fullmatch(r'/api/crescendo/([a-f0-9]{32})/(review|favorites)', path)
    if path != '/api/crescendo' and not match:
        return False
    if not handler.hostok() or handler.headers.get('Origin') != handler.server.origin or handler.headers.get('X-DESK-CSRF') != handler.store.token:
        handler.reply(403, {'error': 'Same-origin library token required'})
        return True
    try:
        size = int(handler.headers.get('Content-Length', '0'))
        if not 0 < size <= (4 * 1024 * 1024 if match else MAX_AUDIO):
            handler.reply(413, {'error': 'Invalid payload size'})
            return True
        if match:
            if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                handler.reply(415, {'error': 'JSON required'})
                return True
            request = json.loads(handler.rfile.read(size))
            if not isinstance(request, dict):
                raise ValueError('Review must be an object')
            current = store(handler)
            result = current.save_favorite(match[1], request) if match[2] == 'favorites' else current.save_review(match[1], request)
            handler.reply(200, result)
        else:
            query = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(handler.path).query))
            handler.reply(202, store(handler).submit(handler.rfile, size, query))
    except ReviewConflict as error:
        handler.reply(409, {'error': str(error)})
    except FileNotFoundError:
        handler.reply(404, {'error': 'Analysis not found'})
    except (ValueError, TypeError, KeyError) as error:
        handler.reply(400, {'error': str(error)})
    except OSError:
        handler.reply(500, {'error': 'Could not save Crescendo data. Keep this page open and try again.'})
    return True


def send_media(handler, path):
    size = path.stat().st_size
    start, end, status = 0, size - 1, 200
    requested = handler.headers.get('Range')
    if requested:
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
        try:
            if not match or not any(match.groups()):
                raise ValueError()
            a, b = match.groups()
            if a:
                start, end = int(a), min(int(b), size - 1) if b else size - 1
            else:
                start = max(0, size - int(b))
            if not 0 <= start <= end < size:
                raise ValueError()
            status = 206
        except ValueError:
            handler.send_response(416)
            handler.send_header('Content-Range', 'bytes */' + str(size))
            handler.send_header('Content-Length', '0')
            handler.end_headers()
            return
    handler.send_response(status)
    handler.send_header('Content-Type', mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
    handler.send_header('Accept-Ranges', 'bytes')
    handler.send_header('Content-Length', str(end - start + 1))
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    if status == 206:
        handler.send_header('Content-Range', f'bytes {start}-{end}/{size}')
    handler.end_headers()
    with path.open('rb') as source:
        source.seek(start)
        remaining = end - start + 1
        while remaining:
            data = source.read(min(1024 * 1024, remaining))
            if not data:
                break
            handler.write_bytes(data)
            remaining -= len(data)
