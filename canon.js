'use strict';
function lookDisplayName(look){if(!look)return '';if(look.active_story===false)return look.name;return ({'fresh-independence':'Fresh','trail':'Trail Hopeful','trail-worn':'Trail Worn','winter-hopeful':'Winter'})[look.id.split('--')[1]]||look.name;}
// Explicit reference decisions, separate from rank, pinned to exact image bytes.
function canonKey(role,look){return role+(look?'@'+look:'');}
function canonRoleFamily(role){return ['emotion-map','individual-emotion'].includes(role)||namedEmotionRole(role)?'emotion':role;}
function canonSongNames(){return [...new Set(D.assets.flatMap(a=>(a.song_appearances||[]).map(x=>x.song)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
function canonRoleLabel(role){if(namedEmotionRole(role))return 'Individual emotion · '+role.slice(19);return role?.startsWith('song:')?'Musical number · '+role.slice(5):({likeness:'Portrait / likeness',body:'Full-body / costume',wardrobe:'Mannequin outfit study',emotion:'Emotion reference (shared)', 'emotion-map':'Emotion map','individual-emotion':'Individual emotion',scene:'Scene reference',prop:'Supporting prop / map',hair:'Hairstyle'}[role]||role);}
function canonCategoryRole(type){return ({'Portrait / likeness':'likeness','Full-body / costume':'body','Mannequin outfit study':'wardrobe','Emotion map':'emotion-map','Individual emotion':'individual-emotion','Scene reference':'scene','Supporting prop / map':'prop','Hairstyle study':'hair'})[type]||'scene';}
function canonDefaultRole(a){
 const songs=[...new Set((a.song_appearances||[]).map(x=>x.song).filter(Boolean))];
 if(a.type==='Scene reference'&&songs.length===1)return 'song:'+songs[0];
 return canonCategoryRole(a.type);
}
function canonAllowed(a,role){
 if(namedEmotionRole(role))return a.type==='Individual emotion';
 if(role?.startsWith('song:'))return canonSongNames().includes(role.slice(5));
 return ({likeness:['Portrait / likeness','Scene reference','Full-body / costume'],body:['Full-body / costume'],emotion:['Individual emotion','Emotion map'],'emotion-map':['Emotion map'],'individual-emotion':['Individual emotion'],wardrobe:['Mannequin outfit study'],scene:['Scene reference'],prop:['Supporting prop / map'],hair:['Hairstyle study']}[role]||[]).includes(a.type);
}
// Explicit user assignments can cross image categories; automatic suggestions still use canonAllowed.
function canonDestinationAllowed(role){
 if(namedEmotionRole(role))return true;
 if(role?.startsWith('song:'))return canonSongNames().includes(role.slice(5));
 return ['likeness','body','emotion','emotion-map','individual-emotion','scene','prop','wardrobe','hair'].includes(role);
}
function canonValidate(v){
 const refs=v.canonical_references||{},hist=v.canon_history||[];
 if(!refs||typeof refs!=='object'||Array.isArray(refs)||!Array.isArray(hist)||hist.length>10000)throw Error('Invalid canon selections/history');
 function check(cid,slot,r){const c=people.get(cid),a=assets.get(r?.id);if(!c||!a||!a.character_ids.includes(cid)||!canonDestinationAllowed(r.role)||!knownSourceHash(a,r.source_sha256))throw Error('Invalid canon identity, role or source hash');if(r.look_id!=null&&!c.looks.some(l=>l.id===r.look_id))throw Error('Unknown costume stage');if(!['body','wardrobe'].includes(r.role)&&r.look_id)throw Error('Identity/emotion is separate from wardrobe stage');if(r.role==='wardrobe'&&!r.look_id)throw Error('Wardrobe needs a look');if(slot!==canonKey(r.role,r.look_id)||typeof r.selected_at!=='string'||!Number.isFinite(Date.parse(r.selected_at))||typeof r.selection_id!=='string'||r.selection_id.length>150)throw Error('Invalid canon selection');}
 for(const [cid,slots]of Object.entries(refs)){if(!slots||typeof slots!=='object'||Array.isArray(slots))throw Error('Invalid canon slots');for(const [slot,r]of Object.entries(slots))check(cid,slot,r);}
 for(const e of hist){if(!e||typeof e.event_id!=='string'||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at)))throw Error('Invalid canon history');check(e.character_id,e.slot,e.next);if(e.previous)check(e.character_id,e.slot,e.previous);}
 const approvals=v.reference_approvals||{};
 if(typeof approvals!=='object'||Array.isArray(approvals))throw Error('Invalid image approvals');
 for(const[cid,items]of Object.entries(approvals)){if(!people.has(cid)||!items||typeof items!=='object'||Array.isArray(items))throw Error('Invalid approval character');for(const[id,r]of Object.entries(items)){const a=assets.get(id);if(!a||!a.character_ids.includes(cid)||!r||!knownSourceHash(a,r.source_sha256)||!canonDestinationAllowed(r.role)||typeof r.approved!=='boolean'||typeof r.updated_at!=='string'||!Number.isFinite(Date.parse(r.updated_at)))throw Error('Invalid image approval');}}
 return {canonical_references:JSON.parse(JSON.stringify(refs)),canon_history:JSON.parse(JSON.stringify(hist)),reference_approvals:JSON.parse(JSON.stringify(approvals))};
}
function canonCurrent(cid,sourceReview=review){
 const c=people.get(cid),out={},pair=c.prompt_reference_pair||{};
 for(const [role,id]of Object.entries({likeness:pair.likeness_id,body:pair.full_body_id})){const a=assets.get(id);if(a?.status==='Confirmed')out[role]={id,role,look_id:null,source_sha256:a.sha256,selected_at:D.created||'2026-10-24T00:00:00Z',selection_id:'documented-'+cid+'-'+role,basis:'Documented user selection'};}
 for(const [role,id]of Object.entries(sourceReview.pairs[cid]||{})){const a=assets.get(id);if(a&&canonAllowed(a,role))out[role]={id,role,look_id:null,source_sha256:a.sha256,selected_at:sourceReview.notes[id]?.updated_at||'2026-10-24T00:00:00Z',selection_id:'legacy-'+cid+'-'+role,basis:'Earlier explicit reference choice; legacy export did not pin a hash'};}
 Object.assign(out,sourceReview.canonical_references?.[cid]||{});return out;
}
// Resolution warnings concern the exact selected source, never its thumbnail.
function referenceResolutionNotice(width,height){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||Math.min(width,height)>=512)return '';
 return `<summary>Low-resolution reference</summary><p>Original: ${Math.round(width)} × ${Math.round(height)} pixels. Fine facial and costume details may be unreliable.</p><p>Choose a larger original if available. Enlarging this file alone will not recover missing detail.</p><small>Shown when the source’s shorter side is under 512 pixels. Approval does not measure image quality.</small>`;
}
// Loading the source also covers older versions without recorded dimensions.
document.addEventListener('load',event=>{
 const im=event.target;if(!im.matches?.('img[data-selected-reference-source]'))return;
 const warning=im.closest('.selected-reference-card')?.querySelector('[data-reference-resolution]');if(!warning)return;
 const notice=referenceResolutionNotice(im.naturalWidth,im.naturalHeight);warning.innerHTML=notice;warning.hidden=!notice;
},true);
function canonImage(r){const a=assets.get(r.id);return r.source_sha256===a.sha256?a:(a.previous_versions||[]).find(x=>x.sha256===r.source_sha256);}
function canonLabel(r,cid){return canonRoleLabel(r.role)+(r.look_id?' · '+lookDisplayName(people.get(cid).looks.find(l=>l.id===r.look_id)):r.role==='body'?' · Earlier unscoped choice':'');}
function canonPanel(c){
 const slots=Object.entries(canonCurrent(c.id)).filter(([,r])=>{const a=assets.get(r.id);return a&&effectiveStatus(a)!=='Obsolete';}),history=(review.canon_history||[]).filter(e=>e.character_id===c.id);
 const missingRoles=[['likeness','portrait'],['body','full-body / costume'],['emotion','emotion reference']].filter(([role])=>!slots.some(([,r])=>canonRoleFamily(r.role)===role&&assets.has(r.id)&&effectiveStatus(assets.get(r.id))!=='Obsolete'));
 const complete=missingRoles.length===0;
 const chooseMissing=missingRoles.length?`<div class="actions">${missingRoles.map(([role,label])=>`<button type="button" data-reference-role="${role}" data-reference-character="${esc(c.id)}">Choose ${label}</button>`).join(' ')}</div>`:'';
 const detailsIcon='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Z M14 3v5h5 M8 12h8 M8 16h5"/></svg>';
 const historyIcon='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Z M12 5v15 M5 7h4 M5 10h4"/><path d="M17 8v3l2 1"/><circle cx="17" cy="11" r="4"/></svg>';
 return `<details class="canonpanel${complete?' is-complete':''}"${complete?'':' open'}><summary class="canon-summary"><h2>Selected references</h2><span class="canon-completion">${complete?'All selections made':(3-missingRoles.length)+' of 3 selected'}</span></summary><div class="canon-panel-body">${!slots.length?'<p>No references selected yet.</p>':''}${chooseMissing}<div class="canongrid">${slots.map(([slot,r])=>{const a=assets.get(r.id),im=canonImage(r),resolutionNotice=referenceResolutionNotice(im.width,im.height);return `<article class="selected-reference-card"><div class="selected-reference-info"><strong>${esc(canonLabel(r,c.id))}</strong>${referenceBadge(a,c.id,r.source_sha256)}<details class="reference-resolution-warning" data-reference-resolution${resolutionNotice?'':' hidden'}>${resolutionNotice}</details>${r.source_sha256!==a.sha256?'<p>Earlier image version selected.</p>':''}<button data-canon="${esc(r.id)}" data-canon-character="${esc(c.id)}" data-canon-slot="${esc(slot)}">Change selection</button><details class="reference-icon-details"><summary aria-label="Image details" title="Image details">${detailsIcon}</summary><div class="reference-details-body"><code>${esc(r.id)}</code><p>${esc(r.basis||'Your explicit reference choice')}</p></div></details></div><a class="selected-reference-image" href="${esc(im.asset)}" target="_blank" rel="noopener" aria-label="Open selected ${esc(canonLabel(r,c.id).toLowerCase())} image full size" title="Open full-size image"><img data-selected-reference-source src="${esc(im.asset)}" alt="${esc(a.title)}" loading="lazy"></a></article>`;}).join('')}</div>${history.length?`<details class="reference-icon-details reference-history"><summary aria-label="Selection history (${history.length})" title="Selection history (${history.length})">${historyIcon}</summary><div class="reference-details-body">${history.slice().reverse().map(e=>`<p>${esc(e.at)} · ${esc(e.slot)}: ${esc(e.previous?.id||'None')} → ${esc(e.next.id)}${e.previous?` <button data-canon-restore="${esc(e.event_id)}">Restore previous selection</button>`:''}</p>`).join('')}</div></details>`:''}</div></details>`;
}
function canonSelect(cid,id,role,look,restore=false,hash=null){
 if(role==='individual-emotion')throw Error('Choose a named emotion for this reference.');
 const a=assets.get(id),c=people.get(cid);if(!a||!c||!a.character_ids.includes(cid)||!canonDestinationAllowed(role))throw Error('Choose a reference that belongs to this character and role.');
 if(['body','wardrobe'].includes(role)&&(!look||!c.looks.some(l=>l.id===look&&l.active_story!==false)))throw Error('Choose an active costume look/stage.');
 if(!['body','wardrobe'].includes(role))look=null;
 if(effectiveStatus(a)==='Obsolete'&&!restore)throw Error('This image is obsolete. Explicitly restore it before selecting.');
 const source_sha256=hash||a.sha256;if(!knownSourceHash(a,source_sha256))throw Error('Unknown image revision.');
 const at=new Date().toISOString(),slot=canonKey(role,look),previous=canonCurrent(cid)[slot]||null;
 const next={id,role,look_id:look,source_sha256,selected_at:at,selection_id:crypto.randomUUID()};
 if(restore)review.notes[id]={...review.notes[id],verdict:review.notes[id]?.verdict||'Unreviewed',text:review.notes[id]?.text||'',obsolete:false,updated_at:at};
 review.canonical_references??={};review.canonical_references[cid]??={};review.canonical_references[cid][slot]=next;
 review.canon_history??=[];review.canon_history.push({event_id:crypto.randomUUID(),character_id:cid,slot,previous,next,at});
 // Legacy readers can still find identity/emotion; stage-specific bodies live in canonical_references.
 if(['likeness','emotion'].includes(role)){review.pairs[cid]??={};review.pairs[cid][role]=id;}
 save();return next;
}
function canonDialog(id,cid=current,prior=null,presetRole=null,presetLook=null){
 const a=assets.get(id);if(!a)return;
 cid=a.character_ids.includes(cid)?cid:a.character_ids.length===1?a.character_ids[0]:'';
 const c=people.get(cid);if(!c){openModal('Choose a character first','<p>Open the intended character’s record, then choose this image from a reference slot.</p>');return;}
 let initialRole=prior?.role||presetRole||canonDefaultRole(a);if(initialRole==='individual-emotion'){const n=emotionNames(c).find(n=>n.toLowerCase()===emotionImageName(a).toLowerCase());if(n)initialRole='individual-emotion:'+n;}const looks=(c.looks||[]).filter(l=>l.active_story!==false);
 const initialLook=prior?.look_id||presetLook||'';
 const roles=['likeness','body','emotion-map','individual-emotion','scene','prop','wardrobe','hair'];if(initialRole==='emotion')roles.push('emotion');
 const option=role=>`<option value="${esc(role)}"${role===initialRole?' selected':''}>${esc(canonRoleLabel(role))}</option>`;
 openModal('Confirm reference',`<div class="canon-confirmation"><img class="canonpreview" src="${esc(prior?canonImage(prior).asset:a.asset)}" alt="${esc(a.title)}"><div class="canon-confirmation-info"><p class="eyebrow">${esc(c.name)}</p><label class="canon-destination-label" for="canonDestination">Use as reference for</label><select id="canonDestination"><optgroup label="Reference categories">${roles.map(option).join('')}</optgroup><optgroup label="Individual emotions">${emotionNames(c).map(n=>option('individual-emotion:'+n)).join('')}</optgroup><optgroup label="Musical numbers">${canonSongNames().map(song=>option('song:'+song)).join('')}</optgroup></select><p class="small">${esc(id)}</p><label id="canonLookLabel">Costume stage<select id="canonLook"><option value="">Choose a stage</option>${looks.map(l=>`<option value="${esc(l.id)}"${l.id===initialLook?' selected':''}>${esc(lookDisplayName(l))}</option>`).join('')}</select></label><p id="canonCurrentSlot" aria-live="polite"></p>${effectiveStatus(a)==='Obsolete'?'<label class="canon-restore"><input type="checkbox" id="canonRestore"> Restore this set-aside image</label>':''}<button id="commitCanon">Use this reference</button><p id="canonResult" role="status"></p></div></div>`);
 if(initialLook&&looks.some(l=>l.id===initialLook))$('modalBody').insertAdjacentHTML('afterbegin',`<p><button data-wardrobe-browse="${esc(initialLook)}" data-wardrobe-character="${esc(cid)}">Browse all tagged images for this look</button></p>`);
 const selectedRole=()=>$('canonDestination').value,needsLook=()=>['body','wardrobe'].includes(selectedRole()),selectedLook=()=>needsLook()?$('canonLook').value||null:null;
 const showSlot=()=>{const role=selectedRole(),lid=selectedLook(),old=canonCurrent(cid)[canonKey(role,lid)];$('canonLookLabel').hidden=!needsLook();$('commitCanon').disabled=role==='individual-emotion'||!canonDestinationAllowed(role)||(needsLook()&&!lid);$('canonCurrentSlot').textContent=role==='individual-emotion'?'Choose a named emotion from the Individual emotions group above.':needsLook()&&!lid?'Choose the stage this outfit belongs to.':old?.id===id&&old.source_sha256===(prior?.source_sha256||a.sha256)?'This image is already selected for '+canonRoleLabel(role)+'.':old?'Replaces '+old.id+' for '+canonRoleLabel(role)+'.':'No reference selected for '+canonRoleLabel(role)+' yet.';};
 $('canonDestination').onchange=showSlot;$('canonLook').onchange=showSlot;showSlot();
 $('commitCanon').onclick=()=>{try{canonSelect(cid,id,selectedRole(),selectedLook(),!!$('canonRestore')?.checked,prior?.source_sha256);$('modal').close();detail(cid);toast('Reference selected.');}catch(e){$('canonResult').textContent=e.message;}};
}

function canonChangeGallery(cid,slot,uploadMessage=''){
 const c=people.get(cid),selected=canonCurrent(cid)[slot];if(!c||!selected)return;
 if(namedEmotionRole(selected.role)){emotionPicker(cid,selected.role.slice(19));return;}
 if(selected.look_id){wardrobeChoose(cid,selected.look_id);return;}
 const roleType=canonRoleLabel(selected.role),uploadType=types.includes(roleType)?roleType:assets.get(selected.id).type;
 const images=[...assets.values()].filter(a=>a.character_ids.includes(cid)).sort((a,b)=>(a.id===selected.id?-1:b.id===selected.id?1:0)||(rankValue(a,cid)??Infinity)-(rankValue(b,cid)??Infinity)||a.id.localeCompare(b.id));
 openModal('Change selection · '+c.name,`<section class="reference-chooser"><p><strong>${esc(canonLabel(selected,cid))}</strong> · ${images.length} known images</p><p class="small">Choose a replacement, then confirm. Images for other roles are shown for reference; set-aside images require restoration.</p><div id="selectionReferenceUpload"></div>${uploadMessage?`<p class="reference-upload-feedback" role="status">${esc(uploadMessage)}</p>`:''}<div class="reference-choice-grid">${images.map(a=>`<article><img loading="lazy" src="${esc(a.thumbnail)}" alt="${esc(a.title)}">${a.id===selected.id?'<strong>Current selection</strong>':''}${referenceBadge(a,cid)}<strong>${esc(a.id)}</strong><p>${esc(a.title)}</p><p class="small">${esc(a.type)}</p><button type="button" data-canon-gallery-pick="${esc(a.id)}" ${canonAllowed(a,selected.role)?'':'disabled'}>${canonAllowed(a,selected.role)?effectiveStatus(a)==='Obsolete'?'Restore & choose…':'Choose this image':'Not available for this role'}</button><button type="button" data-image="${esc(a.id)}" data-selection-character="${esc(cid)}" data-selection-role="${esc(selected.role)}" data-selection-look="${esc(selected.look_id||'')}" aria-label="Review image ${esc(a.id)}">Review image</button></article>`).join('')}</div></section>`);
 window.DESKReferenceLibrary.mountUpload($('selectionReferenceUpload'),{characterId:cid,type:uploadType,lookId:selected.look_id||null,onSaved:message=>{detail(cid);canonChangeGallery(cid,slot,message);}});
 for(const b of $('modalBody').querySelectorAll('[data-canon-gallery-pick]'))b.onclick=()=>canonDialog(b.dataset.canonGalleryPick,cid,b.dataset.canonGalleryPick===selected.id?selected:null,selected.role,selected.look_id);
}
function canonMergeImport(v,replace){let conflicts=0;review.reference_approvals??={};for(const[cid,items]of Object.entries(v.reference_approvals||{})){review.reference_approvals[cid]??={};for(const[id,r]of Object.entries(items)){const old=review.reference_approvals[cid][id];if(old&&JSON.stringify(old)!==JSON.stringify(r)&&!replace){conflicts++;continue;}review.reference_approvals[cid][id]=r;}}review.canonical_references??={};for(const[cid,slots]of Object.entries(v.canonical_references||{})){review.canonical_references[cid]??={};for(const[slot,r]of Object.entries(slots)){const old=review.canonical_references[cid][slot];if(old&&JSON.stringify(old)!==JSON.stringify(r)&&!replace){conflicts++;continue;}review.canonical_references[cid][slot]=r;}}review.canon_history??=[];const seen=new Set(review.canon_history.map(e=>e.event_id));for(const e of v.canon_history||[])if(!seen.has(e.event_id)){review.canon_history.push(e);seen.add(e.event_id);}return conflicts;}
function directorExport(cid=null){return {schema:'desk.director-references',version:1,source:'Browser preview; use shared disk manifest after saved',characters:(cid?[people.get(cid)]:D.characters).map(c=>({id:c.id,name:c.name,references:Object.entries(canonCurrent(c.id)).map(([slot,r])=>{const a=assets.get(r.id),im=canonImage(r);return {...r,slot,asset:im.asset,source_paths:a.sources,usable:effectiveStatus(a)!=='Obsolete',revision_is_current:r.source_sha256===a.sha256};}),rule:'Pair an appropriate full-body costume for the story stage with an emotional reference. Outfit-only studies are separate; missing or obsolete references block that role.'}))};}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.canon){const cid=b.dataset.canonCharacter||current;if(b.dataset.canonSlot)canonChangeGallery(cid,b.dataset.canonSlot);else{let role=b.dataset.selectionRole||null;const group=b.closest('[data-library-disclosure]');if(!role&&group){const [,kind,label]=JSON.parse(group.dataset.libraryDisclosure);if(kind==='song'&&canonSongNames().includes(label))role='song:'+label;else if(kind==='type')role=canonCategoryRole(label);}const category=b.closest('[data-category-disclosure]');if(!role&&category)role=canonCategoryRole(JSON.parse(category.dataset.categoryDisclosure)[1]);canonDialog(b.dataset.canon,cid,null,role,b.dataset.selectionLook||null);}}if(b.dataset.canonRestore){const h=review.canon_history.find(h=>h.event_id===b.dataset.canonRestore);if(h?.previous)canonDialog(h.previous.id,h.character_id,h.previous);}if(b.dataset.directorExport)exportOptions();});
