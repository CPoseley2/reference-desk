"""Version-scoped, local still-storyboard FCPXML packages. No source edits or rendering."""
import base64, hashlib, json, math, os, re, shutil, struct, subprocess, tempfile, threading, uuid, zipfile
from datetime import datetime, timezone
from fractions import Fraction
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit
from xml.etree import ElementTree as ET

RATES = ('24', '25', '30', '24000/1001', '30000/1001')
JOBS = set()
JOB_LOCK = threading.Lock()
class ExportError(ValueError): pass
class Conflict(ExportError): pass

def digest(data): return hashlib.sha256(data).hexdigest()
def read_json(p): return json.loads(p.read_text())
def canonical(obj): return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
def tool(name):
    p=shutil.which(name) or str(Path('/opt/homebrew/bin')/name)
    if not Path(p).is_file(): raise ExportError(f'{name} is required for local export validation.')
    return p

def view_data(root,eid):
    if not isinstance(eid,str) or not re.fullmatch('[a-f0-9]{16}',eid): raise ExportError('Choose a valid storyboard version.')
    entry=next((e for e in read_json(root/'inventory.json')['entries'] if e['id']==eid),None)
    if not entry: raise ExportError('Storyboard version is no longer indexed. Refresh and choose it again.')
    text=(root/'view-data'/f'{eid}.js').read_text()
    if not text.startswith('window.VIEW='): raise ExportError('Unsupported storyboard snapshot.')
    view=json.loads(text[len('window.VIEW='):].rstrip(';\n'))
    return entry,view

def options(root,eid):
    entry,view=view_data(root,eid)
    choices=[]
    for i,ref in enumerate(view.get('audio',[])):
        if isinstance(ref,str): choices.append({'index':i,'label':f'Recording {i+1} — '+('embedded in this version' if ref.startswith('data:') else Path(unquote(ref)).name)})
    rate='25'
    bp=root/'beat-edits'/f'{eid}.json'
    if bp.exists(): rate=str(read_json(bp).get('fps',25))
    return {'id':eid,'title':entry['title'],'song':entry['song'],'note':entry.get('note',''),'recordings':choices,'fps':rate,'supported_rates':list(RATES)}

def media_bytes(ref,approved,resolve,kind):
    if not isinstance(ref,str): raise ExportError(f'Missing {kind} source.')
    if ref.startswith('data:'):
        m=re.fullmatch(r'data:((?:image|audio)/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)',ref)
        if not m or not m[1].startswith(kind+'/'): raise ExportError(f'Unsupported embedded {kind}.')
        if len(m[2])>300_000_000: raise ExportError('Embedded media is too large.')
        try: raw=base64.b64decode(m[2],validate=False)
        except ValueError as e: raise ExportError('Invalid embedded media.') from e
        ext={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','audio/mp4':'.m4a','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav'}.get(m[1])
        if not ext: raise ExportError(f'Unsupported media type: {m[1]}')
        return raw,ext
    if ref.startswith('file:'):
        u=urlsplit(ref)
        if u.netloc not in ('','localhost'): raise ExportError('Only local media is supported.')
        ref=unquote(u.path)
    if ref.startswith('/files/'): ref=unquote(ref[len('/files'):])
    if not ref.startswith('/'): raise ExportError('Only registered local media is supported.')
    p=resolve(ref).resolve()
    if not approved(p): raise ExportError(f'Unregistered {kind}: {p.name}')
    if not p.is_file(): raise ExportError(f'Missing {kind}: {p.name}. Check the source drive.')
    if p.stat().st_size>500_000_000: raise ExportError(f'{kind.title()} exceeds the 500 MB export limit: {p.name}')
    if kind=='image' and p.suffix.lower() not in ('.png','.jpg','.jpeg','.webp','.tif','.tiff'):
        raise ExportError(f'Only still images are supported: {p.name}')
    return p.read_bytes(),p.suffix.lower()

def probe_bytes(raw,ext):
    with tempfile.TemporaryDirectory(prefix='owl-export-probe-') as td:
        p=Path(td)/('media'+ext);p.write_bytes(raw)
        try:
            result=subprocess.run([tool('ffprobe'),'-v','error','-show_streams','-show_format','-of','json',str(p)],capture_output=True,text=True,timeout=30,check=True)
            return json.loads(result.stdout)
        except (subprocess.SubprocessError,ValueError) as e: raise ExportError('Media could not be decoded by ffprobe.') from e

def image_size(raw,ext):
    if ext=='.png' and raw.startswith(b'\x89PNG\r\n\x1a\n'): return struct.unpack('>II',raw[16:24])
    p=probe_bytes(raw,ext);s=next((s for s in p['streams'] if s['codec_type']=='video'),None)
    if not s: raise ExportError('Selected image has no readable picture.')
    if s.get('nb_frames') not in (None,'N/A','1'): raise ExportError('Animated images are not supported.')
    return s['width'],s['height']

def crop_rect(value,width,height):
    value=[0,0,1,1] if value is None else value
    if not isinstance(value,list) or len(value)!=4 or any(type(x) not in (int,float) or not math.isfinite(x) for x in value): raise ExportError('Unsupported image crop; expected normalized x, y, width, height.')
    x,y,w,h=value
    if x<0 or y<0 or w<=0 or h<=0 or x+w>1.000001 or y+h>1.000001: raise ExportError('Image crop falls outside the selected image.')
    left,top=round(x*width),round(y*height)
    right,bottom=min(width,round((x+w)*width)),min(height,round((y+h)*height))
    if right<=left or bottom<=top: raise ExportError('Image crop is empty.')
    return [left,top,right-left,bottom-top]

def finite(v): return type(v) in (int,float) and math.isfinite(v)
def frame(v,fps): return int(Fraction(str(v))*fps+Fraction(1,2))
def seconds(f):
    f=Fraction(f);return f'{f.numerator}/{f.denominator}s'

def snapshot(root,data,approved,resolve):
    eid=data.get('id');entry,view=view_data(root,eid)
    # Detect changed source snapshots using the same dependency signatures as the viewer.
    for ref,sig in entry.get('source_signature',{}).items():
        p=resolve(ref)
        if not approved(p) or not p.is_file() or [p.stat().st_size,p.stat().st_mtime_ns]!=sig:
            raise Conflict('Storyboard source changed or is unavailable. Refresh the inventory and review this version before exporting.')
    catpath=root/'image-libraries'/f'{eid}.json';statepath=root/'feedback/arrangements'/f'{eid}.json'
    if not catpath.exists() or not statepath.exists(): raise ExportError('Save an image arrangement for this version first.')
    cat=read_json(catpath);state=read_json(statepath)
    if cat.get('source_sha256')!=view.get('sha256'): raise Conflict('The saved arrangement belongs to an older source snapshot. Reconcile the storyboard before exporting.')
    assets={a['id']:a for a in cat['assets']+state.get('related_assets',[])}
    slots=cat['slots'];ids=[str(s['id']) for s in slots]
    if not slots or len(ids)!=len(set(ids)): raise ExportError('Storyboard needs unique, ordered shot slots.')
    if len(slots)>2000: raise ExportError('Export supports up to 2,000 shots.')
    fps_text=str(data.get('fps','25'))
    if fps_text not in RATES: raise ExportError('Choose a supported frame rate.')
    fps=Fraction(fps_text);timing_revision=None;timings=None
    cfgpath=root/'beat-edits'/f'{eid}.json'
    if cfgpath.exists():
        cfg=read_json(cfgpath);tp=root/'feedback/timings'/f'{eid}.json'
        ts=read_json(tp) if tp.exists() else {'revision':0,'end_frames':cfg['initial_end_frames']}
        if list(map(str,cfg['shot_ids']))!=ids: raise ExportError('Saved timing does not match this shot order.')
        ends=ts['end_frames'];rate=Fraction(str(cfg['fps']))
        if len(ends)!=len(slots) or any(type(e) is not int for e in ends): raise ExportError('Invalid saved frame boundaries.')
        timings=[(float(Fraction(a,1)/rate),float(Fraction(b,1)/rate)) for a,b in zip([0]+ends,ends)]
        timing_revision=ts['revision']
    audio_index=data.get('audio_index');choices=view.get('audio',[])
    if type(audio_index) is not int or not 0<=audio_index<len(choices): raise ExportError('Select the exact recording to export.')
    audio_ref=choices[audio_index];raw,ext=media_bytes(audio_ref,approved,resolve,'audio')
    ap=probe_bytes(raw,ext);astream=next((s for s in ap['streams'] if s['codec_type']=='audio'),None)
    if not astream: raise ExportError('Selected recording has no audio stream.')
    if any(s['codec_type']=='video' for s in ap['streams']): raise ExportError('Choose an audio-only recording.')
    duration=float(astream.get('duration') or ap['format']['duration'])
    if not math.isfinite(duration) or not 0<duration<=14400: raise ExportError('Invalid recording duration.')
    ahash=digest(raw)
    if cfgpath.exists() and cfg.get('audio_sha256') and ahash!=cfg['audio_sha256']: raise Conflict('Selected recording differs from the saved timing recording.')
    shots=[];cache={};previous=0.;lastframe=0;maxround=0.;totalbytes=len(raw)
    for i,s in enumerate(slots):
        sid=str(s['id']);aid=state['assignments'].get(sid);a=assets.get(aid)
        if not a: raise ExportError(f'Shot {sid}: select and save an image before exporting.')
        start,end=timings[i] if timings else (s.get('start'),s.get('end'))
        if not finite(start) or not finite(end) or end<=start or abs(start-previous)>0.0001:
            raise ExportError(f'Shot {sid}: missing, overlapping, or non-continuous timing. Save a complete timed storyboard.')
        previous=end;begin=frame(start,fps);stop=frame(end,fps)
        if begin!=lastframe or stop<=begin: raise ExportError(f'Shot {sid} is shorter than one output frame.')
        lastframe=stop;maxround=max(maxround,abs(float(Fraction(begin,1)/fps)-start),abs(float(Fraction(stop,1)/fps)-end))
        ref=a.get('image')
        if ref not in cache:
            b,suffix=media_bytes(ref,approved,resolve,'image');w,h=image_size(b,suffix)
            if w*h>100_000_000: raise ExportError('Selected image is too large.')
            cache[ref]=(digest(b),suffix,w,h);totalbytes+=len(b)
        sha,suffix,w,h=cache[ref];crop=crop_rect(a.get('crop'),w,h)
        if a.get('sha256') and sha!=a['sha256']: raise Conflict(f'Shot {sid}: selected image changed on disk. Review and save it again.')
        shots.append({'id':sid,'asset_id':aid,'title':s['title'],'source':ref,'sha256':sha,'extension':suffix,'width':w,'height':h,'crop_pixels':crop,'start_frame':begin,'end_frame':stop,'source_start':start,'source_end':end})
    if abs(previous-duration)>max(.1,1/float(fps)):
        raise ExportError(f'Picture ends at {previous:.2f}s but recording ends at {duration:.2f}s. Confirm the recording and finish the timing first.')
    totalframes=max(lastframe,math.ceil(Fraction(str(duration))*fps))
    shots[-1]['end_frame']=totalframes
    # Contents, not modification time alone, bind all indexed source dependencies.
    source_hashes={ref:digest(resolve(ref).read_bytes()) for ref in entry.get('source_signature',{})}
    snap={'schema':1,'entry_id':eid,'title':entry['title'],'song':entry['song'],'review_note':entry.get('note',''),'source':entry['path'],'source_hashes':source_hashes,'source_sha256':view.get('sha256'),'arrangement_revision':state['revision'],'timing_revision':timing_revision,'fps':fps_text,'width':1920,'height':1080,'frames':totalframes,'duration':float(Fraction(totalframes,1)/fps),'max_cut_rounding_seconds':maxround,'audio':{'source':audio_ref,'sha256':ahash,'extension':ext,'duration':duration,'channels':int(astream['channels']),'sample_rate':int(astream['sample_rate'])},'shots':shots,'media_bytes':totalbytes}
    if snap['audio']['channels'] not in (1,2): raise ExportError('This exporter supports mono or stereo recordings.')
    snap['fingerprint']=digest(canonical(snap))
    return snap

def summary(s):
    return {'fingerprint':s['fingerprint'],'title':s['title'],'note':s['review_note'],'shots':len(s['shots']),'duration':s['duration'],'audio_duration':s['audio']['duration'],'fps':s['fps'],'width':1920,'height':1080,'arrangement_revision':s['arrangement_revision'],'timing_revision':s['timing_revision'],'media_bytes':s['media_bytes'],'max_cut_rounding_seconds':s['max_cut_rounding_seconds'],'upscaled_images':sum(x['crop_pixels'][2]<1920 or x['crop_pixels'][3]<1080 for x in s['shots'])}

def redact(s):
    s=json.loads(json.dumps(s))
    for row in s['shots']+[s['audio']]:
        if row['source'].startswith('data:'): row['source']='embedded:'+row['sha256']
    return s

def make_xml(s,dest):
    root=ET.Element('fcpxml',version='1.10');res=ET.SubElement(root,'resources');fps=Fraction(s['fps'])
    ET.SubElement(res,'format',id='r1',width='1920',height='1080',frameDuration=seconds(1/fps),colorSpace='1-1-1 (Rec. 709)')
    for i,shot in enumerate(s['shots'],10):
        fmt=f'f{i}';ET.SubElement(res,'format',id=fmt,width=str(shot['crop_pixels'][2]),height=str(shot['crop_pixels'][3]))
        a=ET.SubElement(res,'asset',id=f'r{i}',name=shot['title'],start='0s',duration='0s',hasVideo='1',format=fmt)
        ET.SubElement(a,'media-rep',kind='original-media',src=(dest/shot['packaged_path']).as_uri())
    audio=s['audio'];adur=seconds(Fraction(str(audio['duration'])))
    a=ET.SubElement(res,'asset',id='r3',name='Selected recording',start='0s',duration=adur,hasAudio='1',audioSources='1',audioChannels=str(audio['channels']),audioRate=str(audio['sample_rate']))
    ET.SubElement(a,'media-rep',kind='original-media',src=(dest/audio['packaged_path']).as_uri())
    lib=ET.SubElement(root,'library');event=ET.SubElement(lib,'event',name=s['song']+' — Storyboard XML')
    project=ET.SubElement(event,'project',name=s['title']+' — 1080p — '+s['export_id'][:8])
    seq=ET.SubElement(project,'sequence',format='r1',duration=seconds(Fraction(s['frames'],1)/fps),tcStart='0s',tcFormat='NDF',audioLayout='stereo' if audio['channels']==2 else 'mono',audioRate='48k')
    spine=ET.SubElement(seq,'spine')
    for i,shot in enumerate(s['shots'],10):
        v=ET.SubElement(spine,'video',ref=f'r{i}',name=shot['id']+' — '+shot['title'],offset=seconds(Fraction(shot['start_frame'],1)/fps),start='0s',duration=seconds(Fraction(shot['end_frame']-shot['start_frame'],1)/fps))
        ET.SubElement(v,'adjust-conform',type='fit')
        if i==10:ET.SubElement(v,'asset-clip',ref='r3',name='Selected recording',lane='-1',offset='0s',start='0s',duration=adur,audioRole='music')
    ET.indent(root)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n'+ET.tostring(root,encoding='utf-8')

def validate_xml(p):
    ET.parse(p)
    dtd=Path('/Applications/Final Cut Pro.app/Contents/Frameworks/Interchange.framework/Versions/A/Resources/FCPXMLv1_10.dtd')
    if not dtd.exists(): raise ExportError('Final Cut FCPXML 1.10 schema is unavailable on this Mac.')
    with tempfile.TemporaryDirectory(prefix='owl-xml-schema-') as td:
        target=Path(td)/'schema.dtd';shutil.copyfile(dtd,target)
        result=subprocess.run(['/usr/bin/xmllint','--noout','--dtdvalid',str(target),str(p)],capture_output=True,text=True,timeout=30)
        if result.returncode: raise ExportError('Final Cut XML validation failed: '+result.stderr[:500])

def build_package(root,s,approved,resolve,progress=lambda text:None):
    dest=root/'exports/final-cut'/s['export_id'];dest.parent.mkdir(parents=True,exist_ok=True)
    if shutil.disk_usage(dest.parent).free < s['media_bytes']*3+100_000_000: raise ExportError('Not enough free disk space for the media package.')
    work=Path(tempfile.mkdtemp(prefix='owl-fcpxml-'))
    try:
        (work/'Media').mkdir();s=json.loads(json.dumps(s));copied={}
        for i,row in enumerate(s['shots']+[s['audio']]):
            progress(f'Preparing media {i+1} of {len(s["shots"])+1}')
            kind='audio' if i==len(s['shots']) else 'image'
            key=(row['sha256'],tuple(row.get('crop_pixels',[])))
            if key in copied: row['packaged_path']=copied[key];continue
            raw,ext=media_bytes(row['source'],approved,resolve,kind)
            if digest(raw)!=row['sha256']: raise Conflict('Media changed during export. Check the storyboard and create a new export.')
            name=digest(canonical(key))[:24]+ext;relative='Media/'+name;target=work/relative
            if kind=='image' and row['crop_pixels']!=[0,0,row['width'],row['height']]:
                source=work/('crop-source'+ext);source.write_bytes(raw);x,y,w,h=row['crop_pixels']
                relative='Media/'+Path(name).stem+'.png';target=work/relative
                try:subprocess.run([tool('ffmpeg'),'-v','error','-nostdin','-i',str(source),'-vf',f'crop={w}:{h}:{x}:{y}','-frames:v','1',str(target)],capture_output=True,timeout=60,check=True)
                except subprocess.SubprocessError as e:raise ExportError('Could not prepare the selected image crop.') from e
                source.unlink()
            else:target.write_bytes(raw)
            row['packaged_path']=relative;copied[key]=relative
        # Detect sources modified after preflight, including while media was copied.
        for ref,sha in s['source_hashes'].items():
            if not approved(resolve(ref)) or digest(resolve(ref).read_bytes())!=sha:raise Conflict('Source changed during export. Refresh and retry.')
        progress('Validating Final Cut XML')
        xml=work/'Storyboard.fcpxml';xml.write_bytes(make_xml(s,dest));validate_xml(xml)
        (work/'export-manifest.json').write_text(json.dumps(redact(s),ensure_ascii=False,indent=2))
        checks={p.relative_to(work).as_posix():digest(p.read_bytes()) for p in (work/'Media').iterdir()}
        (work/'checksums.json').write_text(json.dumps(checks,indent=2))
        (work/'README.txt').write_text(f'''{s['title']}\nFinal Cut XML package — {s['created_at']}\n\n{len(s['shots'])} still shots · 1920 x 1080 · {s['fps']} fps · {s['duration']:.3f} seconds\nSaved arrangement revision {s['arrangement_revision']}; timing revision {s['timing_revision']}.\n\n{ s['review_note'] }\n\nDouble-click Storyboard.fcpxml on this Mac and import into a new Final Cut library.\nOpen the project and check images, framing, timing and audio.\nShare > Export File > Settings: Computer, H.264, 1920 x 1080, Save only.\nVerify the full duration and .mp4 extension, then save. Wait for Sharing to finish.\nThis package is an editable still-image timeline, not a rendered movie or approval.\nNo new image/video generation occurred. The song is continuous; cuts are frame-aligned.\nOriginal image resolution is retained; smaller images scale up into the HD canvas.\n\nMedia location: {dest/'Media'}\nXML contains absolute file URIs. If this folder moves, relink its Media folder in Final Cut.\nKeep this folder until Final Cut has copied media into its library.\n\nExport ID: {s['export_id']}\nSnapshot fingerprint: {s['fingerprint']}\n''')
        progress('Packaging download')
        # ZIP uses stored bytes: fast, and images/audio are already compressed.
        with zipfile.ZipFile(work/'Final-Cut-Package.zip','w',compression=zipfile.ZIP_STORED) as z:
            for p in sorted(work.rglob('*')):
                if p.is_file() and p.suffix!='.zip':z.write(p,arcname=s['export_id']+'/'+p.relative_to(work).as_posix())
        # Publish on the same filesystem only after validation and packaging complete.
        staging=dest.with_name('.'+dest.name+'.preparing')
        shutil.copytree(work,staging);os.replace(staging,dest)
        return {'folder':str(dest),'xml_url':f'/exports/final-cut/{s["export_id"]}/Storyboard.fcpxml','zip_url':f'/exports/final-cut/{s["export_id"]}/Final-Cut-Package.zip','readme_url':f'/exports/final-cut/{s["export_id"]}/README.txt',**summary(s)}
    finally:shutil.rmtree(work,ignore_errors=True)

def job_path(root,jid):
    if not isinstance(jid,str) or not re.fullmatch('[a-f0-9]{32}',jid):raise ExportError('Unknown export job.')
    return root/'feedback/final-cut-exports'/(jid+'.json')

def job_status(root,jid):
    p=job_path(root,jid)
    if not p.exists():raise ExportError('Export job not found.')
    s=read_json(p)
    with JOB_LOCK:active=jid in JOBS
    if s['status'] in ('preparing','validating') and not active:
        s.update(status='failed',error='Export interrupted by a server restart. Start a new export.')
    return s

def start_job(root,data,approved,resolve,atomic,lock):
    jid=data.get('mutation_id');path=job_path(root,jid)
    with JOB_LOCK:
        if path.exists():
            old=read_json(path)
            if old['fingerprint']!=data.get('fingerprint'):raise Conflict('Export request ID was reused for another snapshot.')
            return {'job_id':jid}
        with lock:s=snapshot(root,data,approved,resolve)
        if s['fingerprint']!=data.get('fingerprint'):raise Conflict('The saved storyboard changed after the export check. Check it again.')
        s.update(export_id=jid,created_at=datetime.now(timezone.utc).isoformat())
        path.parent.mkdir(parents=True,exist_ok=True)
        status={'job_id':jid,'fingerprint':s['fingerprint'],'entry_id':s['entry_id'],'created_at':s['created_at'],'status':'preparing','progress':'Preparing media'}
        atomic(path,status);JOBS.add(jid)
    def run():
        def progress(text):
            status['progress']=text;atomic(path,status)
        try:status.update(result=build_package(root,s,approved,resolve,progress),status='ready',progress='XML package ready')
        except Exception as e:status.update(status='failed',error=str(e),progress='Export failed')
        finally:
            atomic(path,status)
            with JOB_LOCK:JOBS.discard(jid)
    threading.Thread(target=run,name='final-cut-export-'+jid,daemon=True).start()
    return {'job_id':jid}
