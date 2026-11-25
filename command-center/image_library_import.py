"""Add durable image candidates to one storyboard without changing its arrangement."""
import base64, binascii, hashlib, json, os, re, time, uuid
from pathlib import Path
MAX_BYTES = 20 * 1024 * 1024

def catalog_path(root, eid):
    if not isinstance(eid, str) or not re.fullmatch(r'[a-f0-9]{16}', eid):
        raise ValueError('Choose a valid storyboard.')
    path = root / 'image-libraries' / (eid + '.json')
    if not path.is_file(): raise ValueError('Storyboard image set was not found.')
    return path

def options(root, eid, query='', offset=0):
    from related_images import snapshot
    catalog = json.loads(catalog_path(root, eid).read_text())
    known = {a.get('sha256') for a in catalog['assets'] if not a.get('crop')}
    terms = str(query)[:300].lower().split()
    rows = [a for a in snapshot()[0] if not a.get('obsolete') and all(t in ' '.join([a['title'], *a.get('tags', []), *a.get('location_names', [])]).lower() for t in terms)]
    offset = max(0, min(int(offset), len(rows))); page = rows[offset:offset+40]
    return {'assets':[{k:a.get(k) for k in ('id','title','image','thumbnail','tags','sha256')} | {'added':a.get('sha256') in known} for a in page], 'total':len(rows), 'offset':offset, 'next_offset':offset+40 if offset+40<len(rows) else None}

def image_extension(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'): return '.png'
    if raw.startswith(b'\xff\xd8\xff'): return '.jpg'
    if raw.startswith(b'RIFF') and raw[8:12] == b'WEBP': return '.webp'
    raise ValueError('Choose a PNG, JPEG or WebP image.')

def validate_image(raw, ext):
    from final_cut_export import probe_bytes
    probe = probe_bytes(raw, ext)
    streams = [s for s in probe.get('streams', []) if s.get('codec_type') == 'video']
    if len(streams) != 1: raise ValueError('The file must contain one still image.')
    s = streams[0]
    if s.get('codec_name') not in ('png','mjpeg','webp') or s.get('nb_frames') not in (None, 'N/A', '1'):
        raise ValueError('Choose a still PNG, JPEG or WebP image.')
    width, height = s.get('width',0), s.get('height',0)
    if not (0 < width <= 20000 and 0 < height <= 20000 and width * height <= 100000000):
        raise ValueError('Image dimensions are unsupported.')
    return width, height

def add(root, data, atomic, desk_rows=None, validator=validate_image):
    path = catalog_path(root, data.get('id')); catalog = json.loads(path.read_text())
    desk = None
    if bool(data.get('desk_asset_id')) == bool(data.get('upload')):
        raise ValueError('Choose one image source.')
    if data.get('desk_asset_id'):
        if desk_rows is None:
            from related_images import snapshot
            desk_rows = snapshot()[0]
        desk = next((a for a in desk_rows if a['id'] == data['desk_asset_id'] and not a.get('obsolete')), None)
        if desk is None: raise ValueError('Reference Desk image is unavailable. Search again.')
        media = Path(desk['image'])
        if media.stat().st_size > MAX_BYTES: raise ValueError('Images must be 20 MB or smaller.')
        raw = media.read_bytes(); title = desk['title']; tags = desk.get('tags', [])
    else:
        upload = data['upload']
        if not isinstance(upload, dict) or not isinstance(upload.get('data'), str): raise ValueError('Choose an image file.')
        if len(upload['data']) > (MAX_BYTES+2)//3*4: raise ValueError('Images must be 20 MB or smaller.')
        try: raw = base64.b64decode(upload['data'], validate=True)
        except (ValueError, binascii.Error): raise ValueError('The uploaded image could not be read.')
        title = data.get('title') or Path(str(upload.get('name','Uploaded image'))).stem
        tags = data.get('tags', [])
    if not raw or len(raw)>MAX_BYTES: raise ValueError('Images must be 20 MB or smaller.')
    if not isinstance(title,str) or not title.strip() or len(title)>500: raise ValueError('Use an image title of 1–500 characters.')
    if not isinstance(tags,list) or len(tags)>100 or any(not isinstance(t,str) or len(t)>150 for t in tags): raise ValueError('Image tags are invalid.')
    ext = image_extension(raw); digest = hashlib.sha256(raw).hexdigest()
    existing = next((a for a in catalog['assets'] if a.get('sha256') == digest and not a.get('crop')), None)
    if existing: return {'asset':existing,'created':False}
    width,height = validator(raw,ext)
    folder = root/'image-imports'/data['id']; folder.mkdir(parents=True,exist_ok=True)
    dest = folder/(digest+ext); temp=folder/('.'+uuid.uuid4().hex)
    try: temp.write_bytes(raw);os.replace(temp,dest)
    finally: temp.unlink(missing_ok=True)
    aid = hashlib.sha256(json.dumps([str(dest),None],sort_keys=True).encode()).hexdigest()[:20]
    asset={'id':aid,'image':str(dest),'title':title.strip(),'crop':None,'version':'Added to this storyboard','tags':list(dict.fromkeys(t.strip() for t in tags if t.strip())),'sha256':digest,'width':width,'height':height,'added_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'import_source':'Reference Desk' if desk else 'Uploaded file'}
    if desk:
        asset.update(reference_desk_asset_id=desk.get('desk_id') or desk['id'].removeprefix('desk-'),source_image=desk['image'])
    allowpath=root/'allowlist.json';allow=json.loads(allowpath.read_text());allow['files']=sorted(set(allow['files'])|{str(dest)});atomic(allowpath,allow)
    history=root/'feedback/image-import-history';history.mkdir(parents=True,exist_ok=True)
    atomic(history/(data['id']+'-'+uuid.uuid4().hex+'.json'),catalog)
    catalog['assets'].append(asset);atomic(path,catalog)
    return {'asset':asset,'created':True}
