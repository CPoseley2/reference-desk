/* Review flags belong to shot slots, not the images assigned to them. */
window.shotFlagStart=function(shots,index,duration){
 const shot=shots[index];if(!shot)return null;
 if(Number.isFinite(shot.start)&&Number.isFinite(shot.end)&&shot.end>shot.start)return shot.start;
 const timed=shots.some(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start);
 return !timed&&Number.isFinite(duration)&&duration>0?index*duration/shots.length:null;
};
window.initShotFlags=function({id,host,view,getCurrent,show,position}){
 const player=document.getElementById('player'),viewButton=document.getElementById('view-shot');
 if(!viewButton)return;
 let flags={},csrf=null,revision=-1,busy=false,loading=false,ready=false,failedAction=null;
 const button=document.createElement('button');button.type='button';button.id='flag-shot';button.disabled=true;viewButton.after(button);
 const section=document.createElement('section');section.className='shot-flag-timeline';section.setAttribute('aria-label','Flagged shots timeline');
 section.innerHTML='<div class="shot-flag-heading"><strong>Flagged shots <span data-flag-count>0</span></strong><span data-flag-message role="status" aria-live="polite" hidden></span><button type="button" data-flag-retry hidden>Retry flag save</button><button type="button" class="review-icon" data-flag-refresh aria-label="Refresh flags" title="Refresh flags"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7v5h-5M4 17v-5h5M5.5 7a7 7 0 0 1 11.6-2L20 8M4 16l2.9 3A7 7 0 0 0 18.5 17"/></svg></button></div><div class="shot-flag-track"><div class="shot-flag-playhead" aria-hidden="true"></div><div class="shot-flag-pins"></div></div><div class="shot-flag-scale"><span>0:00</span><span data-flag-duration></span></div><div class="shot-flag-untimed"></div>';
 (document.getElementById('audio')||viewButton.parentElement).after(section);
 const q=name=>section.querySelector('[data-flag-'+name+']'),track=section.querySelector('.shot-flag-track'),pins=section.querySelector('.shot-flag-pins'),untimed=section.querySelector('.shot-flag-untimed');
 function message(text,attention=false){q('message').textContent=text;q('message').hidden=!attention;}
 const clock=t=>Math.floor(t/60)+':'+(t%60).toFixed(1).padStart(4,'0');
 const duration=()=>Number.isFinite(player?.duration)&&player.duration>0?player.duration:Math.max(0,...view.shots.map(s=>Number.isFinite(s.end)?s.end:0),...Object.values(flags).map(f=>f.timestamp||0));
 function paintCards(){
  host.querySelectorAll('.edit-slot').forEach(card=>{
   const sid=card.dataset.slot,marked=!!flags[sid];card.classList.toggle('shot-flagged',marked);
   let toggle=card.querySelector('.shot-flag-toggle');
   if(!toggle){toggle=document.createElement('button');toggle.type='button';toggle.className='shot-flag-toggle review-icon';toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/></svg>';toggle.onclick=()=>toggleShot(sid,false);card.querySelector('.slot-actions').append(toggle);}
   toggle.title=(marked?'Unflag':'Flag')+' shot '+sid;toggle.setAttribute('aria-label',(marked?'Unflag':'Flag')+' shot '+sid);toggle.setAttribute('aria-pressed',String(marked));toggle.disabled=!ready||busy||!!failedAction;
  });
 }
 function updateButton(){
  const sid=view.shots[getCurrent()]?.id,marked=!!flags[sid];button.textContent=marked?'⚑ Unflag shot':'⚐ Flag shot';button.setAttribute('aria-pressed',String(marked));button.setAttribute('aria-label',(marked?'Unflag':'Flag')+' current shot'+(sid?' '+sid:''));button.disabled=!ready||busy||!!failedAction||!sid;
 }
 function updatePlayhead(){const total=duration();section.querySelector('.shot-flag-playhead').style.left=(total?Math.min(100,(player?.currentTime||0)/total*100):0)+'%';}
 function render(){
  updateButton();paintCards();const total=duration();q('count').textContent=Object.keys(flags).length;q('duration').textContent=total?clock(total):'No timing yet';
  const rows=Object.entries(flags).map(([sid,flag])=>({sid,...flag,index:view.shots.findIndex(s=>String(s.id)===sid)})).filter(f=>f.index>=0).sort((a,b)=>(a.timestamp??Infinity)-(b.timestamp??Infinity)||a.index-b.index);
  pins.replaceChildren();untimed.replaceChildren();const lanes=[],width=Math.max(100,track.clientWidth);
  for(const flag of rows){
   const pin=document.createElement('button');pin.type='button';pin.className='shot-flag-pin';pin.dataset.shot=flag.sid;pin.textContent='⚑ '+(flag.index+1);
   const hasTime=flag.timestamp!==null&&total>0;
   pin.title=pin.getAttribute('aria-label')||('Go to shot '+flag.sid+(hasTime?' at '+clock(flag.timestamp):' · no timestamp'));
   pin.setAttribute('aria-label',pin.title);
   pin.onclick=()=>{if(player&&hasTime){player.currentTime=Math.min(flag.timestamp,Number.isFinite(player.duration)?player.duration:flag.timestamp);player.dispatchEvent(new Event('timeupdate'));}show(flag.index);updatePlayhead();};
   if(hasTime){const x=Math.max(0,Math.min(100,flag.timestamp/total*100)),pixel=x/100*width;let lane=lanes.findIndex(end=>pixel-end>=46);if(lane<0)lane=lanes.length;lanes[lane]=pixel;pin.style.left=x+'%';pin.style.top=(lane*30)+'px';pin.style.transform=x<3?'none':x>97?'translateX(-100%)':'translateX(-50%)';pins.append(pin);}else untimed.append(pin);
  }
  track.style.height=Math.max(32,lanes.length*30)+'px';track.hidden=!total;section.querySelector('.shot-flag-scale').hidden=!total;updatePlayhead();
 }
 async function refresh(){
  if(busy||loading)return;loading=true;
  try{const r=await fetch('/library-api/shot-flags?id='+encodeURIComponent(id),{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error||'Could not load flags.');if(busy||data.revision<revision)return;csrf=data.csrf_token;ready=true;if(data.revision!==revision){flags=data.flags;revision=data.revision;render();}else{updateButton();paintCards();}if(!failedAction)message('');}
  catch{ready=false;message('Flags unavailable. Refresh flags to reconnect.',true);updateButton();paintCards();}
  finally{loading=false;}
 }
 async function save(action){
  if(busy)return;busy=true;failedAction=action;q('retry').hidden=true;message('');updateButton();paintCards();
  try{
   // Refresh only the token; expected values still guard concurrent edits.
   const check=await fetch('/library-api/shot-flags?id='+encodeURIComponent(id),{cache:'no-store'}),state=await check.json();if(!check.ok)throw Error('Could not reconnect.');csrf=state.csrf_token;
   const response=await fetch('/library-api/shot-flags',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':csrf},body:JSON.stringify({id,...action})}),data=await response.json();
   if(response.status===409){flags=data.flags;revision=data.revision;failedAction=null;throw Error(data.error);}
   if(!response.ok)throw Error(data.error||'Could not save flag.');
   flags=data.flags;revision=data.revision;ready=true;failedAction=null;message('');
  }catch(error){message(error.message+(failedAction?' Save not confirmed; retry to safely check and save this flag.':''),true);q('retry').hidden=!failedAction;}
  finally{busy=false;render();}
 }
 function toggleShot(sid,playback){
  if(!ready||busy||failedAction)return;
  const index=view.shots.findIndex(s=>String(s.id)===sid);if(index<0)return;
  let stamp=window.shotFlagStart(view.shots,index,player?.duration);
  if(playback&&player&&position(view.shots,player.currentTime,player.duration).index===index)stamp=player.currentTime;
  save({shot_id:sid,flagged:!flags[sid],timestamp:stamp,expected:flags[sid]||null});
 }
 button.onclick=()=>toggleShot(String(view.shots[getCurrent()]?.id),true);
 q('retry').onclick=()=>failedAction&&save(failedAction);q('refresh').onclick=refresh;
 window.addEventListener('owl-shot-change',updateButton);window.addEventListener('owl-timing-change',render);
 player?.addEventListener('timeupdate',updatePlayhead);player?.addEventListener('loadedmetadata',render);player?.addEventListener('durationchange',render);
 new MutationObserver(()=>paintCards()).observe(document.getElementById('slot-grid'),{childList:true});
 if(window.ResizeObserver)new ResizeObserver(render).observe(track);
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 const poll=setInterval(()=>{if(!document.hidden&&host.isConnected)refresh();else if(!host.isConnected)clearInterval(poll);},5000);
 window.ReferenceDeskBridge?.register('shot-flags',{state:()=>({dirty:!!failedAction,inflight:busy}),flush:async()=>{await window.ReferenceDeskBridge.waitUntil(()=>busy);if(failedAction)await save(failedAction);if(failedAction)throw Error('Retry the unsaved shot flag before leaving.');}});
 window.addEventListener('beforeunload',event=>{if(busy||failedAction){event.preventDefault();event.returnValue='';}});
 render();refresh();
};
