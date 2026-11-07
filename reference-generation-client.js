/* API-first creation adapters for the existing reference brief views. */
(()=>{
'use strict';
function chosen(cid,key,role){const r=canonCurrent(cid)[key],a=r&&assets.get(r.id),im=r&&canonImage(r);return im&&a&&effectiveStatus(a)!=='Obsolete'?{id:r.id,sha256:r.source_sha256,role}:null;}
function character(cid,type,lid,prompt){
 const c=people.get(cid),identity=chosen(cid,'likeness','identity'),reasons=[];
 if(['Full-body / costume','Emotion map','Individual emotion','Hairstyle study'].includes(type)&&!identity)reasons.push('No saved likeness. Use Choose likeness above, select the face, save it, then reopen this request.');
 if(['Full-body / costume','Mannequin outfit study'].includes(type)&&!lid)reasons.push('No costume stage selected. Choose a costume / story stage above.');
 if(reasons.length)throw Object.assign(Error(reasons.join(' ')),{reasons});
 const refs=[...(type!=='Mannequin outfit study'&&identity?[identity]:[]),...(lid?[chosen(cid,canonKey('wardrobe',lid),'costume'),chosen(cid,canonKey('body',lid),'body')].filter(Boolean):[])];
 const unique=[...new Map(refs.map(r=>[r.id+'|'+r.sha256,r])).values()];
 return {job_kind:'reference',character_id:cid,look_id:lid||null,reference_type:type,prompt,input_references:unique,aspect:type==='Individual emotion'?'1:1 square':type==='Portrait / likeness'?'2:3 portrait':'3:2 landscape'};
}
function locationRefs(l){
 const choices=[...(l.canonical_source?[l.canonical_source]:[]),...Object.values(l.selections||{}),...Object.entries(l.approvals||{}).filter(([,r])=>r.approved).map(([id,r])=>({id,...r}))];
 return [...new Map(choices.filter(r=>{const a=assets.get(r.id);return a&&effectiveStatus(a)!=='Obsolete'&&(a.sha256===r.source_sha256||a.previous_versions?.some(v=>v.sha256===r.source_sha256));}).map(r=>[r.id+'|'+r.source_sha256,{id:r.id,sha256:r.source_sha256,role:'location'}])).values()];
}
function locationRequest(l,slot,prompt,extra={}){return {job_kind:'reference',character_id:null,look_id:null,location_id:l.id,slot_id:slot,reference_type:'Scene reference',prompt,input_references:locationRefs(l),aspect:'16:9 widescreen',...extra};}
function promptDisclosure(area,isFresh=()=>true){
 const label=area.closest('label');if(!label)return ()=>{};
 const details=document.createElement('details');details.className='reference-prompt-disclosure';
 const summary=document.createElement('summary');
 summary.innerHTML='<span>Image prompt</span><span class="reference-prompt-state" role="status" aria-live="polite"></span>';
 const status=summary.querySelector('.reference-prompt-state');
 label.before(details);details.append(summary,label);label.classList.add('reference-prompt-label');
 const copy=document.querySelector('[data-copy-textarea="'+area.id+'"]');if(copy)details.append(copy);
 return ()=>{
  const state=!area.value.trim()?'empty':isFresh()?'fresh':'stale';
  const title={empty:'Empty',stale:'Stale Prompt',fresh:'Fresh Prompt'}[state];
  const hint={empty:'Regenerate or enter an image prompt.',stale:'Reference choices or direction changed. Regenerate the prompt.',fresh:'Prompt reflects the current reference choices and direction; you can edit it before generating.'}[state];
  const icon={empty:'<circle cx="12" cy="12" r="8"/>',stale:'<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>',fresh:'<circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/>'}[state];
  status.dataset.state=state;status.title=hint;status.setAttribute('aria-label',title+'. '+hint);
  status.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icon+'</svg><span>'+title+'</span>';
 };
}
function attach(textareaId,build,options={}){
 const area=document.getElementById(textareaId);if(!area)return;
 const updatePrompt=textareaId==='referenceLookPrompt'?promptDisclosure(area,options.promptFresh):()=>{};
 const host=document.createElement('div');host.className='reference-generation-host';document.getElementById('modalBody').append(host);
 const choices=document.createElement('div');choices.className='reference-generation-options';
 const formats=[['','Recommended','For this reference'],['3:2 landscape','3:2','Landscape'],['2:3 portrait','2:3','Portrait'],['16:9 widescreen','16:9','Widescreen'],['1:1 square','1:1','Square']];
 choices.innerHTML='<fieldset class="reference-format-picker"><legend>Image format</legend><div class="reference-format-segments">'+formats.map(([value,title,description])=>'<label><input type="radio" name="'+textareaId+'-format" data-ref-format value="'+value+'" '+(value===(options.aspect||'')?'checked':'')+'><span><strong>'+title+'</strong><small>'+description+'</small></span></label>').join('')+'</div></fieldset>'+(options.design?'<details><summary>Initial location design proposal</summary><p class="small">Use this only to establish a location without existing visual references. Describe the design to propose; it will remain unapproved.</p><label>Design direction<textarea data-ref-direction rows="3" maxlength="2500" placeholder="Describe the geography, architecture, materials and layout to propose…"></textarea></label><label><input type="checkbox" data-ref-proposal> Generate an initial design proposal from this direction</label></details>':'');
 host.append(choices);const controls=document.createElement('div');host.append(controls);
 function request(){const reasons=[];if(!area.value.trim())reasons.push('The image prompt is empty. Enter or create a prompt above.');let value;try{value=build(area.value);}catch(e){reasons.push(...(e.reasons||[e.message]));}if(!value)throw Object.assign(Error(reasons.join(' ')),{reasons});const fmt=choices.querySelector('[data-ref-format]:checked').value;if(fmt)value.aspect=fmt;
  if(options.design){value.design_proposal=choices.querySelector('[data-ref-proposal]').checked;value.design_direction=choices.querySelector('[data-ref-direction]').value.trim();if(!value.input_references.length&&(!value.design_proposal||value.design_direction.length<20))reasons.push('No usable location reference. Add a reference, or expand Initial location design proposal above, enter at least 20 characters of design direction and select its checkbox.');}
  if(reasons.length)throw Object.assign(Error(reasons.join(' ')),{reasons});
  return value;
 }
 const panel=DESKGeneration.mount(controls,null,{storageKey:'desk-reference-job:'+options.key,request});
 const update=()=>{if(!host.isConnected)return;updatePrompt();try{request();panel.prepare({});}catch(e){panel.invalidate(e.reasons||e.message);}};
 const body=document.getElementById('modalBody');body.addEventListener('input',update);body.addEventListener('change',update);
 const observer=new MutationObserver(()=>{if(!host.isConnected){body.removeEventListener('input',update);body.removeEventListener('change',update);observer.disconnect();}});observer.observe(body,{childList:true});
 update();
}
function costumeRequest(cid,lid){
 const c=people.get(cid),look=c?.looks.find(l=>l.id===lid);if(!look)return;
 const saved=canonCurrent(cid).likeness;
 const exact=r=>{const a=r&&assets.get(r.id),im=a&&canonImage(r);return im?.asset&&effectiveStatus(a)!=='Obsolete'?{...a,...im,id:a.id,sha256:r.source_sha256}:null;};
 let identity=exact(saved),costume=null,prepared=false,limit=24;
 const gallery=window.DESKImageGalleries.characterImages(c);
 const variants=Object.values(canonCurrent(cid)).map(exact).filter(Boolean);
 const seeds=[...new Map([...gallery,...variants.filter(a=>gallery.some(x=>x.id===a.id))].map(a=>[a.id+'|'+a.sha256,a])).values()].filter(a=>effectiveStatus(assets.get(a.id))!=='Obsolete');
 const faces=[...new Map([...D.assets.filter(a=>(a.character_ids||[]).includes(cid)&&a.type==='Portrait / likeness'),...(identity?[identity]:[])].map(a=>[a.id+'|'+a.sha256,a])).values()].filter(a=>effectiveStatus(assets.get(a.id))!=='Obsolete');
 const key=a=>a.id+'|'+a.sha256;
 openModal('Create reference · '+lookDisplayName(look),`<section class="reference-seed-request"><p><strong>${esc(c.name)}</strong> · Full-body / costume · ${esc(lookDisplayName(look))}</p><p class="small">Both image references are optional. Keep either, both, or neither for this request. These choices do not change selected references or approvals.</p><div class="reference-seed-pair"><section><h3>Likeness / portrait · Optional</h3><div data-seed-preview="identity"></div><button type="button" data-seed-picker="identity">Choose likeness / portrait</button> <button type="button" data-seed-remove="identity">Remove likeness</button></section><section><h3>Costume seed · Optional</h3><div data-seed-preview="costume"></div><button type="button" data-seed-picker="costume">Choose from wardrobe gallery</button> <button type="button" data-seed-remove="costume">Remove costume seed</button></section></div><section class="reference-seed-picker" hidden><div class="reference-seed-picker-heading"><h3 data-seed-picker-title></h3><button type="button" data-seed-close>Done</button></div><label>Search images<input type="search" data-seed-search placeholder="Title, look, image ID or tag"></label><p class="small" data-seed-count></p><div class="reference-seed-grid"></div><button type="button" data-seed-more hidden>Show more</button></section><label class="reference-seed-notes">Additional costume direction<textarea data-seed-notes rows="2" placeholder="Optional changes to the seed outfit"></textarea></label><button type="button" data-seed-regenerate>Regenerate prompt</button><p data-seed-message role="status">Attach optional references or use text direction, then regenerate the prompt.</p><label class="reference-prompt-label">Image prompt<textarea id="referenceLookPrompt" rows="10" aria-label="Reference image prompt" placeholder="Your prompt will appear here when you click Regenerate prompt."></textarea></label><button type="button" data-copy-textarea="referenceLookPrompt">Copy prompt for chat</button></section>`);
 const root=document.querySelector('.reference-seed-request'),area=document.getElementById('referenceLookPrompt'),picker=root.querySelector('.reference-seed-picker');let picking='costume';
 const q=s=>root.querySelector(s);
 function preview(role,a){q('[data-seed-preview="'+role+'"]').innerHTML=a?`<a href="${esc(a.asset)}" target="_blank" rel="noopener" title="Open exact reference"><img class="${role==='identity'?'reference-face-preview':''}" src="${esc(a.asset)}" alt="${esc(a.title)}"></a><p><strong>${esc(a.title)}</strong></p><p class="small">${esc(a.id)} · ${esc(referenceStatus(assets.get(a.id),cid,a.sha256))}</p>`:'<div class="reference-seed-empty">'+(role==='identity'?'No portrait attached. The face will be a proposed likeness.':'No costume seed attached. Clothing will follow the written direction.')+'</div>';q('[data-seed-remove="'+role+'"]').hidden=!a;}

 function invalidate(){prepared=false;q('[data-seed-message]').textContent='Choices changed. Regenerate the prompt before generating.';area.dispatchEvent(new Event('input',{bubbles:true}));}
 function renderPicker(){
  const query=q('[data-seed-search]').value.trim().toLowerCase(),items=(picking==='identity'?faces:seeds).filter(a=>!query||[a.title,a.id,...(a.tags||[])].join(' ').toLowerCase().includes(query));
  q('[data-seed-count]').textContent=items.length+' images · all looks · selecting here affects only this request';
  q('.reference-seed-grid').innerHTML=items.slice(0,limit).map(a=>`<button type="button" data-seed-use="${esc(key(a))}" aria-pressed="${key(a)===(picking==='identity'?(identity&&key(identity)):(costume&&key(costume)))}"><img src="${esc(a.asset)}" alt="" loading="lazy"><span>${esc(a.title)}</span><small>${esc(referenceStatus(assets.get(a.id),cid,a.sha256))}</small></button>`).join('')||'<p>No matching images. Add a reference to this character’s gallery first.</p>';
  q('[data-seed-more]').hidden=items.length<=limit;
 }
 root.addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.seedRemove){const role=b.dataset.seedRemove;if(role==='identity')identity=null;else costume=null;preview(role,null);picker.hidden=true;invalidate();}
  if(b.dataset.seedPicker){picking=b.dataset.seedPicker;limit=24;picker.hidden=false;q('[data-seed-search]').value='';q('[data-seed-picker-title]').textContent=picking==='identity'?'Choose a likeness / portrait':'Choose a costume seed · Wardrobe gallery';renderPicker();}
  if(b.hasAttribute('data-seed-close'))picker.hidden=true;
  if(b.hasAttribute('data-seed-more')){limit+=24;renderPicker();}
  if(b.dataset.seedUse){const a=(picking==='identity'?faces:seeds).find(a=>key(a)===b.dataset.seedUse);if(!a)return;if(picking==='identity')identity=a;else costume=a;preview(picking,a);picker.hidden=true;invalidate();}
  if(b.hasAttribute('data-seed-regenerate')){
   const ref=(label,a)=>`${label}: ${a.title}\nID: ${a.id}\nExact image SHA-256: ${a.sha256}\nImage: ${new URL(a.asset,location.href).href}`;
   const refs=[identity&&ref('IDENTITY / FACE',identity),costume&&ref('COSTUME SEED',costume)].filter(Boolean);
   const direction=q('[data-seed-notes]').value.trim();
   const clothing=costume?'The costume seed controls garment construction, layers, palette, closures, accessories and footwear, except for requested changes below. Use it for clothing only; do not copy its face.':`No costume image is attached. Propose clothing from the written outfit direction: ${look.custom?(look.custom_garments||'Design an outfit appropriate to the character and named look.'):(look.garment_language||'Design an outfit appropriate to the character and named look.')}`;
   area.value=`Create a full-body costume reference for ${c.name}, look ${lookDisplayName(look)}.\nCharacter ID: ${cid}\nLook ID: ${lid}\n\n${refs.length?refs.join('\n\n'):'TEXT-ONLY DESIGN — no input images attached.'}\n\n${refs.length?'Use only the exact input images listed above.':'Generate from the text direction only.'} Do not substitute or silently attach other saved references.\n${identity?'The portrait controls facial identity, age, hairline, hairstyle and facial hair. Preserve this identity and proportions.':'No portrait is attached. Create a proposed likeness using the character context below; facial continuity with saved portraits is not established.'}\nCharacter context: ${c.description||c.role||c.name}\n${clothing}\nThese are exploration choices, not a declaration of approved costume canon.\n\nRequested condition for this look: ${look.custom?(look.custom_condition||(costume?'Preserve the condition shown in the seed.':'Use a sound, maintained condition unless directed otherwise.')):(look.condition_language||'Follow the written direction.')}\n${direction?'Additional costume direction: '+direction+'\n':''}\nProduce a front / three-quarter / back full-length costume sheet, complete head through footwear, neutral relaxed standing pose, consistent face and outfit across views, soft studio light and warm-gray background. No scenery, extra people or labels.\n\nScope: ${look.scope_note||'Creative costume exploration.'}\nSave as an unapproved candidate for this character and look. Preserve existing selections, approvals, rankings and originals.`;
   prepared=true;area.dispatchEvent(new Event('input',{bubbles:true}));q('[data-seed-message]').textContent='Prompt regenerated with '+refs.length+' attached image'+(refs.length===1?'':'s')+'. Review it, then generate.';
  }
 });
 if(look.custom)q('[data-seed-notes]').value=look.custom_garments||'';
 q('[data-seed-search]').addEventListener('input',renderPicker);q('[data-seed-notes]').addEventListener('input',invalidate);
 preview('identity',identity);preview('costume',costume);
 attach('referenceLookPrompt',prompt=>{
  const reasons=[];if(!prepared)reasons.push('Regenerate the prompt after choosing references or changing costume direction.');
  if(identity&&costume&&key(identity)===key(costume))reasons.push('Choose a separate costume seed so face and clothing have distinct references.');
  for(const a of [identity,costume].filter(Boolean))if(effectiveStatus(assets.get(a.id))==='Obsolete')reasons.push('A chosen reference was set aside. Choose an active image.');
  if(reasons.length)throw Object.assign(Error(reasons.join(' ')),{reasons});
  return {job_kind:'reference',character_id:cid,look_id:lid,reference_type:'Full-body / costume',explicit_reference_choices:true,prompt,input_references:[['identity',identity],['costume',costume]].filter(([,a])=>a).map(([role,a])=>({id:a.id,sha256:a.sha256,role})),aspect:'3:2 landscape'};
 },{key:cid+':'+lid+':Full-body / costume',promptFresh:()=>prepared});
}

function fromLook(cid,lid,type='Full-body / costume'){
 if(type==='Full-body / costume')return costumeRequest(cid,lid);
 const c=people.get(cid),l=c?.looks.find(x=>x.id===lid);if(!l)return;
 const text=type==='Mannequin outfit study'?`Create a clothing-only mannequin outfit study for ${c.name}, look ${lookDisplayName(l)}. No recognizable face or person. Garments: ${l.garment_language}. Condition: ${l.condition_language}. Scope: ${l.scope_note}. Show the complete outfit including footwear. Preserve the attached selected outfit construction when available. This is an unapproved design proposal.\n\n${l.proposed_mannequin_prompt||''}`:lookChatRequest(c,l);
 openModal('Create reference · '+lookDisplayName(l),`<p><strong>${esc(c.name)}</strong> · ${esc(type)}</p><label>Image prompt<textarea id="referenceLookPrompt" rows="9" aria-label="Reference image prompt">${esc(text)}</textarea></label><button type="button" data-copy-textarea="referenceLookPrompt">Copy prompt for chat</button>`);
 attach('referenceLookPrompt',prompt=>character(cid,type,lid,prompt),{key:cid+':'+lid+':'+type});
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-reference-generate-look]');if(b)fromLook(b.dataset.referenceCharacter,b.dataset.referenceGenerateLook,b.dataset.referenceType||'Full-body / costume');});
window.DESKReferenceGeneration={attach,character,locationRequest,locationRefs,fromLook};
})();
