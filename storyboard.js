(()=>{
 const brandName=document.querySelector?.('.brand-canvas small');
 if(brandName)brandName.textContent=window.DESKContext?.name||'Reference Desk';
 // Disclosures overlay the workspace; opening controls never resizes the canvas.
 document.addEventListener?.('click',event=>{
  for(const panel of document.querySelectorAll('header details[open]'))if(!panel.contains(event.target))panel.open=false;
 });
 document.addEventListener?.('keydown',event=>{
  if(event.key!=='Escape')return;
  for(const panel of document.querySelectorAll('header details[open]')){panel.open=false;panel.querySelector('summary')?.focus();}
 });
 const origin='http://127.0.0.1:8899',frame=document.getElementById('commandCenter'),status=document.getElementById('status'),error=document.getElementById('error'),reconnect=document.getElementById('reconnect');
 const params=new URLSearchParams(location.search),entry=params.get('entry'),film=params.get('film');
 const destination=/^[a-f0-9]{16}$/.test(entry||'')?'/viewer.html?id='+entry:/^a[1-5]-\d{2}$/.test(film||'')?'/index.html?film='+encodeURIComponent(film):'/index.html';
 document.getElementById('openSeparately').href=origin+destination;
 let state={dirty:false,inflight:false,conflicted:false},loaded=false,connected=false,lastSeen=0,sequence=0,requests=new Map(),connecting=false;
 const unknown=()=>({dirty:true,inflight:true,conflicted:false});
 function current(){return loaded&&(!connected||Date.now()-lastSeen>3500)?unknown():{...state};}
 function showError(message){error.textContent=message;error.hidden=!message;}
 function request(type){return new Promise((resolve,reject)=>{
  if(!loaded){resolve();return;}
  const id=String(++sequence),timer=setTimeout(()=>{requests.delete(id);reject(Error('Could not confirm storyboard saves. Keep this workspace open, check its save status, and retry.'));},12000);
  requests.set(id,{resolve,reject,timer});frame.contentWindow.postMessage({channel:'reference-desk-storyboard',type,id},origin);
 });}
 window.addEventListener('message',event=>{
  const data=event.data;if(event.origin!==origin||event.source!==frame.contentWindow||data?.channel!=='reference-desk-storyboard')return;
  if(data.type==='state'||data.type==='flushed'){
   state={dirty:!!data.state?.dirty,inflight:!!data.state?.inflight,conflicted:!!data.state?.conflicted};connected=true;lastSeen=Date.now();
   status.textContent=state.conflicted?'Resolve saved-edit conflict':state.dirty||state.inflight?'Changes pending':'Connected · saves ready';
  }
  if(data.type==='flushed'&&requests.has(data.id)){
   const p=requests.get(data.id);requests.delete(data.id);clearTimeout(p.timer);
   if(data.error||state.dirty||state.inflight||state.conflicted)p.reject(Error(data.error||'Finish saving storyboard edits before leaving.'));else p.resolve();
  }
 });
 async function flush(){await request('flush');const s=current();if(s.dirty||s.inflight||s.conflicted)throw Error('Finish saving storyboard edits before leaving.');}
 window.DESKAutosave={flush,state:current};
 frame.addEventListener('load',()=>{connected=false;state=unknown();frame.contentWindow.postMessage({channel:'reference-desk-storyboard',type:'hello'},origin);});
 setInterval(()=>{if(loaded){frame.contentWindow.postMessage({channel:'reference-desk-storyboard',type:'hello'},origin);if(Date.now()-lastSeen>3500)status.textContent='Checking storyboard save connection…';}},1000);
 document.querySelectorAll('.app-header a:not([target="_blank"])').forEach(link=>link.addEventListener('click',async event=>{
  event.preventDefault();try{await flush();location.assign(link.href);}catch(e){showError(e.message);}
 }));
 window.addEventListener('beforeunload',event=>{const s=current();if(s.dirty||s.inflight||s.conflicted){event.preventDefault();event.returnValue='';}});
 async function connect(){
  if(connecting)return;connecting=true;reconnect.disabled=true;
  try{
   if(loaded)await flush();showError('');status.textContent='Connecting…';
   const response=await fetch('api/storyboard',{cache:'no-store'}),info=await response.json();if(!response.ok)throw Error(info.error||'Reference Desk could not connect.');
   let result=info;
   if(!info.online){const r=await fetch('api/storyboard/connect',{method:'POST',headers:{'X-DESK-CSRF':info.csrf_token}});result=await r.json();}
   if(!result.online)throw Error(result.error||'Open the Storyboard Command Center launcher and reconnect.');
   loaded=true;connected=false;state=unknown();frame.hidden=false;frame.src=origin+destination;
  }catch(e){status.textContent=loaded?'Workspace still open':'Offline';showError(e.message);}
  finally{connecting=false;reconnect.disabled=false;}
 }
 reconnect.onclick=connect;connect();
})();
