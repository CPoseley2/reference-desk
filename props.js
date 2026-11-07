/* Named prop groups reuse existing images without changing their approvals. */
(()=>{
'use strict';
const type='Supporting prop / map',opened=new Set();
const category=c=>D.assets.filter(a=>assetInCategory(a,c.id,type));
function render(c,visible){
 const props=c.props||[],ids=new Set(visible.map(a=>a.id)),assigned=new Set(props.flatMap(p=>p.reference_ids||[]));
 const unassigned=visible.filter(a=>!assigned.has(a.id));
 return `<div class="prop-groups"><button type="button" class="add-prop" data-prop-create="${esc(c.id)}"><span aria-hidden="true">＋</span> Add prop</button>${props.length?`<div class="prop-list">${props.map(p=>{
 const images=(p.reference_ids||[]).map(id=>assets.get(id)).filter(Boolean),shown=images.filter(a=>ids.has(a.id));
 return `<details class="prop-card" data-prop-disclosure="${esc(p.id)}" ${opened.has(p.id)?'open':''}><summary><h3>${esc(p.name)}</h3><span>${images.length} reference image${images.length===1?'':'s'}</span></summary><div class="prop-body"><button type="button" data-prop-edit="${esc(p.id)}" data-prop-character="${esc(c.id)}">Edit prop / references</button>${shown.length?`<div class="assetgrid">${shown.map(assetCard).join('')}</div>`:`<p class="small">${images.length?'No references match the current image filters.':'No references yet. Choose Edit prop / references to add images.'}</p>`}</div></details>`;
 }).join('')}</div>`:'<p class="small">Create a named prop, then choose its reference images below. An image can belong to more than one prop.</p>'}<details class="prop-unassigned" open><summary>Unassigned references · ${unassigned.length}</summary>${unassigned.length?`<div class="assetgrid">${unassigned.map(assetCard).join('')}</div>`:'<p class="small">All visible images are assigned to a prop.</p>'}</details></div>`;
}
function edit(cid,pid){
 const c=people.get(cid),prop=c?.props?.find(p=>p.id===pid);if(!c||(pid&&!prop))return;
 const before=prop?structuredClone(prop):null,requestId=crypto.randomUUID(),chosen=new Set(prop?.reference_ids||[]);
 const available=category(c).filter(a=>effectiveStatus(a)!=='Obsolete'||chosen.has(a.id));let busy=false;
 openModal((prop?'Edit prop':'Add prop')+' · '+c.name,`<form id="propForm" class="prop-form"><label>Prop name<input id="propName" required maxlength="140" value="${esc(prop?.name||'')}" placeholder="For example: Wooden skis" autocomplete="off"></label><p>Choose any number of images from this character’s Supporting prop / map section. Images can be shared between props.</p><label>Search reference images<input type="search" id="propSearch" placeholder="Title, tag or image ID"></label><div class="prop-picker-actions"><button type="button" id="propSelectVisible">Select matching images</button><button type="button" id="propClearVisible">Clear matching images</button><span id="propCount" role="status"></span></div><div id="propChoices" class="reference-grid prop-picker"></div><div class="prop-save-actions"><button type="submit" id="propSave">${prop?'Save prop':'Add prop'}</button><button type="button" id="propCancel">Cancel</button></div><p class="small">Grouping images preserves their approval, rankings and original files.</p><p id="propStatus" role="status" aria-live="polite"></p></form>`);
 const host=$('propForm'),q=id=>host.querySelector('#'+id);
 const matches=()=>{const query=q('propSearch').value.trim().toLowerCase();return available.filter(a=>!query||[a.title,a.id,...(a.tags||[])].join(' ').toLowerCase().includes(query));};
 const count=()=>{q('propCount').textContent=`${chosen.size} selected · ${matches().length} matching images`;};
 function draw(){
  q('propChoices').innerHTML=matches().map(a=>`<label class="reference-choice prop-choice"><input type="checkbox" data-prop-image="${esc(a.id)}" ${chosen.has(a.id)?'checked':''}><img src="${esc(a.thumbnail||a.asset)}" alt="" loading="lazy"><strong>${esc(a.title)}</strong><span>${esc(a.id)}</span><small>${effectiveStatus(a)==='Obsolete'?'Set aside · already in this prop':isApprovedReference(a,cid)?'Approved reference':'Needs review'}</small></label>`).join('')||'<p>No matching images. Add references to the Supporting prop / map section first.</p>';
  count();
 }
 q('propSearch').oninput=draw;
 q('propChoices').onchange=e=>{const id=e.target.dataset.propImage;if(!id||busy)return;e.target.checked?chosen.add(id):chosen.delete(id);count();};
 q('propSelectVisible').onclick=()=>{for(const a of matches())chosen.add(a.id);draw();};
 q('propClearVisible').onclick=()=>{for(const a of matches())chosen.delete(a.id);draw();};
 q('propCancel').onclick=()=>$('modal').close();
 host.onsubmit=async e=>{
  e.preventDefault();if(busy||!host.reportValidity())return;
  const payload={character_id:cid,name:q('propName').value,reference_ids:[...chosen],...(prop?{prop_id:prop.id,expected:before}:{request_id:requestId})};
  busy=true;for(const el of host.querySelectorAll('button,input'))el.disabled=true;q('propStatus').textContent='Saving prop…';
  try{
   const result=await DESKReferenceLibrary.post('api/props',payload),saved=result.characters?.find(x=>x.id===cid)?.props?.find(p=>prop?p.id===prop.id:p.creation_request_id===requestId);
   if(saved)opened.add(saved.id);
   categoryOpenGroups.add(JSON.stringify([cid,type]));
   if(host.isConnected){$('modal').close();detail(cid);const card=[...document.querySelectorAll('[data-prop-disclosure]')].find(el=>el.dataset.propDisclosure===saved?.id);card?.scrollIntoView({block:'nearest'});}
   toast('Prop saved. Reference image approvals unchanged.');
  }catch(error){if(host.isConnected){q('propStatus').textContent=error.message;busy=false;for(const el of host.querySelectorAll('button,input'))el.disabled=false;}}
 };
 draw();q('propName').focus();
}
window.DESKProps={render};
document.addEventListener('toggle',e=>{const id=e.target.dataset?.propDisclosure;if(id)e.target.open?opened.add(id):opened.delete(id);},true);
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.propCreate)edit(b.dataset.propCreate);if(b.dataset.propEdit)edit(b.dataset.propCharacter,b.dataset.propEdit);});
})();
