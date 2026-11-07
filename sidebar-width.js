'use strict';
(() => {
 const layout=document.querySelector('.layout'),aside=document.getElementById('familySidebar'),handle=document.getElementById('sidebarResize');
 const key='desk-sidebar-width-v1',min=180;
 let preferred=null,drag=null;
 try{const value=Number(DESKStorage.getItem(key));if(Number.isFinite(value)&&value>=min)preferred=value;}catch(_){}
 const defaultWidth=()=>window.innerWidth<=1000?180:230;
 const maximum=()=>Math.max(min,Math.min(420,layout.getBoundingClientRect().width-360));
 function apply(value){const width=Math.round(Math.max(min,Math.min(maximum(),value)));layout.style.setProperty('--sidebar-width',width+'px');handle.setAttribute('aria-valuemin',String(min));handle.setAttribute('aria-valuemax',String(maximum()));handle.setAttribute('aria-valuenow',String(width));handle.setAttribute('aria-valuetext',width+' pixels');return width;}
 function remember(value){preferred=apply(value);try{DESKStorage.setItem(key,String(preferred));}catch(_){} }
 function finish(e){if(!drag||e.pointerId!==drag.id)return;const id=drag.id;drag=null;document.body.classList.remove('sidebar-resizing');if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);remember(aside.getBoundingClientRect().width);}
 handle.addEventListener('pointerdown',e=>{if(e.button!==0||window.innerWidth<=680)return;e.preventDefault();handle.focus({preventScroll:true});drag={id:e.pointerId,x:e.clientX,width:aside.getBoundingClientRect().width};handle.setPointerCapture(e.pointerId);document.body.classList.add('sidebar-resizing');});
 handle.addEventListener('pointermove',e=>{if(drag&&e.pointerId===drag.id)apply(drag.width+e.clientX-drag.x);});
 handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
 handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?40:10;remember(e.key==='Home'?min:e.key==='End'?maximum():aside.getBoundingClientRect().width+(e.key==='ArrowRight'?step:-step));});
 handle.addEventListener('dblclick',()=>{preferred=null;try{DESKStorage.removeItem(key);}catch(_){}apply(defaultWidth());});
 window.addEventListener('resize',()=>apply(preferred??defaultWidth()));
 apply(preferred??defaultWidth());
})();
