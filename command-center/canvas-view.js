/* The same canvas stays live in docked, floating and full-screen modes. */
(()=>{
 const screen=document.getElementById('screen');if(!screen)return;
 const home=document.createElement('div'),stage=document.createElement('section');
 home.className='canvas-home';stage.id='canvas-stage';stage.className='canvas-stage';stage.setAttribute('aria-label','Storyboard canvas');
 screen.before(home);home.append(stage);stage.append(screen);
 const icons={fullscreen:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',float:'M9 3H3v18h18v-6M13 3h8v8m0-8L11 13',close:'m6 6 12 12M6 18 18 6',move:'M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3M6 9l-3 3 3 3m12-6 3 3-3 3',play:'m8 5 11 7-11 7V5Z',pause:'M8 5v14M16 5v14',previous:'m14 5-7 7 7 7',next:'m10 5 7 7-7 7'};
 const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${icons[name]}"/></svg>`;
 const tools=document.createElement('div');tools.className='canvas-view-tools';stage.append(tools);
 function button(name,label,handler){const b=document.createElement('button');b.type='button';b.className='review-icon';b.innerHTML=svg(name);b.setAttribute('aria-label',label);window.describeControlPurpose?.(b,label);b.addEventListener('click',handler);return b;}
 let mode='docked',beforeFullscreen='docked',focusReturn=null,drag=null;
 const floating=button('float','Floating canvas — move and resize the playback image',async()=>{if(mode==='fullscreen'){beforeFullscreen='floating';await exitFullscreen();}else setMode(mode==='floating'?'docked':'floating');});
 const full=button('fullscreen','Full-screen canvas',toggleFullscreen);
 const close=button('close','Return canvas to page',dock);close.hidden=true;
 tools.append(floating,full,close);
 const handle=button('move','Move floating canvas — drag, or use the arrow keys',()=>{});handle.classList.add('canvas-drag');stage.append(handle);
 const transport=document.createElement('div');transport.className='canvas-transport';stage.append(transport);
 const previous=button('previous','Previous shot',()=>document.getElementById('prev')?.click());
 const play=button('play','Play',async()=>{const p=document.getElementById('player');if(!p)return;try{if(p.paused)await p.play();else p.pause();}catch{status.textContent='Playback could not start. Try the audio player on the page.';}});
 const next=button('next','Next shot',()=>document.getElementById('next')?.click());
 const counter=document.createElement('span');counter.className='canvas-counter';
 transport.append(previous,play,next,counter);
 const status=document.createElement('p');status.className='canvas-view-status';status.setAttribute('role','status');stage.append(status);
 function clampPosition(){
  if(mode!=='floating')return;
  const r=stage.getBoundingClientRect();
  stage.style.left=Math.max(8,Math.min(r.left,innerWidth-r.width-8))+'px';
  stage.style.top=Math.max(8,Math.min(r.top,innerHeight-r.height-8))+'px';
 }
 function setMode(value){
  if(value!=='docked'&&mode==='docked')focusReturn=document.activeElement;
  mode=value;stage.dataset.mode=mode;
  floating.setAttribute('aria-pressed',String(mode==='floating'));full.setAttribute('aria-pressed',String(mode==='fullscreen'));
  close.hidden=mode==='docked';handle.hidden=mode!=='floating';transport.hidden=mode==='docked';status.textContent='';
  if(mode==='floating'){
   if(!stage.style.left){stage.style.left=Math.max(8,innerWidth-500)+'px';stage.style.top='80px';}
   clampPosition();
  }
  if(mode==='docked'){stage.removeAttribute('style');focusReturn?.focus({preventScroll:true});}
 }
 async function toggleFullscreen(){
  if(mode==='fullscreen'){await exitFullscreen();return;}
  beforeFullscreen=mode;setMode('fullscreen');
  // Embedded web views may deny the Fullscreen API. The same view still fills the app.
  try{if(stage.requestFullscreen)await stage.requestFullscreen();else if(stage.webkitRequestFullscreen)stage.webkitRequestFullscreen();}catch{}
 }
 async function exitFullscreen(){
  if(document.fullscreenElement===stage)await document.exitFullscreen();
  else if(document.webkitFullscreenElement===stage)document.webkitExitFullscreen();
  setMode(beforeFullscreen);
 }
 async function dock(){
  beforeFullscreen='docked';
  if(mode==='fullscreen')await exitFullscreen();
  setMode('docked');
 }
 function fullscreenChanged(){if(!document.fullscreenElement&&!document.webkitFullscreenElement&&mode==='fullscreen')setMode(beforeFullscreen);}
 document.addEventListener('fullscreenchange',fullscreenChanged);document.addEventListener('webkitfullscreenchange',fullscreenChanged);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode!=='docked'&&!document.querySelector('dialog[open]')){e.preventDefault();dock();}});
 handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=stage.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};handle.setPointerCapture(e.pointerId);e.preventDefault();});
 handle.addEventListener('pointermove',e=>{if(!drag)return;stage.style.left=(e.clientX-drag.x)+'px';stage.style.top=(e.clientY-drag.y)+'px';clampPosition();});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,()=>drag=null);
 handle.addEventListener('keydown',e=>{const d={ArrowLeft:[-16,0],ArrowRight:[16,0],ArrowUp:[0,-16],ArrowDown:[0,16]}[e.key];if(!d)return;e.preventDefault();const r=stage.getBoundingClientRect();stage.style.left=r.left+d[0]+'px';stage.style.top=r.top+d[1]+'px';clampPosition();});
 window.addEventListener('resize',clampPosition);new ResizeObserver(clampPosition).observe(stage);
 function sync(){
  counter.textContent=document.getElementById('counter')?.textContent||'';
  const p=document.getElementById('player');play.disabled=!p;play.innerHTML=svg(p&&!p.paused?'pause':'play');play.setAttribute('aria-label',p&&!p.paused?'Pause':'Play');
  // Reserve enough width for any shot number / identifier before playback starts.
  if(typeof V!=='undefined'&&V?.shots){const length=Math.max(...V.shots.map((s,i)=>`${i+1} / ${V.shots.length} · ${s.id}`.length));document.getElementById('counter').style.minWidth=length+'ch';}
 }
 // Keep the box dimensions independent of font size, so fitting never moves playback.
 const description=document.getElementById('shot-title');
 function fitDescription(){
  if(!description.clientWidth||!description.clientHeight)return;
  description.scrollTop=0;
  const maximum=parseFloat(getComputedStyle(description).getPropertyValue('--description-max-font'))||23;
  const fits=()=>description.scrollHeight<=description.clientHeight&&description.scrollWidth<=description.clientWidth;
  description.style.fontSize=maximum+'px';
  if(fits())return;
  let low=1,high=maximum;
  for(let i=0;i<12;i++){
   const size=(low+high)/2;description.style.fontSize=size+'px';
   if(fits())low=size;else high=size;
  }
  description.style.fontSize=low+'px';
 }
 new ResizeObserver(fitDescription).observe(description);
 document.fonts?.ready.then(fitDescription);
 window.addEventListener('owl-shot-change',()=>{sync();description.scrollTop=0;fitDescription();});
 for(const event of ['play','pause','ended','loadedmetadata'])document.addEventListener(event,sync,true);
 setMode('docked');
})();
