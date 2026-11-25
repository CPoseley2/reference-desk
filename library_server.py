"""Route every library request to a fixed store; there is no global active library."""
import json
import os
import secrets
import re
import library_covers
import urllib.parse
import uuid
from http.server import ThreadingHTTPServer
from pathlib import Path

from library_store import LibraryRegistry
from local_review_server import Handler, MAX
from outreach_store import OutreachStore, Conflict as OutreachConflict, STATUSES, PRIORITIES, KINDS
import crescendo_routes
import storyboard_module

class LibraryHandler(Handler):
    @property
    def store(self):
        return self.library_context.store

    @property
    def generation(self):
        return self.library_context.generation

    def static_root(self, rel):
        if rel in self.server.shared_files or rel.startswith('ui-assets/'):
            return self.server.app_root
        return self.store.root

    def route_library(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        parts = path.split('/')
        if len(parts) < 4 or parts[1] != 'libraries': return False
        lid = parts[2]
        try:
            self.library_context = self.server.libraries.context(lid)
            self.library_record = self.server.libraries.lookup(lid)
        except (KeyError, ValueError):
            return False
        self.library_id = lid
        self.path = '/' + '/'.join(parts[3:]) + ('?' + parsed.query if parsed.query else '')
        return True

    def send_file(self, path):
        data = path.read_bytes()
        import mimetypes
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.write_bytes(data)

    def do_GET(self):
        if not self.hostok(): return self.reply(403, {'error': 'Invalid Host'})
        path = urllib.parse.urlsplit(self.path).path
        if path == '/api/health':
            return self.reply(200, {'service': 'desk.local-review', 'multi_library': True,
                                   'instance_id': self.server.instance_id, 'pid': os.getpid(),
                                   'asset_root': str(self.server.app_root)})
        if path == '/api/libraries':
            return self.reply(200, {'libraries': self.server.libraries.list(),
                                   'default_library_id': self.server.libraries.catalog['default_library_id'],
                                   'csrf_token': self.server.app_token})
        cover = re.fullmatch(r'/api/libraries/([a-f0-9]{32})/cover', path)
        if cover:
            try: self.server.libraries.lookup(cover[1])
            except KeyError: return self.reply(404, {'error': 'Library not found'})
            image = library_covers.image_path(self.server.libraries.root/cover[1])
            if image is None or not image.is_file(): return self.reply(404, {'error': 'No cover photo'})
            return self.send_file(image)
        if path in ('/', '/index.html'):
            return self.send_file(self.server.app_root/'app.html')
        if path in ('/library-manager.js', '/library-manager.css', '/style.css'):
            return self.send_file(self.server.app_root/path.lstrip('/'))
        if path.startswith('/ui-assets/'):
            p = (self.server.app_root/path.lstrip('/')).resolve()
            if p.is_relative_to(self.server.app_root/'ui-assets') and p.is_file(): return self.send_file(p)
            return self.reply(404, {'error': 'Not found'})
        if not self.route_library(): return self.reply(404, {'error': 'Library not found'})
        local_path = urllib.parse.urlsplit(self.path).path
        if crescendo_routes.get(self, local_path): return
        if storyboard_module.get(self, local_path): return
        if local_path == '/api/outreach':
            return self.reply(200, {**OutreachStore(self.store.dir).public(), 'csrf_token': self.store.token,
                                   'stages': STATUSES, 'priorities': PRIORITIES, 'activity_kinds': KINDS})
        if local_path == '/api/outreach/export.csv':
            data = OutreachStore(self.store.dir).csv_export()
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.send_header('Content-Disposition', 'attachment; filename="theater-outreach.csv"')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return self.write_bytes(data)
        if urllib.parse.urlsplit(self.path).path == '/library-context.js':
            info = {'id': self.library_id, 'name': self.library_record['name'],
                    'base': '/libraries/' + self.library_id + '/',
                    'linked_media': self.library_record.get('linked_media', False),
                    'migrate_legacy_storage': self.server.libraries.catalog.get('migrated_legacy', False)
                        and self.library_id == self.server.libraries.catalog['default_library_id']}
            data = ('window.DESK_CONTEXT = ' + json.dumps(info) + ';').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/javascript')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            return self.write_bytes(data)
        return super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlsplit(self.path).path
        cover = re.fullmatch(r'/api/libraries/([a-f0-9]{32})/cover', path)
        if cover:
            if not self.hostok() or self.headers.get('Origin') != self.server.origin or self.headers.get('X-DESK-CSRF') != self.server.app_token:
                return self.reply(403, {'error': 'Same-origin application token required'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required'})
            try:
                self.server.libraries.lookup(cover[1])
            except KeyError: return self.reply(404, {'error': 'Library not found'})
            root = self.server.libraries.root/cover[1]
            try:
                n = int(self.headers.get('Content-Length', '0'))
                if not 0 < n <= library_covers.MAX_BODY: return self.reply(413, {'error': 'Choose an image smaller than 12 MB.'})
                library_covers.mutate(root, json.loads(self.rfile.read(n)))
                return self.reply(200, {'cover': library_covers.public(root, cover[1])})
            except library_covers.Conflict as error:
                return self.reply(409, {'error': str(error)})
            except (ValueError, TypeError) as error:
                return self.reply(400, {'error': str(error)})
            except OSError:
                return self.reply(500, {'error': 'Could not save the cover. Keep this dialog open and try again.'})
        if path in ('/api/libraries','/api/libraries/import'):
            if not self.hostok() or self.headers.get('Origin') != self.server.origin or self.headers.get('X-DESK-CSRF') != self.server.app_token:
                return self.reply(403, {'error': 'Same-origin application token required'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required'})
            try:
                n = int(self.headers.get('Content-Length', '0'))
                if not 0 < n <= MAX: return self.reply(413, {'error': 'Invalid payload size'})
                request = json.loads(self.rfile.read(n))
                if not isinstance(request, dict): raise ValueError('Request must be an object')
                operation = self.server.libraries.adopt_import if path.endswith('/import') else self.server.libraries.create
                return self.reply(201, {'library': operation(request)})
            except (ValueError, TypeError, AttributeError, OSError, KeyError) as error:
                return self.reply(400, {'error': str(error)})
        if not self.route_library(): return self.reply(404, {'error': 'Library not found'})
        if crescendo_routes.post(self, urllib.parse.urlsplit(self.path).path): return
        if storyboard_module.post(self, urllib.parse.urlsplit(self.path).path): return
        if urllib.parse.urlsplit(self.path).path == '/api/outreach':
            if not self.hostok() or self.headers.get('Origin') != self.server.origin or self.headers.get('X-DESK-CSRF') != self.store.token:
                return self.reply(403, {'error': 'Same-origin library token required'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required'})
            try:
                n = int(self.headers.get('Content-Length', '0'))
                if not 0 < n <= MAX: return self.reply(413, {'error': 'Invalid payload size'})
                record = OutreachStore(self.store.dir).mutate(json.loads(self.rfile.read(n)))
                return self.reply(200, {'record': record})
            except OutreachConflict as error:
                return self.reply(409, {'error': str(error), 'record': error.record})
            except (ValueError, TypeError, KeyError) as error:
                return self.reply(400, {'error': str(error)})
            except OSError:
                return self.reply(500, {'error': 'Could not save outreach. Keep this window open and retry.'})
        return super().do_POST()

def create_app_server(root, state, port):
    server = ThreadingHTTPServer(('127.0.0.1', port), LibraryHandler)
    server.app_root = Path(root).resolve()
    server.origin = 'http://127.0.0.1:' + str(server.server_port)
    server.instance_id = uuid.uuid4().hex
    server.app_token = secrets.token_urlsafe(32)
    server.shared_files = {p.name for p in server.app_root.iterdir()
                           if p.suffix in ('.js', '.css', '.html') and p.name not in
                           ('data.js', 'exploration-actions.js', 'location-story-structure.js', 'requested-revisions.html')}
    try:
        server.libraries = LibraryRegistry(root, state)
        # Initialize each persisted job queue once. Workers remain tied to their owning library.
        for record in server.libraries.catalog['libraries']:
            server.libraries.context(record['id'])
    except Exception:
        server.server_close()
        raise
    return server
