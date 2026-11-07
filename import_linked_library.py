#!/usr/bin/env python3
"""Import a compatible library snapshot; source files are opened read-only, images are never copied.

Prepare first, then register the staged library through the running app API. A
failed or interrupted preparation cannot become a visible half-imported library.
"""
import argparse
import copy
import hashlib
import json
import re
import shutil
import time
import urllib.request
import uuid
from pathlib import Path

from library_store import atomic_json, write_seed, empty_manifest
from linked_media import MEDIA_SUFFIXES, relative_path


def digest(raw): return hashlib.sha256(raw).hexdigest()


def normalize_choices(value, lid):
    value = copy.deepcopy(value)
    if value.get('schema') not in ('owl.character-choices', 'desk.character-choices'):
        raise ValueError('Unrecognized review choices schema')
    reviews=value.get('collection_reviews',{})
    if 'one-warm-line-s1' in reviews:
        if 'reference-desk' in reviews: raise ValueError('Conflicting global review namespaces')
        reviews['reference-desk']=reviews.pop('one-warm-line-s1')
    value.update(schema='desk.character-choices', collection='reference-desk', library_id=lid)
    return value


def prepare(app_root, source, review_file, name='Imported Library', progress=print):
    app_root, source, review_file = map(lambda p: Path(p).resolve(), (app_root, source, review_file))
    if source == app_root or source.is_relative_to(app_root) or app_root.is_relative_to(source):
        raise ValueError('The source must be separate from the new app')
    manifest_raw = (source/'manifest.json').read_bytes()
    state_raw = review_file.read_bytes()
    manifest, state = json.loads(manifest_raw), json.loads(state_raw)
    if state.get('schema') not in ('owl.local-review-state','desk.local-review-state'):
        raise ValueError('Unrecognized saved review state')
    if digest(json.dumps(state['choices'],sort_keys=True,separators=(',',':')).encode()) != state['payload_hash']:
        raise ValueError('Source review checksum mismatch; source left untouched')
    lid = uuid.uuid4().hex
    stage = app_root/'libraries'/('.import-'+lid)
    stage.mkdir(parents=True)
    original_snapshots = stage/'.state/import-source'
    original_snapshots.mkdir(parents=True)
    (original_snapshots/'manifest.json').write_bytes(manifest_raw)
    (original_snapshots/'review-state.json').write_bytes(state_raw)
    paths = set()
    def collect(value):
        if isinstance(value,dict):
            for child in value.values(): collect(child)
        elif isinstance(value,list):
            for child in value: collect(child)
        elif isinstance(value,str) and '/' in value and len(value)<1000 and '\n' not in value:
            try: relative_path(value)
            except ValueError: return
            if value.split('/')[0] in {'assets','thumbs','sources','prompts','generation-records','reports'}:
                path = source/value
                if not path.resolve().is_relative_to(source) or path.is_symlink():
                    raise ValueError('Source reference escapes its directory: '+value)
                if path.is_file(): paths.add(value)
    collect(manifest)
    # Every current image, thumbnail and saved older image version must exist.
    for asset in manifest['assets']:
        for version in [asset]+asset.get('previous_versions',[]):
            for field in ('asset','thumbnail'):
                if version.get(field) and version[field] not in paths:
                    raise ValueError('Required image is missing: '+version[field])
    files = {}; copied = {}; signatures = {}; linked_bytes = 0
    for i,relative in enumerate(sorted(paths)):
        path = source/relative; before = path.stat(); raw = path.read_bytes(); after = path.stat()
        signature = lambda s:(s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if signature(before) != signature(after): raise ValueError('Source changed during import: '+relative)
        signatures[relative] = signature(after)
        info = {'sha256':digest(raw),'bytes':len(raw)}
        if path.suffix.lower() in MEDIA_SUFFIXES:
            files[relative] = info; linked_bytes += len(raw)
        else:
            target = stage/relative; target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(raw)
            copied[relative] = info
        if (i+1)%1000 == 0: progress('Checked '+str(i+1)+' of '+str(len(paths))+' referenced files')
    # Confirm exact catalogue hashes for images used by review and generation.
    mismatches = []
    for asset in manifest['assets']:
        for version in [asset]+asset.get('previous_versions',[]):
            if files[version['asset']]['sha256'] != version['sha256']:
                if 'source SHA-256 retained' not in version.get('asset_encoding',asset.get('asset_encoding','')):
                    raise ValueError('Unexpected source image hash mismatch: '+version['asset'])
                # Legacy catalogs can retain TIFF source hashes for PNG conversions. Keep those
                # stable identities and record the separately verified on-disk bytes.
                version['file_sha256']=files[version['asset']]['sha256']
                mismatches.append({'id':asset['id'],'asset':version['asset'],'catalog_sha256':version['sha256'],'file_sha256':files[version['asset']]['sha256']})
    for name_ in ['looks.json','roster.json','roster.csv','reference-manifest.csv','reference-audit.csv','looks-audit.csv','missing-imagery-plan.json','missing-imagery-plan.csv','prompt-catalogue.json']:
        if (source/name_).is_file():
            raw=(source/name_).read_bytes();(stage/name_).write_bytes(raw);copied[name_]={'sha256':digest(raw),'bytes':len(raw)}
    for name_,symbol in [('exploration-actions.js','DESKExplorationActions'),('location-story-structure.js','DESK_STORY_STRUCTURE')]:
        raw=(source/name_).read_text()
        # These resources are JSON assignments; import their data, not executable source code.
        data=json.loads(raw.split('=',1)[1].strip().rstrip(';'))
        (stage/name_).write_text('window.'+symbol+' = '+json.dumps(data,ensure_ascii=False)+';\n')
    shutil.copy2(app_root/'library-templates/requested-revisions.html',stage/'requested-revisions.html')
    atomic_json(stage/'selection-schema.json',empty_manifest(name,lid)['review_defaults'])
    for character in manifest['characters']:
        if character.get('scope') == 'Season 1 roster':
            character['imported_scope'] = character['scope']
            character['scope'] = 'Project roster'
    manifest['library_id']=lid
    manifest.setdefault('project',{})['name']=name
    manifest['review_storage_key']='desk-s1-character-index-review-v1'
    # Seed from saved state, not potentially older manifest defaults.
    manifest['review_defaults']=normalize_choices(state['choices'],lid)
    write_seed(stage,manifest)
    state['schema']='desk.local-review-state'
    state['choices']=normalize_choices(state['choices'],lid)
    state['payload_hash']=digest(json.dumps(state['choices'],sort_keys=True,separators=(',',':')).encode())
    state['mutation_id']='linked-import-'+lid
    atomic_json(stage/'.state/review-state.json',state)
    atomic_json(stage/'.state/history'/('revision-%08d.json'%state['revision']),state)
    atomic_json(stage/'.state/linked-media.json',{'version':1,'mode':'read-only','source_root':str(source),'files':files})
    for folder in ['assets','thumbs','sources','prompts']:(stage/folder).mkdir(exist_ok=True)
    # Fail rather than import a mixture if the source was edited while we copied it.
    if (source/'manifest.json').read_bytes()!=manifest_raw or review_file.read_bytes()!=state_raw:
        raise ValueError('The source was edited during import. Prepared copy is not registered; retry with a stable snapshot.')
    for relative,expected in signatures.items():
        stat=(source/relative).stat()
        if (stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns)!=expected:
            raise ValueError('Original media or references changed during import: '+relative)
    receipt={'version':1,'id':lid,'name':name,'created_at':time.time(),'source_root':str(source),
             'source_review_file':str(review_file),'source_manifest_sha256':digest(manifest_raw),'source_review_sha256':digest(state_raw),
             'source_review_revision':state['revision'],'linked_files':len(files),'linked_bytes':linked_bytes,
             'copied_files':len(copied),'copied_reference_bytes':sum(x['bytes'] for x in copied.values()),
             'catalog_image_hash_mismatches':mismatches,'original_files_written':0,'image_files_copied':0,
             'characters':len(manifest['characters']),'locations':len(manifest.get('locations',[])),'images':len(manifest['assets'])}
    atomic_json(stage/'.state/import-receipt.json',receipt)
    atomic_json(stage/'.state/import-source/copied-file-checksums.json',copied)
    from local_review_server import Store
    Store(stage,stage/'.state').read()  # Validate all preserved choices before making the library visible.
    progress(json.dumps(receipt,indent=2))
    return receipt


def register(lid, url='http://127.0.0.1:8876'):
    with urllib.request.urlopen(url+'/api/libraries') as response: config=json.load(response)
    request=urllib.request.Request(url+'/api/libraries/import',data=json.dumps({'import_id':lid}).encode(),headers={'Origin':url,'Content-Type':'application/json','X-DESK-CSRF':config['csrf_token']})
    with urllib.request.urlopen(request,timeout=120) as response:return json.load(response)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source');parser.add_argument('--review-state');parser.add_argument('--name',default='Imported Library')
    parser.add_argument('--register',metavar='IMPORT_ID',help='Register an already prepared copy through the running app')
    args=parser.parse_args()
    if args.register: print(json.dumps(register(args.register),indent=2))
    elif args.source and args.review_state:prepare(Path(__file__).resolve().parent,args.source,args.review_state,args.name)
    else:parser.error('Use --source and --review-state to prepare, or --register IMPORT_ID')
