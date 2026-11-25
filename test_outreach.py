"""Outreach integration checks use disposable files; no production records are edited."""
import concurrent.futures
import csv
import io
import json
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from outreach_store import OutreachStore, Conflict, CSV_FIELDS
from library_server import create_app_server

SOURCE = Path(__file__).resolve().parent


class OutreachStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = OutreachStore(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def create(self, name='Example Theatre'):
        return self.store.mutate({'action': 'create', 'request_id': uuid.uuid4().hex,
                                  'fields': {'name': name, 'email': 'office@example.org'}})

    def test_import_references_once_and_preserve_user_edits(self):
        fixture = Path(self.tmp.name) / 'synthetic-outreach.csv'
        with fixture.open('w', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
            writer.writeheader()
            for i in range(8):
                row = dict.fromkeys(CSV_FIELDS, '')
                row.update({'Theater or organization': f'Example Theatre {i}',
                            'Email': f'office{i}@example.org' if i < 6 else '',
                            'Organization status': 'Closed' if i >= 6 else 'Active',
                            'Last outreach date': '2026-01-15' if i == 0 else '',
                            'Outreach thread URL': 'https://example.org/thread/example001' if i == 0 else '',
                            'Research checked date': '2026-02-01'})
                writer.writerow(row)
        self.assertEqual(self.store.import_csv(fixture)['imported'], 8)
        records = self.store.public()['records']
        venue = next(r for r in records if r['name'] == 'Example Theatre 0')
        self.assertEqual(venue['last_contact'], '2026-01-15')
        self.assertEqual(venue['activities'][0]['kind'], 'Email')
        self.assertIn('example001', venue['thread_url'])
        self.assertEqual(sum(r['stage'] == 'Do not contact' for r in records), 2)
        self.assertEqual(sum(bool(r['email']) for r in records), 6)
        self.store.mutate({'action': 'update', 'request_id': uuid.uuid4().hex, 'id': venue['id'],
                          'base_revision': 1, 'fields': {'notes': 'Call the coordinator on Tuesday', 'follow_up': '2026-11-10'}})
        self.assertTrue(self.store.import_csv(fixture)['already_imported'])
        reopened = OutreachStore(Path(self.tmp.name)).public()
        saved = next(r for r in reopened['records'] if r['id'] == venue['id'])
        self.assertEqual(saved['notes'], 'Call the coordinator on Tuesday')
        self.assertEqual(saved['checked_date'], '2026-02-01')
        self.assertTrue((Path(self.tmp.name) / 'outreach-history/revision-00000001.json').exists())

    def test_retry_logging_does_not_duplicate_and_backdated_activity_keeps_last_contact(self):
        r = self.create()
        payload = {'action': 'log', 'id': r['id'], 'base_revision': 1, 'request_id': uuid.uuid4().hex,
                   'activity': {'kind': 'Reply', 'date': '2026-11-07', 'text': 'Interested in a reading.'},
                   'update_last_contact': True}
        first = self.store.mutate(payload)
        self.assertEqual(self.store.mutate(payload), first)
        self.assertEqual(len(first['activities']), 1)
        older = {**payload, 'base_revision': 2, 'request_id': uuid.uuid4().hex,
                 'activity': {'kind': 'Email', 'date': '2026-10-22', 'text': 'Initial email'}}
        self.assertEqual(self.store.mutate(older)['last_contact'], '2026-11-07')
        with self.assertRaises(ValueError):
            self.store.mutate({**payload, 'activity': {**payload['activity'], 'text': 'Changed'}})

    def test_venue_resources_round_trip_and_reject_unsafe_urls(self):
        r = self.create()
        fields = {'exterior_image': 'https://example.org/exterior.jpg',
                  'interior_image': 'https://example.org/interior.webp',
                  'seating_image': 'https://example.org/seats.png',
                  'seating_plan_url': 'https://example.org/plan.pdf',
                  'venue_source': 'https://example.org/venue',
                  'venue_checked_date': '2026-11-07', 'capacity': '296',
                  'stage_dimensions': '30 x 30 ft', 'venue_notes': 'Verify current configuration.'}
        self.store.mutate({'action': 'update', 'id': r['id'], 'base_revision': r['revision'],
                          'request_id': uuid.uuid4().hex, 'fields': fields})
        saved = OutreachStore(self.store.directory).public()['records'][0]
        for key, value in fields.items(): self.assertEqual(saved[key], value)
        for key in ['exterior_image', 'interior_image', 'seating_image', 'seating_plan_url', 'venue_source']:
            with self.assertRaises(ValueError):
                self.store.mutate({'action': 'update', 'id': r['id'], 'base_revision': saved['revision'],
                                   'request_id': uuid.uuid4().hex, 'fields': {key: 'javascript:alert(1)'}})
        exported = list(csv.DictReader(io.StringIO(self.store.csv_export().decode('utf-8-sig'))))
        self.assertEqual(exported[0]['Seating plan URL'], fields['seating_plan_url'])

    def test_additional_contacts_persist_export_and_preserve_primary_contact(self):
        row = self.create()
        contacts = [dict(id=uuid.uuid4().hex, name=name, title='Booking', email='person@example.org',
                         phone='916-555-0100', notes='Ask about a reading.\nAvailable evenings.')
                    for name in ['First Person', 'Second Person']]
        payload = dict(action='update', request_id=uuid.uuid4().hex, id=row['id'],
                       base_revision=row['revision'], fields={'contacts': contacts})
        saved = self.store.mutate(payload)
        reopened = OutreachStore(self.store.directory).public()['records'][0]
        self.assertEqual(reopened['contacts'], contacts)
        self.assertEqual(reopened['email'], 'office@example.org')
        exported = list(csv.DictReader(io.StringIO(self.store.csv_export().decode('utf-8-sig'))))
        self.assertEqual(json.loads(exported[0]['Additional contacts']), contacts)
        with self.assertRaises(Conflict):
            self.store.mutate({**payload, 'request_id': uuid.uuid4().hex})
        for invalid in ['wrong', [{**contacts[0], 'name': ''}], [{**contacts[0], 'email': 'bad'}],
                        [contacts[0], contacts[0]], [{'name': 'Missing fields'}]]:
            with self.assertRaises(ValueError):
                self.store.mutate({**payload, 'request_id': uuid.uuid4().hex,
                                   'base_revision': saved['revision'], 'fields': {'contacts': invalid}})
        self.assertEqual(self.store.public()['records'][0]['contacts'], contacts)

    def test_parallel_records_save_and_stale_record_does_not_overwrite(self):
        a, b = self.create('A'), self.create('B')
        def save(r):
            return self.store.mutate({'action': 'update', 'id': r['id'], 'base_revision': 1,
                                     'request_id': uuid.uuid4().hex, 'fields': {'notes': r['name']}})
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            self.assertEqual(len(list(pool.map(save, [a, b]))), 2)
        with self.assertRaises(Conflict):
            save(a)
        self.assertEqual({r['notes'] for r in self.store.public()['records']}, {'A', 'B'})

    def test_validation_and_export_preserve_multiline_data_and_prevent_formula_cells(self):
        r = self.create()
        payload = {'action': 'update', 'request_id': uuid.uuid4().hex, 'id': r['id'], 'base_revision': 1}
        for fields in [{'website': 'javascript:alert(1)'}, {'follow_up': '2026-02-30'},
                       {'email': 'wrong'}, {'stage': 'Unknown'}, {'revision': '9'}]:
            with self.assertRaises(ValueError): self.store.mutate({**payload, 'fields': fields})
        note = '=SUM(A1:A9)\n"Quoted", next step'
        self.store.mutate({**payload, 'fields': {'notes': note}})
        exported = list(csv.DictReader(io.StringIO(self.store.csv_export().decode('utf-8-sig'))))
        self.assertEqual(exported[0]['Working notes'], "'" + note)
        self.assertEqual(self.store.public()['records'][0]['notes'], note)


class OutreachAPITests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'app'
        shutil.copytree(SOURCE, self.root, ignore=shutil.ignore_patterns('.git', 'docs', 'command-center', '.state', 'libraries', '__pycache__'))
        self.server = create_app_server(self.root, self.root / '.state', 0)
        self.worker = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.worker.start()
        self.lid = self.server.libraries.catalog['default_library_id']
        self.other = self.server.libraries.create({'name': 'Other Library', 'request_id': uuid.uuid4().hex})['id']
        self.token = self.server.libraries.context(self.lid).store.token

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join(); self.tmp.cleanup()

    def request(self, path, payload=None, token=None, origin=None):
        headers = {}
        if payload is not None:
            headers = {'Content-Type': 'application/json', 'Origin': origin or self.server.origin,
                       'X-DESK-CSRF': token or self.token}
        req = urllib.request.Request(self.server.origin + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req) as response: return response.status, response.read()
        except urllib.error.HTTPError as error: return error.code, error.read()

    def test_library_routes_tokens_conflicts_and_private_history(self):
        path = '/libraries/' + self.lid + '/api/outreach'
        other = '/libraries/' + self.other + '/api/outreach'
        payload = {'action': 'create', 'request_id': uuid.uuid4().hex, 'fields': {'name': 'API Theatre'}}
        self.assertEqual(self.request(other, payload)[0], 403)
        self.assertEqual(self.request(path, payload, origin='https://example.com')[0], 403)
        status, raw = self.request(path, payload)
        self.assertEqual(status, 200, raw)
        row = json.loads(raw)['record']
        update = {'action': 'update', 'request_id': uuid.uuid4().hex, 'id': row['id'], 'base_revision': 1, 'fields': {'notes': 'Persistent note'}}
        self.assertEqual(self.request(path, update)[0], 200)
        self.assertEqual(self.request(path, {**update, 'request_id': uuid.uuid4().hex})[0], 409)
        self.assertEqual(json.loads(self.request(other)[1])['records'], [])
        self.assertEqual(self.request('/libraries/' + self.lid + '/.state/outreach.json')[0], 404)
        self.assertIn(b'Persistent note', self.request(path + '/export.csv')[1])

    def test_new_page_and_navigation_assets_serve(self):
        base = '/libraries/' + self.lid + '/'
        for file in ['outreach.html', 'outreach.js', 'outreach.css', 'library-context.js']:
            status, raw = self.request(base + file)
            self.assertEqual(status, 200, raw[:100])
        self.assertIn(b'Theater outreach', self.request('/library-manager.js')[1])


if __name__ == '__main__':
    unittest.main()
