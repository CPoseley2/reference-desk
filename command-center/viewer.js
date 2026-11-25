// Untimed boards get a review-only sequence; source/edit timing stays untouched.
function storyboardPlaybackPosition(shots,time,duration){
 const timed=shots.some(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start);
 if(timed)return {index:shots.findIndex(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&time>=s.start&&time<s.end),provisional:false};
 if(!shots.length||!Number.isFinite(duration)||duration<=0||!Number.isFinite(time))return {index:-1,provisional:true};
 return {index:Math.min(shots.length-1,Math.max(0,Math.floor(time/duration*shots.length))),provisional:true};
}
const $=id=>document.getElementById(id),local=location.protocol==='file:',id=new URLSearchParams(location.search).get('id'),entry=CATALOG.entries.find(e=>e.id===id);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));function file(p){return p?.startsWith('data:')?p:(local?'file://':'/files')+encodeURI(p||'').replace(/#/g,'%23').replace(/\?/g,'%3F')};let V,current=0,token,notes={},key,base='',timer,pending={},saving=false,conflictValue;
try{pending=JSON.parse(localStorage.getItem('owl-library-pending-v1')||'{}')}catch(e){}
function updateNoteSaveButton(){
 const disabled=local||saving||!pending[key];
 $('save').disabled=disabled;
 const label=local?'Disk saving unavailable offline':saving?'Saving notes…':pending[key]?'Save notes to disk':'No note changes to save';
 $('save').title=label;$('save').setAttribute('aria-label',label);
}
function setNoteStatus(state,message){
 const icon=$('save-state');icon.dataset.state=state;icon.setAttribute('aria-label',message);icon.title=message;
 $('save-state-symbol').textContent=({saved:'✓',pending:'●',saving:'↻',error:'!',conflict:'!',offline:'×',connecting:'…'})[state];
 $('save-status').textContent=message;
 $('feedback-toggle').dataset.state=state;
 $('feedback-toggle').title='Feedback notes · '+message;
 if(state==='conflict')window.setFeedbackOpen(true);
 updateNoteSaveButton();
}
function store(){try{localStorage.setItem('owl-library-pending-v1',JSON.stringify(pending))}catch(e){setNoteStatus('error','Browser pending storage unavailable. Keep this tab open until disk save succeeds.')}}
function noteKey(){return id+':'+($('scope').value==='shot'?(V.shots[current]?.id||'song'):'song')}
function selectNote(){key=noteKey();base=pending[key]?.base??notes[key]??'';$('note').value=pending[key]?.value??notes[key]??'';$('note-label').textContent=$('scope').value==='shot'?'Shot '+(V.shots[current]?.id||'none'):'Storyboard/version note';setNoteStatus(local?'offline':saving?'saving':pending[key]?'pending':token?'saved':'connecting',local?'OFFLINE — pending text only; disk saving requires the launcher.':saving?'Saving to disk…':pending[key]?'Unsaved pending changes':token?'Loaded from disk — no pending changes':'Connecting — disk save not yet available');$('conflict').hidden=true}
// Reuse the existing storyboard-level note and its autosave/conflict handling.
window.storyboardProductionNotes={
 text:()=>pending[id+':song']?.value??notes[id+':song']??'',
 open:()=>{window.setFeedbackOpen(true);$('scope').value='song';selectNote();$('note').scrollIntoView({block:'center',behavior:'instant'});$('note').focus({preventScroll:true});}
};
function imageMarkup(s,thumb=false){if(!s.crop||s.crop[2]===1&&s.crop[3]===1)return `<img ${thumb?'loading="lazy"':''} src="${file(s.image)}" alt="${esc(s.id)}">`;const [x,y,w,h]=s.crop;return `<div role="img" aria-label="${esc(s.id)} source panel crop" style="width:100%;aspect-ratio:16/9;background-image:url('${file(s.image)}');background-size:${100/w}% ${100/h}%;background-position:${w===1?0:x/(1-w)*100}% ${h===1?0:y/(1-h)*100}%;background-repeat:no-repeat"></div>`}function show(n){current=Math.max(0,Math.min(n,V.shots.length-1));const s=V.shots[current];if(!s){$('screen').textContent='No image references were recoverable in this page. Open the original source layout above.';return}if(s.available){const nearby=V.shots.slice(Math.max(0,current-1),current+4).filter(x=>x.available&&x.image).map(x=>({...x,url:file(x.image)}));storyboardImagePresenter.present({...s,url:file(s.image)},nearby);}else{storyboardImagePresenter.cancel();$('screen').innerHTML=(!!s.generation_prompt?'<div style="padding:32px;text-align:left"><small>PROPOSED NEW COVERAGE · NOT GENERATED</small><h2>'+esc(s.title)+'</h2><p>Full proposed prompt is available below and in the prompt readout.</p></div>':'<p>'+esc(s.status?.startsWith('Empty slot')?'Empty shot slot — choose an image below.':'No generated image available for this shot.')+'</p>');};$('counter').textContent=`${current+1} / ${V.shots.length} · ${s.id}`;$('shot-title').textContent=s.title||s.id;$('shot-status').textContent=s.status;$('prompt').textContent=s.prompt||'See original storyboard and source records.';if(!!s.generation_prompt){const label=s.generation_prompt?'Full proposed generation prompt':'Source prompt';$('source-prompt-toggle').title=label;$('source-prompt-toggle').setAttribute('aria-label',label);}document.querySelectorAll('.shot').forEach((e,i)=>e.classList.toggle('selected',i===current));if($('scope').value==='shot')selectNote();window.dispatchEvent(new CustomEvent('owl-shot-change',{detail:{index:current,shotId:s.id}}))}

const storyboardImagePresenter=createStoryboardImagePresenter({
 load:loadDecodedStoryboardImage,
 commit:(image,shot)=>{
  image.alt=shot.id;
  if(!shot.crop||(shot.crop[2]===1&&shot.crop[3]===1))$('screen').replaceChildren(image);
  else $('screen').innerHTML=imageMarkup(shot);
  $('screen').dataset.displayedShot=shot.id;
 },
 onBusy:busy=>$('screen').setAttribute('aria-busy',String(busy)),
 onError:()=>{$('shot-status').textContent='Image could not load; the previous shot remains visible. Try this shot again.';}
});

async function connect(){if(local){$('save').disabled=true;selectNote();return}try{let r=await fetch('/library-api/review',{cache:'no-store'});if(!r.ok)throw Error(r.status);let d=await r.json();token=d.csrf_token;notes=d.notes;selectNote();if(pending[key])schedule()}catch(e){setNoteStatus('error','Save service unavailable. Pending text stays in this browser; launch the library and retry.')}}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>save(),900)}
$('note').oninput=()=>{const value=$('note').value;if(!saving&&value===(notes[key]??'')){delete pending[key];store();selectNote();return}pending[key]={base:pending[key]?.base??base,value,mutation_id:crypto.randomUUID()};store();setNoteStatus(local?'offline':saving?'saving':'pending',local?'OFFLINE — pending in this browser only':saving?'Saving to disk; new edits pending…':'Unsaved changes…');schedule()};$('scope').onchange=selectNote;
async function save(requestedKey){clearTimeout(timer);const saveKey=requestedKey||Object.keys(pending)[0];if(local||saving||!saveKey||!pending[saveKey])return;if(!token){await connect();if(!token)return}const k=saveKey,p={...pending[k]};let success=false;saving=true;setNoteStatus('saving','Saving to disk…');try{const r=await fetch('/library-api/merge',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':token},body:JSON.stringify({key:k,...p})});const d=await r.json();if(r.status===409){if(k===key){conflictValue=d.disk_value;$('disk-note').textContent='Disk text:\n'+conflictValue;$('conflict').hidden=false}throw Error('Save conflict — choose which text to keep.')}if(!r.ok){if(r.status===403)token=null;throw Error(d.error||r.status)}success=true;notes[k]=d.value;if(pending[k]?.mutation_id===p.mutation_id)delete pending[k];else if(pending[k])pending[k].base=p.value;store();if(k===key){base=d.value;setNoteStatus(pending[k]?'pending':'saved',pending[k]?'New edits pending…':`Saved to disk · revision ${d.revision}`)}}catch(e){setNoteStatus(e.message.startsWith('Save conflict')?'conflict':'error','Save failed: '+e.message+' Your pending text is retained.')}finally{saving=false;updateNoteSaveButton();if(success&&Object.keys(pending).length)schedule()}}
$('save').onclick=()=>save(key);$('use-disk').onclick=()=>{notes[key]=conflictValue;delete pending[key];store();selectNote()};$('keep-mine').onclick=()=>{pending[key]={base:conflictValue,value:$('note').value,mutation_id:crypto.randomUUID()};store();$('conflict').hidden=true;save()};$('prev').onclick=()=>show(current-1);$('next').onclick=()=>show(current+1);
if(!entry){$('title').textContent='Unknown storyboard. Return to the catalog.'}else{const script=document.createElement('script');script.src='view-data/'+id+'.js';script.onload=()=>{V=window.VIEW;document.title=V.song+' • Storyboard Library';$('song').textContent=V.song;$('title').textContent=V.title;window.renderProductionNotes(V.note);$('links').innerHTML=`<a class="button" target="_blank" rel="noopener" href="${file(V.source)}">Open source manifest</a>`;$('provenance').innerHTML=`<p class="path">${esc(V.source)}</p><p>Source modified: ${esc(entry.modified)}</p><p class="path">SHA-256: ${esc(V.sha256)}</p><p>Original review controls use their own storage. Use this Library feedback panel for central disk notes.</p><p>${entry.unique_referenced_images} distinct references; ${entry.available_slots}/${entry.slots} available slots. Counts refer to this indexed layout, not all historic generations.</p><pre>${esc(entry.missing_dependencies.length?'Unresolved source references:\n'+entry.missing_dependencies.join('\n'):'No missing literal dependencies found. Dynamic source code may require its own server.')}</pre><details><summary>${entry.source_record_unresolved_references?.length||0} original historical/provenance paths absent in unchanged source layout; see repair report for resolved copies</summary><pre>${esc((entry.source_record_unresolved_references||[]).join('\n'))}</pre></details>`;$('shots').innerHTML=V.shots.map((s,i)=>`<button class="shot" data-index="${i}">${s.available?imageMarkup(s,true):'<div style="height:104px">Image pending</div>'}<small>${esc(s.id)}</small></button>`).join('');$('shots').onclick=e=>{const b=e.target.closest('[data-index]');if(b)show(Number(b.dataset.index))};if(V.audio[0])$('audio').innerHTML=`<audio id="player" controls preload="metadata" src="${file(V.audio[0])}"></audio><label class="follow-control" title="Follow source timing while audio plays"><input type="checkbox" id="sync" checked autocomplete="off" aria-label="Follow source timing while audio plays"><svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><path d="M12 3v18M3 12h6m-3-3 3 3-3 3m15-3h-6m3-3-3 3 3 3"/></svg></label>`;if($('sync'))$('sync').checked=true;if($('player')){
 const player=$('player'),timingNotice=document.createElement('p');
 timingNotice.id='playback-timing-status';const playbackTools=document.createElement('div');playbackTools.className='playback-tools';$('audio').append(playbackTools);playbackTools.append($('sync').closest('label'),timingNotice);window.compactInfo(timingNotice,'Playback timing','bulb');playbackTools.append($('prev').parentElement);playbackTools.append($('shot-status').parentElement,$('source-prompt-toggle'));window.orderPlaybackTools();
 const followTimeline=()=>{
  const position=storyboardPlaybackPosition(V.shots,player.currentTime,player.duration);
  const label=position.provisional?'Follow provisional sequence while audio plays':'Follow source timing while audio plays';
  $('sync').setAttribute('aria-label',label);$('sync').closest('label').title=label;
  const message=position.provisional?(Number.isFinite(player.duration)&&player.duration>0?
   `Provisional playback · ${V.shots.length} slots shown evenly across the song (${(player.duration/V.shots.length).toFixed(2)}s each). Shot timings remain unset.`:
   'Provisional playback · waiting for audio duration. Shot timings remain unset.'):(V.cutTimingNote||'Playback follows source shot timing.');
  if(timingNotice.textContent!==message)timingNotice.textContent=message;
  if($('sync').checked&&position.index>=0&&position.index!==current)show(position.index);
 };
 for(const event of ['timeupdate','seeking','seeked','loadedmetadata','durationchange'])player.addEventListener(event,followTimeline);
 window.addEventListener('owl-timing-change',()=>queueMicrotask(followTimeline));
 $('sync').onchange=followTimeline;
 followTimeline();
 }show(0);window.installComingPlayback?.(V,{show,getCurrent:()=>current,file});selectNote();connect();window.initPromptReadout?.();Promise.resolve(window.initStoryboardEditor?.()).finally(()=>window.ReferenceDeskBridge?.ready())};script.onerror=()=>{$('title').textContent='Inventory data unavailable — refresh the catalog.'};document.body.append(script)}

window.initPromptReadout=function(){
 const shots=V.shots.filter(s=>s.generation_prompt);if(!shots.length)return;
 const link=document.createElement('a');link.className='button';link.href='#generation-prompts';link.textContent='Read all '+shots.length+' generation prompts';$('links').append(link);
 const panel=document.createElement('details');panel.id='generation-prompts';panel.style='margin:32px 0;padding:24px;border:1px solid #59626a;border-radius:10px;scroll-margin-top:20px';
 panel.innerHTML='<summary><h2 style="display:inline;font-size:22px">ImageGen prompts and generation records</h2></summary><p>All '+shots.length+' proposed new shots, in storyboard order. Filled shots show submitted prompts and any correction requests; unfilled shots remain proposed. Preparation notes identify missing references and location decisions.</p><nav>'+shots.map(s=>'<a style="display:inline-block;margin:0 12px 10px 0" href="#prompt-'+esc(s.id)+'">'+esc(s.id)+'</a>').join('')+'</nav>'+shots.map(s=>'<article id="prompt-'+esc(s.id)+'" style="padding:22px 0;border-top:1px solid #43535d;scroll-margin-top:20px"><h3>'+esc(s.id+' - '+s.title)+'</h3><p>'+(Number.isFinite(s.start)&&Number.isFinite(s.end)?s.start.toFixed(2)+'-'+s.end.toFixed(2)+' seconds':'Untimed scene exploration')+' · '+(s.source_lines?'Script lines '+esc(s.source_lines):'User-directed staging')+'</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:16px/1.6 system-ui;max-width:1050px">'+esc(s.generation_prompt)+'</pre><details><summary>References and preparation still needed</summary><p>'+esc((s.generation_gaps||[]).join('; '))+'</p><ul>'+(s.generation_references||[]).map(r=>'<li>'+esc(r.character+' / '+r.role+' / '+r.id)+'</li>').join('')+'</ul></details><a href="#generation-prompts">Back to prompt index</a></article>').join('');
 document.querySelector('main').append(panel);
 const expandPrompt=()=>{
  const hash=location.hash;
  if(hash==='#generation-prompts'||/^#prompt-[A-Za-z0-9_-]+$/.test(hash)){
   panel.open=true;requestAnimationFrame(()=>document.getElementById(hash.slice(1))?.scrollIntoView({block:'start'}));
  }
 };
 document.addEventListener('click',e=>{const a=e.target.closest('a[href^="#prompt-"],a[href="#generation-prompts"]');if(a)panel.open=true;});
 window.addEventListener('hashchange',expandPrompt);expandPrompt();
};

window.addEventListener('owl-timing-change',()=>{if(!V)return;V.shots.forEach(s=>{const p=document.querySelector('#prompt-'+s.id+' > p');if(p)p.textContent=s.start.toFixed(2)+'–'+s.end.toFixed(2)+' seconds · Script lines '+(s.source_lines||'');});});

// Reference Desk waits for every pending note before switching modules.
window.ReferenceDeskBridge?.register('notes',{
 state:()=>({dirty:Object.keys(pending).length>0,inflight:saving,conflicted:!$('conflict').hidden}),
 flush:async()=>{
  await window.ReferenceDeskBridge.waitUntil(()=>saving);
  if(!$('conflict').hidden)throw Error('Resolve the note conflict before leaving this storyboard.');
  for(const k of Object.keys(pending)){await save(k);if(pending[k])throw Error('A storyboard note has not saved. Check Save to disk and resolve any conflict before leaving.');}
 }
});
