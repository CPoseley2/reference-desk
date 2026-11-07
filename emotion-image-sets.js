/* Emotion set UI reuses single-emotion prompts, reference validation, API jobs,
   registration and the existing review/assignment flow. */
(()=>{
'use strict';
const prefix='desk-emotion-set-v1:',lockName=DESKContext.id+':desk-emotion-set-worker-v1';let working=false,modalId=null;
function read(id){try{return JSON.parse(DESKStorage.getItem(prefix+id)||'null');}catch{return null;}}
function all(){const rows=[];for(let i=0;i<DESKStorage.length;i++){const key=DESKStorage.key(i);if(key.startsWith(prefix)){const row=read(key.slice(prefix.length));if(row?.id&&Array.isArray(row.items))rows.push(row);}}return rows.sort((a,b)=>b.created_at-a.created_at);}
function persist(set){DESKStorage.setItem(prefix+set.id,JSON.stringify(set));update();}
function receive(job){if(window.DESKGenerationActivity)DESKGenerationActivity.track(job);else if(job.status==='completed')DESKGeneration.merge(job);}
const runner=DESKEmotionSetQueue.create({get:path=>DESKGeneration.get(path),post:(path,value)=>DESKGeneration.post(path,value),save:persist,receive});
async function tick(){
 if(working||!navigator.locks)return;working=true;
 try{await navigator.locks.request(lockName,{ifAvailable:true},async lock=>{if(!lock)return;const set=all().reverse().find(x=>x.status==='running');if(set)await runner.tick(set);});}
 catch(e){console.error('Emotion set progress could not be saved',e);}
 finally{working=false;}
}
function progress(set){return set.items.filter(x=>x.state==='completed').length+'/'+set.items.length;}
const setupRefresh=new WeakMap();
function emotionGroups(c,names){
 const labelled=new Set(D.assets.filter(a=>a.character_ids.includes(c.id)&&a.type==='Individual emotion'&&effectiveStatus(a)!=='Obsolete').map(a=>emotionImageName(a).toLocaleLowerCase()).filter(Boolean));
 const mapped=[],missing=[];
 for(const name of names){
  const selected=!!emotionSlotState(c,name).reference;
  (selected||labelled.has(name.toLocaleLowerCase())?mapped:missing).push({name,selected});
 }
 return {mapped,missing};
}
function emotionChips(c,names){
 const {mapped,missing}=emotionGroups(c,names);
 return [{title:'Mapped images',className:'is-mapped',items:mapped},{title:'No mapped image',className:'is-missing',items:missing}].map(group=>`<section class="emotion-set-label-group ${group.className}"><h3>${group.title} <span>(${group.items.length})</span></h3>${group.items.length?`<ul class="emotion-set-labels">${group.items.map(item=>`<li title="${item.selected?'Selected reference mapped':group.className==='is-mapped'?'Matching image available; may still need approval or selection':'No image mapped to this emotion'}">${esc(item.name)}</li>`).join('')}</ul>`:'<p class="small">None</p>'}</section>`).join('');
}
function refreshEmotionChips(){
 const host=document.querySelector('[data-emotion-set-chips]'),c=host&&people.get(host.dataset.emotionSetChips);
 if(c)setupRefresh.get(host.closest('.emotion-set-setup'))?.();
}
function update(){
 for(const b of document.querySelectorAll('[data-emotion-set]')){const set=all().find(x=>x.character_id===b.dataset.emotionSet&&['running','paused'].includes(x.status));b.textContent=set?'Image set · '+progress(set)+(set.status==='paused'?' · Paused':''):'Create image set';}
 const host=document.querySelector('[data-emotion-set-progress]');if(!host||!modalId)return;
 const set=read(modalId);if(!set)return;
 host.innerHTML=`<div class="emotion-set-progress-heading"><strong>${progress(set)} images saved</strong><span>${esc(set.status)}</span></div><p role="status">${esc(set.message||'Queued')}</p><div class="emotion-set-items">${set.items.map(item=>{const a=item.asset_id&&assets.get(item.asset_id);return `<article>${a?`<img src="${esc(a.thumbnail||a.asset)}" alt="${esc(item.name)} candidate">`:'<span class="emotion-set-placeholder" aria-hidden="true">◌</span>'}<div><strong>${esc(item.name)}</strong><p class="small">${esc(item.state==='planned'?'Waiting':item.state==='completed'?'Saved · Awaiting review':item.message||item.state)}</p>${item.asset_id?`<button type="button" data-image="${esc(item.asset_id)}" data-selection-character="${esc(set.character_id)}" data-selection-role="${esc('individual-emotion:'+item.name)}">Review image</button>`:''}</div></article>`;}).join('')}</div><div class="emotion-set-controls">${set.status==='running'?'<button type="button" data-set-action="pause">Pause remaining images</button>':''}${set.status==='paused'?`<button type="button" data-set-action="resume">${set.items.some(x=>['failed','interrupted','save_failed'].includes(x.state))?'Skip failed image & continue':'Resume set'}</button>${set.items.some(x=>x.state==='save_failed')?'<button type="button" data-set-action="save">Retry saving image · no generation charge</button>':''}`:''}<button type="button" data-emotion-bulk="${esc(set.character_id)}">Review &amp; assign matching images</button></div>`;
}
function showProgress(set){modalId=set.id;openModal('Emotion image set · '+people.get(set.character_id)?.name,'<section data-emotion-set-progress></section><div class="emotion-set-help" aria-label="Image set information"><details><summary aria-label="About emotion image approvals" title="About emotion image approvals"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/></svg></summary><p>Images are labelled by emotion and remain unapproved. Existing selected references are preserved.</p></details><details><summary aria-label="Tip: keeping the image set running" title="Tip: keeping the image set running"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/></svg></summary><p>Keep a reference desk tab open to process the remaining images. You can close this dialog. If all tabs close, the current image continues on the server and the set resumes when you reopen the desk.</p></details></div>');update();}
function open(cid){
 const c=people.get(cid);if(!c)return;
 const previous=all().find(x=>x.character_id===cid&&['running','paused'].includes(x.status));if(previous){showProgress(previous);return;}
 const names=emotionNames(c),selected=canonCurrent(cid).likeness,identity=selected&&canonImage(selected),latest=all().find(x=>x.character_id===cid);
 modalId=null;
 openModal('Create emotion image set · '+c.name,`<section class="emotion-set-setup"><p data-set-intro></p><div class="emotion-set-identity">${identity?`<img src="${esc(identity.asset)}" alt="Selected likeness for ${esc(c.name)}"><div><strong>${esc(c.name)} · Saved likeness</strong><p class="small">${esc(selected.id)}</p></div>`:'<p>Choose a saved likeness before generating the set.</p><button type="button" data-set-choose-face>Choose likeness</button>'}</div><div data-emotion-set-chips="${esc(cid)}" data-emotion-names="${esc(JSON.stringify(names))}">${emotionChips(c,names)}</div><label>Image quality<select data-set-quality><option value="medium">Medium</option><option value="high">High</option></select></label><label>Shared expression direction · Optional<textarea data-set-direction rows="2" maxlength="1200" placeholder="For example: restrained, natural expressions"></textarea></label><details class="emotion-set-prompts"><summary data-set-prompt-count></summary><div data-set-prompts></div></details><p class="small" data-set-billing></p><button type="button" class="studio-primary" data-set-start disabled>Generate missing images</button><p role="status" data-set-status>Checking the image API…</p>${latest?'<button type="button" data-set-history>View previous set · '+progress(latest)+'</button>':''}</section>`);
 const host=document.querySelector('.emotion-set-setup'),status=host.querySelector('[data-set-status]'),button=host.querySelector('[data-set-start]');let ready=false,busy=false,connectionMessage='Checking the image API…';
 const missingNames=()=>emotionGroups(c,names).missing.map(item=>item.name);
 const prompts=()=>{host.querySelector('[data-set-prompts]').innerHTML=missingNames().map(n=>`<details><summary>${esc(n)}</summary><pre>${esc(emotionPrompt(c,n,host.querySelector('[data-set-direction]').value,selected))}</pre></details>`).join('');};
 const refresh=()=>{
  const count=missingNames().length,images=count===1?'image':'images';
  host.querySelector('[data-emotion-set-chips]').innerHTML=emotionChips(c,names);
  host.querySelector('[data-set-intro]').textContent=count?`Generate ${count} separate ${images}, one face-only square close-up for each emotion under “No mapped image”. Emotions with mapped images are skipped.`:'Every listed emotion already has a mapped image. No generation is needed.';
  host.querySelector('[data-set-prompt-count]').textContent=count?`Review the ${count} missing-emotion ${count===1?'prompt':'prompts'}`:'No missing-emotion prompts';
  host.querySelector('[data-set-billing]').textContent=count?`Uses your OpenAI API billing for ${count} ${images}, generated one at a time. New candidates do not replace approved selections.`:'No API calls will be made.';
  button.textContent=count?`Generate ${count} missing ${images}`:'All emotions have mapped images';
  button.disabled=!ready||busy||!count;
  status.textContent=!count?'All emotions have mapped images. Nothing to generate.':connectionMessage;
  prompts();
 };
 setupRefresh.set(host,refresh);refresh();host.querySelector('[data-set-direction]').oninput=prompts;
 host.querySelector('[data-set-choose-face]')?.addEventListener('click',()=>referenceChooser(cid,'likeness'));
 host.querySelector('[data-set-history]')?.addEventListener('click',()=>showProgress(latest));
 DESKGeneration.get('api/generation/config').then(config=>{if(!host.isConnected)return;ready=config.configured&&!!identity&&!!navigator.locks;connectionMessage=!navigator.locks?'This browser does not support safe set coordination. Use a current browser.':!identity?'Save a likeness first.':!config.configured?config.message:config.active_job?'Ready. The set will wait for the current request to finish.':'Ready to generate only the missing emotions.';refresh();}).catch(e=>{if(host.isConnected){connectionMessage=e.message;refresh();}});
 button.onclick=async()=>{
  if(!ready||busy||!missingNames().length)return;busy=true;button.disabled=true;
  try{await navigator.locks.request(lockName,async()=>{
   const existing=all().find(x=>x.character_id===cid&&['running','paused'].includes(x.status));if(existing){showProgress(existing);return;}
   // Recheck mappings under the cross-tab lock before snapshotting paid requests.
   const missing=missingNames();if(!missing.length){busy=false;refresh();return;}
   const id=crypto.randomUUID(),context=host.querySelector('[data-set-direction]').value,quality=host.querySelector('[data-set-quality]').value;
   // Snapshot every prompt and exact input before queueing any generation.
   const items=missing.map(name=>({name,state:'planned',payload:{...DESKReferenceGeneration.character(cid,'Individual emotion',null,emotionPrompt(c,name,context,selected)),emotion:name,emotion_set_id:id,aspect:'1:1 square',quality,request_id:crypto.randomUUID()}}));
   if(items.some(item=>!item.payload.input_references.some(r=>r.role==='identity'&&r.id===selected.id&&r.sha256===selected.source_sha256)))throw Error('The saved likeness changed. Reopen Create image set to use the latest choice.');
   const set={id,character_id:cid,created_at:Date.now(),status:'running',message:'Queued for generation.',items};persist(set);showProgress(set);
  });void tick();}catch(e){if(host.isConnected){busy=false;connectionMessage=e.message;refresh();}}
 };
}
document.addEventListener('click',async event=>{
 const opener=event.target.closest('[data-emotion-set]');if(opener){open(opener.dataset.emotionSet);return;}
 const action=event.target.closest('[data-set-action]');if(!action||!modalId)return;
 action.disabled=true;
 try{await navigator.locks.request(lockName,async()=>{
  const set=read(modalId);if(!set)return;
  if(action.dataset.setAction==='pause'){set.status='paused';set.message='Paused. Any image already submitted will finish on the server.';}
  if(action.dataset.setAction==='resume'){for(const item of set.items)if(['failed','interrupted','save_failed'].includes(item.state))item.state='skipped';set.status='running';set.message='Continuing remaining images.';}
  if(action.dataset.setAction==='save'){
   const item=set.items.find(x=>x.state==='save_failed');if(item){const job=await DESKGeneration.post('api/generation/jobs/'+item.job_id+'/retry-save',{});item.state=job.status;item.asset_id=job.assets?.[0]?.id||job.asset_id;item.message=job.message;receive(job);set.status='running';}
  }
  persist(set);
 });void tick();}catch(e){const host=document.querySelector('[data-emotion-set-progress]');if(host){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=e.message;host.append(p);}action.disabled=false;}
});
window.addEventListener('desk-storage',e=>{if(e.key?.startsWith(prefix)){update();void tick();}});
window.addEventListener('desk-catalog-changed',()=>{update();refreshEmotionChips();});
window.addEventListener('desk-approval-saved',refreshEmotionChips);
window.DESKEmotionImageSets={open};
update();void tick();setInterval(tick,3500);
})();
