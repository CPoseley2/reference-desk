/* Location beta editor. The server owns revision history; drafts never carry API keys. */
(()=>{
'use strict';
const running=new Set(['queued','generating','saving']);
const exact=a=>a?{id:a.id,sha256:a.sha256}:null;
const opt=(v,t,current)=>`<option value="${esc(v)}" ${v===current?'selected':''}>${esc(t)}</option>`;
const locationFor=id=>D.locations.find(l=>l.id===id);
const slotName=id=>(D.location_slots||[]).find(s=>s.id===id)?.label||id;
function linkedImageIds(l){
 return new Set([l.canonical_source?.id,...Object.values(l.references||{}).flat()]);
}
function library(l){
 const ids=linkedImageIds(l);
 return [...ids].map(id=>assets.get(id)).filter(a=>a&&effectiveStatus(a)!=='Obsolete');
}
function button(l,slot,asset,label='Generate (beta)'){
 return `<button type="button" class="location-beta-launch" data-location-beta="${esc(l.id)}" data-beta-slot="${esc(slot||'scene-references')}" ${asset?`data-beta-asset="${esc(asset.id)}"`:''}>${esc(label)}</button>`;
}
async function open(locationId,options={}){
 const l=locationFor(locationId);if(!l)return;
 let turns=[],session=crypto.randomUUID().replaceAll('-',''),selected=null,seed=assets.get(options.assetId)||null;
 let slot=options.slotId||'scene-references',sceneKey=options.sceneKey||null,requirementId=options.requirementId||null;
 if(!seed&&!options.turnId){const chosen=l.selections?.[slot]||l.canonical_source,a=chosen&&assets.get(chosen.id);if(a&&a.sha256===chosen.source_sha256&&effectiveStatus(a)!=='Obsolete')seed=a;}
 let mode=seed?'refine':'generate',busy=false,ready=false,closed=false,timer=null,pending=null,following=null,loaded=false;
 let approvalSnapshot=null,planSnapshot=null,selectionSnapshot=null;
 let storyboardContext=options.storyboardContext||null;
 const merged=new Set(),pendingKey='desk-location-beta-pending:'+locationId+(storyboardContext?':'+storyboardContext.storyboard_id+':'+storyboardContext.shot_id:'');
 try{pending=JSON.parse(DESKStorage.getItem(pendingKey)||'null');}catch{}
 const persist=()=>{try{if(pending)DESKStorage.setItem(pendingKey,JSON.stringify(pending));else DESKStorage.removeItem(pendingKey);}catch{}};
 openModal('Generate (beta) · '+l.name,`<section class="location-beta-editor" aria-label="Location image editing"><div class="beta-top"><div class="beta-switch" role="group" aria-label="Generator"><button type="button" data-beta-classic>Generate</button><button type="button" aria-current="page" class="active">Generate (beta)</button></div><button type="button" data-beta-refresh>Refresh</button></div><p class="small">Refine an image in a conversation. Every result is saved as a new candidate.</p><div class="beta-session-controls"><label>Saved editing sessions<select id="betaSession"><option value="">New session</option></select></label><button type="button" id="betaNew">New session from selected image</button></div><div class="beta-layout"><div class="beta-canvas"><div id="betaPreview"></div><div class="beta-preview-tools"><label><input type="checkbox" id="betaCompare"> Compare with parent</label><span id="betaImageStatus" class="small"></span></div><section class="beta-supporting" aria-label="Supporting reference images"><div class="beta-supporting-heading"><h3>Reference images <span id="betaReferenceCount"></span></h3><button type="button" id="betaAddReference" aria-expanded="false" aria-controls="betaReferencePicker">＋ Add reference image</button></div><p class="small">Add a church, building or other visual guide. Tell us what to use from it in “What should change?”</p><div id="betaAttachedReferences" class="beta-attached-references"></div><section id="betaReferencePicker" hidden><div class="beta-supporting-heading"><h4>Choose supporting images</h4><button type="button" id="betaReferencesDone">Done</button></div><label>Image library<select id="betaReferenceScope"><option value="location">This location · all views</option><option value="all">All Reference Desk images</option></select></label><label>Search images<input type="search" id="betaReferenceSearch" placeholder="Church, image title or tag"></label><p id="betaReferenceMatches" class="small" role="status"></p><div id="betaReferences" class="beta-reference-grid"></div></section><p class="small">Selected references are attached with the starting image. Using an image does not approve it. References from elsewhere are linked to this location when you generate.</p></section><div id="betaVersions" class="beta-versions" aria-label="Saved revisions"></div><p id="betaLastDirection" class="small"></p><div id="betaJobs" role="status" aria-live="polite"></div></div><form id="betaForm" class="beta-form"><label>Location view<select id="betaView"></select></label><p id="betaScope" class="small"></p><label>Starting image<select id="betaSeed"></select></label><label>Action<select id="betaOperation"><option value="refine">Refine selected image</option><option value="generate">Generate a new composition</option></select></label><label id="betaInstructionLabel" for="betaInstruction">What should change?</label><textarea id="betaInstruction" rows="4" maxlength="6000" placeholder="Make it moonlit. Keep the shoreline and buildings."></textarea><details class="beta-references"><summary>References & continuity</summary><label>Keep consistent<textarea id="betaContinuity" rows="3" maxlength="6000" placeholder="Shoreline, landmark positions, materials…"></textarea></label><label class="beta-check"><input type="checkbox" id="betaRestart"> Start fresh from these images and notes</label><p class="small">Use this when changing the design direction or references. Earlier revisions remain saved.</p></details><div class="beta-settings"><label>Format<select id="betaAspect"><option>16:9 widescreen</option><option>3:2 landscape</option><option>2:3 portrait</option><option>1:1 square</option></select></label><label>Quality<select id="betaQuality"><option value="medium">Medium</option><option value="high">High</option></select></label></div><div class="beta-submit-row"><button type="submit" id="betaSubmit" class="location-generate-primary" disabled>Generate revision</button><span id="betaSubmitHelp" class="beta-submit-help" hidden><button type="button" id="betaSubmitWarning" aria-label="Why generation is unavailable" aria-describedby="betaSubmitReason">!</button><span id="betaSubmitReason" role="tooltip"></span></span></div><p id="betaMessage" role="status" aria-live="polite">Loading saved sessions…</p><section class="beta-adoption" id="betaAdoption" hidden><h3>Use this image</h3><label>Destination<select id="betaDestination"></select></label><p id="betaDestinationNote" class="small"></p><button type="button" id="betaApprove">Approve image</button><p id="betaApprovalMessage" role="status" aria-live="polite"></p></section></form></div></section>`);
 const host=document.querySelector('.location-beta-editor'),q=id=>host.querySelector('#'+id),alive=()=>!closed&&host.isConnected;
 let referenceLocked=false;
 let unavailableReason='Checking image generation availability…';
 let references=new Set((storyboardContext?[]:Object.values(l.selections||{})).map(r=>r.id).filter(id=>id!==seed?.id).slice(0,6));
 function renderStoryboardContext(){
  host.querySelector('.beta-storyboard-context')?.remove();if(!storyboardContext)return;
  const c=storyboardContext,back='http://127.0.0.1:8899/viewer.html?id='+c.storyboard_id+'#slot-'+c.slot_number;
  const section=document.createElement('section');section.className='beta-storyboard-context notice';
  section.innerHTML=`<strong>${esc(c.song)} · Slot ${esc(c.slot_number)} · ${esc(c.shot_id)}</strong><p>${esc(c.title)}</p><p>${effectiveStatus(assets.get(c.asset_id))==='Obsolete'?'This starting image is marked obsolete. Revising it creates a new candidate and leaves that status unchanged. ':''}Revise the attached shot below. Your changes take priority over the saved prompt. Generating saves a new candidate; the storyboard image stays unchanged.</p><details><summary>Saved shot prompt</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(c.prompt)}</pre></details><p><a href="${esc(back)}" target="_blank" rel="noopener">Return to Slot ${esc(c.slot_number)}</a> · Choose your revision from the storyboard’s Reference Desk images.</p>`;
  host.querySelector('.beta-top').after(section);
 }
 renderStoryboardContext();
 function message(text){if(alive())q('betaMessage').textContent=text;}
 function current(){return selected?assets.get(selected.asset_id):seed;}
 function blockedReason(){
  if(!ready)return unavailableReason;
  if(busy)return 'Wait for the current operation to finish.';
  if(turns.some(t=>t.editing.session_id===session&&running.has(t.status)))return 'An image request is already in progress in this session.';
  if(pending)return '';
  if(!q('betaInstruction').value.trim())return 'Enter instructions for the image first.';
  if(mode==='refine'&&!current())return 'Choose a starting image to refine.';
  const parent=current();
  const exactStoryboardParent=mode==='refine'&&storyboardContext?.asset_id===parent?.id&&storyboardContext?.sha256===parent?.sha256;
  if(parent&&effectiveStatus(parent)==='Obsolete'&&!exactStoryboardParent)return 'This image is obsolete. Open its storyboard slot and choose Revise image, or choose an active starting image.';
  if(references.size>6)return 'Choose at most six supporting references.';
  if([...references].some(id=>id!==current()?.id&&(!assets.get(id)||effectiveStatus(assets.get(id))==='Obsolete')))return 'A supporting image is unavailable. Choose another.';
  return '';
 }
 function controls(){
  if(!alive())return;
  const ownActive=turns.some(t=>t.editing.session_id===session&&running.has(t.status));
  const reason=blockedReason();
  q('betaSubmit').disabled=!!reason;
  q('betaSubmitHelp').hidden=!reason;
  q('betaSubmitWarning').title=reason;
  q('betaSubmitReason').textContent=reason;
  q('betaSubmit').textContent=pending?'Retry this submission':ownActive?'Request in progress…':mode==='refine'?'Generate revision':'Generate image';
  for(const el of q('betaForm').querySelectorAll('input,textarea,select'))el.disabled=busy||!!pending||ownActive;
  referenceLocked=busy||!!pending||ownActive;
  for(const el of host.querySelectorAll('.beta-supporting input,.beta-supporting select,.beta-supporting button'))el.disabled=referenceLocked||(el.dataset.betaReference&&!el.checked&&references.size>=6);
  q('betaNew').disabled=busy||!!pending;q('betaSession').disabled=busy||!!pending;
  q('betaSeed').disabled=busy||!!pending||ownActive||!!selected;
  q('betaInstructionLabel').textContent=mode==='refine'?'What should change?':'What should the new image show?';
 }
 function renderReferences(){
  const search=q('betaReferenceSearch').value.trim().toLowerCase(),parent=current();
  references.delete(parent?.id);
  const available=q('betaReferenceScope').value==='all'?[...assets.values()].filter(a=>effectiveStatus(a)!=='Obsolete'):library(l);
  const matches=available.filter(a=>a.id!==parent?.id&&(!search||[a.title,...(a.tags||[])].join(' ').toLowerCase().includes(search)));
  q('betaReferenceCount').textContent=references.size+' / 6';
  q('betaReferenceMatches').textContent=matches.length+' matching images. Choose up to six.';
  q('betaReferences').innerHTML=matches.map(a=>`<label class="beta-reference"><input type="checkbox" data-beta-reference="${esc(a.id)}" ${references.has(a.id)?'checked':''}><img src="${esc(a.thumbnail||a.asset)}" alt="" loading="lazy"><span>${esc(a.title)}</span><small>${esc(DESKLocations.status(a,l))}</small></label>`).join('')||'<p class="small">No matching images. Try All Reference Desk images or a different search.</p>';
  q('betaAttachedReferences').innerHTML=[...references].map(id=>{const a=assets.get(id);return a?`<article><a href="${esc(a.asset)}" target="_blank" rel="noopener"><img src="${esc(a.thumbnail||a.asset)}" alt="${esc(a.title)}"></a><span>${esc(a.title)}</span><small>${esc(DESKLocations.status(a,l))}</small><button type="button" data-beta-remove-reference="${esc(id)}" aria-label="Remove reference: ${esc(a.title)}">Remove</button></article>`:'';}).join('');
  controls();
 }
 function toggleReferences(show){
  q('betaReferencePicker').hidden=!show;q('betaAddReference').setAttribute('aria-expanded',String(show));
  if(show)renderReferences();
  (show?q('betaReferenceSearch'):q('betaAddReference')).focus({preventScroll:true});
 }
 function renderSessions(){
  const sessions=new Map();for(const t of turns){const s=sessions.get(t.editing.session_id)||{count:0,last:t};s.count++;s.last=t;sessions.set(t.editing.session_id,s);}
  q('betaSession').innerHTML=opt('','New session',sessions.has(session)?session:'')+[...sessions].reverse().map(([id,s])=>opt(id,slotName(s.last.editing.slot_id)+' · '+s.count+' request'+(s.count===1?'':'s')+' · '+new Date(s.last.created_at*1000).toLocaleString(),session)).join('');
 }
 function refreshApproval(){
  const a=current();q('betaAdoption').hidden=!a;if(!a)return;
  approvalSnapshot=structuredClone(l.approvals?.[a.id]||null);
  selectionSnapshot=structuredClone(l.selections?.[slot]||null);
  const targets=DESKProduction.generationTargets(l).filter(t=>t.slotId===slot),preferred=targets.find(t=>t.sceneKey===sceneKey&&t.requirementId===requirementId);
  const old=q('betaDestination').value,desired=old||(preferred?'scene:'+preferred.sceneKey+'|'+preferred.requirementId:'library');
  q('betaDestination').innerHTML=opt('library','Approve for this Location library',desired)+opt('view','Use as the working reference for this view',desired)+targets.map(t=>opt('scene:'+t.sceneKey+'|'+t.requirementId,t.label,desired)).join('');
  destination();
 }
 function destination(){
  const v=q('betaDestination').value,a=current();planSnapshot=null;
  if(v.startsWith('scene:')){const [key]=v.slice(6).split('|');planSnapshot=structuredClone(l.production?.scenes?.[key]||null);}
  const replacing=v==='view'?l.selections?.[slot]?.id:v.startsWith('scene:')?planSnapshot?.requirements?.find(r=>r.id===v.split('|')[1])?.asset_id:null;
  q('betaApprove').textContent=v==='library'?'Approve image':v==='view'?'Approve & use for this view':'Approve & assign to this scene';
  q('betaApprove').disabled=busy||!a||effectiveStatus(a)==='Obsolete'||(v==='library'&&DESKProduction.isApproved(a,l));
  q('betaDestinationNote').textContent=v==='library'?'Approves this exact image. Scene assignments remain as chosen.':(replacing&&replacing!==a?.id?'Replaces the currently assigned image. ':'')+(v==='view'?'Updates this view’s working reference.':'Updates only this scene requirement.');
 }
 function renderPreview(){
  const a=current(),parent=selected?.editing.parent_asset,pa=parent&&assets.get(parent.id),compare=q('betaCompare').checked&&pa&&pa.sha256===parent.sha256;
  const figure=(im,label)=>`<figure><figcaption>${esc(label)}</figcaption><a href="${esc(im.asset)}" target="_blank" rel="noopener"><img src="${esc(im.asset)}" alt="${esc(im.title)}"></a></figure>`;
  q('betaPreview').classList.toggle('is-comparing',!!compare);
  q('betaPreview').innerHTML=a?(compare?figure(pa,'Parent image'):'')+figure(a,selected?'Selected revision':'Starting image'):'<div class="beta-empty">Choose a starting image, or describe a new Location image.</div>';
  q('betaCompare').disabled=!pa;q('betaImageStatus').textContent=a?DESKLocations.status(a,l):'No image selected';
  const sessionTurns=turns.filter(t=>t.editing.session_id===session),completed=sessionTurns.filter(t=>t.status==='completed');
  q('betaVersions').innerHTML=completed.map((t,i)=>{const a=assets.get(t.asset_id),parentIndex=completed.findIndex(x=>x.id===t.editing.parent_turn_id);return a?`<button type="button" data-beta-turn="${esc(t.id)}" aria-pressed="${selected?.id===t.id}" title="${esc(t.editing.instruction)}"><img src="${esc(a.thumbnail||a.asset)}" alt=""><span>Version ${i+1}</span><small>${parentIndex>=0?'From v'+(parentIndex+1):'First result'}</small></button>`:'';}).join('');
  q('betaLastDirection').textContent=selected?'Direction for this revision: '+selected.editing.instruction:'';
  q('betaJobs').innerHTML=sessionTurns.filter(t=>t.status!=='completed').map(t=>`<div class="beta-job"><span>${esc(t.message||t.status)}</span>${t.status==='save_failed'?`<button type="button" data-beta-retry="${esc(t.id)}">Retry saving image</button>`:''}</div>`).join('');
  q('betaScope').textContent=sceneKey?'Scene: '+sceneKey+' · required image '+requirementId:'Shared Location view · scene assignments are chosen separately.';
  refreshApproval();controls();
 }
 function setSelectors(){
  const views=DESKLocationTemplates.slots(l),saved=(D.location_slots||[]).find(s=>s.id===slot);
  q('betaView').innerHTML=[...views,...(saved&&!views.some(s=>s.id===slot)?[saved]:[])].map(s=>opt(s.id,s.label,slot)).join('');
  q('betaSeed').innerHTML=opt('','No starting image',current()?.id||'')+library(l).map(a=>opt(a.id,a.title,current()?.id||'')).join('');
  if(current()&&!library(l).some(a=>a.id===current().id))q('betaSeed').insertAdjacentHTML('beforeend',opt(current().id,current().title,current().id));
  q('betaOperation').value=mode;
 }
 function choose(t){
  storyboardContext=t.editing.storyboard_context||null;renderStoryboardContext();
  q('betaDestination').innerHTML='';selected=t;session=t.editing.session_id;slot=t.editing.slot_id;sceneKey=t.editing.scene_key;requirementId=t.editing.requirement_id;mode='refine';seed=null;
  references=new Set((t.editing.input_references||[]).map(r=>r.id).filter(id=>id!==t.asset_id));
  // The old parent remains visible in comparison; it is not silently reused as a supporting image.
  references.delete(t.editing.parent_asset?.id);
  q('betaContinuity').value=t.editing.continuity||'';q('betaAspect').value=t.editing.aspect||'16:9 widescreen';q('betaQuality').value=t.editing.quality||'medium';q('betaInstruction').value='';q('betaRestart').checked=false;
  setSelectors();renderReferences();renderSessions();renderPreview();
 }
 function restoreRequest(t){
  const r=t.editing;storyboardContext=r.storyboard_context||null;renderStoryboardContext();session=r.session_id;slot=r.slot_id;sceneKey=r.scene_key;requirementId=r.requirement_id;mode=r.operation;
  selected=turns.find(x=>x.id===r.parent_turn_id&&x.status==='completed')||null;seed=selected?null:assets.get(r.parent_asset?.id)||null;
  references=new Set((r.input_references||[]).map(x=>x.id).filter(id=>id!==r.parent_asset?.id));
  q('betaInstruction').value=r.instruction||'';q('betaContinuity').value=r.continuity||'';q('betaAspect').value=r.aspect;q('betaQuality').value=r.quality;q('betaRestart').checked=!!r.restart_context;
  setSelectors();renderReferences();renderSessions();renderPreview();
 }
 function newSession(){
  seed=current();selected=null;session=crypto.randomUUID().replaceAll('-','');mode=seed?'refine':'generate';q('betaInstruction').value='';q('betaRestart').checked=false;
  setSelectors();renderReferences();renderSessions();renderPreview();message('New session. The selected image will be the starting point.');
 }
 async function refresh(){
  if(!alive())return;clearTimeout(timer);
  try{
   const result=await DESKGeneration.get('api/location-editing?location_id='+encodeURIComponent(l.id));if(!alive())return;
   turns=result.turns;
   for(const t of turns){DESKGenerationActivity?.track(t);if(t.status==='completed'&&!merged.has(t.id)){DESKGeneration.merge(t);merged.add(t.id);}}
   if(pending&&turns.some(t=>t.id===pending.request_id.replaceAll('-',''))){following=pending.request_id.replaceAll('-','');session=pending.session_id;pending=null;persist();}
   const follow=turns.find(t=>t.id===following);
   if(follow?.status==='completed'&&follow.editing.session_id===session){following=null;choose(follow);message(follow.metadata?.context_restarted?'Revision saved. Editing resumed from the saved image and current notes.':'Revision saved. Compare it, refine it, or approve it below.');}
   else if(follow&&!running.has(follow.status)){following=null;message(follow.message);}
   if(!loaded){
    loaded=true;
    const requested=storyboardContext?null:turns.find(t=>t.id===options.turnId)||turns.find(t=>t.asset_id===options.assetId&&t.status==='completed');
    if(requested){if(requested.status==='completed')choose(requested);else{restoreRequest(requested);following=requested.id;}}
    else if(pending){session=pending.session_id;message('A previous submission has an uncertain result. Retry it to recover the same request.');}
   }
   renderSessions();renderPreview();
  }catch(e){message(e.status===404?'The server needs to be restarted to enable Generate (beta).':e.message);}
  if(alive()&&(following||turns.some(t=>running.has(t.status))))timer=setTimeout(refresh,2500);
 }
 q('betaForm').onsubmit=async e=>{
  e.preventDefault();if(blockedReason()){controls();return;}
  busy=true;controls();
  try{
   if(!pending){
    const instruction=q('betaInstruction').value.trim(),parent=current();if(!instruction)throw Error('Enter instructions for the image first.');
    if(mode==='refine'&&!parent)throw Error('Choose the image to refine.');
    if(references.size>6)throw Error('Choose at most six supporting references.');
    // Existing linkage is independent of approval or obsolete status.
    if(parent&&!linkedImageIds(l).has(parent.id))await DESKLocations.ensureCoverage(l,slot,parent);
    const supporting=[...references].filter(id=>id!==parent?.id).map(id=>{const a=assets.get(id);if(!a||effectiveStatus(a)==='Obsolete')throw Error('A supporting image is unavailable. Choose another.');return {role:'location',...exact(a)};});
    for(const ref of supporting){const a=assets.get(ref.id);if(!library(l).some(x=>x.id===a.id))await DESKLocations.ensureCoverage(l,slot,a);}
    const scene=sceneKey?l.production?.scenes?.[sceneKey]:null,requirement=scene?.requirements?.find(r=>r.id===requirementId);
    pending={request_id:crypto.randomUUID(),job_kind:'reference',generation_mode:'location-beta',location_id:l.id,reference_type:'Scene reference',slot_id:slot,session_id:session,parent_turn_id:selected?.id||null,parent_asset:exact(parent),operation:mode,instruction,continuity:q('betaContinuity').value,input_references:supporting,aspect:q('betaAspect').value,quality:q('betaQuality').value,restart_context:q('betaRestart').checked};
    if(storyboardContext)pending.storyboard_context=structuredClone(storyboardContext);
    if(sceneKey)Object.assign(pending,{scene_key:sceneKey,requirement_id:requirementId,script_sha256:l.script_source?.sha256,scene_plan_snapshot:structuredClone(scene),requirement_snapshot:structuredClone(requirement)});
    persist();
   }
   const job=await DESKGeneration.post('api/generation/jobs',pending);following=job.id;session=pending.session_id;pending=null;persist();DESKGenerationActivity.track(job);message(job.message);await refresh();
  }catch(e){if(!e.uncertain){pending=null;persist();}message(e.message);}
  finally{busy=false;controls();}
 };
 q('betaApprove').onclick=async()=>{
  const a=current();if(!a||busy)return;
  const value=q('betaDestination').value,destinationKind=value.startsWith('scene:')?'scene':value;
  const request={location_id:l.id,slot_id:slot,asset_id:a.id,source_sha256:a.sha256,destination:destinationKind,expected_approval:approvalSnapshot,expected_selection:selectionSnapshot};
  if(destinationKind==='scene'){const [key,rid]=value.slice(6).split('|');Object.assign(request,{scene_key:key,requirement_id:rid,expected_plan:planSnapshot});}
  busy=true;controls();q('betaApprove').disabled=true;
  try{await DESKReferenceLibrary.post('api/location-adopt',request);DESKLocations.render();if(alive()){q('betaApprovalMessage').textContent=destinationKind==='library'?'Image approved.':destinationKind==='view'?'Approved and selected for this view.':'Approved and assigned to this scene.';renderPreview();}}
  catch(e){if(alive())q('betaApprovalMessage').textContent=e.message+' Use Refresh to load current choices.';}
  finally{busy=false;if(alive()){controls();destination();}}
 };
 q('betaDestination').onchange=destination;q('betaCompare').onchange=renderPreview;
 q('betaOperation').onchange=()=>{mode=q('betaOperation').value;controls();};
 q('betaNew').onclick=newSession;
 q('betaView').onchange=()=>{slot=q('betaView').value;sceneKey=null;requirementId=null;newSession();};
 q('betaSeed').onchange=()=>{seed=assets.get(q('betaSeed').value)||null;selected=null;newSession();};
 q('betaSession').onchange=()=>{const list=turns.filter(t=>t.editing.session_id===q('betaSession').value),t=list.filter(t=>t.status==='completed').at(-1);if(t)choose(t);else if(list.length){restoreRequest(list.at(-1));}else newSession();};
 q('betaInstruction').oninput=controls;
 q('betaAddReference').onclick=()=>toggleReferences(q('betaReferencePicker').hidden);
 q('betaReferencesDone').onclick=()=>toggleReferences(false);
 q('betaReferenceScope').onchange=renderReferences;
 q('betaReferenceSearch').oninput=renderReferences;
 q('betaReferences').onchange=e=>{const id=e.target.dataset.betaReference;if(!id||referenceLocked)return;if(e.target.checked&&references.size>=6){e.target.checked=false;return;}e.target.checked?references.add(id):references.delete(id);if(selected)q('betaRestart').checked=true;renderReferences();const checkbox=[...q('betaReferences').querySelectorAll('input')].find(el=>el.dataset.betaReference===id);checkbox?.focus({preventScroll:true});};
 q('betaAttachedReferences').onclick=e=>{const b=e.target.closest('[data-beta-remove-reference]');if(!b||referenceLocked)return;references.delete(b.dataset.betaRemoveReference);if(selected)q('betaRestart').checked=true;renderReferences();q('betaAddReference').focus({preventScroll:true});};
 q('betaContinuity').oninput=()=>{if(selected)q('betaRestart').checked=true;};
 host.onclick=async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.betaTurn){const t=turns.find(t=>t.id===b.dataset.betaTurn);if(t)choose(t);}
  if(b.dataset.betaRetry){b.disabled=true;try{await DESKGeneration.post('api/generation/jobs/'+b.dataset.betaRetry+'/retry-save',{});following=b.dataset.betaRetry;await refresh();}catch(err){message(err.message);b.disabled=false;}}
  if(b.hasAttribute('data-beta-refresh')){merged.clear();await refresh();}
  if(b.hasAttribute('data-beta-classic')){closed=true;clearTimeout(timer);DESKLocations.show(l.id);DESKLocations.generate(slot);}
 };
 $('modal').addEventListener('close',()=>{closed=true;clearTimeout(timer);},{once:true});
 q('betaContinuity').value=l.production?.continuity||'';setSelectors();renderReferences();renderPreview();
 try{const config=await DESKGeneration.get('api/generation/config');if(!alive())return;ready=config.configured&&config.location_beta;unavailableReason=ready?'':config.location_beta?(config.message||'Configure image generation in Settings first.'):'Restart the reference desk server to enable the beta.';message('');}catch(e){unavailableReason=e.message||'Unable to connect to image generation.';message('');}
 await refresh();controls();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-location-beta]');if(!b)return;open(b.dataset.locationBeta,{slotId:b.dataset.betaSlot,assetId:b.dataset.betaAsset,sceneKey:b.dataset.betaScene,requirementId:b.dataset.betaRequirement});});
window.DESKLocationEditing={open,button};
async function openStoryboardRevision(){
 if(!location.hash.startsWith('#storyboard-revise='))return;
 try{
  if(location.hash.length>150000)throw Error('Revision context is too large.');
  const c=JSON.parse(decodeURIComponent(location.hash.slice('#storyboard-revise='.length)));
  if(c.version!==1||!(/^[a-f0-9]{16}$/).test(c.storyboard_id)||!(/^S[0-9]{3,5}$/).test(c.shot_id)||!Number.isInteger(c.slot_number)||c.slot_number<1||c.slot_number>10000||typeof c.song!=='string'||c.song.length>180||typeof c.title!=='string'||c.title.length>1000||typeof c.prompt!=='string'||c.prompt.length>18000)throw Error('Invalid storyboard revision context.');
  const a=assets.get(c.asset_id),l=locationFor(c.location_id);
  if(!a||a.sha256!==c.sha256)throw Error('This exact starting image is unavailable. Refresh the storyboard before revising.');
  if(!l||!(l.references?.[c.slot_id]||[]).includes(a.id))throw Error('The starting image is no longer linked to this location view.');
  document.getElementById('locationsTab').click();DESKLocations.show(l.id);
  await open(l.id,{assetId:a.id,slotId:c.slot_id,storyboardContext:c});
 }catch(e){openModal('Cannot open storyboard revision',`<p>${esc(e.message)}</p><p>Your storyboard and images are unchanged.</p>`);}
}
window.addEventListener('hashchange',openStoryboardRevision);
openStoryboardRevision();
if(window.DESKLocations?.active)DESKLocations.render();
})();
