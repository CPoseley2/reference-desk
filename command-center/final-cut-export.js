/* Local, version-scoped Final Cut handoff. Rendering stays in Final Cut Pro. */
(()=>{
 const offline=location.protocol==='file:';
 const dialog=document.createElement('dialog');dialog.id='final-cut-export-dialog';
 dialog.setAttribute('aria-labelledby','fcpxml-heading');
 dialog.innerHTML=`<form method="dialog"><button class="fcpxml-close" aria-label="Close export">Close ×</button></form><h2 id="fcpxml-heading">Export Final Cut XML</h2><p id="fcpxml-version"></p><details id="fcpxml-notes"><summary>Storyboard notes</summary><p id="fcpxml-note" class="muted"></p></details><div class="fcpxml-options"><label>Timing<select id="fcpxml-timing" aria-describedby="fcpxml-timing-note"></select></label><label>Frame rate<select id="fcpxml-fps"></select></label><label id="fcpxml-seconds-label" hidden>Seconds per clip<input id="fcpxml-seconds" type="number" min="0.001" max="3600" step="any" value="5" aria-describedby="fcpxml-runtime"></label><label id="fcpxml-audio-label">Recording<select id="fcpxml-audio"></select></label></div><p id="fcpxml-timing-note" class="muted"></p><p id="fcpxml-runtime" role="status" aria-live="polite"></p><p id="fcpxml-media-note"></p><p id="fcpxml-status" role="status" aria-live="polite"></p><div id="fcpxml-summary"></div><div class="toolbar"><button id="fcpxml-check" type="button">Check saved storyboard</button><button id="fcpxml-create" type="button" disabled>Create XML package</button></div><div id="fcpxml-result"></div><details id="fcpxml-history"><summary>Recent XML exports</summary><div></div></details><p class="muted">Creating XML does not render a movie or change storyboard approval. Import the XML into Final Cut, then use Share → Export File.</p>`;
 document.body.append(dialog);
 const el=id=>document.getElementById('fcpxml-'+id);
 let generation=0,entry,token,checked,mutation,busy=false,shotCount=0,supportsFixed=false;
 function status(text){el('status').textContent=text;}
 function link(parent,label,url,download=false){const a=document.createElement('a');a.textContent=label;a.href=url;a.className='button';a.target='_blank';a.rel='noopener';if(download)a.download='';parent.append(a);return a;}
 function disable(value){busy=value;el('check').disabled=value||offline;el('audio').disabled=value||el('timing').value==='fixed';el('seconds').disabled=value;el('fps').disabled=value;el('timing').disabled=value;el('create').disabled=value||!checked;}
 async function request(url,body){
  const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':token},body:JSON.stringify(body)}:{cache:'no-store'});
  let d;try{d=await r.json();}catch{throw Error('Export service unavailable. Reload the Command Center or restart its launcher.');}
  if(!r.ok)throw Error(d.error||'Export request failed');return d;
 }
 function selection(){const fixed=el('timing').value==='fixed';return {id:entry,audio_index:fixed?null:Number(el('audio').value),fps:el('fps').value,timing_mode:el('timing').value,...(fixed?{seconds_per_clip:Number(el('seconds').value)}:{})};}
 function invalidate(){checked=null;mutation=null;el('create').disabled=true;el('summary').textContent='';}
 function updateSelection(){invalidate();timingNote();status('Check this selection before exporting.');}
 for(const id of ['audio','fps','timing'])el(id).addEventListener('change',updateSelection);
 el('seconds').addEventListener('input',updateSelection);
 function fixedTiming(){
  const seconds=Number(el('seconds').value),[num,den='1']=el('fps').value.split('/'),fps=Number(num)/Number(den),frames=Math.round(seconds*fps),total=frames*shotCount/fps;
  if(!Number.isFinite(seconds)||seconds<=0||seconds>3600||frames<1||!Number.isFinite(total)||total>14400)return null;
  return {seconds,frames,total,actual:frames/fps};
 }
 function timingNote(){
  const fixed=el('timing').value==='fixed';el('seconds-label').hidden=!fixed;el('audio-label').hidden=fixed;el('audio').disabled=fixed||busy;
  el('timing-note').textContent=fixed?'Apply the same duration to every shot in saved order. No recording is needed or included. Saved storyboard timing stays unchanged.':el('timing').value==='even'?'Provisional draft: space all shots evenly across the selected recording, matching the playback preview. Cuts are not aligned to beats or lyrics. Saved storyboard timing stays unchanged.':'Use the saved storyboard cut times.';
  el('media-note').textContent='1080p · Proportional fit · '+(fixed?'Still images only':'Still images + soundtrack')+'. Selected media is copied into a new export folder.';
  if(fixed){const t=fixedTiming();el('runtime').textContent=!shotCount?'Shot count is unavailable until the export service is reloaded.':t?`${shotCount} clips × ${t.seconds} seconds = ${(shotCount*t.seconds).toFixed(2)} seconds requested. Total video: ${t.total.toFixed(3)} seconds (${Math.floor(t.total/60)}m ${(t.total%60).toFixed(2)}s).`+(Math.abs(t.actual-t.seconds)>.000001?` Each clip rounds to ${t.frames} frames (${t.actual.toFixed(5)} seconds) at this frame rate.`:''):'Enter a duration of at least one frame and up to 3,600 seconds per clip; total video must be four hours or less.';}
  else el('runtime').textContent='Total video duration will be shown after checking the saved storyboard.';
 }
 function results(r,target=el('result')){
  target.replaceChildren();const p=document.createElement('p');p.textContent='XML package ready — '+r.shots+' shots · '+r.duration.toFixed(2)+' seconds';target.append(p);
  const bar=document.createElement('div');bar.className='toolbar';target.append(bar);
  link(bar,'Download XML',r.xml_url,true);link(bar,'Download media package',r.zip_url,true);link(bar,'Import instructions',r.readme_url);
  const path=document.createElement('p');path.className='fcpxml-path';path.textContent=r.folder;target.append(path);
  const note=document.createElement('p');note.textContent='The XML references this media folder on this Mac. If you move the package, relink its Media folder in Final Cut.';target.append(note);
 }
 async function open(id){
  const g=++generation;entry=id;checked=null;mutation=null;token=null;el('result').replaceChildren();el('summary').replaceChildren();el('history').lastElementChild.replaceChildren();el('version').textContent='Loading selected version…';el('note').textContent='';disable(true);
  if(!dialog.open)dialog.showModal();
  if(offline){status('Start the local Storyboard Library to export. Offline browsing cannot create files.');return;}
  status('Loading saved version…');
  try{
   const d=await request('/library-api/final-cut-export/options?id='+encodeURIComponent(id));if(g!==generation)return;
   token=d.csrf_token;shotCount=d.shot_count??document.querySelectorAll('#slot-grid .edit-slot').length;supportsFixed=!!d.supports_fixed_timing;el('seconds').value=d.seconds_per_clip||5;el('version').textContent=d.title;el('note').textContent=d.note;
   el('audio').replaceChildren();const placeholder=new Option('Choose recording…','');el('audio').append(placeholder);
   for(const a of d.recordings)el('audio').append(new Option(a.label,String(a.index)));
   if(d.recordings.length===1)el('audio').value=String(d.recordings[0].index);
   el('fps').replaceChildren();for(const fps of d.supported_rates)el('fps').append(new Option(fps.includes('/')?(Number(fps.split('/')[0])/Number(fps.split('/')[1])).toFixed(3)+' fps':fps+' fps',fps));el('fps').value=d.fps;
   if(!el('fps').value)el('fps').value='25';
   el('timing').replaceChildren(new Option('Fixed seconds per clip — no recording','fixed'),new Option('Saved cut times + recording','saved'));if(d.allow_even_timing)el('timing').append(new Option('Evenly spaced draft timing','even'));el('timing').value=d.timing_mode||'saved';timingNote();
   for(const job of d.history||[]){const row=document.createElement('div');row.className='fcpxml-history-row';el('history').lastElementChild.append(row);const date=document.createElement('p');date.textContent=new Date(job.created_at).toLocaleString()+' — '+job.status;row.append(date);if(job.result){const links=document.createElement('div');links.className='toolbar';row.append(links);link(links,'XML',job.result.xml_url,true);link(links,'Media package',job.result.zip_url,true);}if(job.status==='preparing'){const b=document.createElement('button');b.textContent='Check progress';b.onclick=()=>poll(job.job_id,g);row.append(b);}}
   status(el('timing').value==='fixed'?'Choose seconds per clip, then check the saved storyboard.':d.recordings.length?'Ready to check the saved edit.':'Choose fixed seconds per clip to export without a recording.');disable(false);
  }catch(e){if(g===generation){status(e.message);el('check').disabled=true;}}
 }
 el('check').onclick=async()=>{
  if(el('timing').value==='fixed'){if(!supportsFixed){status('The running export service needs to be reloaded to support fixed clip timing.');return}if(!fixedTiming()){status('Enter valid seconds per clip before checking.');return}}else if(el('audio').value===''){status('Choose a recording, or select fixed seconds per clip.');return;}
  const g=generation;invalidate();disable(true);status('Saving pending edits and checking media…');
  try{
   await window.ReferenceDeskBridge?.flush();
   const s=await request('/library-api/final-cut-export/preflight',selection());if(g!==generation)return;
   shotCount=s.shots;timingNote();checked=s;mutation=crypto.randomUUID().replaceAll('-','');
   el('summary').textContent=`${s.shots} shots · ${s.duration.toFixed(2)} seconds · 1920 × 1080 · ${s.fps} fps. Saved image revision ${s.arrangement_revision}${s.timing_revision===null?'':', timing revision '+s.timing_revision}. Maximum cut rounding: ${(s.max_cut_rounding_seconds*1000).toFixed(1)} ms.${s.upscaled_images?' '+s.upscaled_images+' images will scale up to fit HD.':''}`;
   el('summary').append(document.createTextNode(' '+s.timing_note));
   status('Checks passed. Ready to create the XML package.');
  }catch(e){if(g===generation){invalidate();status(e.message);}}
  finally{if(g===generation)disable(false);}
 };
 async function poll(id,g){
  disable(true);
  try{
   for(;;){
    const d=await request('/library-api/final-cut-export/status?job='+encodeURIComponent(id));if(g!==generation)return;
    status(d.progress||d.status);
    if(d.status==='ready'){results(d.result);checked=null;return;}
    if(d.status==='failed')throw Error(d.error||'Export failed.');
    await new Promise(resolve=>setTimeout(resolve,1500));
   }
  }catch(e){if(g===generation)status(e.message+' Reopen export to check its saved status.');}
  finally{if(g===generation)disable(false);}
 }
 el('create').onclick=async()=>{
  if(!checked||busy)return;const g=generation;disable(true);status('Creating the export…');
  try{await window.ReferenceDeskBridge?.flush();const d=await request('/library-api/final-cut-export/create',{...selection(),fingerprint:checked.fingerprint,mutation_id:mutation});if(g===generation)await poll(d.job_id,g);}
  catch(e){if(g===generation){invalidate();status(e.message);disable(false);}}
 };
 document.addEventListener('click',e=>{const b=e.target.closest('[data-fcpxml-id]');if(b){e.preventDefault();open(b.dataset.fcpxmlId);}});
 if(location.pathname.endsWith('/viewer.html')){
  const id=new URLSearchParams(location.search).get('id');
  if(id){const b=document.createElement('button');b.type='button';b.className='review-icon';b.id='share-export';b.setAttribute('aria-label','Share and export');b.setAttribute('aria-haspopup','dialog');b.title='Share and export';b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 16V3M7 8l5-5 5 5M5 13v8h14v-8"/></svg>';b.dataset.fcpxmlId=id;(document.querySelector('.header-actions')||document.querySelector('header')).append(b);}
 }
})();
