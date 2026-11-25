"""Measured musical energy and edit cues. No instrument or section labels inferred."""
import math
import numpy as np
from scipy.ndimage import gaussian_filter1d
from scipy.signal import butter, sosfilt, find_peaks

def _db(x): return 20*np.log10(np.maximum(x,1e-8))

def analyze_dynamics(y,sr,beats,fps=25.,offset=0.):
    step=.1;hop=round(sr*step);duration=len(y)/sr
    # Sample-aligned 100ms non-overlapping windows, with exact original duration kept elsewhere.
    def rms(signal):
        return np.array([np.sqrt(np.mean(signal[i:i+hop].astype('float64')**2)) for i in range(0,len(signal),hop)])
    times=(np.arange(math.ceil(len(y)/hop))+.5)*step
    times=np.minimum(times,duration)
    energy=rms(y)
    if len(energy)<10 or energy.max()<1e-7:
        return dict(schema_version='1.0',curve=[],swells=[],impacts=[],breaks=[],cut_bursts=[],warnings=['Insufficient dynamic evidence; no crescendo or impact inferred.'])
    bass=rms(sosfilt(butter(3,[35,180],fs=sr,btype='bandpass',output='sos'),y))
    # RMS is signal amplitude, NOT integrated loudness/LUFS or musical intensity ground truth.
    smooth=_db(gaussian_filter1d(energy,5))
    fast=_db(gaussian_filter1d(energy,1))
    bassdb=_db(gaussian_filter1d(bass,1))
    active=smooth[smooth>max(-65,float(smooth.max())-35)]
    low,high=np.percentile(active,[8,95]) if len(active) else (-60,-10)
    intensity=np.clip((smooth-low)/max(high-low,3),0,1)
    attack=np.maximum(0,fast-np.roll(fast,3));attack[:3]=0
    bassrise=np.maximum(0,bassdb-np.roll(bassdb,4));bassrise[:4]=0
    frame=lambda t:math.floor(t*fps+.5)
    def timing(t):return dict(seconds=round(float(t),6),song_frame=frame(t),film_seconds=round(float(t+offset),6),film_frame=frame(t+offset))
    def rank_separated(items,limit,separation):
        chosen=[]
        for item in sorted(items,key=lambda x:x['score'],reverse=True):
            if all(abs(item['seconds']-c['seconds'])>=separation for c in chosen):chosen.append(item)
            if len(chosen)>=limit:break
        return sorted(chosen,key=lambda x:x['seconds'])
    # Broad local peaks pair with an earlier valley: sustained gain, not each loud transient.
    peaks,_=find_peaks(smooth,distance=40,prominence=1.8)
    swells=[]
    for p in peaks:
        a=max(0,p-120);b=max(a+1,p-25)
        if b<=a:continue
        v=a+int(np.argmin(smooth[a:b]));gain=float(smooth[p]-smooth[v]);length=(p-v)*step
        increments=np.diff(smooth[v:p+1]);rising=float(np.mean(increments>-.015))
        if gain<3.0 or length<2.5 or intensity[p]<.5 or rising<.58:continue
        # Do not call the initial fade-in or recovery from near-silence a sustained crescendo.
        if v*step<1.0 or smooth[v]<high-28:continue
        score=gain*min(1,length/5)*rising
        swells.append(dict(**timing(times[p]),start_seconds=round(float(times[v]),6),end_seconds=round(float(times[p]),6),
            gain_db=round(gain,2),rise_fraction=round(rising,3),score=round(score,3),confidence=round(min(.85,.4+gain/30+rising/10),3),
            kind='swell',label='Crescendo candidate',status='unreviewed',
            evidence=f'{gain:.1f} dB smoothed RMS rise over {length:.1f}s; {rising:.0%} rising/flat steps.',
            suggestion='Shorten holds through the rise; reserve the strongest image change for the arrival.',
            hold_seconds_start=2.4,hold_seconds_end=1.0))
    swells=rank_separated(swells,8,12)
    # Bass-supported attacks are boom candidates, not claims that a particular drum/instrument played.
    impactscore=np.clip(bassrise/10,0,1)*.55+np.clip(attack/6,0,1)*.3+intensity*.15
    ip,_=find_peaks(impactscore,distance=15,prominence=.12)
    impacts=[]
    for p in ip:
        if bassrise[p]<4 or attack[p]<1.2 or bassdb[p]<np.percentile(bassdb,65) or intensity[p]<.35:continue
        # Refine within +/-150ms to the sharpest broadband rise; retain measured timing precision 100ms.
        a=max(1,p-2);b=min(len(energy)-1,p+2);k=a+int(np.argmax(np.diff(energy)[a-1:b]))
        impacts.append(dict(**timing(times[k]),kind='impact',label='Bass impact / boom candidate',status='unreviewed',
            score=round(float(impactscore[p]),3),confidence=round(min(.85,float(impactscore[p])),3),
            bass_rise_db=round(float(bassrise[p]),2),attack_rise_db=round(float(attack[p]),2),
            evidence=f'35–180 Hz energy rises {bassrise[p]:.1f} dB in 0.4s; broadband attack rises {attack[p]:.1f} dB in 0.3s.',
            suggestion='Land a clear angle/scale change on this attack; avoid an extra cut immediately before it.'))
    impacts=rank_separated(impacts,8,8)
    # A break is a relative drop from preceding level, not necessarily literal silence.
    drops=[]
    for k in range(10,len(fast)-10):
        before=float(np.median(fast[k-10:k-3]));after=float(np.median(fast[k:k+5]));drop=before-after
        if drop<6 or before<high-15:continue
        end=k+5
        while end<min(len(fast),k+80) and fast[end]<before-3:end+=1
        if end>=len(times):end=len(times)-1
        drops.append(dict(**timing(times[k]),end_seconds=round(float(times[end]),6),kind='break',label='Energy break / drop candidate',status='unreviewed',
            drop_db=round(drop,2),score=round(drop,3),confidence=round(min(.85,.45+drop/40),3),
            evidence=f'RMS level falls {drop:.1f} dB relative to the preceding second; reduced energy lasts about {(end-k)*step:.1f}s.',
            suggestion='Cut on the drop for contrast, then ease the cutting rate. Keep the held shot within the project duration cap.'))
    breaks=rank_separated(drops,6,8)
    # Choose a sparse burst of actual beat candidates through each selected swell, never a uniform invented grid.
    bursts=[]
    for i,s in enumerate(swells):
        start,end=s['start_seconds'],s['end_seconds'];eligible=[b for b in beats if start<=b['seconds']<=end];points=[];last=start
        while last<end-.5:
            progress=(last-start)/max(end-start,1);target=last+(2.4-1.4*progress)
            choices=[b for b in eligible if b['seconds']>last+.55 and abs(b['seconds']-target)<=.35]
            if not choices:break
            chosen=min(choices,key=lambda b:abs(b['seconds']-target));last=chosen['seconds'];points.append(dict(**timing(last),beat_id=chosen['id'],beat_status=chosen['status']))
        nearby=[v for v in impacts if abs(v['seconds']-end)<=1.5]
        landing=min(nearby,key=lambda v:abs(v['seconds']-end)) if nearby else None
        bursts.append(dict(id=f'burst-{i+1}',start_seconds=start,end_seconds=end,hold_seconds_start=2.4,hold_seconds_end=1.0,
            candidate_cuts=points,arrival_seconds=landing['seconds'] if landing else end,arrival_basis='measured bass-supported attack' if landing else 'smoothed energy peak; audition exact landing',
            status='proposed timing only; no imagery assigned',coverage_note='Every accepted cut needs a distinct available image; preserve lyric order. Timing suggestions do not authorize rendering.'))
    curve=[dict(seconds=round(float(times[i]),3),rms_dbfs=round(float(smooth[i]),2),bass_dbfs=round(float(bassdb[i]),2),intensity=round(float(intensity[i]),4)) for i in range(len(times))]
    return dict(schema_version='1.0',method='100ms RMS and 35–180Hz bass energy; 500ms smoothing; measured rises, attacks and relative drops',
        timing_resolution_seconds=.1,intensity_definition='Within-track smoothed RMS normalized between active 8th and 95th percentiles; not LUFS or musical emotion.',
        curve=curve,swells=swells,impacts=impacts,breaks=breaks,cut_bursts=bursts,
        warnings=['Offline look-ahead locates upcoming measured energy rises; it is not a live predictive model.',
            'Crescendo, break and boom labels are hypotheses from acoustic features; audition before accepting.',
            'Automatic compression, vocals and orchestration can change energy without a musical crescendo; bass attacks need not be drums.',
            'Cue timing is approximately 100ms; fine-tune exact cut frames by audition. No musical sections or downbeats are inferred.'])
