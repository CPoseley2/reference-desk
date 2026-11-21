/* Local, version-scoped Final Cut handoff. Rendering stays in Final Cut Pro. */
(()=>{
 const offline=location.protocol==='file:';
 const dialog=document.createElement('dialog');dialog.id='final-cut-export-dialog';
 dialog.setAttribute('aria-labelledby','fcpxml-heading');
 dialog.innerHTML=`<form method="dialog"><button class="fcpxml-close" aria-label="Close export">Close ×</button></form><h2 id="fcpxml-heading">Export Final Cut XML</h2><p id="fcpxml-version"></p><p id="fcpxml-note" class="muted"></p><div class="fcpxml-options"><label>Recording<select id="fcpxml-audio"></select></label><label>Frame rate<select id="fcpxml-fps"></select></label></div><p>1080p · Proportional fit · Still images + soundtrack<br>Selected media is copied into a new export folder.</p><p id="fcpxml-status" role="status" aria-live="polite"></p><div id="fcpxml-summary"></div><div class="toolbar"><button id="fcpxml-check" type="button">Check saved storyboard</button><button id="fcpxml-create" type="button" disabled>Create XML package</button></div><div id="fcpxml-result"></div><details id="fcpxml-history"><summary>Recent XML exports</summary><div></div></details><p class="muted">Creating XML does not render a movie or change storyboard approval. Import the XML into Final Cut, then use Share → Export File.</p>`;
 document.body.append(dialog);
 const el=id=>document.getElementById('fcpxml-'+id);
 let generation=0,entry,token,checked,mutation,busy=false;
 function status(text){el('status').textContent=text;}
 function link(parent,label,url,download=false){const a=document.createElement('a');a.textContent=label;a.href=url;a.className='button';a.target='_blank';a.rel='noopener';if(download)a.download='';parent.append(a);return a;}
 function disable(value){busy=value;el('check').disabled=value||offline;el('audio').disabled=value;el('fps').disabled=value;el('create').disabled=value||!checked;}
 async function request(url,body){
  const r=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':token},body:JSON.stringify(body)}:{cache:'no-store'});
  let d;try{d=await r.json();}catch{throw Error('Export service unavailable. Reload the Command Center or restart its launcher.');}
  if(!r.ok)throw Error(d.error||'Export request failed');return d;
 }
 function selection(){return {id:entry,audio_index:Number(el('audio').value),fps:el('fps').value};}
 function invalidate(){checked=null;mutation=null;el('create').disabled=true;el('summary').textContent='';}
 for(const id of ['audio','fps'])el(id).addEventListener('change',()=>{invalidate();status('Check this selection before exporting.');});
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
   token=d.csrf_token;el('version').textContent=d.title;el('note').textContent=d.note;
   el('audio').replaceChildren();const placeholder=new Option('Choose recording…','');el('audio').append(placeholder);
   for(const a of d.recordings)el('audio').append(new Option(a.label,String(a.index)));
   if(d.recordings.length===1)el('audio').value=String(d.recordings[0].index);
   el('fps').replaceChildren();for(const fps of d.supported_rates)el('fps').append(new Option(fps.includes('/')?(Number(fps.split('/')[0])/Number(fps.split('/')[1])).toFixed(3)+' fps':fps+' fps',fps));el('fps').value=d.fps;
   if(!el('fps').value)el('fps').value='25';
   for(const job of d.history||[]){const row=document.createElement('div');row.className='fcpxml-history-row';el('history').lastElementChild.append(row);const date=document.createElement('p');date.textContent=new Date(job.created_at).toLocaleString()+' — '+job.status;row.append(date);if(job.result){const links=document.createElement('div');links.className='toolbar';row.append(links);link(links,'XML',job.result.xml_url,true);link(links,'Media package',job.result.zip_url,true);}if(job.status==='preparing'){const b=document.createElement('button');b.textContent='Check progress';b.onclick=()=>poll(job.job_id,g);row.append(b);}}
   status(d.recordings.length?'Ready to check the saved edit.':'No recording is indexed for this version. Add the correct recording before exporting.');disable(false);
  }catch(e){if(g===generation){status(e.message);el('check').disabled=true;}}
 }
 el('check').onclick=async()=>{
  if(el('audio').value===''){status('Choose the exact recording first.');return;}
  const g=generation;invalidate();disable(true);status('Saving pending edits and checking media…');
  try{
   await window.ReferenceDeskBridge?.flush();
   const s=await request('/library-api/final-cut-export/preflight',selection());if(g!==generation)return;
   checked=s;mutation=crypto.randomUUID().replaceAll('-','');
   el('summary').textContent=`${s.shots} shots · ${s.duration.toFixed(2)} seconds · 1920 × 1080 · ${s.fps} fps. Saved image revision ${s.arrangement_revision}${s.timing_revision===null?'':', timing revision '+s.timing_revision}. Maximum cut rounding: ${(s.max_cut_rounding_seconds*1000).toFixed(1)} ms.${s.upscaled_images?' '+s.upscaled_images+' images will scale up to fit HD.':''}`;
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
  if(id){const b=document.createElement('button');b.type='button';b.textContent='Export Final Cut XML';b.dataset.fcpxmlId=id;document.querySelector('header').append(b);}
 }
})();
