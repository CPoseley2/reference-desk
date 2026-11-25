/* Installed into the existing Command Center, preserving its origin and storage. */
(()=>{
 const parentOrigin='http://127.0.0.1:8876',channel='reference-desk-storyboard',providers=new Map();
 let booting=location.pathname.endsWith('/viewer.html'),writes=0,flushing=null;
 const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
 async function waitUntil(test){const end=Date.now()+9000;while(test()){if(Date.now()>end)throw Error('Storyboard changes are still saving. Please retry.');await pause();}}
 function state(){
  const result={dirty:false,inflight:booting||writes>0,conflicted:false};
  for(const provider of providers.values()){const s=provider.state();for(const key of Object.keys(result))result[key] ||= !!s[key];}
  return result;
 }
 function announce(type='state',id,error){if(parent!==window)parent.postMessage({channel,type,id,state:state(),error},parentOrigin);}
 async function saveAll(){
  await waitUntil(()=>booting||writes>0);
  for(const provider of providers.values()){await provider.flush();}
  await waitUntil(()=>writes>0);
  const s=state();if(s.dirty||s.inflight||s.conflicted)throw Error('Finish saving notes, image tags, arrangements, or timing changes in this storyboard before leaving.');
 }
 function flush(){if(!flushing)flushing=saveAll().finally(()=>{flushing=null;announce();});return flushing;}
 window.ReferenceDeskBridge={register:(name,provider)=>{providers.set(name,provider);announce();},ready:()=>{booting=false;announce();},waitUntil,state,flush};
 const originalFetch=window.fetch.bind(window);
 window.fetch=async(input,options)=>{
  const method=(options?.method||input?.method||'GET').toUpperCase();const write=method!=='GET'&&method!=='HEAD';
  if(write){writes++;announce();}try{return await originalFetch(input,options);}finally{if(write){writes--;announce();}}
 };
 window.addEventListener('message',async event=>{
  if(event.source!==parent||event.origin!==parentOrigin||event.data?.channel!==channel)return;
  if(event.data.type==='hello')announce();
  if(event.data.type==='flush'){try{await flush();announce('flushed',event.data.id);}catch(error){announce('flushed',event.data.id,error.message);}}
 });
 document.addEventListener('DOMContentLoaded',()=>{
  for(const link of document.querySelectorAll('a[href="http://127.0.0.1:8765/"]')){
   link.href=parentOrigin+'/';link.title='Reference Desk';link.setAttribute('aria-label','Reference Desk');
  }
 });
 // Keep documents and original layouts separate; only the catalog and viewer replace this frame.
 document.addEventListener('click',event=>{
  const link=event.target.closest('a[href]');if(!link||link.hasAttribute('download'))return;
  const url=new URL(link.href,location.href);
  if(url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
  const embedded=parent!==window;
  if(embedded&&!(url.origin===location.origin&&['/','/index.html','/viewer.html'].includes(url.pathname))){link.target='_blank';link.rel='noopener';return;}
  if(link.target==='_blank'||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();flush().then(()=>location.assign(url.href)).catch(error=>alert(error.message));
 },true);
 window.addEventListener('beforeunload',event=>{const s=state();if(s.dirty||s.inflight||s.conflicted){event.preventDefault();event.returnValue='';}});
 setInterval(()=>announce(),700);
})();
