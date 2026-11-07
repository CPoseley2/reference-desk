/* Persistent set scheduler. Call tick under one cross-tab lock. Each item keeps
   the same request ID and payload through reloads and lost responses. */
(function(root){
'use strict';
function create(io){
 const active=new Set(['queued','generating','saving']),failed=new Set(['failed','interrupted','save_failed']);
 async function tick(set){
  if(!set||set.status!=='running')return;
  const item=set.items.find(x=>!['completed','skipped'].includes(x.state));
  if(!item){set.status=set.items.some(x=>x.state==='skipped')?'partial':'completed';set.message=set.status==='completed'?'All images saved for review.':'Finished; some emotions need attention.';io.save(set);return;}
  const update=message=>{set.message=message;io.save(set);};
  function accept(job){
   item.job_id=job.id;item.state=job.status;item.message=job.message||job.status;item.asset_id=job.assets?.[0]?.id||job.asset_id||null;
   if(failed.has(job.status)){set.status='paused';set.message=item.name+': '+item.message;}
   else set.message=job.status==='completed'?item.name+' saved for review.':item.name+' · '+item.message;
   if(set.items.every(x=>['completed','skipped'].includes(x.state))){set.status=set.items.some(x=>x.state==='skipped')?'partial':'completed';set.message=set.status==='completed'?'All images saved for review.':'Finished; some emotions need attention.';}
   // Save progress before notifying views; a UI error must never resubmit a job.
   io.save(set);io.receive(job);
  }
  try{
   if(item.state==='planned'){
    const config=await io.get('api/generation/config');
    if(config.active_job){update('Waiting for the current image request to finish.');return;}
    if(!config.configured){set.status='paused';update(config.message||'Configure the image API to continue.');return;}
    item.state='submitting';update('Submitting '+item.name+'…');
   }
   if(item.state==='submitting'){
    // Recover an ackndeskedged or uncertain submission before sending anything.
    let job;
    try{job=await io.get('api/generation/jobs/'+item.payload.request_id.replaceAll('-',''));}
    catch(e){if(e.status!==404&&e.status!==400)throw e;}
    if(job){accept(job);return;}
    try{accept(await io.post('api/generation/jobs',item.payload));}
    catch(e){
     if(e.uncertain||!e.status||e.status>=500){update('Connection interrupted. Recovering the same '+item.name+' request; no duplicate image request.');return;}
     const config=await io.get('api/generation/config');
     if(config.active_job){update('Waiting for the current image request to finish.');return;}
     item.state='failed';item.message=e.message;set.status='paused';update(item.name+': '+e.message);
    }
   }else if(active.has(item.state))accept(await io.get('api/generation/jobs/'+item.job_id));
   else if(failed.has(item.state)){set.status='paused';update(item.name+': '+item.message);}
  }catch(e){update('Connection unavailable. The set will resume checking the same request when the desk reconnects.');}
 }
 return {tick};
}
if(typeof module==='object'&&module.exports)module.exports={create};else root.DESKEmotionSetQueue={create};
})(typeof window==='undefined'?{}:window);
