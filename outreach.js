/* Durable outreach belongs to the current library; no email is sent by this UI. */
(()=>{'use strict';
const $=id=>document.getElementById(id),context=window.DESK_CONTEXT;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const link=(url,label,cls='')=>/^https?:\/\//i.test(url||'')?`<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:'';
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const pretty=value=>value?new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'—';
let records=[],stages=[],priorities=[],kinds=[],view='all',sortKey='name',direction=1,base=null,dirty=false,activityDirty=false,inflight=null,conflicted=false,conflictDraft=null,activeTab='overview';
const retries=new Map(),inlineDrafts=new Map();
let inlineTimer=null,inlineSaving=null;
$('libraryName').textContent=context.name;document.title=`Theater Outreach · ${context.name} · Reference Desk`;

function notice(text,error=false){$('saveState').textContent=text;$('saveState').dataset.error=String(error);}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,3000);}
const nonOperating=r=>/^(closed|permanently closed|ceased operations|dissolved|non-operating|inactive)(?:$|[; .:-])/i.test((r.organization_status||'').trim());
const needsResearch=r=>!nonOperating(r)&&r.stage!=='Do not contact'&&(r.stage==='Research needed'||!r.contact||!r.email||/reconfirm|not verified|confirmation|unverified/i.test(r.organization_status+' '+r.contact_route));
const waiting=r=>!nonOperating(r)&&(r.stage==='Contacted'||r.stage==='Follow-up');
const due=r=>!nonOperating(r)&&r.follow_up&&r.follow_up<=today()&&!['Do not contact','Not a fit'].includes(r.stage);
function options(values,selected){return values.map(v=>`<option${v===selected?' selected':''}>${esc(v)}</option>`).join('');}
function refreshOptions(){
 for(const [id,field,label] of [['countyFilter','county','All counties'],['typeFilter','category','All types']]){
  const previous=$(id).value;$(id).innerHTML=`<option value="">${label}</option>`+options([...new Set(records.map(r=>r[field]).filter(Boolean))].sort(),previous);
 }
}
async function load(){
 const response=await fetch('api/outreach',{cache:'no-store'});const data=await response.json();
 if(!response.ok)throw Error(data.error||'Could not load outreach.');
 records=data.records;stages=data.stages;priorities=data.priorities;kinds=data.activity_kinds;
 const stage=$('stageFilter').value;$('stageFilter').innerHTML='<option value="">All stages</option>'+options(stages,stage);
 refreshOptions();render();$('add').disabled=false;$('addContact').disabled=false;$('error').hidden=true;notice('Saved on this Mac');
 const dates=[...new Set(records.map(r=>r.checked_date).filter(Boolean))].sort();
 $('scopeNote').textContent=dates.length?`Research checked ${pretty(dates[0])}${dates.length>1?' – '+pretty(dates.at(-1)):''} · Sources inside each record`:'Add theaters to start tracking outreach for this library.';
}
function matches(r){
 if(view==='followup'&&!due(r)||view==='waiting'&&!waiting(r)||view==='research'&&!needsResearch(r))return false;
 if($('stageFilter').value&&r.stage!==$('stageFilter').value||$('countyFilter').value&&r.county!==$('countyFilter').value||$('typeFilter').value&&r.category!==$('typeFilter').value)return false;
 const query=$('search').value.trim().toLowerCase();
 return !query||[r.name,r.city,r.contact,r.email,r.title,r.notes,r.research_notes,r.next_action,r.owner,...(r.contacts||[]).flatMap(c=>[c.name,c.title,c.email,c.phone,c.notes]),...r.activities.map(a=>a.text)].join(' ').toLowerCase().includes(query);
}
const inlineFields={notes:{label:'Notes',placeholder:'Add outreach notes…',limit:20000},next_action:{label:'Next step',placeholder:'Add a next step…',limit:2000},follow_up:{label:'Follow-up date',type:'date'}};
function inlineCell(r,field='notes'){
 const key=`${r.id}:${field}`,draft=inlineDrafts.get(key),config=inlineFields[field],value=draft?draft.value:r[field];
 const control=config.type==='date'?`<input type="date" class="inline-date" data-inline="${key}" data-inline-field="${field}" aria-label="${config.label} for ${esc(r.name)}" value="${esc(value)}" max="9999-12-31">`:`<textarea class="inline-notes" data-inline="${key}" data-inline-field="${field}" aria-label="${config.label} for ${esc(r.name)}" rows="3" maxlength="${config.limit}" placeholder="${config.placeholder}">${esc(value)}</textarea>`;
 return `<td class="${field==='notes'?'notes-cell':field==='next_action'?'next-step-cell':'follow-up-cell'}">${control}<div class="note-feedback" data-inline-feedback="${key}" role="status">${inlineFeedback(draft)}</div>${field==='follow_up'?`<span class="subtext due-indicator"${due(r)?'':' hidden'}>Follow-up due</span>`:''}${field==='next_action'&&r.owner?`<span class="subtext">Owner · ${esc(r.owner)}</span>`:''}</td>`;
}
function inlineFeedback(draft){
 if(!draft)return 'Saved';
 if(draft.current)return `Changed in another window. Your draft is kept.<details><summary>View saved value</summary><p>${esc(draft.current[draft.field]||'(empty)')}</p></details><button type="button" data-inline-action="keep">Save my value</button><button type="button" data-inline-action="saved">Use saved value</button>`;
 if(draft.invalid)return 'Enter a complete, valid date, or clear the field.';
 if(draft.error)return `${esc(draft.error)} <button type="button" data-inline-action="retry">Retry save</button>`;
 return draft.saving?'Saving…':'Unsaved · saves automatically';
}
function updateInlineFeedback(){
 document.querySelectorAll('[data-inline-feedback]').forEach(el=>{const draft=inlineDrafts.get(el.dataset.inlineFeedback);el.innerHTML=inlineFeedback(draft);el.dataset.error=String(!!(draft?.error||draft?.current||draft?.invalid));});
 if(inlineDrafts.size){const error=[...inlineDrafts.values()].some(d=>d.error||d.current||d.invalid);notice(error?'Some edits need attention':'Saving edits…',error);}
 else if(!inflight)notice('Saved on this Mac');
 document.querySelectorAll('.due-indicator').forEach(el=>{const r=records.find(r=>r.id===el.closest('tr').dataset.id);el.hidden=!due(r);});
}
function scheduleInline(){clearTimeout(inlineTimer);inlineTimer=setTimeout(flushInline,700);}
async function flushInline(){
 clearTimeout(inlineTimer);
 if(inlineSaving){await inlineSaving;return inlineDrafts.size===0;}
 inlineSaving=(async()=>{
  if(inflight){try{await inflight;}catch{}}
  for(const [key,draft] of inlineDrafts){
   if(draft.error||draft.current||draft.invalid)continue;
   while(inlineDrafts.get(key)===draft&&!draft.error&&!draft.current&&!draft.invalid){
    const value=draft.value;draft.saving=true;updateInlineFeedback();
    try{
     const saved=await send({action:'update',id:draft.id,base_revision:draft.revision,fields:{[draft.field]:value}},false);
     if(draft.value===value&&!draft.invalid)inlineDrafts.delete(key);
     else{draft.original=value;draft.revision=saved.revision;}
     renderMetrics();
    }catch(error){
     if(error.current&&error.current[draft.field]===draft.original){draft.revision=error.current.revision;}
     else{draft.error=error.current?'':error.message;draft.current=error.current;}
    }finally{draft.saving=false;updateInlineFeedback();}
   }
  }
 })();
 try{await inlineSaving;}finally{inlineSaving=null;}
 return inlineDrafts.size===0;
}
function editInline(event){
 const control=event.target.closest('[data-inline]');if(!control)return;
 const key=control.dataset.inline,field=control.dataset.inlineField,id=control.closest('tr').dataset.id,r=records.find(r=>r.id===id);
 if(!inlineDrafts.has(key))inlineDrafts.set(key,{id,field,value:control.value,original:r[field],revision:r.revision});
 else inlineDrafts.get(key).value=control.value;
 inlineDrafts.get(key).invalid=!control.validity.valid;
 updateInlineFeedback();scheduleInline();
}
$('rows').addEventListener('input',editInline);
$('rows').addEventListener('change',event=>{if(event.target.matches('.inline-date'))editInline(event);});
$('rows').addEventListener('focusout',event=>{if(event.target.matches('[data-inline]'))scheduleInline();});
$('rows').addEventListener('click',event=>{
 const button=event.target.closest('[data-inline-action]');if(!button)return;
 const key=button.closest('[data-inline-feedback]').dataset.inlineFeedback,draft=inlineDrafts.get(key);if(!draft)return;
 if(button.dataset.inlineAction==='saved'){
  records[records.findIndex(r=>r.id===draft.id)]=draft.current;inlineDrafts.delete(key);render();updateInlineFeedback();return;
 }
 if(draft.current){draft.revision=draft.current.revision;draft.original=draft.current[draft.field];}
 draft.error=null;draft.current=null;flushInline();
});
function renderMetrics(){
 const closed=records.filter(nonOperating).length;
 const metrics=[['all','Theater directory',records.length-closed,`${closed} non-operating below · ${records.filter(r=>!nonOperating(r)&&r.email).length} primary email contacts`],['waiting','Awaiting reply',records.filter(waiting).length,'Contacted or follow-up stage'],['followup','Follow-ups due',records.filter(due).length,'Scheduled for today or earlier'],['research','Needs verification',records.filter(needsResearch).length,'Leadership or contact details to confirm']];
 $('metrics').innerHTML=metrics.map(([key,label,count,note])=>`<button class="metric" data-view="${key}" aria-label="${esc(label)}: ${count}"><span class="metric-top">${label}<span aria-hidden="true">↗</span></span><strong>${count}</strong><small>${esc(note)}</small></button>`).join('');
}
function render(){
 const focused=document.activeElement?.matches('[data-inline]')?{id:document.activeElement.dataset.inline,start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd}:null;
 renderMetrics();
 const matching=records.filter(matches).sort((a,b)=>{
  let av=a[sortKey]||'',bv=b[sortKey]||'';
  if(sortKey==='priority'){av=priorities.indexOf(av);bv=priorities.indexOf(bv);return (av-bv)*direction||a.name.localeCompare(b.name);}
  if(sortKey==='follow_up'||sortKey==='last_contact'){if(!av!==!bv)return av?-1:1;}
  return String(av).localeCompare(String(bv))*direction||a.name.localeCompare(b.name);
 });
 const filtered=matching.filter(r=>!nonOperating(r)),archived=matching.filter(nonOperating);
 $('nonOperatingCount').textContent=`${archived.length} of ${records.filter(nonOperating).length}`;
 $('nonOperatingRows').innerHTML=archived.map(r=>`<article class="archive-record"><div><button class="theater-name" data-open="${r.id}">${esc(r.name)}</button><span class="subtext">${esc(r.city)} · ${esc(r.organization_status)}</span><p>${esc(r.research_notes||'Retained for reference.')}</p></div><button data-open="${r.id}">View record</button></article>`).join('')||'<p class="archive-empty">No non-operating theaters match these filters.</p>';
 $('rows').innerHTML=filtered.map(r=>`<tr data-id="${r.id}"><td><button class="theater-name" data-open="${r.id}">${esc(r.name)}</button><span class="subtext">${esc(r.city||'Location not added')} · ${esc(r.category||'Type not added')}</span>${r.organization_status==='Closed'?'<span class="badge closed">Closed organization</span>':needsResearch(r)?'<span class="badge">Verify contact</span>':''}</td><td><span class="contact-name">${esc(r.contact||'Contact to confirm')}</span><span class="subtext">${esc(r.title||r.contact_route||'Add a contact')}</span>${r.email?`<a class="contact-email" href="mailto:${esc(r.email)}">${esc(r.email)}</a>`:`<span class="subtext">${esc(r.phone||'See contact route in record')}</span>`}${(r.contacts||[]).map(c=>`<div class="directory-contact"><span class="contact-name">${esc(c.name)}</span><span class="subtext">${esc(c.title)}</span>${c.email?`<a class="contact-email" href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:c.phone?`<span class="subtext">${esc(c.phone)}</span>`:''}</div>`).join('')}<button class="add-contact-inline" data-add-contact="${r.id}" aria-label="Add contact for ${esc(r.name)}">＋ Add contact</button></td><td><select class="inline-stage" data-field="stage" data-stage="${esc(r.stage)}" aria-label="Outreach stage for ${esc(r.name)}">${options(stages,r.stage)}</select></td>${inlineCell(r)}<td><select class="inline-priority" data-field="priority" data-priority="${r.priority}" aria-label="Priority for ${esc(r.name)}">${options(priorities,r.priority)}</select></td>${inlineCell(r,'next_action')}${inlineCell(r,'follow_up')}<td><span class="date-label muted">${pretty(r.last_contact)}</span></td></tr>`).join('');
 if(focused){const control=$('rows').querySelector(`[data-inline="${focused.id}"]`);if(control){control.focus({preventScroll:true});if(control.tagName==='TEXTAREA')control.setSelectionRange(focused.start,focused.end);}}
 updateInlineFeedback();
 $('resultCount').textContent=`${filtered.length} of ${records.filter(r=>!nonOperating(r)).length} theaters · non-operating records below`;$('empty').hidden=filtered.length>0;
 document.querySelectorAll('.views [data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view)));
 document.querySelectorAll('[data-sort]').forEach(b=>{b.parentElement.removeAttribute('aria-sort');b.querySelector('span').textContent='↕';if(b.dataset.sort===sortKey){b.parentElement.setAttribute('aria-sort',direction===1?'ascending':'descending');b.querySelector('span').textContent=direction===1?'↑':'↓';}});
}
function reset(){view='all';for(const id of ['search','stageFilter','countyFilter','typeFilter'])$(id).value='';render();}
document.addEventListener('click',event=>{
 const viewButton=event.target.closest('[data-view]');if(viewButton){view=viewButton.dataset.view;render();}
 const sort=event.target.closest('[data-sort]');if(sort){direction=sortKey===sort.dataset.sort?-direction:1;sortKey=sort.dataset.sort;render();}
 const addContact=event.target.closest('[data-add-contact]');if(addContact)openContactRecord(addContact.dataset.addContact);
 const open=event.target.closest('[data-open]');if(open)flushInline().then(ok=>{if(ok)openRecord(records.find(r=>r.id===open.dataset.open));else toast('Save or resolve your inline edits first.');});
});
for(const id of ['search','stageFilter','countyFilter','typeFilter'])$(id).addEventListener(id==='search'?'input':'change',render);
$('clear').onclick=reset;$('emptyReset').onclick=reset;
$('refresh').onclick=async()=>{if(await flushInline())load().catch(showError);else toast('Resolve unsaved edits before refreshing.');};
function showError(error){$('error').textContent=error.message;$('error').hidden=false;notice('Could not save or refresh',true);}
async function send(payload,renderTable=true){
 if(inflight)throw Error('A change is still saving. Please try again in a moment.');
 const key=JSON.stringify(payload);if(!retries.has(key))retries.set(key,{...payload,request_id:crypto.randomUUID()});
 notice('Saving…');
 document.querySelectorAll('.inline-stage,.inline-priority').forEach(e=>e.disabled=true);
 const task=(async()=>{
  const config=await fetch('api/outreach',{cache:'no-store'});const configData=await config.json();if(!config.ok)throw Error(configData.error||'Outreach service unavailable.');
  const response=await fetch('api/outreach',{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':configData.csrf_token},body:JSON.stringify(retries.get(key))});
  const data=await response.json();
  if(!response.ok){const error=Error(data.error||'Save failed. Your draft is still here.');error.current=response.status===409?data.record:null;throw error;}
  retries.delete(key);const index=records.findIndex(r=>r.id===data.record.id);if(index<0)records.push(data.record);else records[index]=data.record;
  refreshOptions();if(renderTable)render();$('error').hidden=true;notice('Saved on this Mac');return data.record;
 })();
 inflight=task;
 try{return await task;}catch(error){notice('Changes not saved',true);throw error;}finally{inflight=null;document.querySelectorAll('.inline-stage,.inline-priority').forEach(e=>e.disabled=false);}
}
$('rows').onchange=async event=>{
 const control=event.target.closest('[data-field]');if(!control)return;
 const r=records.find(r=>r.id===control.closest('tr').dataset.id),value=control.value;
 try{await send({action:'update',id:r.id,base_revision:r.revision,fields:{[control.dataset.field]:value}});}
 catch(error){if(error.current){records[records.findIndex(x=>x.id===r.id)]=error.current;render();error.message='This theater changed in another window. Its saved values are shown; choose your stage or priority again.';}else control.value=r[control.dataset.field];showError(error);}
};
const labels={name:'Theater / organization',contact:'Contact name',title:'Title / role',email:'Email',phone:'Phone',city:'City / service area',county:'County',category:'Organization type',scope:'Geographic scope',stage:'Outreach stage',priority:'Priority',owner:'Owner',last_contact:'Last contact',follow_up:'Next follow-up',next_action:'Next action',notes:'Working notes',organization_status:'Organization status',contact_route:'Contact route',website:'Website',thread_url:'Outreach thread URL',contact_source:'Contact source URL',leadership_source:'Leadership source URL',checked_date:'Research checked date',research_notes:'Research notes',exterior_image:'Exterior image URL',interior_image:'Interior image URL',seating_image:'Seating plan image URL',seating_plan_url:'Seating plan or PDF URL',exterior_source:'Exterior photo source / credit URL',interior_source:'Interior photo source / credit URL',seating_source:'Seating plan source URL',capacity:'Seating capacity',stage_dimensions:'Stage dimensions',venue_source:'Venue information source URL',venue_checked_date:'Venue information checked',venue_notes:'Venue notes'};
function input(key,{wide=false,type='text',area=false,select=null,required=false}={}){
 const value=base[key]||'';return `<label class="${wide?'wide':''}">${labels[key]}${area?`<textarea name="${key}" maxlength="20000" rows="4">${esc(value)}</textarea>`:select?`<select name="${key}">${options(select,value)}</select>`:`<input name="${key}" type="${type}" value="${esc(value)}" maxlength="2000"${required?' required':''}>`}</label>`;
}
function switchTab(tab){const panel=document.querySelector(`[data-panel="${tab}"]`);if(panel)panel.open=true;}
function venueImage(field,title,source){
 const url=base[field]||'',valid=/^https?:\/\//i.test(url);
 return `<figure class="venue-image${field==='seating_image'?' seating-image':''}"><div class="venue-image-frame">${valid?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" alt="${esc(title)} — ${esc(base.name)}" loading="lazy" referrerpolicy="no-referrer"></a><p class="image-fallback" hidden>Image unavailable. Open its source below.</p>`:`<p class="image-placeholder">${field==='seating_image'?'Seating plan not yet verified':'No '+title.toLowerCase()+' added'}<span>Add a verified image using the fields below.</span></p>`}</div><figcaption><strong>${esc(title)}</strong>${link(base[source],'Source / credit')}${valid?link(url,'Open image'):''}</figcaption></figure>`;
}
function refreshVenue(){
 $('venueGallery').innerHTML=venueImage('exterior_image','Venue exterior','exterior_source')+venueImage('interior_image','Auditorium / interior','interior_source');
 $('seatingPreview').innerHTML=venueImage('seating_image','Seating plan','seating_source')+(base.seating_plan_url?link(base.seating_plan_url,'Open seating plan / PDF','button'):'<p class="venue-empty-note">A verified seating diagram has not been added. Request the current layout from the venue before planning a configuration.</p>');
 $('venueFacts').innerHTML=`<div><span>Capacity</span><strong>${esc(base.capacity||'To confirm')}</strong></div><div><span>Stage</span><strong>${esc(base.stage_dimensions||'To confirm')}</strong></div>`;
 $('venueEvidence').innerHTML=link(base.venue_source,'Venue information source')+(base.venue_checked_date?`<span>Checked ${pretty(base.venue_checked_date)}</span>`:'');
 document.querySelectorAll('.venue-image img').forEach(img=>img.addEventListener('error',()=>{img.closest('a').hidden=true;img.closest('.venue-image-frame').querySelector('.image-fallback').hidden=false;},{once:true}));
}
function accordion(id,num,title,hint,body,open=false){return `<details class="theater-section" data-panel="${id}"${open?' open':''}><summary><span class="section-number">${num}</span><span><strong>${title}</strong><small>${hint}</small></span><span class="section-toggle" aria-hidden="true"></span></summary><div class="section-content">${body}</div></details>`;}
function readContacts(){return [...document.querySelectorAll('[data-contact-id]')].map(row=>Object.fromEntries([['id',row.dataset.contactId],...[...row.querySelectorAll('[data-contact-field]')].map(input=>[input.dataset.contactField,input.value]) ]));}
function contactEditor(contact,isNew=false){
 const row=document.createElement('fieldset');row.className='contact-card';row.dataset.contactId=contact.id;
 row.innerHTML=`<legend>${isNew?'New contact':esc(contact.name)}</legend><div class="form-grid">${[['name','Contact name','text'],['title','Title / role','text'],['email','Email','email'],['phone','Phone','tel'],['notes','Contact notes','textarea']].map(([key,label,type])=>`<label class="${key==='notes'?'wide':''}">${label}${type==='textarea'?`<textarea data-contact-field="${key}" maxlength="20000" rows="2">${esc(contact[key])}</textarea>`:`<input data-contact-field="${key}" type="${type}" maxlength="2000" value="${esc(contact[key])}"${key==='name'?' required':''}>`}</label>`).join('')}</div>${isNew?'<button type="button" class="quiet" data-cancel-contact>Cancel new contact</button>':''}`;
 row.querySelector('[data-cancel-contact]')?.addEventListener('click',()=>{row.remove();draftState();});
 return row;
}
function renderContacts(){
 $('additionalContacts').replaceChildren(...(base.contacts||[]).map(c=>contactEditor(c)));
}
function addContactEditor(){
 const row=contactEditor({id:crypto.randomUUID(),name:'',title:'',email:'',phone:'',notes:''},true);
 $('additionalContacts').append(row);switchTab('contacts');draftState();row.querySelector('input').focus();
}
async function openContactRecord(id){if(await flushInline()){openRecord(records.find(r=>r.id===id));document.querySelector('[data-panel="venue"]').open=false;addContactEditor();}else toast('Save or resolve your inline edits first.');}
function changedFields(){
 if(!$('contactForm'))return {};
 const fields=Object.fromEntries([...new FormData($('contactForm')).entries()].filter(([key,value])=>value!==(base[key]||'')));
 const contacts=readContacts();if(JSON.stringify(contacts)!==JSON.stringify(base.contacts||[]))fields.contacts=contacts;
 return fields;
}
function draftState(){dirty=Object.keys(changedFields()).length>0;$('draftState').textContent=dirty?'Unsaved changes':'All changes saved';$('draftState').className=dirty?'draft-status':'';}
function lockForm(id,locked){for(const field of $(id).elements)field.disabled=locked;}
function openRecord(record){
 base=record?structuredClone(record):{id:null,revision:0,name:'',stage:'Not started',priority:'Normal',activities:[]};dirty=false;activityDirty=false;conflicted=false;conflictDraft=null;activeTab='overview';
 const photoFields=`<details class="resource-editor"><summary>Edit image links & credits</summary><p>Use direct image URLs for previews and source-page URLs for attribution.</p><div class="form-grid">${input('exterior_image',{type:'url',wide:true})}${input('exterior_source',{type:'url',wide:true})}${input('interior_image',{type:'url',wide:true})}${input('interior_source',{type:'url',wide:true})}</div></details>`;
 const venue=accordion('venue','01','Venue images','Exterior & auditorium',`<div id="venueGallery" class="venue-gallery"></div>${photoFields}`,!!base.id);
 const seating=accordion('seating','02','Seating & stage','Plans, capacity & technical information',`<div id="venueFacts" class="venue-facts"></div><div id="seatingPreview"></div><div id="venueEvidence" class="venue-evidence"></div><details class="resource-editor"><summary>Edit seating & venue information</summary><div class="form-grid">${input('capacity')}${input('stage_dimensions')}${input('seating_image',{type:'url',wide:true})}${input('seating_plan_url',{type:'url',wide:true})}${input('seating_source',{type:'url',wide:true})}${input('venue_source',{type:'url',wide:true})}${input('venue_checked_date',{type:'date'})}</div></details><div class="form-grid venue-notes">${input('venue_notes',{area:true,wide:true})}</div>`);
 const contact=accordion('contacts','03','Theater & contacts','People, website & location',`<div class="form-grid">${input('name',{wide:true,required:true})}<h3 class="wide contact-group-title">Primary contact</h3>${input('contact')}${input('title')}${input('email',{type:'email'})}${input('phone',{type:'tel'})}${input('website',{type:'url',wide:true})}${input('contact_route',{wide:true})}${input('city')}${input('county')}${input('category')}${input('scope')}${input('organization_status')}</div><section class="additional-contacts" aria-label="Additional contacts"><h3>Additional contacts</h3><p>Keep producers, booking staff, and other people alongside your primary contact.</p><div id="additionalContacts"></div><button type="button" id="addRecordContact">＋ Add contact</button></section>`,!base.id);
 const plan=accordion('overview','04','Outreach plan','Next steps, dates & working notes',`<div class="form-grid">${input('stage',{select:stages})}${input('priority',{select:priorities})}${input('follow_up',{type:'date'})}${input('last_contact',{type:'date'})}${input('owner')}${input('thread_url',{type:'url'})}${input('next_action',{wide:true,area:true})}${input('notes',{area:true,wide:true})}</div>`);
 const research=accordion('research','05','Research & sources','Original evidence & verification',`<div class="research-banner">Research evidence is separate from your outreach notes. Email replies are not synced automatically.</div><dl class="research-dl"><dt>Prior outreach</dt><dd>${esc(base.prior_outreach||'No prior outreach recorded')}</dd><dt>Original priority</dt><dd>${esc(base.research_priority||'Not assigned')}</dd></dl><div class="source-links">${link(base.contact_source,'View contact source')}${link(base.leadership_source,'View leadership source')}</div><div class="form-grid">${input('checked_date',{type:'date'})}${input('contact_source',{type:'url',wide:true})}${input('leadership_source',{type:'url',wide:true})}${input('research_notes',{wide:true,area:true})}</div>`);
 const activity=accordion('activity','06','Activity <span id="activityCount">'+base.activities.length+'</span>','Emails, calls, meetings & replies',`<form id="activityForm" class="activity-form"><h3>Log a conversation or update</h3><div class="form-grid"><label>Type<select name="kind">${options(kinds,'Note')}</select></label><label>Date<input name="date" type="date" value="${today()}" required></label><label class="wide">What happened?<textarea name="text" required maxlength="20000" placeholder="What you discussed, their response, and what comes next…"></textarea></label><label class="wide">Related link (optional)<input name="url" type="url" placeholder="https://…"></label><label class="wide check"><input type="checkbox" name="update_last_contact"> Also update last contact date</label></div><button type="submit" id="logActivity"${base.id?'':' disabled'}>＋ Log activity</button><p class="subtext">${base.id?'Records an interaction that already happened.':'Save this theater before logging activity.'}</p></form><div id="activityList"></div>`);
 $('detail').innerHTML=`<div class="detail-head"><div class="detail-heading"><div><p class="eyebrow">${esc(context.name)} / OUTREACH</p><h2 id="recordTitle">${esc(base.name||'Add a theater')}</h2><p class="subtitle">${esc(base.city||'Build your next production relationship.')}</p></div><button type="button" class="close-detail" id="closeDetail" aria-label="Close theater details">×</button></div><div class="detail-links">${base.email?`<a class="button" href="mailto:${esc(base.email)}">Email contact ↗</a>`:''}${link(base.thread_url,'Open email thread','button')}${link(base.website,'Website','button')}</div></div>
 <div class="section-tools"><span>THEATER REFERENCE</span><button type="button" id="expandSections">Expand all</button><button type="button" id="collapseSections">Collapse all</button></div>
 <div class="detail-body sectional-body"><div id="detailError" role="alert" class="detail-error" hidden></div><form id="contactForm" novalidate>${venue}${seating}${contact}${plan}${research}</form>${activity}</div>
 <footer class="detail-footer"><p id="draftState">${base.id?'All changes saved':'New theater'}</p><button type="submit" form="contactForm" class="primary" id="saveDetails">${base.id?'Save changes':'Add theater'}</button></footer>`;
 $('contactForm').oninput=draftState;$('contactForm').onchange=draftState;
 $('contactForm').onsubmit=event=>{event.preventDefault();saveDetails();};
 $('activityForm').oninput=()=>{activityDirty=!!$('activityForm').elements.text.value.trim();};
 $('activityForm').onsubmit=event=>{event.preventDefault();logActivity();};
 $('closeDetail').onclick=closeDetails;
 $('expandSections').onclick=()=>document.querySelectorAll('.theater-section').forEach(s=>s.open=true);
 $('collapseSections').onclick=()=>document.querySelectorAll('.theater-section').forEach(s=>s.open=false);
 renderContacts();$('addRecordContact').onclick=addContactEditor;renderActivity();refreshVenue();$('recordDialog').showModal();$('closeDetail').focus();
}
function renderActivity(){
 $('activityCount').textContent=base.activities.length;
 $('activityList').innerHTML=[...base.activities].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at)).map(a=>`<article class="activity-entry"><div class="event-meta"><strong>${esc(a.kind)}</strong><time>${pretty(a.date)}</time></div><p>${esc(a.text)}</p>${link(a.url,'Open related link')}</article>`).join('')||'<p class="muted">No activity logged yet.</p>';
}
function closeDetails(){if(inflight)return;if((dirty||activityDirty)&&!confirm('Discard the unsaved changes in this theater?'))return;$('recordDialog').close();dirty=activityDirty=conflicted=false;base=null;}
$('recordDialog').addEventListener('cancel',event=>{event.preventDefault();closeDetails();});
function detailError(error,fields){
 $('detailError').hidden=false;$('detailError').textContent=error.message;
 if(error.current){
  conflicted=true;conflictDraft={fields,current:error.current};
  const comparison=document.createElement('details');comparison.className='saved-comparison';const summary=document.createElement('summary');summary.textContent='Compare your edits with the saved version';comparison.append(summary);
  for(const [key,value] of Object.entries(fields||{})){const p=document.createElement('p');p.textContent=`${labels[key]||key} — Your draft: ${Array.isArray(value)?JSON.stringify(value):value||'(empty)'} · Saved: ${Array.isArray(error.current[key])?JSON.stringify(error.current[key]):error.current[key]||'(empty)'}`;comparison.append(p);}
  $('detailError').append(comparison);
  const reload=document.createElement('button');reload.type='button';reload.textContent='Load saved record';reload.onclick=()=>{if(confirm('Discard this draft and load the saved record?'))openRecord(error.current);};$('detailError').append(reload);
  if(fields&&Object.keys(fields).length){const keep=document.createElement('button');keep.type='button';keep.textContent='Save my edited fields instead';keep.onclick=()=>saveDetails(conflictDraft);$('detailError').append(keep);}
 }
}
async function saveDetails(overwrite=null){
 if(!base||inflight)return false;
 if(!$('contactForm').checkValidity()){const invalid=$('contactForm').querySelector(':invalid');for(let section=invalid?.closest('details');section;section=section.parentElement.closest('details'))section.open=true;$('contactForm').reportValidity();return false;}
 const fields=overwrite?overwrite.fields:changedFields();
 if(!Object.keys(fields).length&&base.id)return true;
 $('saveDetails').disabled=true;lockForm('contactForm',true);
 const request=base.id?{action:'update',id:base.id,base_revision:(overwrite?overwrite.current:base).revision,fields}:{action:'create',fields:{stage:base.stage,priority:base.priority,...fields}};
 try{
  const result=await send(request);base=structuredClone(result);
  for(const [key,value] of Object.entries(base)){const input=$('contactForm').elements.namedItem(key);if(input)input.value=value;}
  renderContacts();dirty=conflicted=false;conflictDraft=null;$('detailError').hidden=true;lockForm('contactForm',false);draftState();$('recordTitle').textContent=base.name;
  $('detail').querySelector('.detail-head .subtitle').textContent=base.city||'Build your next production relationship.';
  $('detail').querySelector('.detail-links').innerHTML=(base.email?`<a class="button" href="mailto:${esc(base.email)}">Email contact ↗</a>`:'')+link(base.thread_url,'Open email thread','button')+link(base.website,'Website','button');
  refreshVenue();$('logActivity').disabled=false;$('saveDetails').textContent='Save changes';toast('Theater saved');return true;
 }catch(error){detailError(error,fields);return false;}finally{$('saveDetails').disabled=false;lockForm('contactForm',false);}
}
async function logActivity(){
 if(!base?.id||inflight||!$('activityForm').reportValidity())return false;
 if(dirty&&!(await saveDetails()))return false;
 const f=$('activityForm'),data=new FormData(f),activity={kind:data.get('kind'),date:data.get('date'),text:data.get('text'),url:data.get('url')};
 lockForm('activityForm',true);
 try{
  const result=await send({action:'log',id:base.id,base_revision:base.revision,activity,update_last_contact:data.has('update_last_contact')});
  base=structuredClone(result);$('contactForm').elements.last_contact.value=base.last_contact;activityDirty=false;conflicted=false;f.reset();f.elements.date.value=today();renderActivity();$('detailError').hidden=true;toast('Activity logged');return true;
 }catch(error){detailError(error,null);return false;}finally{lockForm('activityForm',false);}
}
$('addContact').onclick=async()=>{
 if(!(await flushInline())){toast('Save or resolve your inline edits first.');return;}
 const groups=[[false,'Theaters'],[true,'Non-operating theaters']];
 $('contactTheater').innerHTML='<option value="">Choose a theater…</option>'+groups.map(([closed,label])=>`<optgroup label="${label}">${records.filter(r=>nonOperating(r)===closed).sort((a,b)=>a.name.localeCompare(b.name)).map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
 $('contactPicker').showModal();$('contactTheater').focus();
};
$('cancelContactPicker').onclick=()=>$('contactPicker').close();
$('contactPickerForm').onsubmit=event=>{event.preventDefault();const id=$('contactTheater').value;if(id){$('contactPicker').close();openContactRecord(id);}};
$('add').onclick=async()=>{if(await flushInline())openRecord(null);else toast('Save or resolve your inline edits first.');};
document.querySelectorAll('[data-leave]').forEach(a=>a.onclick=event=>{if(inflight||dirty||activityDirty||inlineDrafts.size){event.preventDefault();flushInline();toast('Wait for edits to save, or resolve unsaved edits before leaving.');}});
window.addEventListener('beforeunload',event=>{if(dirty||activityDirty||inflight||inlineDrafts.size){event.preventDefault();event.returnValue='';}});
window.DESKAutosave={state:()=>({dirty:dirty||activityDirty||inlineDrafts.size>0,inflight:!!inflight||!!inlineSaving,conflicted:conflicted||[...inlineDrafts.values()].some(d=>d.current)}),flush:async()=>{await flushInline();if(inflight){try{await inflight;}catch{}}if(dirty&&!conflicted)await saveDetails();}};
load().catch(showError);
})();
