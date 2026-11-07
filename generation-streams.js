/* Read-only live monitor. Requests, approvals and generator settings are unchanged. */
(()=>{
'use strict';
const icon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="16" rx="2"/><path d="M6.5 8v5m-1.5-1 1.5 2 1.5-2M17.5 8v5m-1.5-1 1.5 2 1.5-2"/></svg>';
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const laneOf=j=>j.queue_lane||(j.location_id&&!j.character_id?'location':'character');
const labels={location:'Locations',character:'Characters'};
const dialog=document.createElement('dialog');dialog.className='generation-streams';dialog.setAttribute('aria-labelledby','generationStreamsTitle');
dialog.innerHTML='<header class="streams-header"><div><span class="streams-eyebrow">DESK · REFERENCE DESK</span><h2 id="generationStreamsTitle">Live generation streams</h2></div><button type="button" data-streams-close aria-label="Close live streams">Close ×</button></header><div class="streams-content"><div class="streams-statusbar"><p data-streams-status role="status" aria-live="polite">Connecting…</p><button type="button" data-streams-refresh title="Refresh both streams">Refresh</button></div><div class="streams-grid"><section data-stream-lane="location" aria-label="Location generation stream"></section><section data-stream-lane="character" aria-label="Character generation stream"></section></div><p class="streams-footnote">Queued now counts requests already on the server. Batches add more as images finish. Saved images are candidates until reviewed.</p></div>';
document.body.append(dialog);
let config=null,lastUpdate=null,error='',polling=false,tracked=new Set(),timer=null;
const seen=new Map(),signatures=new Map();
function allJobs(){return new Map([...(window.DESKGenerationActivity?.snapshot?.()||[]).map(j=>[j.id,j]),...seen]);}
function title(job){return job?.assets?.[0]?.title||D.locations?.find(l=>l.id===job?.location_id)?.name||people.get(job?.character_id)?.name||'Image request';}
function laneData(lane){
 const data=config?.generation_lanes?.[lane];if(data)return data;
 const known=[...allJobs().values()].filter(j=>laneOf(j)===lane);
 return {active_job:known.find(j=>['generating','saving'].includes(j.status))?.id,queued_jobs:known.filter(j=>j.status==='queued').map(j=>j.id)};
}
function render(){
 if(!dialog.open)return;
 const status=dialog.querySelector('[data-streams-status]');status.classList.toggle('is-error',!!error);
 status.textContent=error?'Connection unavailable · showing the last received status.':lastUpdate?'Live · updated '+lastUpdate.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'}):'Connecting…';
 const jobs=allJobs();
 for(const lane of ['location','character']){
  const data=laneData(lane),activeIds=data.active_jobs||(data.active_job?[data.active_job]:[]),current=jobs.get(activeIds[0]),queued=data.queued_jobs||[];
  const recent=[...jobs.values()].filter(j=>laneOf(j)===lane&&j.status==='completed'&&j.assets?.[0]).sort((a,b)=>(b.updated_at||b.created_at)-(a.updated_at||a.created_at)).slice(0,4);
  const cooldown=config?.cooldown_until>Date.now()/1000;
  const phase=error?'Status unavailable':data.active_job?(current?.status==='saving'?'Saving image':'Generating'):cooldown&&queued.length?'Waiting for API limit':queued.length?'Starting next request':'Waiting for requests';
  const content=`<div class="stream-title"><h3>${labels[lane]}</h3><span class="stream-state ${data.active_job&&!error?'is-running':''}">${data.active_job&&!error?'<i aria-hidden="true"></i>':''}${phase}</span></div><div class="stream-metrics"><div><strong>${activeIds.length}</strong><span>Active${data.capacity?' / '+data.capacity:''}</span></div><div title="Requests waiting on the server; excludes future batch submissions."><strong>${queued.length}</strong><span>Queued now</span></div></div><div class="stream-current"><span class="streams-eyebrow">${activeIds.length?'CURRENT REQUESTS':'STREAM STATUS'}</span>${activeIds.length?activeIds.map((id,index)=>{const job=jobs.get(id);return `<div class="stream-current-job"><span class="stream-worker">${index+1}</span><div><strong>${escape(job?title(job):'Loading request…')}</strong>${job?.editing?.slot_id?`<span class="stream-view">${escape((D.location_slots||[]).find(s=>s.id===job.editing.slot_id)?.label||job.editing.slot_id)}</span>`:''}<span class="stream-view">${error?'Status unavailable':job?.status==='saving'?'Saving image':'Generating'}</span></div></div>`;}).join(''):`<strong>${cooldown&&queued.length?'The stream will resume after the API cooldown.':queued.length?'Preparing the next image.':'Ready for the next image.'}</strong>`}${activeIds.length?'<div class="stream-pulse '+(error?'is-stale':'')+'" aria-hidden="true"><span></span></div>':''}</div><details class="stream-next"><summary>Up next <span>${Math.min(queued.length,3)} shown</span></summary>${queued.length?'<ol>'+queued.slice(0,3).map(id=>'<li>'+escape(jobs.has(id)?title(jobs.get(id)):'Queued image')+'</li>').join('')+'</ol>':'<p>No requests queued on the server.</p>'}</details><h4>Latest saved images</h4><div class="stream-results">${recent.map(j=>{const a=j.assets[0];return `<button type="button" class="stream-result" data-stream-review="${escape(j.id)}" aria-label="Review ${escape(a.title)}"><img src="${escape(a.thumbnail||a.asset)}" alt="" loading="lazy"><span>${escape(a.title)}</span><small>Review image ↗</small></button>`;}).join('')||'<p class="stream-empty">Completed images will appear here as this stream runs.</p>'}</div>`;
  const host=dialog.querySelector('[data-stream-lane="'+lane+'"]');
  if(signatures.get(lane)!==content){
   const open=host.querySelector('details')?.open,focus=document.activeElement?.closest('[data-stream-review]')?.dataset.streamReview;
   signatures.set(lane,content);host.innerHTML=content;
   if(open)host.querySelector('details').open=true;
   if(focus)host.querySelector('[data-stream-review="'+focus+'"]')?.focus({preventScroll:true});
  }
 }
}
async function read(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('Status unavailable');return r.json();}
async function poll(){
 if(polling)return;polling=true;
 try{
  const next=await read('api/generation/config');
  const activeIds=next.active_jobs||(next.active_job?[next.active_job]:[]);
  const ids=new Set([...activeIds,...tracked]);
  if(dialog.open)for(const lane of Object.values(next.generation_lanes||{}))for(const id of (lane.queued_jobs||[]).slice(0,3))ids.add(id);
  const results=await Promise.allSettled([...ids].map(async id=>{const j=await read('api/generation/jobs/'+id);seen.set(id,j);window.DESKGenerationActivity?.track(j);return j;}));
  config=next;tracked=new Set(activeIds);
  results.forEach((r,i)=>{if(r.status==='rejected')tracked.add([...ids][i]);});
  error=results.some(r=>r.status==='rejected')?'Some request details could not be refreshed.':'';
  lastUpdate=new Date();
 }catch(e){error=e.message;}
 finally{polling=false;render();clearTimeout(timer);timer=setTimeout(poll,5000);}
}
function open(){
 document.querySelector('.generation-activity')?.removeAttribute('open');
 if(!dialog.open)dialog.showModal();render();void poll();
}
function launcher(className){const b=document.createElement('button');b.type='button';b.className=className;b.innerHTML=icon+'<span>Live streams</span>';b.onclick=open;return b;}
document.querySelector('.desk-switch')?.after(launcher('streams-launch'));
document.querySelector('.generation-activity-tabs')?.before(launcher('streams-tray-launch'));
dialog.querySelector('[data-streams-close]').onclick=()=>dialog.close();
dialog.querySelector('[data-streams-refresh]').onclick=()=>void poll();
dialog.addEventListener('click',e=>{const button=e.target.closest('[data-stream-review]');if(!button)return;const job=allJobs().get(button.dataset.streamReview),asset=job?.assets?.[0];if(!asset)return;window.DESKGeneration?.merge(job);dialog.close();imageView(asset.id,job.character_id?{selectionCharacter:job.character_id}:job.location_id?{reviewLocation:job.location_id}:{});});
window.DESKGenerationStreams={open};void poll();
})();
