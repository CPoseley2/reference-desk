/* Explicit local API jobs. Keys and input image bytes never enter browser storage. */
(()=>{
'use strict';
const active=new Set(['queued','generating','saving']);
async function get(path){const r=await fetch(path,{cache:'no-store'});const v=await r.json();if(!r.ok)throw Object.assign(Error(v.error||'Could not read generation status.'),{status:r.status});return v;}
async function post(path,value){
 const state=await get('api/review');let r;
 try{r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':state.csrf_token},body:JSON.stringify(value)});}catch{throw Object.assign(Error('Connection interrupted. Retry this submission to recover the same job; a second generation will not be sent.'),{uncertain:true});}
 let v;try{v=await r.json();}catch{throw Object.assign(Error('Response interrupted. Retry this submission to recover the same job.'),{uncertain:true});}
 if(!r.ok)throw Object.assign(Error(v.error||'Generation request failed.'),{status:r.status});return v;
}
function merge(job){
 for(const a of job.assets||[]){if(assets.has(a.id))Object.assign(assets.get(a.id),a);else{D.assets.push(a);assets.set(a.id,a);}}
 for(const c of job.characters||[])if(people.has(c.id))Object.assign(people.get(c.id),c);
 for(const l of job.locations||[]){const old=D.locations?.find(x=>x.id===l.id);if(old)Object.assign(old,l);else(D.locations??=[]).push(l);}
 window.dispatchEvent(new Event('desk-catalog-changed'));
}
function mount(host,cid,options={}){
 const key=options.storageKey||'desk-image-job:'+cid;let model=null,ready=false,busy=false,submitting=false,queueEnabled=false,job=null,timer=null,pending=null,closed=false,applied=null,preparationReasons=['Create a prompt above to prepare your image.'],connectionReason='Checking the image API connection…',requestError='';
 const blockersId='generation-blockers-'+crypto.randomUUID();
 const reasonsOf=e=>Array.isArray(e.reasons)?e.reasons:[e.message||String(e)];
 try{pending=JSON.parse(DESKStorage.getItem(key)||'null');}catch{}
 host.innerHTML=`<section class="explore-generation"><div class="explore-generation-heading"><div><p class="eyebrow">GENERATE ON THIS MAC</p><h3>Create the image here</h3></div><section class="generation-help-controls" aria-label="Generation information"><details class="generation-help"><summary aria-label="API key and connection status" title="API key and connection status"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l3-3M19 19l3-3"/></svg></summary><div class="generation-help-popover"><p data-gen="connection" class="small" role="status">Checking image API…</p></div></details><details class="generation-help"><summary aria-label="Image generation information" title="Image generation information"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></svg></summary><div class="generation-help-popover"><p class="small">One image per click. Uses your OpenAI API credits or paid API billing. Results are saved for review as unapproved candidates.</p></div></details><button type="button" data-gen="refresh" title="Check server connection">Refresh connection</button></section></div><div class="explore-generation-controls"><label>Image quality<select data-gen="quality"><option value="medium">Medium</option><option value="high">High</option></select></label><button type="button" class="explore-generate-button" data-gen="submit" aria-describedby="${blockersId}" disabled>Generate one image</button><div class="generation-progress" data-gen="progress" role="progressbar" aria-label="Generating image" hidden><span class="generation-progress-sweep" aria-hidden="true"></span><span class="generation-progress-label" data-gen="progress-label">Submitting…</span></div><details class="generation-notice" data-gen="blockers" hidden><summary data-gen="notice" aria-label="Why generation needs attention" aria-controls="${blockersId}">!</summary><div class="generation-blockers" id="${blockersId}" role="status" aria-live="polite"><strong data-gen="blocker-heading"></strong><ul data-gen="blocker-list"></ul></div></details></div><p data-gen="status" role="status" aria-live="polite">Create a prompt above to prepare your image.</p><div data-gen="result" class="explore-generation-result"></div><button type="button" data-gen="retry" hidden>Retry saving image (no generation charge)</button><details><summary>API setup</summary><p>On this Mac, open <strong>Set Up Image API.command</strong> in the reference desk folder. Paste your API key into its private Terminal prompt, then refresh the connection here. The key stays on the server, outside the website.</p><p><a href="https://platform.openai.com/settings/organization/api-keys" target="_blank" rel="noopener">Create an API key</a> · <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">API credits & billing</a></p><p class="small" data-gen="model"></p></details></section>`;
 host.addEventListener('toggle',e=>{if(e.target.matches('.generation-help')&&e.target.open)for(const other of host.querySelectorAll('.generation-help[open]'))if(other!==e.target)other.open=false;},true);
 host.addEventListener('keydown',e=>{const help=e.target.closest('.generation-help');if(e.key==='Escape'&&help?.open){e.preventDefault();e.stopPropagation();help.open=false;help.querySelector('summary').focus({preventScroll:true});}});
 const el=name=>host.querySelector('[data-gen="'+name+'"]');
 const alive=()=>!closed&&host.isConnected;
 function persist(){try{if(pending)DESKStorage.setItem(key,JSON.stringify(pending));else DESKStorage.removeItem(key);}catch{}}
 function controls(){
  const reasons=[];

  if(!ready)reasons.push(connectionReason);
  if(!model&&!pending?.unconfirmed){
   let issues=[];try{issues=options.getBlockers?.()||[];}catch(e){issues=reasonsOf(e);}
   reasons.push(...issues,...preparationReasons);
  }
  const canQueue=queueEnabled&&busy&&!submitting&&!pending?.unconfirmed&&active.has(job?.status);
  const blocked=(busy&&!canQueue)||!ready||(!model&&!pending?.unconfirmed);
  el('submit').disabled=blocked;el('quality').disabled=(busy&&!canQueue)||!!pending?.unconfirmed;
  el('submit').textContent=pending?.unconfirmed?'Retry this submission':canQueue?'Queue another image':job?.status==='completed'?'Generate another image':'Generate one image';
  if(requestError)reasons.push(requestError);
  const unique=busy&&!canQueue?[]:[...new Set(reasons.filter(Boolean))];
  el('submit').hidden=busy&&!canQueue;el('progress').hidden=!busy;
  const phase=pending?.unconfirmed?'Submitting image request…':({queued:job?.queue_position?'Queued · position '+job.queue_position:'Queued — waiting to generate…',generating:'Generating image…',saving:'Saving image…'}[job?.status]||'Saving image…');
  el('progress-label').textContent=phase;el('progress').setAttribute('aria-label',phase);
  el('progress').title='The API does not report a completion percentage. Follow the current stage here or in Image requests.';
  el('progress').closest('.explore-generation-controls').setAttribute('aria-busy',String(busy));
  el('blockers').hidden=!unique.length;
  el('status').hidden=!!unique.length&&!busy;
  if(!unique.length)el('blockers').open=false;
  el('notice').title=unique.join('\n');
  el('notice').setAttribute('aria-label','Generation notice: '+unique.join(' '));
  el('blocker-heading').textContent=blocked?'Generation is unavailable': 'The last request needs attention';
  const html=unique.map(r=>`<li>${esc(r)}</li>`).join('');if(el('blocker-list').innerHTML!==html)el('blocker-list').innerHTML=html;
  el('submit').title=blocked?unique.join(' '):'';
 }
 function schedule(){clearTimeout(timer);if(alive())timer=setTimeout(poll,2000);}
 function show(v){
  window.DESKGenerationActivity?.track(v);job=v;busy=active.has(v.status);requestError=['failed','interrupted','save_failed'].includes(v.status)?(v.message||'The image request failed. Review the status below before trying again.')+(v.status==='save_failed'?' Use Retry saving image below to save the existing result without a new generation charge.':''):'';el('status').textContent=(v.message||v.status)+(busy?' You can close this dialog; follow progress in Image requests.':'');el('retry').hidden=v.status!=='save_failed';controls();
  if(v.status==='completed'&&applied!==v.id){applied=v.id;merge(v);const a=v.assets?.[0];if(a&&options.onResult)options.onResult(a,v);else if(a)el('result').innerHTML=`<img src="${esc(a.asset)}" alt="${esc(a.title)}"><div><strong>Unapproved candidate</strong><p>${esc(a.title)}</p><p class="small">${esc(a.id)} · ${v.job_kind==='studio'?'saved with tags'+(v.character_id?' · character linked':'')+(v.location_id?' · location linked':''):v.job_kind==='reference'?(v.location_id?'saved to this location':'saved to this character'+(v.look_id?' and look':'')):'saved to this look'+(v.locations?.length?' and location':'')}</p><a href="${esc(a.asset)}" target="_blank" rel="noopener">Open full image</a></div>`;}
  if(busy)schedule();
 }
 async function poll(){
  if(!alive()||!pending?.id)return;
  const polledId=pending.id;
  try{const v=await get('api/generation/jobs/'+polledId);if(!alive()||pending?.id!==polledId)return;pending.unconfirmed=false;persist();show(v);}catch(e){if(!alive()||pending?.id!==polledId)return;el('status').textContent='Status unavailable. The server may still be working. Refresh the connection to resume.';busy=false;controls();}
 }
 async function refresh(){
  try{const v=await get('api/generation/config');if(!alive())return;ready=v.configured;queueEnabled=v.queue_supported===true;connectionReason=ready?'':(v.message||'The server API key is not configured.')+' Open API setup below, then use Refresh connection.';el('connection').textContent=v.message;el('model').textContent='Model: '+v.model;controls();if(pending?.id)await poll();else if(v.active_jobs?.length||v.active_job){const activeId=v.generation_lanes?.character?.active_job||v.active_jobs?.[0]||v.active_job;const other=await get('api/generation/jobs/'+activeId);if(!options.storageKey&&other.character_id===cid){pending={id:other.id};persist();show(other);}else el('status').textContent='Another image is generating. Submit your next image to join the queue.';}}
  catch{if(!alive())return;ready=false;connectionReason='Cannot reach the generation server. Start the reference desk with Start Reference Desk.command, then use Refresh connection.';el('connection').textContent=connectionReason;controls();}
 }
 el('refresh').onclick=refresh;
 el('submit').onclick=async()=>{
  if(submitting||!ready||(busy&&(!queueEnabled||pending?.unconfirmed||!active.has(job?.status))))return;
  clearTimeout(timer);
  if(!pending?.unconfirmed){
   if(!model)return;
   const references=[['identity',model.identity],['costume',model.costume],['body',model.body?.id!==model.costume?.id?model.body:null],['hairstyle',model.hairstyle],['emotion',model.emotion],['location',model.settingMode==='location'?model.locationRef:null]].filter(([,r])=>r).map(([role,r])=>({role,id:r.id,sha256:r.sha256}));
   let custom;try{custom=options.request?.();}catch(e){model=null;preparationReasons=reasonsOf(e);el('status').textContent=e.message;controls();return;}
   const id=crypto.randomUUID();pending={id:id.replaceAll('-',''),unconfirmed:true,payload:custom?{...custom,request_id:id,quality:el('quality').value}:{request_id:id,character_id:cid,look_id:model.look.id,prompt:document.getElementById('explore-prompt').value,aspect:model.aspect,quality:el('quality').value,setting_mode:model.settingMode,limbo_id:model.settingMode==='limbo'?model.limboId:null,location_id:model.settingMode==='location'?model.location.id:null,action:{id:model.action.id},input_references:references}};persist();
  }
  requestError='';submitting=true;busy=true;controls();el('status').textContent='Submitting one image…';el('result').replaceChildren();el('retry').hidden=true;
  try{const v=await post('api/generation/jobs',pending.payload);pending={id:v.id};submitting=false;persist();window.DESKGenerationActivity?.track(v);if(alive())show(v);}
  catch(e){submitting=false;if(!e.uncertain){pending=null;persist();}busy=false;if(alive()){requestError=e.message;el('status').textContent=e.message;controls();}}
 };
 el('retry').onclick=async()=>{if(busy||!pending)return;busy=true;el('retry').disabled=true;controls();try{const v=await post('api/generation/jobs/'+pending.id+'/retry-save',{});if(alive())show(v);}catch(e){if(alive()){requestError=e.message;el('status').textContent=e.message;}}finally{busy=false;if(alive()){el('retry').disabled=false;controls();}}};
 if(host.closest('#modal'))document.getElementById('modal').addEventListener('close',()=>{closed=true;clearTimeout(timer);},{once:true});
 refresh();
 return {prepare(value){const wasUnprepared=preparationReasons.length>0;model=value;preparationReasons=[];requestError='';controls();if(!busy&&(!job||wasUnprepared))el('status').textContent='Prompt ready. Generate one image when you are ready.';},invalidate(reason){model=null;preparationReasons=Array.isArray(reason)?reason:[reason||'Choices changed. Click Create prompt above to prepare the updated request.'];requestError='';controls();if(!busy&&!pending?.unconfirmed)el('status').textContent=preparationReasons.join(' ');}};
}
window.DESKGeneration={mount,merge,get,post};
})();
