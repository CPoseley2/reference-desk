#!/usr/bin/env python3
"""Local, non-destructive audio analysis. The first artifact is a review dashboard."""
import argparse, csv, hashlib, json, math, os, tempfile
from pathlib import Path
os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(tempfile.gettempdir()) / 'song-beat-map-numba'))
import numpy as np
import soundfile as sf
import librosa
from scipy.signal import find_peaks
from dynamics import analyze_dynamics

ROOT = Path(__file__).resolve().parents[1]

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024*1024), b''): h.update(b)
    return h.hexdigest()

def frame(t, fps):
    return math.floor(t * fps + 0.5)  # nearest frame; ties toward +infinity

def coordinates(t, fps, offset):
    return dict(seconds=float(t), song_frame=frame(t,fps), film_seconds=float(t+offset), film_frame=frame(t+offset,fps))

def analysis_channel(audio):
    mono=audio.mean(axis=1)
    energy=np.mean(audio.astype('float64')**2,axis=0)
    if max(energy)>1e-12 and np.mean(mono.astype('float64')**2)<.1*max(energy):
        channel=int(np.argmax(energy))
        return audio[:,channel], f'channel {channel+1}; stereo mix cancellation detected', ['Stereo mix cancellation detected; analyzed the highest-energy channel instead. Audition stereo imaging separately.']
    return mono,'channel mean',[]

def detect(y, sr):
    """Dynamic-tempo tracker; retain only beats supported by nearby observed onsets."""
    hop = 220
    if len(y) < 2048 or np.max(np.abs(y)) < 1e-7:
        return [], [], [], ['No reliable rhythmic evidence; no beats inferred.']
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if np.max(env) < 1e-7: return [], [], [], ['No measurable onsets.']
    local = librosa.feature.tempo(onset_envelope=env, sr=sr, hop_length=hop,
        aggregate=None, ac_size=8, start_bpm=110, std_bpm=1, max_tempo=220)
    _, tracked = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=hop,
        bpm=local, tightness=70, trim=False)
    peaks, _ = find_peaks(env, distance=max(1,round(.10*sr/hop)), prominence=max(env)*.012)
    times = peaks*hop/sr
    beats, used = [], set()
    scale = max(float(np.percentile(env[peaks],90)) if len(peaks) else 1, 1e-9)
    for f in tracked:
        if not len(peaks): break
        i = int(np.argmin(abs(peaks-f)))
        p = int(peaks[i]); t = float(times[i])
        # Tracker interpolation is not evidence. Drop unsupported pulses, including silence.
        if abs(p-f)*hop/sr > .085 or p in used: continue
        a,b = max(0,int((t-.08)*sr)), min(len(y),int((t+.08)*sr))
        if b<=a or np.sqrt(np.mean(y[a:b]**2)) < 1e-5: continue
        used.add(p)
        support = min(1.,float(env[p])/scale)
        beats.append(dict(seconds=t, confidence=round(.35+.5*support,3), status='uncertain',
            provenance='librosa dynamic-tempo DP; observed spectral-flux onset',
            original_seconds=t, manual_override=False, downbeat=None, bar=None,
            local_bpm=round(float(local[p]),3)))
    tempo=[]
    duration=len(y)/sr
    for start in np.arange(0,duration,8):
        b=[x for x in beats if start<=x['seconds']<start+8]
        if len(b)<3: continue
        bpm=float(np.median([x['local_bpm'] for x in b]))
        spread=float(np.std([x['local_bpm'] for x in b]))
        tempo.append(dict(start_seconds=float(start),end_seconds=min(duration,float(start+8)),
            bpm=round(bpm,2), alternatives_bpm=[round(bpm/2,2),round(bpm*2,2)],
            status='estimate', confidence=round(max(.1,.7-spread/100),3),
            provenance='8-second summary of local autocorrelation tempo; not meter/section evidence'))
    onsets=[dict(seconds=float(t),strength=round(float(env[p])/scale,3)) for p,t in zip(peaks,times)]
    return beats, tempo, onsets, [
        'All automatic markers need audition; confidence measures onset support, not calibrated beat accuracy.',
        'Half/double tempo, pickups, rubato and weak percussion remain ambiguous. Missing markers are allowed.',
        'No downbeats, meter, musical sections, lyrics or speaker identities are inferred.',
        '8-second tempo windows blur abrupt changes; spectral onset timing has about 10–50 ms uncertainty.']

def export_csv(m,path):
    meta=dict(schema_version=m['schema_version'],source_sha256=m['source']['sha256'],source_samples=m['source']['samples'],sample_rate=m['source']['sample_rate'],duration_seconds=m['source']['duration_seconds'],fps=m['timing']['fps'],film_offset_seconds=m['timing']['film_offset_seconds'])
    fields=list(meta)+['id','seconds','song_frame','film_seconds','film_frame','confidence','status','provenance','manual_override','original_seconds','downbeat','bar']
    with open(path,'w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows([{**meta,**b} for b in m['beats']])

def build(source,out,title,fps=25.,offset=0.,film_duration=None,context=None):
    source=Path(source).resolve();out=Path(out).resolve()
    if out.exists(): raise ValueError('Output directory already exists. Choose a new run directory; originals are never overwritten.')
    if not math.isfinite(fps) or fps<=0 or not math.isfinite(offset): raise ValueError('Finite positive FPS and finite offset required')
    info=sf.info(source); original_hash=sha256(source)
    audio,sr=sf.read(source,always_2d=True,dtype='float32')
    duration=info.frames/info.samplerate
    mono,channel_method,channel_warnings=analysis_channel(audio)
    analysis=librosa.resample(mono,orig_sr=sr,target_sr=22050)
    beats,tempo,onsets,warnings=detect(analysis,22050)
    warnings=channel_warnings+warnings
    for i,b in enumerate(beats): b.update(id=f'b{i+1:05}',**coordinates(b['seconds'],fps,offset))
    # Envelope is min/max, preserving the visible amplitude and silence, not decorative sine waves.
    buckets=np.array_split(mono,min(len(mono),4000))
    waveform=[[round(float(np.min(b)),5),round(float(np.max(b)),5)] for b in buckets]
    m=dict(schema_version='1.0',title=title,revision=0,review_status='analysis demonstration — not an approved edit',
        source=dict(path=str(source),sha256=original_hash,sample_rate=info.samplerate,channels=info.channels,
            samples=info.frames,duration_seconds=duration,timing_origin='decoded source sample 0; no trim, stretch or leading-silence removal'),
        timing=dict(fps=fps,film_offset_seconds=offset,film_duration_seconds=film_duration,
            rounding='nearest frame, ties toward +infinity; frame 0 is origin',song_end_frame=frame(duration,fps)),
        analysis=dict(engine='librosa '+librosa.__version__,sample_rate=22050,hop_samples=220,channel_method=channel_method,
            method='spectral flux + dynamic local autocorrelation tempo + DP + observed-onset support filter',
            listening_verified=False), beats=beats,tempo_segments=tempo,onset_candidates=onsets,
        musical_sections=[],manual_history=[],warnings=warnings,context=context or {})
    m['dynamics']=analyze_dynamics(mono,sr,beats,fps,offset)
    out.mkdir(parents=True)
    sf.write(out/'audio-preview.wav',audio,sr,subtype='PCM_16')
    m['preview']=dict(file='audio-preview.wav',sha256=sha256(out/'audio-preview.wav'),
        purpose='local PCM16 listening copy; same sample count/rate; original preserved')
    data=json.dumps(dict(map=m,waveform=waveform),ensure_ascii=False).replace('</','<\\/')
    html=(ROOT/'assets/dashboard.html').read_text().replace('__DATA__',data).replace('__ENGINE__',(ROOT/'assets/editor.js').read_text())
    (out/'index.html').write_text(html)
    (out/'beat-map.json').write_text(json.dumps(m,indent=2)+'\n')
    export_csv(m,out/'beat-map.csv')
    cues=m['dynamics']['swells']+m['dynamics']['impacts']+m['dynamics']['breaks']
    with open(out/'edit-cues.csv','w',newline='') as f:
        fields=['kind','seconds','song_frame','film_seconds','film_frame','start_seconds','end_seconds','confidence','status','evidence','suggestion']
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(sorted(cues,key=lambda c:c['seconds']))
    assert sha256(source)==original_hash
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source');p.add_argument('--out',required=True);p.add_argument('--title',required=True)
    p.add_argument('--fps',type=float,default=25);p.add_argument('--film-offset',type=float,default=0)
    p.add_argument('--film-duration',type=float);p.add_argument('--context',help='Read-only JSON with verified project provenance and bookends')
    a=p.parse_args();m=build(a.source,a.out,a.title,a.fps,a.film_offset,a.film_duration,json.loads(Path(a.context).read_text()) if a.context else None)
    print(json.dumps(dict(dashboard=str(Path(a.out).resolve()/'index.html'),beats=len(m['beats']),duration=m['source']['duration_seconds'],source_sha256=m['source']['sha256'])))
