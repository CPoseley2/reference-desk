/* Job monitor with local, reversible archiving. Never cancels or resubmits requests. */
(()=>{
'use strict';
const storageKey='desk-generation-activity-v1', active=new Set(['queued','generating','saving']);
const jobs=new Map(), merged=new Set();let polling=false, rendered='', view='requests';
const archiveKey='desk-generation-activity-archive-v1';
function readArchive(){try{const v=JSON.parse(DESKStorage.getItem(archiveKey)||'[]');return new Set(Array.isArray(v)?v.filter(id=>/^[a-f0-9]{32}$/.test(id)):[]);}catch{return new Set();}}
let archived=readArchive();
const archiveIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/></svg>';
const restoreIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13v7h16v-7M12 16V4m-5 5 5-5 5 5"/></svg>';
function setArchived(id,value){
 const next=readArchive();if(value)next.add(id);else next.delete(id);
 try{DESKStorage.setItem(archiveKey,JSON.stringify([...next]));}
 catch{notice.textContent='Could not save this change. Try again with browser storage available.';return;}
 archived=next;notice.textContent='';render();
}

const panel=document.createElement('details');panel.className='generation-activity';panel.hidden=true;panel.open=false;
panel.innerHTML='<summary title="Drag to move; click to open. Alt + arrow keys move; Home returns it to the header."><span class="generation-activity-grip" aria-hidden="true">⠿</span><span data-activity-heading>Image requests</span><button type="button" class="generation-activity-reset" aria-label="Return image requests to header" title="Return to header">↗</button></summary><div class="generation-activity-body"><nav class="generation-activity-tabs" aria-label="Image request views"><button type="button" data-activity-view="requests" aria-pressed="true">Requests</button><button type="button" data-activity-view="archive" aria-pressed="false">Archive</button></nav><p data-activity-notice role="status" class="small"></p><details class="generation-activity-queue" hidden><summary><span data-activity-queue-count></span><span class="small">Next 5</span></summary><div data-activity-queue-list></div></details><div data-activity-list></div><details class="generation-activity-older" hidden><summary>Older requests</summary><div data-activity-older-list></div></details></div>';
const header=document.querySelector('body>header'),dock=document.createElement('div');
dock.className='generation-activity-dock';dock.hidden=true;
if(header)header.insertBefore(dock,header.querySelector('.topactions'));
document.body.append(panel);
const list=panel.querySelector('[data-activity-list]'), heading=panel.querySelector('[data-activity-heading]');
const older=panel.querySelector('.generation-activity-older'), olderHeading=older.querySelector('summary'), olderList=panel.querySelector('[data-activity-older-list]');
const queue=panel.querySelector('.generation-activity-queue'), queueCount=panel.querySelector('[data-activity-queue-count]'), queueList=panel.querySelector('[data-activity-queue-list]');
const notice=panel.querySelector('[data-activity-notice]');
const viewButtons=panel.querySelectorAll('[data-activity-view]');
for(const button of viewButtons)button.addEventListener('click',()=>{view=button.dataset.activityView;render();});
// Position is independent of the request history and never changes a job.
const positionKey='desk-generation-activity-position-v2', summary=panel.querySelector('summary');
let position=null, drag=null, suppressClick=false;
try{const saved=JSON.parse(DESKStorage.getItem(positionKey));if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))position=saved;}catch{}
function dockPanel(){
 panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';
 if(header){dock.append(panel);panel.classList.add('is-docked');dock.hidden=panel.hidden;}
}
if(position)document.body.append(panel);else dockPanel();
function place(x,y){
 if(panel.classList.contains('is-docked')){panel.classList.remove('is-docked');document.body.append(panel);dock.hidden=true;}
 const box=panel.getBoundingClientRect(), margin=8;
 const next={x:Math.max(margin,Math.min(x,window.innerWidth-box.width-margin)),y:Math.max(margin,Math.min(y,window.innerHeight-box.height-margin))};
 panel.style.left=next.x+'px';panel.style.top=next.y+'px';panel.style.right='auto';panel.style.bottom='auto';
 return next;
}
function keepVisible(){
 if(header)document.documentElement.style.setProperty('--desk-header-height',header.getBoundingClientRect().height+'px');
 if(position&&!panel.hidden)place(position.x,position.y);
 else if(header){dock.hidden=panel.hidden;panel.style.setProperty('--activity-dropdown-space',Math.max(120,window.innerHeight-summary.getBoundingClientRect().bottom-20)+'px');}
}
function savePosition(){try{DESKStorage.setItem(positionKey,JSON.stringify(position));}catch{}}
function resetPosition(){
 position=null;dockPanel();keepVisible();
 try{DESKStorage.removeItem(positionKey);}catch{}
}
summary.querySelector('button').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();resetPosition();});
summary.addEventListener('pointerdown',event=>{
 if(!event.isPrimary||event.button!==0||event.target.closest('button'))return;
 // A fresh pointer gesture must not inherit suppression from a cancelled drag.
 suppressClick=false;
 const box=panel.getBoundingClientRect();
 drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:box.left,top:box.top,moved:false};
 summary.setPointerCapture(event.pointerId);
});
summary.addEventListener('pointermove',event=>{
 if(!drag||drag.id!==event.pointerId)return;
 const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
 if(!drag.moved&&Math.hypot(dx,dy)<5)return;
 drag.moved=true;suppressClick=true;panel.classList.add('is-dragging');
 position=place(drag.left+dx,drag.top+dy);
});
function endDrag(event){
 if(!drag||drag.id!==event.pointerId)return;
 if(drag.moved)savePosition();
 drag=null;panel.classList.remove('is-dragging');
 if(summary.hasPointerCapture(event.pointerId))summary.releasePointerCapture(event.pointerId);
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])summary.addEventListener(event,endDrag);
summary.addEventListener('click',event=>{
 if(suppressClick&&event.detail!==0){event.preventDefault();event.stopPropagation();suppressClick=false;}
});
summary.addEventListener('keydown',event=>{
 if(event.target!==summary)return;
 if(event.key==='Home'){event.preventDefault();resetPosition();return;}
 const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
 if(!event.altKey||!directions[event.key])return;
 event.preventDefault();const box=panel.getBoundingClientRect(),step=event.shiftKey?40:10,[dx,dy]=directions[event.key];
 position=place(box.left+dx*step,box.top+dy*step);savePosition();
});
window.addEventListener('resize',keepVisible);
panel.addEventListener('toggle',keepVisible);
// Re-clamp when a status label wraps, jobs arrive, or the list opens.
if(window.ResizeObserver){const observer=new ResizeObserver(keepVisible);observer.observe(panel);if(header)observer.observe(header);}
function stored(){try{const v=JSON.parse(DESKStorage.getItem(storageKey)||'[]');return Array.isArray(v)?v.filter(id=>/^[a-f0-9]{32}$/.test(id)):[];}catch{return [];}}
function remember(id){
 if(!/^[a-f0-9]{32}$/.test(id||'')||jobs.has(id))return;
 jobs.set(id,{id,status:'checking',message:'Checking saved request…'});
}
function persist(){try{DESKStorage.setItem(storageKey,JSON.stringify([...new Set([...stored(),...jobs.keys()])]));}catch{}}
function reviewState(job){
 const snapshot=job.assets?.[0];if(job.status!=='completed'||!snapshot)return null;
 const asset=assets.get(snapshot.id)||snapshot;
 // Scope approval to this job's owner and exact image, never the open character.
 if(job.character_id)return referenceStatus(asset,job.character_id,snapshot.sha256);
 const location=D.locations?.find(l=>l.id===job.location_id);
 return location&&window.DESKLocations?window.DESKLocations.status({...asset,sha256:snapshot.sha256},location):effectiveStatus(asset)==='Obsolete'?'Obsolete':'Needs review';
}
const statusCountIcons={
 ready:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 reviewed:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
 archived:'<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>'
};
function statusCount(kind,count){
 const label=count+' '+({ready:'ready to review',reviewed:'reviewed',archived:'archived'}[kind]);
 return '<span class="activity-count activity-count-icon" role="img" aria-label="'+label+'" title="'+label+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+statusCountIcons[kind]+'</svg><b aria-hidden="true">'+count+'</b></span>';
}
// Render only the next five waiting jobs; keep the live job and review history visible.
function activityGroups(values,isArchive){
 const waiting=isArchive?[]:values.filter(j=>j.status==='queued').sort((a,b)=>{
  const position=j=>Number(j.queue_position)>0?Number(j.queue_position):Infinity;
  return position(a)-position(b)||(Number(a.created_at)||0)-(Number(b.created_at)||0)||a.id.localeCompare(b.id);
 });
 const visible=isArchive?values:values.filter(j=>j.status!=='queued').sort((a,b)=>Number(['generating','saving'].includes(b.status))-Number(['generating','saving'].includes(a.status)));
 return {waiting,next:waiting.slice(0,5),visible};
}
function render(){
 const states=new Map([...jobs.values()].map(j=>[j.id,reviewState(j)]));
 const signature=JSON.stringify([view,[...archived],[...jobs.values()].map(j=>[j.id,j.created_at,j.status,j.message,j.api_error,j.queue_position,j.connectionError,j.assets?.[0]?.id,j.assets?.[0]?.title,j.character_id,j.location_id,states.get(j.id)])]);
 if(signature===rendered)return;rendered=signature;
 panel.hidden=!jobs.size;keepVisible();
 const all=[...jobs.values()].reverse().sort((a,b)=>(Number(b.created_at)||0)-(Number(a.created_at)||0));
 const current=all.filter(j=>!archived.has(j.id)), history=all.filter(j=>archived.has(j.id));
 const values=view==='archive'?history:current, running=current.filter(j=>['generating','saving'].includes(j.status)).length,queued=current.filter(j=>j.status==='queued').length;
 const ready=current.filter(j=>states.get(j.id)==='Needs review').length;
 const reviewed=current.filter(j=>states.get(j.id)&&states.get(j.id)!=='Needs review').length;
 heading.innerHTML='<span class="generation-activity-title">Image requests</span><span class="generation-activity-counts">'+(running?'<span class="activity-count is-running"><b>'+running+'</b> running</span>':'')+(queued?'<span class="activity-count"><b>'+queued+'</b> queued</span>':'')+statusCount('ready',ready)+statusCount('reviewed',reviewed)+(history.length?statusCount('archived',history.length):'')+'</span>';
 for(const button of viewButtons){const isArchive=button.dataset.activityView==='archive';button.textContent=(isArchive?'Archive':'Requests')+' · '+(isArchive?history.length:current.length);button.setAttribute('aria-pressed',String(view===button.dataset.activityView));}
 const groups=activityGroups(values,view==='archive');
 list.replaceChildren();olderList.replaceChildren();queueList.replaceChildren();
 queue.hidden=!groups.waiting.length;
 queueCount.textContent='Queued · '+groups.waiting.length;
 queue.querySelector('summary .small').textContent='Next '+Math.min(5,groups.waiting.length);
 older.hidden=groups.visible.length<=10;
 olderHeading.textContent='Older requests · '+Math.max(0,groups.visible.length-10);
 if(!values.length){const empty=document.createElement('p');empty.className='generation-activity-empty';empty.textContent=view==='archive'?'No archived requests.':'No requests here. Archived requests are available in Archive.';list.append(empty);}
 const rows=[...groups.next.map(job=>({job,target:queueList})),...groups.visible.map((job,index)=>({job,target:index<10?list:olderList}))];
 for(const {job,target} of rows){
  const row=document.createElement('article');row.className='generation-activity-job';
  const a=job.assets?.[0], title=document.createElement('strong');
  title.textContent=a?.title||people.get(job.character_id)?.name||D.locations?.find(l=>l.id===job.location_id)?.name||'Image request';const rowHeader=document.createElement('div');rowHeader.className='generation-activity-row-header';
  const archive=document.createElement('button');archive.type='button';archive.className='generation-activity-archive';
  const isArchived=archived.has(job.id),label=(isArchived?'Restore request: ':'Archive request: ')+title.textContent;
  archive.setAttribute('aria-label',label);archive.title=isArchived?'Restore to requests':'Archive request';archive.innerHTML=isArchived?restoreIcon:archiveIcon;
  archive.onclick=()=>{setArchived(job.id,!isArchived);panel.querySelector('[data-activity-view="'+view+'"]').focus();};
  rowHeader.append(title,archive);row.append(rowHeader);
  const status=document.createElement('p');status.className='small';status.setAttribute('role','status');
  const state=states.get(job.id);
  row.classList.add(state==='Approved reference'?'is-approved':state==='Obsolete'?'is-obsolete':'is-unapproved');
  status.textContent=job.connectionError?'Connection unavailable. Checking again; no new generation will be sent.':job.status==='completed'?(state==='Needs review'?'Ready to review · Unapproved candidate':state==='Obsolete'?'Set aside · Obsolete':state||'Saved image'):(job.api_error?.code==='moderation_blocked'?'OpenAI blocked this image request during a safety check. Your API sign-in is working.':job.message||job.status);
  if(target===queueList&&!job.connectionError)status.textContent=job.queue_position?(job.queue_lane==='location'?'Location':'Character')+' queue · position '+job.queue_position:'Waiting to generate';
  row.append(status);
  if(job.api_error){
   const error=job.api_error,details=document.createElement('details'),label=document.createElement('summary'),body=document.createElement('p');
   details.className='generation-error-details';label.textContent='Error details';body.className='small';body.style.whiteSpace='pre-wrap';body.style.overflowWrap='anywhere';
   const fields=[['HTTP status',error.http_status],['API code',error.code],['Error type',error.type],['Request ID',error.request_id],['Moderation stage',error.moderation_details?.moderation_stage],['Categories',error.moderation_details?.categories?.join(', ')]];
   body.textContent=fields.filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>k+': '+v).join('\n');
   if(error.code==='moderation_blocked'&&!error.moderation_details)body.textContent+='\nNo moderation stage or category was saved for this request. The exact trigger is unknown.';
   body.textContent+='\nNo automatic retry was sent. Keep the request ID if contacting OpenAI support.';
   details.append(label,body);row.append(details);
  }
  if(job.editing){
   const resume=document.createElement('button');resume.type='button';resume.textContent='Open editing session';
   resume.onclick=()=>{panel.open=false;window.DESKLocationEditing?.open(job.location_id,{turnId:job.id,slotId:job.editing.slot_id});};row.append(resume);
  }
  if(a){
   const review=document.createElement('button');review.type='button';review.textContent=state==='Needs review'?'Review image':'View image';
   review.onclick=()=>{panel.open=false;imageView(a.id,job.location_id?{reviewLocation:job.location_id}:job.character_id?{selectionCharacter:job.character_id}:{});};row.append(review);
  }
  if(job.status==='save_failed'){
   const note=document.createElement('p');note.className='small';note.textContent='Reopen the original generation dialog to retry saving without another generation charge.';row.append(note);
  }
  target.append(row);
 }
}
function receive(job){
 if(!/^[a-f0-9]{32}$/.test(job?.id||''))return;
 jobs.set(job.id,job);
 if(job.status==='completed'&&!merged.has(job.id)){
  window.DESKGeneration?.merge(job);merged.add(job.id);
  // Update the counters without changing the user-controlled disclosure state.
 }
 persist();render();
}
async function read(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('Status unavailable');return r.json();}
async function poll(){
 if(polling)return;polling=true;
 try{
  for(const id of stored())remember(id);
  for(const [id,job] of jobs){
   if(!active.has(job.status)&&job.status!=='checking'&&!job.connectionError)continue;
   try{receive(await read('api/generation/jobs/'+id));}
   catch{jobs.set(id,{...job,connectionError:true});}
  }
  render();
 }finally{polling=false;}
}
function track(job){if(typeof job==='string'){remember(job);persist();render();void poll();}else receive(job);}
// Recover both new activity history and requests submitted before this monitor existed.
for(const id of stored())remember(id);
try{for(let i=0;i<DESKStorage.length;i++){
 const key=DESKStorage.key(i);if(!key.startsWith('desk-image-job:')&&!key.startsWith('desk-reference-job:'))continue;
 try{remember(JSON.parse(DESKStorage.getItem(key))?.id);}catch{}
}}catch{}
window.DESKGenerationActivity={track,snapshot:()=>[...jobs.values()]};
render();void poll();
// Discover beta requests from durable server history, including after browser storage is cleared.
read('api/location-editing').then(result=>{for(const job of result.turns||[])receive(job);}).catch(()=>{});
// Recover an active server request even if its dialog was closed before submission returned.
read('api/generation/config').then(v=>{for(const id of v.active_jobs||(v.active_job?[v.active_job]:[]))track(id);for(const id of v.queued_jobs||[])track(id);}).catch(()=>{});
setInterval(poll,5000);
window.addEventListener('desk-storage',e=>{if(e.key===storageKey)void poll();if(e.key===archiveKey||e.key===null){archived=readArchive();render();}});
// Saved character approvals (including disk updates from other tabs), local
// obsolete changes, and location/catalogue mutations all affect this display.
for(const event of ['desk-approval-saved','desk-review-changed','desk-catalog-changed'])window.addEventListener(event,render);
})();
