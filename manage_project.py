#!/usr/bin/env python3
"""Populate a new desk locally. Stop this desk before editing its catalog."""
import argparse
import json
import re
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def add_character(manifest, name, group='Characters', description='', age=None):
    for label, value, limit in [('Name', name, 140), ('Group', group, 100), ('Description', description, 3000)]:
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f'{label} must be text of at most {limit} characters.')
    if age is not None and (type(age) is not int or age < 0):
        raise ValueError('Age must be a nonnegative whole number or left blank.')
    name, group, description = name.strip(), group.strip(), description.strip()
    if not name.strip() or not group.strip():
        raise ValueError('Character and group names must not be blank.')
    if any(c['name'].casefold() == name.strip().casefold() for c in manifest['characters']):
        raise ValueError('A character with that name already exists.')
    def slug(text):
        return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'entry'
    gid = next((g['id'] for g in manifest['groups'] if g['label'].casefold() == group.casefold()), None)
    if gid is None:
        gid = slug(group)
        if any(g['id'] == gid for g in manifest['groups']):
            gid += '-' + uuid.uuid4().hex[:8]
        manifest['groups'].append({'id': gid, 'label': group})
    cid = slug(name)
    if any(c['id'] == cid for c in manifest['characters']):
        cid += '-' + uuid.uuid4().hex[:8]
    from reference_catalog import KEYS, TYPES
    audit = {key: {'category': label, 'status': 'Missing', 'confirmed_ids': [],
                   'candidate_ids': [], 'obsolete_ids': []} for key, label in zip(KEYS, TYPES)}
    audit.update(classification='Character', identity_anchor_ids=[], identity_state='Missing')
    character = dict(id=cid, name=name.strip(), group=gid, description=description, role='',
                     scope='Project roster', kind='character', aliases=[], notes=[],
                     age_note=f'User-specified design age: {age}' if age is not None else 'Age not recorded.',
                     candidate_ids=[], roster_sources=[], missing_reference_types=list(TYPES),
                     prompt_reference_pair={}, reference_audit=audit, looks=[],
                     proposed_reference_briefs='', proposed_reference_briefs_file='',
                     look_catalogue_text_file='')
    manifest['characters'].append(character)
    manifest['audit'].update(season1_entries=len(manifest['characters']),
                             roster_entries=len(manifest['characters']), family_sections=len(manifest['groups']))
    return character

def write_catalog(root, manifest):
    for name, content in [('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2)+'\n'),
                          ('data.js', 'window.DESK_DATA = '+json.dumps(manifest, ensure_ascii=False)+';\n')]:
        temp = root / ('.' + name + '.tmp')
        temp.write_text(content)
        temp.replace(root/name)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--name', help='Project display name')
    p.add_argument('--library', help='Library ID (required after upgrading to multiple libraries)')
    p.add_argument('--story-year', type=int, help='Optional year for birth-year estimates')
    p.add_argument('--add-character', metavar='NAME')
    p.add_argument('--group', default='Characters')
    p.add_argument('--description', default='')
    p.add_argument('--age', type=int)
    a = p.parse_args()
    if not any([a.name, a.story_year is not None, a.add_character]):
        p.error('Supply --name, --story-year, or --add-character.')
    if a.age is not None and a.age < 0:
        p.error('Age must be nonnegative.')
    from launch_review import health
    if health():
        p.error('Stop this Reference Desk before changing its catalog, then restart it.')
    registry_path = ROOT/'.state/libraries.json'
    registry = json.loads(registry_path.read_text()) if registry_path.exists() else None
    target = ROOT
    record = None
    if registry:
        record = next((r for r in registry['libraries'] if r['id'] == a.library), None)
        if record is None:
            p.error('Choose --library ID from: ' + ', '.join(r['id']+' ('+r['name']+')' for r in registry['libraries']))
        target = ROOT/'libraries'/record['id']
    m = json.loads((target/'manifest.json').read_text())
    if a.name:
        if registry and any(r['id'] != record['id'] and r['name'].casefold() == a.name.strip().casefold() for r in registry['libraries']):
            p.error('A library with that name already exists.')
        m['project']['name'] = a.name
        m['review_defaults']['character'] = a.name
    if a.story_year is not None:
        m['project']['story_year'] = a.story_year
    if a.add_character:
        add_character(m, a.add_character, a.group, a.description, a.age)
    write_catalog(target, m)
    if registry and a.name:
        from library_store import atomic_json
        record['name'] = a.name
        atomic_json(registry_path, registry)
    print('Project updated. Start Reference Desk to view it.')

if __name__ == '__main__':
    main()
