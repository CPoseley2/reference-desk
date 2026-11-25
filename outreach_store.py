"""Library-scoped outreach records, optimistic edits, history, and CSV interchange."""
import csv
import fcntl
import hashlib
import io
import json
import re
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from library_store import atomic_json

STATUSES = ['Not started', 'Research needed', 'Contacted', 'Follow-up', 'Replied',
            'Meeting scheduled', 'In discussion', 'Partner', 'Not a fit', 'Do not contact']
PRIORITIES = ['High', 'Normal', 'Low']
KINDS = ['Email', 'Call', 'Meeting', 'Reply', 'Note']
CSV_FIELDS = {
    'Theater or organization': 'name', 'City or service area': 'city', 'County': 'county',
    'Geographic scope': 'scope', 'Organization type': 'category', 'Contact name': 'contact',
    'Contact title': 'title', 'Email': 'email', 'Contact route type': 'contact_route',
    'Phone': 'phone', 'Organization status': 'organization_status',
    'Suggested outreach priority': 'research_priority', 'Next action': 'next_action',
    'Prior outreach status': 'prior_outreach', 'Last outreach date': 'last_contact',
    'Outreach thread URL': 'thread_url', 'Research checked date': 'checked_date',
    'Contact source URL': 'contact_source', 'Leadership source URL': 'leadership_source',
    'Notes': 'research_notes',
}
EXTRA_FIELDS = {'Outreach stage': 'stage', 'Priority': 'priority', 'Owner': 'owner',
                'Next follow-up': 'follow_up', 'Working notes': 'notes', 'Website': 'website',
                'Additional contacts': 'contacts'}
EXTRA_FIELDS.update({
    'Exterior image URL': 'exterior_image', 'Interior image URL': 'interior_image',
    'Seating plan image URL': 'seating_image', 'Seating plan URL': 'seating_plan_url',
    'Exterior image source': 'exterior_source', 'Interior image source': 'interior_source',
    'Seating plan source': 'seating_source', 'Venue source URL': 'venue_source',
    'Venue checked date': 'venue_checked_date', 'Venue notes': 'venue_notes',
    'Seating capacity': 'capacity', 'Stage dimensions': 'stage_dimensions',
})
FIELDS = set(CSV_FIELDS.values()) | set(EXTRA_FIELDS.values())
DATE_FIELDS = {'last_contact', 'checked_date', 'follow_up', 'venue_checked_date'}
URL_FIELDS = {'thread_url', 'contact_source', 'leadership_source', 'website', 'exterior_image', 'interior_image',
              'seating_image', 'seating_plan_url', 'exterior_source', 'interior_source',
              'seating_source', 'venue_source'}


def now():
    return datetime.now(timezone.utc).isoformat()


def validate_fields(fields):
    if not isinstance(fields, dict) or set(fields) - FIELDS:
        raise ValueError('Unknown outreach field')
    for key, value in fields.items():
        if key == 'contacts':
            if not isinstance(value, list) or len(value) > 100:
                raise ValueError('Use a list of up to 100 additional contacts')
            ids = set()
            for contact in value:
                if not isinstance(contact, dict) or set(contact) != {'id', 'name', 'title', 'email', 'phone', 'notes'}:
                    raise ValueError('Invalid additional contact')
                if not isinstance(contact['id'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', contact['id']) or contact['id'] in ids:
                    raise ValueError('Each contact needs a unique ID')
                ids.add(contact['id'])
                validate_fields({'name': contact['name'], 'title': contact['title'],
                                 'email': contact['email'], 'phone': contact['phone'], 'notes': contact['notes']})
            continue
        if not isinstance(value, str) or len(value) > (20000 if 'notes' in key else 2000):
            raise ValueError('Invalid or oversized field: ' + key)
        if key in DATE_FIELDS and value:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
                raise ValueError('Use YYYY-MM-DD for ' + key)
            date.fromisoformat(value)
        if key in URL_FIELDS and value:
            parsed = urlsplit(value)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc:
                raise ValueError('Use a full http(s) URL for ' + key)
        if key == 'email' and value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter one valid email address')
    if 'name' in fields and not fields['name'].strip():
        raise ValueError('Theater name is required')
    if 'stage' in fields and fields['stage'] not in STATUSES:
        raise ValueError('Choose an outreach stage')
    if 'priority' in fields and fields['priority'] not in PRIORITIES:
        raise ValueError('Choose a priority')


class Conflict(Exception):
    def __init__(self, record):
        super().__init__('This record changed in another window. Your draft is still here; review the saved record before retrying.')
        self.record = record


class OutreachStore:
    def __init__(self, state_dir):
        self.directory = Path(state_dir)
        self.file = self.directory / 'outreach.json'

    @contextmanager
    def locked(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        with (self.directory / 'outreach.lock').open('a') as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            yield

    def read(self):
        if not self.file.exists():
            return {'schema': 'desk.outreach', 'version': 1, 'revision': 0,
                    'records': [], 'imports': [], 'requests': {}}
        state = json.loads(self.file.read_text())
        if state.get('schema') != 'desk.outreach' or state.get('version') != 1:
            raise ValueError('Outreach file version is not supported')
        return state

    def public(self):
        with self.locked():
            state = self.read()
            return {k: v for k, v in state.items() if k != 'requests'}

    def write(self, old, new):
        if old['revision']:
            atomic_json(self.directory / 'outreach-history' / ('revision-%08d.json' % old['revision']), old)
        new['revision'] = old['revision'] + 1
        new['saved_at'] = now()
        atomic_json(self.file, new)

    def mutate(self, request):
        if not isinstance(request, dict):
            raise ValueError('Request must be an object')
        rid = request.get('request_id')
        if not isinstance(rid, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,100}', rid):
            raise ValueError('A stable request ID is required')
        fingerprint = hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()
        with self.locked():
            old = self.read()
            state = json.loads(json.dumps(old))
            previous = state['requests'].get(rid)
            if previous:
                if previous['hash'] != fingerprint:
                    raise ValueError('Request ID reused with different content')
                return next(r for r in state['records'] if r['id'] == previous['record_id'])
            action = request.get('action')
            if action == 'create':
                fields = request.get('fields', {})
                validate_fields(fields)
                if not fields.get('name', '').strip():
                    raise ValueError('Theater name is required')
                record = {key: '' for key in FIELDS}
                record.update(stage='Not started', priority='Normal', contacts=[])
                record.update(fields)
                record.update(id=uuid.uuid4().hex, revision=0, activities=[], created_at=now())
                state['records'].append(record)
            else:
                record = next((r for r in state['records'] if r['id'] == request.get('id')), None)
                if not record:
                    raise ValueError('Theater record not found')
                if type(request.get('base_revision')) is not int or record['revision'] != request['base_revision']:
                    raise Conflict(record)
                if action == 'update':
                    fields = request.get('fields')
                    validate_fields(fields)
                    record.update(fields)
                elif action == 'log':
                    activity = request.get('activity', {})
                    if not isinstance(activity, dict) or activity.get('kind') not in KINDS:
                        raise ValueError('Choose an activity type')
                    text = activity.get('text', '')
                    if not isinstance(text, str) or not text.strip() or len(text) > 20000:
                        raise ValueError('Add an activity note (up to 20,000 characters)')
                    when = activity.get('date', '')
                    validate_fields({'last_contact': when})
                    if not when:
                        raise ValueError('An activity date is required')
                    link = activity.get('url', '')
                    validate_fields({'thread_url': link})
                    record['activities'].append({'id': uuid.uuid4().hex, 'kind': activity['kind'],
                        'date': when, 'text': text.strip(), 'url': link, 'created_at': now()})
                    if request.get('update_last_contact') is True:
                        record['last_contact'] = max(record.get('last_contact', ''), when)
                else:
                    raise ValueError('Unknown outreach operation')
            record['revision'] += 1
            record['updated_at'] = now()
            state['requests'][rid] = {'hash': fingerprint, 'record_id': record['id']}
            # Retry receipts are deliberately retained so delayed retries cannot duplicate entries.
            self.write(old, state)
            return record

    def import_csv(self, path):
        raw = Path(path).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
        if not set(CSV_FIELDS).issubset(reader.fieldnames or []):
            raise ValueError('Expected the researched theater CSV columns')
        imported = list(reader)
        with self.locked():
            old = self.read()
            if any(i['sha256'] == digest for i in old['imports']):
                return {'imported': 0, 'already_imported': True}
            if old['records']:
                raise ValueError('Initial import requires an empty outreach tracker; existing edits are preserved')
            state = json.loads(json.dumps(old))
            for source in imported:
                record = {key: '' for key in FIELDS}
                record['contacts'] = []
                record.update({key: source[label] or '' for label, key in CSV_FIELDS.items()})
                record['stage'] = ('Do not contact' if record['organization_status'] == 'Closed' else
                                   'Contacted' if record['last_contact'] else
                                   'Research needed' if re.search(r'unverified|confirmation|not verified', record['organization_status']) else 'Not started')
                record['priority'] = ('High' if record['research_priority'].startswith(('1', '2')) else
                                      'Low' if record['research_priority'].startswith(('4', '5', '9')) else 'Normal')
                validate_fields(record)
                record.update(id=uuid.uuid5(uuid.NAMESPACE_URL, 'desk-theater:' + record['name']).hex,
                              revision=1, activities=[], created_at=now(), updated_at=now())
                if record['last_contact']:
                    record['activities'].append({'id': uuid.uuid4().hex, 'kind': 'Email',
                        'date': record['last_contact'], 'text': 'Imported producing/co-producing inquiry. ' + record['prior_outreach'] + ' as of ' + record['checked_date'] + '.',
                        'url': record['thread_url'], 'created_at': now()})
                state['records'].append(record)
            if len({r['id'] for r in state['records']}) != len(state['records']):
                raise ValueError('Duplicate theater names in import')
            state['imports'].append({'file': Path(path).name, 'sha256': digest, 'count': len(imported), 'imported_at': now()})
            archive = self.directory / 'outreach-sources'
            archive.mkdir(exist_ok=True)
            (archive / (digest + '.csv')).write_bytes(raw)
            self.write(old, state)
            return {'imported': len(imported), 'already_imported': False}

    def csv_export(self):
        state = self.public()
        fields = {**CSV_FIELDS, **EXTRA_FIELDS, 'Activity log': 'activity_log'}
        stream = io.StringIO(newline='')
        writer = csv.writer(stream)
        writer.writerow(fields)
        def safe(value):
            value = str(value or '')
            # Spreadsheet-safe export for user-entered notes/contact values.
            return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')) else value
        for record in state['records']:
            values = {**record, 'contacts': json.dumps(record.get('contacts') or [], ensure_ascii=False),
                      'activity_log': json.dumps(record['activities'], ensure_ascii=False)}
            writer.writerow([safe(values.get(k)) for k in fields.values()])
        return ('\ufeff' + stream.getvalue()).encode('utf-8')
