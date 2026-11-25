'use strict';
(()=>{
 const bar=document.getElementById('autosaveBar'),http=location.protocol==='http:'&&location.hostname==='127.0.0.1',pendingKey=key+'-autosave-pending-v1',baseKey=key+'-autosave-base-v2';
 let revision=null,baseRevision=null,baseChoices=null,token=null,dirty=false,seq=0,inflight=null,timer=null,conflicted=false,loading=true,retryDelay=1500,pending=null,lastConflict=null,recoveryBlocked=false;
 let checking=false;
 bar.innerHTML='<span id="saveIndicator" class="save-indicator" role="img" tabindex="0" aria-label="Checking saved changes"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h13l4 4v13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg><span class="save-symbol" aria-hidden="true"></span></span><span id="saveStatus" role="status" aria-live="polite">Checking saved changes…</span><details class="save-help"><summary class="save-help-trigger" title="Changes save automatically on this Mac." aria-label="About saving" aria-describedby="saveHelpTip">?</summary><span id="saveHelpTip" role="tooltip">Changes save automatically on this Mac.</span></details><span id="saveActions"></span>';
 const status=document.getElementById('saveStatus'),actions=document.getElementById('saveActions');
 const modalStatus=document.createElement('span');modalStatus.id='modalSaveStatus';modalStatus.className='small';modalStatus.setAttribute('role','status');document.getElementById('modalClose').before(modalStatus);
 const modalActions=document.createElement('span');modalActions.id='modalSaveActions';document.getElementById('modalClose').before(modalActions);
 const clone=x=>JSON.parse(JSON.stringify(x));
 function units(v){const out={};for(const[c,rs]of Object.entries(v?.reference_approvals||{}))for(const[id,r]of Object.entries(rs))out['approval '+c+' '+id]=JSON.stringify(r);for(const x of v?.items||[])if(x.updated_at)out['image '+x.id]=JSON.stringify([x.rank??null,!!x.obsolete,x.notes||'',x.role||'',x.preference||'Unreviewed']);for(const[c,rs]of Object.entries(v?.character_rankings||{}))for(const[id,r]of Object.entries(rs))out['rank '+c+' '+id]=JSON.stringify(r.rank);for(const[c,rs]of Object.entries(v?.canonical_references||{}))for(const[s,r]of Object.entries(rs))out['canon '+c+' '+s]=JSON.stringify([r.id,r.source_sha256]);return out;}
 function count(){if(!pending)return 0;const a=units(pending.choices),b=units(baseChoices),ids=new Set();for(const[k,v]of Object.entries(a))if(v!==b[k])ids.add(k.startsWith('canon ')?k:k.split(' ').at(-1));return ids.size||1;}
 function show(text,buttons=[]){
  if(!window.document)return;
  const saved=text===savedText(),busy=!!inflight||checking||loading;
  const state=saved?'saved':busy?'saving':'unsaved';
  const label=saved?'All changes saved on this Mac':busy?'Saving or checking changes':dirty?'Changes need saving':text;
  bar.dataset.saveState=state;
  const indicator=document.getElementById('saveIndicator');
  indicator.dataset.state=state;indicator.setAttribute('aria-label',label);indicator.title=label;
  indicator.querySelector('.save-symbol').textContent=saved?'✓':busy?'…':'!';
  status.textContent=text;modalStatus.textContent=/failed|could not|unavailable|needs recovery/i.test(text)?'Library review — '+text:text;
  window.dispatchEvent(new CustomEvent('desk-save-status',{detail:{text,saved,busy}}));
  const routine=saved||(dirty&&!conflicted&&!recoveryBlocked&&!/failed|only|not on disk/i.test(text)&&!busy);
  status.classList.toggle('save-sr-only',routine);modalStatus.classList.toggle('save-sr-only',routine);
  for(const target of [actions,modalActions]){
   target.replaceChildren();
   for(const[label,fn]of buttons){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;target.append(b);}
  }

 }
 function savedText(){return 'All changes saved on this Mac';}
 function failure(error,phase,retry){
  const retained=count(),suffix=retained?' '+retained+' unsaved change(s) retained.':' No pending edits in this tab.';
  const message=String(error.message||error).replace(/[.\s]+$/,'');
  const buttons=[['Review issue',()=>issueDetails(error,phase,retry)],[phase==='load'?'Retry loading reviews':'Retry saving reviews',retry]];
  if(pending)buttons.push(['Back up pending edits',backup]);
  show((phase==='load'?'Could not load saved reviews: ':'Save failed: ')+message+'.'+suffix,buttons);
 }
 function issueDetails(error,phase,retry){
  const id=error.assetId||String(error.message||'').match(/DESK-[A-Z0-9]+/i)?.[0],asset=assets.get(id);
  const item=pending?.choices?.items?.find(x=>x.id===id),legacy=pending?.choices?.notes?.[id];
  const repair=error.field==='rank'&&(item||legacy);
  openModal(phase==='load'?'Saved-review loading issue':'Review save issue',`<p>${esc(error.message||error)}</p><p>${pending?'Your pending edits are retained in this browser.':(phase==='load'?'The saved reviews could not be loaded. No pending edits are recorded in this tab.':'The save could not be confirmed. Retry to check the saved version.')}</p>${asset?`<section class="notice"><strong>${esc(asset.title||asset.id)}</strong><p>${esc(asset.id)}</p>${asset.thumbnail?`<img src="${esc(asset.thumbnail)}" alt="Affected image" style="max-width:240px;max-height:160px;object-fit:contain">`:''}<button type="button" id="reviewIssueImage">Inspect affected image</button></section>`:''}${repair?'<label>Correct rank (blank means unranked)<input id="reviewRepairRank" type="number" min="1" max="100000" step="1"></label><button type="button" id="reviewRepairApply">Apply rank and retry save</button><p id="reviewRepairStatus" role="status"></p>':''}<button type="button" id="reviewIssueRetry">${phase==='load'?'Retry loading reviews':'Retry saving reviews'}</button><details><summary>Technical details</summary><pre>${esc(JSON.stringify({operation:phase,field:error.field||null,image_id:id||null,value:error.invalidValue??null,pending_changes:count(),message:error.message},null,2))}</pre></details>`);
  document.getElementById('reviewIssueImage')?.addEventListener('click',()=>imageView(id));
  document.getElementById('reviewIssueRetry').onclick=retry;
  if(repair)document.getElementById('reviewRepairApply').onclick=()=>{
   const input=document.getElementById('reviewRepairRank'),value=input.value.trim(),rank=value===''?null:Number(value),result=document.getElementById('reviewRepairStatus');
   if(input.validity.badInput||rank!==null&&(!Number.isSafeInteger(rank)||rank<1||rank>100000)){result.textContent='Enter a whole number from 1 to 100000, or leave it blank.';return;}
   try{const choices=clone(pending.choices);const record=choices.items?.find(x=>x.id===id)||choices.notes[id];record.rank=rank;record.updated_at=new Date().toISOString();const repaired=validateImport(choices);review=repaired;pending={...pending,choices,sequence:++seq,mutation_id:crypto.randomUUID()};dirty=true;recoveryBlocked=false;loading=false;persistPending();document.getElementById('modal').close();load();}catch(e){result.textContent=e.message;}
  };
 }

 function persistPending(){try{DESKStorage.setItem(pendingKey,JSON.stringify(pending));}catch(e){show('Save failed: browser recovery storage unavailable. Keep this tab open.');}}
 function backup(){download('DESK-pending-review-backup.json',pending?.choices||makeExport());}
 function clearPending(){try{DESKStorage.removeItem(pendingKey);}catch(e){}}
 function applyDisk(v){review=mergeReviewDefaults(D.review_defaults?validateImport(D.review_defaults):{notes:{},pairs:{},rankings:{},collection_reviews:{}},validateImport(v.choices));setSavedApprovalReview(review);revision=v.revision;baseRevision=v.revision;baseChoices=clone(v.choices);token=v.csrf_token||token;try{DESKStorage.setItem(key,JSON.stringify(review));DESKStorage.setItem(baseKey,JSON.stringify({revision:baseRevision,choices:baseChoices}));}catch(e){}if(current)detail(current);else render();}
 async function request(path,options={}){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);try{const r=await fetch(path,{...options,cache:'no-store',signal:controller.signal});const v=await r.json();return {r,v};}finally{clearTimeout(timeout);}}
 async function get(){const {r,v}=await request('api/review');if(!r.ok)throw Error(v.error||'Backend unavailable');return v;}
 function conflict(v){lastConflict=v;conflicted=true;show('Save failed: '+(v.conflicts?.length||1)+' conflicting change(s). '+count()+' unsaved changes retained.',[['Resolve conflicting changes',resolveView],['Retry Save',()=>{conflicted=false;flush();}]]);}
 function resolveView(){if(!lastConflict)return;const conflicts=lastConflict.conflicts||[];openModal('Resolve saved-review conflict',`<p>Your edits are safe. Independent changes merge automatically. Choose only where the same field/category changed in both versions.</p>${conflicts.map((c,i)=>`<section class="notice"><strong>${esc(c.key)}</strong><label>Keep<select data-merge-decision="${i}"><option value="">Choose version</option><option value="local">My pending change</option><option value="disk">Saved disk change</option></select></label><details><summary>Compare values</summary><p>My change</p><pre>${esc(JSON.stringify(c.local,null,2))}</pre><p>Disk change</p><pre>${esc(JSON.stringify(c.disk,null,2))}</pre></details></section>`).join('')}<button id="saveConflictResolution">Save chosen resolution</button><p id="conflictResult" role="status"></p>`);document.getElementById('saveConflictResolution').onclick=()=>{const decisions={};for(const el of document.querySelectorAll('[data-merge-decision]')){if(!el.value){document.getElementById('conflictResult').textContent='Choose a version for each conflict.';return;}decisions[conflicts[Number(el.dataset.mergeDecision)].key]=el.value;}const expected=lastConflict.revision;conflicted=false;document.getElementById('modal').close();flush(decisions,expected);};}
 async function load(){if(recoveryBlocked)return;loading=true;show('Checking saved changes…');try{const v=await get();token=v.csrf_token;
   if(pending){dirty=true;baseRevision=pending.base_revision;if(!baseChoices&&Number.isInteger(baseRevision)){if(baseRevision===v.revision)baseChoices=clone(v.choices);else{const old=await request('api/revisions/'+baseRevision);if(old.r.ok)baseChoices=old.v.choices;}}loading=false;conflicted=false;show('Recovering '+count()+' unsaved changes…');await flush();}
   else{applyDisk(v);loading=false;show(savedText());}
  }catch(e){loading=false;failure(e,'load',load);}}
 function schedule(){clearTimeout(timer);timer=setTimeout(flush,650);}
 function changed(){if(recoveryBlocked){show('Save failed: existing browser recovery data is unreadable. Keep this tab open; no pending data has been replaced.');return;}seq++;dirty=true;pending={base_revision:pending?.base_revision??baseRevision,mutation_id:crypto.randomUUID(),choices:makeExport(),sequence:seq};persistPending();if(!http){show('Saved in this browser only · '+count()+' changes are not on disk. Open the live version to save.',[['Open live index',()=>window.open('http://127.0.0.1:8876/','_blank','noopener')]]);return;}if(conflicted){conflict(lastConflict);return;}show(count()+' unsaved changes · autosave pending');schedule();}
 async function flush(resolutions=null,expected=null){if(!http){staticHelp();return;}if(inflight||checking||loading||recoveryBlocked)return;if(!dirty||!pending){checking=true;const checkedSequence=seq;show('Checking saved changes…');try{const v=await get();checking=false;if(seq!==checkedSequence){show('Changes waiting to save');schedule();return;}if(document.getElementById('modal').open){setSavedApprovalReview(mergeReviewDefaults(D.review_defaults?validateImport(D.review_defaults):{},validateImport(v.choices)));show(savedText());}else{applyDisk(v);show(savedText());}}catch(e){checking=false;failure(e,'load',load);}return;}if(conflicted&&!resolutions){resolveView();return;}
  if(!Number.isInteger(pending.base_revision)){show('Save failed: this browser has no saved base revision. Pending data retained; recovery is required.',[['Retry connection',load],['Backup pending edits',backup]]);return;}
  const sent=clone(pending);if(resolutions){sent.resolutions=resolutions;sent.expected_revision=expected;}inflight=sent;show('Saving changes on this Mac…');
  try{validateImport(sent.choices);const {r,v}=await request('api/merge',{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':token},body:JSON.stringify(sent)});
   if(r.status===403){const fresh=await get();token=fresh.csrf_token;inflight=null;schedule();return;}
   if(r.status===409){inflight=null;token=v.csrf_token||token;return conflict(v);}
   if(!r.ok)throw Error(v.error||('HTTP '+r.status));revision=v.revision;token=v.csrf_token||token;retryDelay=1500;inflight=null;conflicted=false;
   if(pending?.mutation_id===sent.mutation_id){pending=null;dirty=false;clearPending();applyDisk(v);show(savedText());}
   else{persistPending();show(count()+' unsaved changes · saving newer edits next');schedule();}
  }catch(e){inflight=null;failure(e,'save',()=>flush());clearTimeout(timer);if(e.name!=='ReviewValidationError'){timer=setTimeout(flush,retryDelay);retryDelay=Math.min(retryDelay*2,30000);}}
 }
 function staticHelp(){try{DESKStorage.setItem(key,JSON.stringify(review));}catch(e){}openModal('Open the live index to save to disk','<p>This file:// page cannot write to the local backend. Its current edits remain stored in this browser; this action does not discard or replace them.</p><p><a href="http://127.0.0.1:8876/" target="_blank" rel="noopener">Open live Character Index — Save to disk</a></p><p>If the server is stopped, double-click <strong>Start Reference Desk.command</strong> in this folder. Keep this tab open if it contains older unsaved changes. The already-uploaded pending backup has been recovered; no new export is required for those edits.</p>');}
 document.getElementById('historyReview').onclick=async()=>{if(!http)return staticHelp();if(dirty||conflicted)return toast('Wait for autosave or resolve pending changes before restoring history.');try{const {r,v:h}=await request('api/history');if(!r.ok)throw Error('History unavailable');openModal('Saved history',`<p>Current saved version: revision ${revision}. Changes are saved on this Mac.</p><p>Restore creates a new revision and keeps the current backup.</p><label>Saved revision<select id="restoreRevision">${h.revisions.slice().reverse().map(x=>`<option value="${Number(x.split('-')[1])}">${esc(x)}</option>`).join('')}</select></label><button id="restoreReview">Restore selected saved version</button><p id="restoreResult"></p>`);document.getElementById('restoreReview').onclick=async()=>{if(dirty||!confirm('Restore this saved review? Current state remains in history.'))return;try{const {r,v}=await request('api/restore',{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':token},body:JSON.stringify({base_revision:revision,mutation_id:crypto.randomUUID(),restore_revision:Number(document.getElementById('restoreRevision').value)})});if(!r.ok)throw Error(v.error||'Disk changed; reload history before restoring');applyDisk(v);document.getElementById('modal').close();show(savedText());}catch(e){document.getElementById('restoreResult').textContent=e.message;}};}catch(e){toast(e.message);}};
 try{const cache=JSON.parse(DESKStorage.getItem(baseKey)||'null');if(cache){baseRevision=cache.revision;baseChoices=cache.choices;}pending=JSON.parse(DESKStorage.getItem(pendingKey)||'null');if(pending){review=validateImport(pending.choices);dirty=true;seq=pending.sequence||0;}}catch(e){recoveryBlocked=true;loading=false;dirty=true;failure(e,'load',()=>{try{if(pending)validateImport(pending.choices);recoveryBlocked=false;load();}catch(e){failure(e,'load',load);}});}
 window.addEventListener('desk-review-changed',changed);window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
 document.getElementById('modal').addEventListener('close',()=>{if(http&&!dirty&&!loading&&!inflight&&!recoveryBlocked&&(revision===null||!approvalSource()))load();});
 window.DESKAutosave={flush,load,state:()=>({revision,dirty,conflicted,inflight:!!inflight,unsavedCount:count()})};
 if(!http){loading=false;show('Offline file page · browser-only storage. Use the live index for Save to disk.',[['Open live index',()=>window.open('http://127.0.0.1:8876/','_blank','noopener')]]);return;}
 load();setInterval(async()=>{if(recoveryBlocked||loading||inflight||conflicted||dirty)return;try{const v=await get();token=v.csrf_token;if(v.revision!==revision||!approvalSource()){if(approvalSource()&&(document.getElementById('modal').open||['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))){show('New disk revision available. Your next edit will merge independent changes automatically.');return;}applyDisk(v);show(savedText());}}catch(e){failure(e,'load',load);}},5000);
})();
