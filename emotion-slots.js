/* One pinned reference per named emotion, independent of wardrobe and emotion maps. */
function emotionName(value){const n=String(value||'').trim().replace(/\s+/g,' ');return n.length&&n.length<=80&&!/[@:<>\x00-\x1f]/.test(n)?n:'';}
function namedEmotionRole(role){return typeof role==='string'&&role.startsWith('individual-emotion:')&&emotionName(role.slice(19))===role.slice(19)&&!!role.slice(19);}
function emotionImageName(a){
 const explicit=emotionName(a.emotion);if(explicit&&!/^(unspecified|unknown|none)$/i.test(explicit))return explicit;
 // Read the recorded expression, never infer it from the face or title.
 for(const p of a.original_prompts||[]){const match=(p.text||'').match(/individual emotion reference[\s\S]*?Expression:\s*([^\n.]+)[.\n]/i);if(match&&emotionName(match[1]))return emotionName(match[1]);}
 return '';
}
function emotionNames(c){
 const labels=['Calm','Joy','Concern','Fear','Anger','Grief','Determination',...(c.individual_emotions||[])];
 for(const a of D.assets.filter(a=>a.character_ids.includes(c.id)&&a.type==='Individual emotion')){const n=emotionImageName(a);if(n)labels.push(n);}
 for(const r of Object.values(canonCurrent(c.id)))if(namedEmotionRole(r.role))labels.push(r.role.slice(19));
 return [...new Map(labels.map(n=>[n.toLocaleLowerCase(),n])).values()];
}
function emotionSlotState(c,n){
 const role='individual-emotion:'+n,source=approvalSource(),r=source&&canonCurrent(c.id,source)[role],a=r&&assets.get(r.id);
 return {role,reference:a&&effectiveStatus(a)!=='Obsolete'&&knownSourceHash(a,r.source_sha256)?r:null};
}
function emotionCoverage(c){const names=emotionNames(c),ready=names.filter(n=>emotionSlotState(c,n).reference).length;return {names,ready,total:names.length,state:ready===names.length?'ready':'selection'};}
function emotionSlotSignature(c){return JSON.stringify([emotionNames(c).map(n=>[n,emotionSlotState(c,n).reference]),D.assets.filter(a=>a.character_ids.includes(c.id)&&a.type==='Individual emotion').map(a=>[a.id,a.sha256,a.emotion,effectiveStatus(a)])]);}
function emotionSlotsView(c){
 const coverage=emotionCoverage(c),images=D.assets.filter(a=>a.character_ids.includes(c.id)&&a.type==='Individual emotion'&&effectiveStatus(a)!=='Obsolete'),key=JSON.stringify([c.id,'Individual emotion']);
 return `<details class="assetgroup category-references emotion-slots" data-emotion-state="${esc(emotionSlotSignature(c))}" data-category-disclosure="${esc(key)}"${categoryOpenGroups.has(key)?' open':''}><summary class="category-references-summary"><h2>Individual emotion</h2><span class="category-reference-count">${coverage.ready}/${coverage.total} emotions selected</span></summary><div class="category-references-body"><p class="small">One face-only, square reference per emotion. Choosing a replacement changes only that emotion. Existing image approvals remain in your library.</p><div class="emotion-bulk-actions"><button type="button" data-emotion-set="${esc(c.id)}">Create image set</button><button type="button" data-emotion-bulk="${esc(c.id)}">Approve all &amp; assign</button><button type="button" data-emotion-add="${esc(c.id)}">＋ Add emotion</button></div><div class="emotion-slot-grid">${coverage.names.map(n=>{const s=emotionSlotState(c,n),a=s.reference&&assets.get(s.reference.id),im=s.reference&&canonImage(s.reference),matching=images.filter(x=>emotionImageName(x).toLocaleLowerCase()===n.toLocaleLowerCase()),candidate=!im&&matching.at(-1);return `<article class="emotion-slot ${a?'is-ready':'needs-selection'}"><h3>${esc(n)}</h3>${im?`<img loading="lazy" src="${esc(im.asset)}" alt="${esc(n)} reference for ${esc(c.name)}">`:candidate?`<img loading="lazy" src="${esc(candidate.thumbnail||candidate.asset)}" alt="${esc(n)} candidate for ${esc(c.name)}">`:'<div class="emotion-slot-empty">No reference selected</div>'}<p>${a?'Approved reference · Selected':candidate?'Candidate · Not selected':'Choose or create a head close-up'}</p>${matching.length?`<p class="small">${matching.length} matching image${matching.length===1?'':'s'}${candidate?` · <button type="button" data-image="${esc(candidate.id)}" data-selection-character="${esc(c.id)}" data-selection-role="${esc(s.role)}">Review candidate</button>`:''}</p>`:''}<button type="button" data-emotion-pick="${esc(n)}" data-emotion-character="${esc(c.id)}">${a?'Change image':'Choose image'}</button> <button type="button" data-emotion-create="${esc(n)}" data-emotion-character="${esc(c.id)}">Create image</button>${a?` <button type="button" data-image="${esc(a.id)}" data-selection-character="${esc(c.id)}" data-selection-role="${esc(s.role)}">Review image</button>`:''}</article>`;}).join('')}</div><details class="emotion-existing"><summary>All individual emotion images · ${images.length}</summary><p class="small">Unlabelled and earlier images are preserved here. Assign an image using Choose image above.</p><div class="assetgrid">${images.map(assetCard).join('')}</div></details></div></details>`;
}
function emotionPicker(cid,label){
 const c=people.get(cid);if(!c)return;const role='individual-emotion:'+label,selected=canonCurrent(cid)[role];
 const images=D.assets.filter(a=>a.character_ids.includes(cid)&&a.type==='Individual emotion'&&effectiveStatus(a)!=='Obsolete').sort((a,b)=>Number(emotionImageName(b).toLowerCase()===label.toLowerCase())-Number(emotionImageName(a).toLowerCase()===label.toLowerCase()));
 openModal('Choose '+label+' · '+c.name,`<p>Choose one face-only image for <strong>${esc(label)}</strong>. Confirming replaces only this emotion’s selected reference.</p><p><button type="button" data-emotion-bulk="${esc(cid)}">Approve all &amp; assign to matching emotions</button></p><div id="emotionUpload"></div><div class="reference-choice-grid">${images.map(a=>`<article><img loading="lazy" src="${esc(a.thumbnail||a.asset)}" alt="${esc(a.title)}"><p><strong>${esc(emotionImageName(a)||'Emotion not labelled')}</strong></p>${referenceBadge(a,cid)}${selected?.id===a.id?'<p>Current selection</p>':''}<p class="small">${esc(a.id)}</p><button type="button" data-emotion-confirm="${esc(a.id)}">Choose for ${esc(label)}</button><button type="button" data-image="${esc(a.id)}" data-selection-character="${esc(cid)}" data-selection-role="${esc(role)}">Review image</button></article>`).join('')||'<p>No individual emotion images yet. Upload one or create a head close-up.</p>'}</div><button type="button" data-emotion-create="${esc(label)}" data-emotion-character="${esc(cid)}">Create ${esc(label)} image</button>`);
 window.DESKReferenceLibrary?.mountUpload($('emotionUpload'),{characterId:cid,type:'Individual emotion',onSaved:()=>emotionPicker(cid,label)});
 for(const b of $('modalBody').querySelectorAll('[data-emotion-confirm]'))b.onclick=()=>canonDialog(b.dataset.emotionConfirm,cid,null,role);
}
function addEmotion(cid){const c=people.get(cid);if(!c)return;openModal('Add emotion · '+c.name,`<form id="addEmotionForm"><label>Emotion name<input name="name" required maxlength="80" placeholder="e.g. Relief, Suspicion, Awe" autocomplete="off"></label><p>Creates an empty emotion slot for this character. Choose or generate its reference afterward.</p><button type="submit">Add emotion</button><p role="status" id="emotionAddStatus"></p></form>`);const form=$('addEmotionForm');form.onsubmit=async e=>{e.preventDefault();const n=emotionName(form.elements.name.value);if(!n){$('emotionAddStatus').textContent='Enter an emotion name of up to 80 characters.';return;}const b=form.querySelector('button');b.disabled=true;try{await DESKReferenceLibrary.post('api/emotions',{character_id:cid,name:n});categoryOpenGroups.add(JSON.stringify([cid,'Individual emotion']));$('modal').close();detail(cid);toast('Emotion slot saved.');}catch(error){$('emotionAddStatus').textContent=error.message;b.disabled=false;}};}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.emotionAdd)addEmotion(b.dataset.emotionAdd);if(b.dataset.emotionPick)emotionPicker(b.dataset.emotionCharacter,b.dataset.emotionPick);if(b.dataset.emotionCreate)emotionRequest(b.dataset.emotionCharacter,b.dataset.emotionCreate);});
function refreshEmotionSlots(){
 if(typeof current==='undefined'||!current||!people.has(current))return;
 const c=people.get(current),section=document.querySelector('#content .emotion-slots');
 if(section&&section.dataset.emotionState!==emotionSlotSignature(c)){const open=section.open;section.outerHTML=emotionSlotsView(c);document.querySelector('#content .emotion-slots').open=open;}
 const count=document.querySelector('[data-coverage-category="individual_emotion"]');if(count){const s=emotionCoverage(c);count.textContent=`${s.ready}/${s.total} emotions selected · Review emotions`;count.classList.toggle('approved',s.ready===s.total);count.classList.toggle('review',s.ready!==s.total);}
 applySectionActionStates(c);
}
window.addEventListener('desk-approval-saved',refreshEmotionSlots);
window.addEventListener('desk-catalog-changed',refreshEmotionSlots);

function emotionBulkPlan(cid){
 const c=people.get(cid);if(!c)throw Error('Unknown character.');
 const images=D.assets.filter(a=>a.character_ids.includes(cid)&&a.type==='Individual emotion'&&effectiveStatus(a)!=='Obsolete'&&review.notes[a.id]?.verdict!=='Reject').map(a=>({...a})),slots=JSON.parse(JSON.stringify(canonCurrent(cid)));
 const rows=emotionNames(c).map(name=>{const role='individual-emotion:'+name,prior=slots[role]||null,a=prior&&assets.get(prior.id),keep=a&&effectiveStatus(a)!=='Obsolete'&&knownSourceHash(a,prior.source_sha256)?prior:null,candidates=images.filter(a=>emotionImageName(a).toLocaleLowerCase()===name.toLocaleLowerCase());return {name,role,prior,keep,candidates};});
 return {cid,rows,unlabelled:images.filter(a=>!emotionImageName(a)).length};
}
function emotionBulkCommit(plan,picks){
 // Validate the complete batch first; a stale row cannot leave a partial assignment.
 const changes=[],slots=canonCurrent(plan.cid);
 for(const row of plan.rows){const pick=picks[row.role];if(!pick||row.keep)continue;
  if(JSON.stringify(slots[row.role]||null)!==JSON.stringify(row.prior))throw Error('An emotion selection changed elsewhere. Reopen Approve all & assign to review the latest choices.');
  const a=assets.get(pick.id),candidate=row.candidates.find(x=>x.id===pick.id);
  if(!a||!candidate||a.sha256!==pick.sha256||!a.character_ids.includes(plan.cid)||a.type!=='Individual emotion'||effectiveStatus(a)==='Obsolete'||review.notes[a.id]?.verdict==='Reject'||emotionImageName(a).toLocaleLowerCase()!==row.name.toLocaleLowerCase())throw Error('An image or emotion label changed. Reopen Approve all & assign before saving.');
  changes.push({row,a});
 }
 if(!changes.length)return 0;
 const next=JSON.parse(JSON.stringify(review)),at=new Date().toISOString();
 next.canonical_references??={};next.canonical_references[plan.cid]??={};next.canon_history??=[];
 for(const {row,a}of changes){const selection={id:a.id,role:row.role,look_id:null,source_sha256:a.sha256,selected_at:at,selection_id:crypto.randomUUID()};next.canonical_references[plan.cid][row.role]=selection;next.canon_history.push({event_id:crypto.randomUUID(),character_id:plan.cid,slot:row.role,previous:row.prior,next:selection,at});}
 canonValidate(next);review=next;save();return changes.length;
}
function emotionBulkDialog(cid){
 const c=people.get(cid),plan=emotionBulkPlan(cid);if(!c)return;
 const available=plan.rows.filter(r=>r.keep||r.candidates.length),empty=plan.rows.length-available.length;
 openModal('Approve all & assign · '+c.name,`<section class="emotion-bulk"><p>Assign each labelled image to its matching emotion and approve it as that emotion’s reference.</p><p class="small">Existing selections are kept. When an emotion has multiple candidates, choose one or leave it unassigned. Unlabelled images (${plan.unlabelled}) and emotions without images (${empty}) are skipped. Set-aside and rejected images are excluded.</p><button type="button" id="emotionBulkCommit">Approve all &amp; assign</button><p role="status" aria-live="polite" id="emotionBulkStatus"></p><div class="emotion-bulk-rows">${available.map((row,i)=>`<article class="emotion-bulk-row"><div data-bulk-preview="${i}"></div><div><h3>${esc(row.name)}</h3>${row.keep?'<p>Keep current reference</p>':`<label>Image for ${esc(row.name)}<select data-bulk-choice="${i}"><option value="">${row.candidates.length>1?'Choose one of '+row.candidates.length+' images…':'Leave unassigned'}</option>${row.candidates.map(a=>`<option value="${esc(a.id)}"${row.candidates.length===1?' selected':''}>${esc(a.title)} · ${esc(a.id)}</option>`).join('')}</select></label>`}<p class="small" data-bulk-note="${i}"></p></div></article>`).join('')||'<p>No labelled images available. Label or create individual emotion images first.</p>'}</div></section>`);
 const host=document.querySelector('.emotion-bulk'),button=$('emotionBulkCommit'),status=$('emotionBulkStatus');let committed=false;
 function selections(){return Object.fromEntries(available.filter(r=>!r.keep).map(row=>{const i=available.indexOf(row),id=host.querySelector(`[data-bulk-choice="${i}"]`)?.value,a=row.candidates.find(a=>a.id===id);return [row.role,a?{id:a.id,sha256:a.sha256}:null];}));}
 function update(){let count=0;available.forEach((row,i)=>{const a=row.keep?assets.get(row.keep.id):row.candidates.find(a=>a.id===host.querySelector(`[data-bulk-choice="${i}"]`)?.value),im=row.keep?canonImage(row.keep):a;
  host.querySelector(`[data-bulk-preview="${i}"]`).innerHTML=im?`<img src="${esc(im.thumbnail||im.asset)}" alt="${esc(row.name)} reference preview">`:'<span class="small">Choose an image</span>';
  host.querySelector(`[data-bulk-note="${i}"]`).textContent=row.keep?row.keep.id:a?'Will approve and assign to '+row.name:'Not included in this batch';if(a&&!row.keep)count++;
 });button.textContent='Approve all & assign'+(count?' · '+count:'');button.disabled=!count;const unresolved=available.filter(r=>!r.keep&&r.candidates.length>1).filter(r=>!selections()[r.role]).length;status.textContent=count?count+' emotion references ready to assign.'+(unresolved?' '+unresolved+' duplicate groups still need a choice.':''):unresolved?'Choose an image for at least one emotion to assign.':'All available labelled emotions are already assigned.';}
 host.addEventListener('change',update);update();
 button.onclick=async()=>{if(committed)return;button.disabled=true;try{const count=emotionBulkCommit(plan,selections());committed=true;host.querySelectorAll('select').forEach(x=>x.disabled=true);status.textContent='Saving '+count+' emotion assignments…';
  if(window.DESKAutosave){await DESKAutosave.flush();const pending=DESKAutosave.state();status.textContent=pending.dirty||pending.conflicted||pending.inflight?'Assignments are pending save. Check the save status for retry or conflict details.':count+' emotion references approved, assigned and saved on this Mac.';}else status.textContent='Assignments saved in this browser. Open the local server to save on this Mac.';
  button.textContent='Assignments submitted';if(current===cid)refreshView();
 }catch(error){status.textContent=error.message;button.disabled=false;}};
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-emotion-bulk]');if(b)emotionBulkDialog(b.dataset.emotionBulk);});
