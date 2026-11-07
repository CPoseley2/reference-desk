/* Add references without changing selections, approvals, ratings or original files. */
(()=>{
const tagList=s=>s.split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
const option=(value,label)=>`<option value="${esc(value)}">${esc(label)}</option>`;
async function post(path,payload){
 const stateResponse=await fetch('api/review',{cache:'no-store'});if(!stateResponse.ok)throw Error('Local reference server unavailable.');
 const state=await stateResponse.json(),res=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':state.csrf_token},body:JSON.stringify(payload)}),value=await res.json();
 if(!res.ok)throw Error(value.error||'Could not save.');
 for(const a of value.assets||[]){const old=assets.get(a.id);if(old)Object.assign(old,a);else{D.assets.push(a);assets.set(a.id,a);}}
 for(const c of value.characters||[]){const old=people.get(c.id);if(old)Object.assign(old,c);else{D.characters.push(c);people.set(c.id,c);}}
 for(const g of value.groups||[]){const old=D.groups.find(x=>x.id===g.id);if(old)Object.assign(old,g);else D.groups.push(g);}
 if(value.audit)Object.assign(D.audit,value.audit);
 for(const l of value.locations||[]){D.locations=D.locations||[];const old=D.locations.find(x=>x.id===l.id);if(old)Object.assign(old,l);else D.locations.push(l);}
 window.dispatchEvent(new Event('desk-catalog-changed'));
 return value;
}
function editTags(id){const a=assets.get(id);if(!a)return;const before=[...(a.tags||[])];
 openModal('Tags · '+id,`<p>${esc(a.title)}</p><label>Tags (comma or newline separated)<textarea id="referenceTagText" rows="4">${esc(before.join(', '))}</textarea></label><p>Use several tags, such as group, season, location, prop. Tags describe an image; they do not approve it.</p><button id="saveReferenceTags">Save tags</button><p id="referenceMessage" role="status"></p>`);
 $('saveReferenceTags').onclick=async()=>{const b=$('saveReferenceTags');b.disabled=true;try{await post('api/reference-tags',{id,expected_tags:before,tags:tagList($('referenceTagText').value)});$('modal').close();refreshView();toast('Tags saved.');}catch(e){$('referenceMessage').textContent=e.message;b.disabled=false;}};
}
function picker(cid,type,lookId=null,loc=null){const c=loc?D.locations.find(x=>x.id===loc.id):people.get(cid);if(!c)return;
 const payload=(extra)=>loc?{location_id:loc.id,slot_id:loc.slot,...extra}:{character_id:cid,type,look_id:lookId,...extra};
 const route=loc?'api/location-references':'api/references';const repaint=()=>loc?DESKLocations.show(loc.id):detail(cid);
 const statusOf=a=>loc?DESKLocations.status(a,c):referenceStatus(a,a.character_ids.includes(cid)?cid:a.character_ids[0]);const chosen=new Set();let limit=60,busy=false;
 openModal('Add reference · '+c.name,`<section class="reference-picker"><p><strong>${esc(type)}</strong> · ${esc(c.name)}${lookId?' · '+esc(lookDisplayName(c.looks.find(l=>l.id===lookId))):''}</p>${lookId?`<p><button data-wardrobe-browse="${esc(lookId)}" data-wardrobe-character="${esc(cid)}">Back to all tagged images for this look</button></p>`:''}<p>Choose existing images or upload from your computer. Adding a reference preserves its approval and obsolete status. New uploads remain unapproved.</p><details class="reference-filter-panel"><summary><strong>Filters</strong><span id="referenceFilterSummary"></span></summary><div class="reference-filters"><label>Browse<select id="referenceScope">${option('character',loc?'This location':'This character')}${option('family','Family / clan / group')}${option('all','All images')}</select></label><label>Family / clan / group<select id="referenceFamily">${D.groups.map(g=>option(g.id,g.label)).join('')}</select></label><label>Image category<select id="referenceType">${option('','All categories')}${types.map(t=>option(t,t)).join('')}</select></label><label>Review status<select id="referenceStatus">${option('','All — including obsolete')}${(loc?['Canonical source','Approved reference','Selected for this slot','Unselected for this slot','Needs review','Obsolete']:['Approved reference','Needs review','Obsolete']).map(t=>option(t,t)).join('')}</select></label><label class="reference-search">Search titles, IDs or tags<input id="referenceQuery" type="search" placeholder="season, location, tag…"></label></div></details><div class="reference-addbar"><label>Tags to add to these images<input id="referenceTags" placeholder="group, season, location"></label><button id="addChosenReferences">Add selected references (0)</button></div><p id="referenceMessage" role="status" aria-live="polite"></p><div id="referenceGrid" class="reference-grid"></div><button id="moreReferences" hidden>Show more</button><section class="reference-upload"><h3>Upload from computer</h3><p>PNG, JPEG or WebP · up to 20 MB per image. Multiple files are supported.</p><label>Choose images<input id="referenceUpload" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><button id="uploadReferences">Upload to ${esc(type)}</button></section></section>`);
 // Embed the shared studio lazily; browsing choices survive switching views.
 let generator=null;
 if(!loc&&window.DESKImageWorkspace?.mountReference){
  const body=$('modalBody'),browse=body.querySelector('.reference-picker'),host=document.createElement('section'),nav=document.createElement('nav');
  host.hidden=true;host.className='reference-generator-view';
  nav.className='reference-source-tabs';nav.setAttribute('aria-label','Add reference method');
  nav.innerHTML='<button type="button" data-reference-view="browse" aria-pressed="true">Browse &amp; upload</button><button type="button" data-reference-view="generate" aria-pressed="false">Image Generator</button>';
  body.prepend(nav);body.append(host);
  for(const button of nav.querySelectorAll('button'))button.onclick=()=>{
   const generating=button.dataset.referenceView==='generate';browse.hidden=generating;host.hidden=!generating;
   for(const tab of nav.querySelectorAll('button'))tab.setAttribute('aria-pressed',String(tab===button));
   if(generating&&!generator)generator=DESKImageWorkspace.mountReference(host,{characterId:cid,type,lookId});
   if(!generating)rows();
  };
  const observer=new MutationObserver(()=>{if(!host.isConnected){generator?.destroy();observer.disconnect();}});observer.observe(body,{childList:true});
  $('modal').addEventListener('close',()=>{generator?.destroy();observer.disconnect();},{once:true});
 }
 $('referenceFamily').value=c.group||D.groups[0]?.id||'';
 function updateCount(){$('addChosenReferences').textContent=`Add selected references (${chosen.size})`;}
 function rows(){const scope=$('referenceScope').value,group=$('referenceFamily').value,category=$('referenceType').value,status=$('referenceStatus').value,q=$('referenceQuery').value.toLowerCase().trim();$('referenceFamily').disabled=scope!=='family';
 const list=D.assets.filter(a=>{const ids=a.character_ids||[];return(scope==='all'||scope==='character'&&(loc?DESKLocations.tagged(a,c):(typeof characterTagged==='function'?characterTagged(a,c):ids.includes(cid)))||scope==='family'&&ids.some(id=>people.get(id)?.group===group))&&(!category||a.type===category||(a.reference_links||[]).some(x=>x.type===category))&&(!status||(loc?(status==='Selected for this slot'?c.selections?.[loc.slot]?.id===a.id:status==='Unselected for this slot'?c.selections?.[loc.slot]?.id!==a.id:statusOf(a)===status):(status==='Obsolete'?effectiveStatus(a)==='Obsolete':status==='Approved reference'?effectiveStatus(a)!=='Obsolete'&&ids.some(id=>isApprovedReference(a,id)):effectiveStatus(a)!=='Obsolete'&&!ids.some(id=>isApprovedReference(a,id)))))&&(!q||[a.id,a.title,...(a.tags||[]),...ids.map(id=>people.get(id)?.name||id)].join(' ').toLowerCase().includes(q));});
 $('referenceFilterSummary').textContent=[$('referenceScope').selectedOptions[0].textContent,scope==='family'?$('referenceFamily').selectedOptions[0].textContent:'',category||'All categories',status||'All statuses',q?'Search: '+$('referenceQuery').value.trim():'',`${list.length} image${list.length===1?'':'s'}`].filter(Boolean).join(' · ');
 $('referenceGrid').innerHTML=list.slice(0,limit).map(a=>`<article class="reference-choice"><label><input type="checkbox" data-reference-choice="${esc(a.id)}" ${chosen.has(a.id)?'checked':''}><img loading="lazy" src="${esc(a.thumbnail)}" alt="${esc(a.title)}"><strong>${esc(a.id)}</strong><span>${esc(a.title)}</span></label><p>${loc?DESKLocations.badge(a,c):referenceBadge(a,a.character_ids.includes(cid)?cid:a.character_ids[0])}</p><p class="small">${esc(a.type)}<br>${esc((a.tags||[]).join(' · '))}</p><a href="${esc(a.asset)}" target="_blank" rel="noopener">View full image</a></article>`).join('')||'<p>No images match these filters.</p>';
 $('moreReferences').hidden=limit>=list.length;$('moreReferences').textContent=`Show more (${Math.min(limit,list.length)} of ${list.length})`;updateCount();
 }
 for(const id of ['referenceScope','referenceFamily','referenceType','referenceStatus'])$(id).onchange=()=>{limit=60;rows();};$('referenceQuery').oninput=()=>{limit=60;rows();};$('moreReferences').onclick=()=>{limit+=60;rows();};
 $('referenceGrid').onchange=e=>{const id=e.target.dataset.referenceChoice;if(id){e.target.checked?chosen.add(id):chosen.delete(id);updateCount();}};
 function lock(v){busy=v;for(const id of ['addChosenReferences','uploadReferences','referenceUpload','referenceTags'])$(id).disabled=v;}
 $('addChosenReferences').onclick=async()=>{if(busy||!chosen.size)return;lock(true);try{const n=chosen.size;await post(route,payload({asset_ids:[...chosen],tags:tagList($('referenceTags').value)}));chosen.clear();repaint();rows();$('referenceMessage').textContent=`Added ${n} reference${n===1?'':'s'}. Selections and ratings preserved.`;}catch(e){$('referenceMessage').textContent=e.message;}finally{lock(false);}};
 $('uploadReferences').onclick=async()=>{if(busy)return;const files=[...$('referenceUpload').files];if(!files.length){$('referenceMessage').textContent='Choose images to upload first.';return;}lock(true);let done=0;try{for(const file of files){if(file.size>20*1024*1024)throw Error(file.name+' exceeds 20 MB.');$('referenceMessage').textContent=`Uploading ${done+1} of ${files.length}: ${file.name}`;const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Could not read '+file.name));reader.readAsDataURL(file);});await post(route,payload({tags:tagList($('referenceTags').value),upload:{name:file.name,data}}));done++;}repaint();rows();$('referenceUpload').value='';$('referenceMessage').textContent=`Saved ${done} image${done===1?'':'s'} as unapproved references. Identical files reuse their existing image ID.`;}catch(e){repaint();rows();$('referenceMessage').textContent=`${done} saved. ${e.message} Saved files are preserved; retrying does not duplicate identical images.`;}finally{lock(false);}};
 rows();
}
function mountUpload(host,{characterId,type,lookId=null,onSaved}){
 const c=people.get(characterId);if(!c||!types.includes(type))return;
 host.innerHTML=`<section class="reference-chooser-upload"><strong>Upload new references</strong><p class="small">Automatically tagged: ${esc(c.name)} · ${esc(type)}${lookId?' · '+esc(lookDisplayName(c.looks.find(l=>l.id===lookId))):''}. New images remain unapproved until reviewed.</p><div class="reference-chooser-upload-controls"><label>Choose images<input data-chooser-upload="files" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><button type="button" data-chooser-upload="submit" disabled>Upload images</button></div><p class="small">PNG, JPEG or WebP · up to 20 MB each.</p><p data-chooser-upload="status" role="status" aria-live="polite"></p></section>`;
 const field=host.querySelector('[data-chooser-upload="files"]'),button=host.querySelector('[data-chooser-upload="submit"]'),status=host.querySelector('[data-chooser-upload="status"]');let busy=false;
 field.onchange=()=>{button.disabled=busy||!field.files.length;status.textContent='';};
 button.onclick=async()=>{
  if(busy||!field.files.length)return;
  const files=[...field.files];busy=true;button.disabled=true;field.disabled=true;let done=0,error='';
  try{
   for(const file of files){
    if(file.size>20*1024*1024)throw Error(file.name+' exceeds 20 MB.');
    if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw Error(file.name+': choose a PNG, JPEG or WebP image.');
    status.textContent=`Uploading ${done+1} of ${files.length}: ${file.name}`;
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('Could not read '+file.name));reader.readAsDataURL(file);});
    await post('api/references',{character_id:characterId,type,look_id:lookId,tags:[c.name,type],upload:{name:file.name,data}});done++;
   }
  }catch(e){error=e.message;}
  finally{busy=false;field.disabled=false;button.disabled=!field.files.length;}
  const message=done?`Added ${done} image${done===1?'':'s'} to ${c.name} · ${type}. New uploads are unapproved; identical files keep their existing review status. Your selected reference is unchanged.`:'';
  const result=[message,error?`${error} ${done?'Saved images are preserved. ':''}You can retry; identical files are not duplicated.`:''].filter(Boolean).join(' ');
  status.textContent=result;
  if(done&&host.isConnected)onSaved?.(result);
 };
}
window.DESKReferenceLibrary={post,picker,mountUpload};
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.addReference)picker(b.dataset.addCharacter||current,b.dataset.addReference,b.dataset.addLook||null);if(b.dataset.editTags)editTags(b.dataset.editTags);});
})();
