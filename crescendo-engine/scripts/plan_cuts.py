#!/usr/bin/env python3
"""Stage boundary suggestions using an existing, ordered image inventory. Never render."""
import argparse, hashlib, json, math
from pathlib import Path

def plan(m,inventory,preset,tolerance=.20,allow_estimates=False):
    fps=m['timing']['fps'];offset=m['timing']['film_offset_seconds'];duration=m['source']['duration_seconds']
    rnd=lambda t:math.floor(t*fps+.5)
    cap=math.ceil(preset.get('max_shot_seconds_exclusive',float('inf'))*fps)-1 if preset.get('max_shot_seconds_exclusive') else None
    shots=inventory.get('shots',inventory if isinstance(inventory,list) else []) if isinstance(inventory,dict) else inventory
    shots=[s for s in shots if isinstance(s.get('start_seconds',s.get('start')),(int,float))]
    conflicts=[];suggestions=[];seen=set();ends=[]
    beats=[b for b in m['beats'] if allow_estimates or b['status']=='confirmed']
    if not beats:conflicts.append('No reviewed beats available. Audition/correct the map, or explicitly request tentative estimates.')
    for i,s in enumerate(shots):
        start=float(s.get('start_seconds',s.get('start')));end=float(s.get('end_seconds',s.get('end')))
        if start<0 or end<=start or end>duration+.04: conflicts.append(f"{s['id']}: source-time bounds invalid")
        image=Path(s.get('source_image',s.get('image','')))
        if not image.is_file():conflicts.append(f"{s['id']}: missing imagery")
        else:
            h=hashlib.sha256(image.read_bytes()).hexdigest()
            if h in seen and preset.get('unique_images'):conflicts.append(f"{s['id']}: repeated imagery; needs distinct coverage")
            seen.add(h)
        if i and abs(start-ends[-1])>1/fps:conflicts.append(f"{s['id']}: input gap/overlap; do not silently repair lyric timing")
        ends.append(end)
        target=None
        # The final audio endpoint is exact and never snapped; locked boundaries stay locked.
        if i<len(shots)-1 and not s.get('boundary_locked',False):
            candidates=[b for b in beats if abs(b['seconds']-end)<=tolerance and start<b['seconds']<duration]
            if candidates:target=min(candidates,key=lambda b:abs(b['seconds']-end))
        proposed_end=target['seconds'] if target else end
        if i==len(shots)-1 and abs(end-duration)<=1/fps:proposed_end=duration
        suggestions.append(dict(id=s['id'],source_image=str(image),original_start_seconds=start,original_end_seconds=end,
            proposed_end_seconds=proposed_end,beat_id=target['id'] if target else None,
            beat_status=target['status'] if target else None,
            rationale='Nearby pulse candidate; check phrase, lyric and visual continuity before acceptance.' if target else 'Retain boundary; no suitable reviewed pulse or boundary locked.',
            lyric_order_preserved=True,attribution=s.get('authoritative_lyric_cues',s.get('attribution'))))
    for i,s in enumerate(suggestions):
        start=suggestions[i-1]['proposed_end_seconds'] if i else s['original_start_seconds'];end=s['proposed_end_seconds']
        s.update(proposed_start_seconds=start,start_frame=rnd(start+offset),end_frame=rnd(end+offset))
        s['duration_frames']=s['end_frame']-s['start_frame']
        if s['duration_frames']<=0:conflicts.append(f"{s['id']}: conflicting boundary proposals; retain source timeline")
        if cap and s['duration_frames']>cap:conflicts.append(f"{s['id']}: {s['duration_frames']} frames exceeds {cap}; needs unique coverage, not a stretched/cropped repeat")
    if not suggestions or suggestions[0]['proposed_start_seconds']>0 or suggestions[-1]['proposed_end_seconds']<duration:conflicts.append('Inventory does not cover the complete source song; retain audio and report missing coverage.')
    if preset.get('setting_first') and (not shots or not shots[0].get('establishes_setting')):conflicts.append('Setting-first opening is not verified; check the separate film prologue or supply an establishing image.')
    if preset.get('meaningful_angle_or_size_change'):conflicts.append('Angle/shot-size change needs visual review; no geometry is inferred from filenames.')
    return dict(schema_version='1.0',status='tentative suggestions only; never a production timeline',source_sha256=m['source']['sha256'],
        audio_duration_seconds=duration,film_offset_seconds=offset,fps=fps,preset=preset,max_shot_frames=cap,
        minimum_unique_song_shots=math.ceil(duration*fps/cap) if cap else None,
        provided_song_shots=len(shots),suggestions=suggestions,conflicts=conflicts,
        restrictions=['Keep locked lyric order and attribution; rhythm cannot identify a singer.',
            'Do not synthesize coverage, crop repeats, stretch audio, generate imagery or render automatically.',
            'Phrase accents need listening evidence; these suggestions use only nearby marked pulses.'])

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('map');p.add_argument('inventory');p.add_argument('--preset',required=True);p.add_argument('--out',required=True)
    p.add_argument('--map-presented',action='store_true',help='Only after opening/presenting the dashboard');p.add_argument('--allow-estimates',action='store_true');p.add_argument('--tolerance',type=float,default=.20)
    a=p.parse_args()
    if not a.map_presented:p.error('Present the dashboard before cut planning.')
    if Path(a.out).exists():p.error('Choose a new suggestion file; existing output is preserved.')
    if not math.isfinite(a.tolerance) or a.tolerance<0:p.error('Nonnegative finite tolerance required')
    result=plan(json.loads(Path(a.map).read_text()),json.loads(Path(a.inventory).read_text()),json.loads(Path(a.preset).read_text()),a.tolerance,a.allow_estimates)
    inventory_path=Path(a.inventory).resolve();inventory_data=json.loads(inventory_path.read_text())
    result['inventory_provenance']={'path':str(inventory_path),'sha256':hashlib.sha256(inventory_path.read_bytes()).hexdigest(),'version':inventory_data.get('version') if isinstance(inventory_data,dict) else None,'scope_note':'Inventory snapshot used for this run; not a claim about the latest production edit.'}
    Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'suggestions':len(result['suggestions']),'conflicts':len(result['conflicts'])}))
