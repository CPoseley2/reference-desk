"""Independent on-disk libraries, with one shared application installation."""
import copy
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

from location_catalog import slot_definitions

DATA_FILES = ('manifest.json', 'data.js', 'looks.json', 'roster.json', 'roster.csv',
              'reference-manifest.csv', 'reference-audit.csv', 'looks-audit.csv',
              'location-story-structure.js', 'exploration-actions.js', 'requested-revisions.html')
DATA_DIRS = ('assets', 'thumbs', 'sources', 'prompts', 'catalog-history', 'generation-records', 'reports', 'backups')

def empty_manifest(name='My Library', library_id=None):
    return {
        'schema_version': 1, 'created': time.strftime('%Y-%m-%d'), 'library_id': library_id,
        'project': {'name': name, 'story_year': None},
        **{key: [] for key in ('groups', 'characters', 'relationships', 'sources', 'metadata_sources', 'assets', 'locations', 'journey_groups')},
        'location_slots': slot_definitions(), 'location_order': {},
        'audit': {'season1_entries': 0, 'roster_entries': 0, 'family_sections': 0,
                  'scanned_image_files': 0, 'indexed_unique_images': 0, 'review_records': 0,
                  'indexed_provenance_paths': 0, 'unresolved_image_ids': []},
        'looks_audit': {}, 'look_requirements': {},
        'policy': {'coverage': 'Add project characters, locations, and sources to build this library.',
                   'approval': 'Only explicit approval of an exact image version marks it approved. Generation, rankings, and working selections do not confer approval.',
                   'deduplication': 'Images are deduplicated by SHA-256 within this library.',
                   'scene_prompt': 'Use selected character, costume, expression, and location references appropriate to the scene.'},
        'review_storage_key': 'desk-s1-character-index-review-v1',
        'review_defaults': {'schema': 'desk.character-choices', 'version': 1, 'collection': 'reference-desk',
                            'library_id': library_id, 'character': name, 'items': [], 'character_roles': {},
                            'character_rankings': {}, 'collection_reviews': {}, 'canonical_references': {},
                            'reference_approvals': {}, 'canon_history': []}
    }

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        with tmp.open('x') as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists(): tmp.unlink()

def write_seed(root, manifest):
    atomic_json(root/'manifest.json', manifest)
    (root/'data.js').write_text('window.DESK_DATA = ' + json.dumps(manifest, ensure_ascii=False) + ';\n')

class LibraryRegistry:
    def __init__(self, app_root, state_dir):
        self.app_root = Path(app_root).resolve()
        self.state_dir = Path(state_dir).resolve()
        self.root = self.app_root/'libraries'
        self.root.mkdir(exist_ok=True)
        self.file = self.state_dir/'libraries.json'
        self.lock = threading.RLock()
        self.contexts = {}
        if not self.file.exists():
            self._initialize()
        self.catalog = json.loads(self.file.read_text())
        # Complete archival if a process was stopped immediately after migration commit.
        if self.catalog.get('migrated_legacy'):
            self._archive_legacy()

    def _initialize(self):
        self.state_dir.mkdir(parents=True, exist_ok=True)
        lid = uuid.uuid4().hex
        legacy = (self.app_root/'manifest.json').exists()
        m = json.loads((self.app_root/'manifest.json').read_text()) if legacy else empty_manifest()
        name = m.get('project', {}).get('name') or 'My Library'
        if name == 'Reference Desk': name = 'My Library'
        stage = self.root/('.new-' + lid)
        stage.mkdir()
        if legacy:
            for name_ in DATA_FILES:
                source = self.app_root/name_
                if source.is_file(): shutil.copy2(source, stage/name_)
            for name_ in DATA_DIRS:
                source = self.app_root/name_
                if source.is_dir(): shutil.copytree(source, stage/name_)
            (stage/'.state').mkdir()
            for name_ in ('review-state.json', 'history', 'image-generation-jobs'):
                source = self.state_dir/name_
                if source.is_dir(): shutil.copytree(source, stage/'.state'/name_)
                elif source.is_file(): shutil.copy2(source, stage/'.state'/name_)
        m['library_id'] = lid
        m.setdefault('project', {})['name'] = name
        if not legacy:
            m['review_defaults']['library_id'] = lid
            m['review_defaults']['character'] = name
        # Existing review decisions and their checksums are preserved byte-for-byte.
        write_seed(stage, m)
        self._resources(stage)
        stage.rename(self.root/lid)
        atomic_json(self.file, {'version': 1, 'default_library_id': lid, 'migrated_legacy': legacy,
                               'libraries': [{'id': lid, 'name': name, 'created_at': time.time()}]})

    def _resources(self, root):
        for name in ('exploration-actions.js', 'location-story-structure.js', 'requested-revisions.html'):
            if not (root/name).exists(): shutil.copy2(self.app_root/'library-templates'/name, root/name)
        for name in ('assets', 'thumbs', 'sources', 'prompts'):
            (root/name).mkdir(exist_ok=True)

    def _archive_legacy(self):
        backup = self.state_dir/'legacy-library-backup'
        backup.mkdir(exist_ok=True)
        for name in DATA_FILES + DATA_DIRS:
            source = self.app_root/name
            if source.exists() and not (backup/name).exists(): shutil.move(str(source), str(backup/name))
        state_backup = backup/'.state'
        state_backup.mkdir(exist_ok=True)
        for name in ('review-state.json', 'director-reference-manifest.json', 'history', 'image-generation-jobs', 'catalog-write.lock'):
            source = self.state_dir/name
            if source.exists() and not (state_backup/name).exists(): shutil.move(str(source), str(state_backup/name))

    def lookup(self, lid):
        if not isinstance(lid, str) or not re.fullmatch('[a-f0-9]{32}', lid): raise KeyError('Unknown library')
        record = next((item for item in self.catalog['libraries'] if item['id'] == lid), None)
        if record is None: raise KeyError('Unknown library')
        return record

    def context(self, lid):
        with self.lock:
            self.lookup(lid)
            if lid not in self.contexts:
                from local_review_server import Store
                from image_generation import Manager
                root = self.root/lid
                store = Store(root, root/'.state')
                store.api_state_dir = self.state_dir
                self.contexts[lid] = SimpleNamespace(store=store, generation=Manager(store))
            return self.contexts[lid]

    def list(self):
        with self.lock:
            result = []
            for record in self.catalog['libraries']:
                m = json.loads((self.root/record['id']/'manifest.json').read_text())
                result.append({**record, 'url': '/libraries/' + record['id'] + '/',
                               'characters': len(m['characters']), 'locations': len(m.get('locations', [])),
                               'images': len(m['assets']),
                               'linked_source_available': Path(record['linked_source_root']).is_dir() if record.get('linked_media') else None})
            return result

    def adopt_import(self, request):
        """Commit a fully prepared copy without ever opening the source for writing."""
        lid = request.get('import_id')
        if not isinstance(lid,str) or not re.fullmatch('[a-f0-9]{32}',lid):
            raise ValueError('Invalid import ID')
        with self.lock:
            existing = next((r for r in self.catalog['libraries'] if r['id']==lid),None)
            if existing: return {**existing,'url':'/libraries/'+lid+'/'}
            stage = self.root/('.import-'+lid)
            if not stage.is_dir() or stage.is_symlink(): raise ValueError('Prepared import not found')
            if any(p.is_symlink() for p in stage.rglob('*')): raise ValueError('Imports cannot contain filesystem links')
            receipt = json.loads((stage/'.state/import-receipt.json').read_text())
            if receipt.get('id')!=lid or receipt.get('image_files_copied')!=0: raise ValueError('Invalid import receipt')
            name = receipt['name']
            if not isinstance(name,str) or not name.strip() or len(name)>100: raise ValueError('Invalid library name')
            if any(r['name'].casefold()==name.casefold() for r in self.catalog['libraries']):
                raise ValueError('A library with this name already exists')
            from local_review_server import Store
            import linked_media
            manifest=json.loads((stage/'manifest.json').read_text())
            if manifest.get('library_id')!=lid: raise ValueError('Import library ID mismatch')
            spec=linked_media.config(stage)
            if not spec or spec['source_root']!=receipt['source_root']: raise ValueError('Import source mismatch')
            source=Path(spec['source_root'])
            if not source.is_absolute() or source.resolve()!=source or source.is_relative_to(self.app_root) or self.app_root.is_relative_to(source):
                raise ValueError('Linked source must be separate from the application')
            Store(stage,stage/'.state').read()
            record={'id':lid,'name':name,'created_at':receipt['created_at'],'linked_media':True,
                    'linked_source_root':str(source),'imported_review_revision':receipt['source_review_revision']}
            updated=copy.deepcopy(self.catalog);updated['libraries'].append(record)
            final=self.root/lid
            stage.rename(final)
            try: atomic_json(self.file,updated)
            except Exception:
                final.rename(stage)
                raise
            self.catalog=updated
            return {**record,'url':'/libraries/'+lid+'/'}

    def create(self, request):
        name = request.get('name')
        if not isinstance(name, str) or not name.strip() or len(name) > 100:
            raise ValueError('Enter a library name of up to 100 characters.')
        name = name.strip()
        token = str(uuid.UUID(request.get('request_id', '')))
        with self.lock:
            for old in self.catalog['libraries']:
                if old.get('request_id') == token:
                    if old['name'] != name: raise ValueError('This request was already used for another library name.')
                    return {**old, 'url': '/libraries/' + old['id'] + '/'}
            if any(x['name'].casefold() == name.casefold() for x in self.catalog['libraries']):
                raise ValueError('A library with this name already exists. Choose it from the library list or use another name.')
            lid = uuid.uuid4().hex
            stage = self.root/('.new-' + lid)
            stage.mkdir()
            write_seed(stage, empty_manifest(name, lid))
            self._resources(stage)
            stage.rename(self.root/lid)
            record = {'id': lid, 'name': name, 'created_at': time.time(), 'request_id': token}
            updated = copy.deepcopy(self.catalog)
            updated['libraries'].append(record)
            atomic_json(self.file, updated)
            self.catalog = updated
            return {**record, 'url': '/libraries/' + lid + '/'}
