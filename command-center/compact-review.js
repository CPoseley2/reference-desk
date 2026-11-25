/* Compact review controls retain the original note/status elements and storage. */
(()=>{
 const paths={chat:'M21 11a8 8 0 0 1-8 8H8l-5 3v-7a8 8 0 0 1-1-4 9 9 0 0 1 19 0ZM7 10h10M7 14h6',help:'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01',images:'M6 3h15v15H6ZM3 6v15h15M8 14l4-4 3 3 2-2 3 4',archive:'M3 4h18v4H3ZM5 8v13h14V8M9 12h6',edit:'m4 16 12-12 4 4L8 20H4v-4ZM14 6l4 4',landscape:'M3 4h18v16H3ZM4 17l5-7 4 5 3-4 4 6M16 7h.01',clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',review:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3ZM12 7v6M12 16h.01',brain:'M12 5a3 3 0 0 0-6-1 4 4 0 0 0-3 6 4 4 0 0 0 1 7 4 4 0 0 0 8 2V5Zm0 0a3 3 0 0 1 6-1 4 4 0 0 1 3 6 4 4 0 0 1-1 7 4 4 0 0 1-8 2M6 4v4M3 10h4l2 3M4 17h3v-2M18 4v4M21 10h-4l-2 3M20 17h-3v-2',note:'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h5',save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h9V3M7 21v-8h10v8',info:'M12 11v6M12 7h.01',book:'M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z',bulb:'M9 18h6M10 22h4M9 15c0-2-4-3-4-7a7 7 0 0 1 14 0c0 4-4 5-4 7v1H9Z'};
 const svg=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${['info','help'].includes(name)?'<circle cx="12" cy="12" r="9"/>':''}<path d="${paths[name]}"/></svg>`;
 // Short purpose labels are separate from the click-only saved notes.
 const purposeTip=document.createElement('div');purposeTip.id='production-purpose-tip';purposeTip.className='production-purpose-tip';purposeTip.setAttribute('role','tooltip');purposeTip.hidden=true;document.body.append(purposeTip);
 let purposeTimer=null;
 function hidePurpose(){clearTimeout(purposeTimer);purposeTimer=null;purposeTip.hidden=true;}
 function describePurpose(button,description){
  button.setAttribute('aria-description',description);
  function schedulePurpose(event){
   hidePurpose();if(event.pointerType==='touch'||button.getAttribute('aria-expanded')==='true')return;
   purposeTimer=setTimeout(()=>{
    if(!button.isConnected||button.getAttribute('aria-expanded')==='true')return;
    purposeTip.textContent=description;purposeTip.hidden=false;
    const anchor=button.getBoundingClientRect(),tip=purposeTip.getBoundingClientRect();
    purposeTip.style.left=Math.max(8,Math.min(anchor.left,window.innerWidth-tip.width-8))+'px';
    purposeTip.style.top=(anchor.bottom+tip.height+16<=window.innerHeight?anchor.bottom+8:Math.max(8,anchor.top-tip.height-8))+'px';
   },1000);
  }
  button.addEventListener('pointerenter',schedulePurpose);button.addEventListener('focus',schedulePurpose);
  for(const event of ['pointerleave','pointerdown','blur','click'])button.addEventListener(event,hidePurpose);
 }
 window.describeControlPurpose=describePurpose;
 const shotCounter=document.getElementById('counter');shotCounter.tabIndex=0;
 describePurpose(shotCounter,'Current shot — the displayed shot number, total shots, and shot ID. Updates as you navigate or follow playback.');
 window.orderPlaybackTools=()=>{
  const row=document.querySelector('.playback-tools'),previous=document.getElementById('prev'),next=document.getElementById('next');if(!row)return;
  const navigation=previous.parentElement,follow=row.querySelector('.follow-control');
  // Keep DOM order, keyboard navigation, and the visible order together.
  for(const child of [...navigation.children])if(child!==previous&&child!==next)navigation.before(child);
  row.prepend(shotCounter);row.append(navigation);if(follow)row.append(follow);
 };

 document.addEventListener('keydown',event=>{if(event.key==='Escape')hidePurpose();});
 document.addEventListener('click',hidePurpose);window.addEventListener('blur',hidePurpose);window.addEventListener('resize',hidePurpose);window.addEventListener('scroll',hidePurpose,true);
 window.compactInfo=(text,label,icon)=>{
  const wrap=document.createElement('span');wrap.className='info-control';
  const button=document.createElement('button');button.type='button';button.className='review-icon';button.innerHTML=svg(icon);button.setAttribute('aria-label',label);button.setAttribute('aria-expanded','false');
  text.before(wrap);wrap.append(button,text);text.className='icon-hint';text.setAttribute('role','tooltip');button.setAttribute('aria-describedby',text.id);
  // Text opens only through activation, never hover or focus.
  button.setAttribute('aria-controls',text.id);
  button.onclick=()=>{const open=wrap.classList.toggle('hint-open');button.setAttribute('aria-expanded',String(open))};
  return wrap;
 };
 function closeInfo(wrap){
  wrap.classList.remove('hint-open');
  (wrap.matches('#save-state')?wrap:wrap.querySelector('button'))?.setAttribute('aria-expanded','false');
 }
 document.addEventListener('click',event=>{
  document.querySelectorAll('.info-control.hint-open').forEach(wrap=>{if(!wrap.contains(event.target))closeInfo(wrap);});
 });
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  document.querySelectorAll('.info-control.hint-open').forEach(wrap=>{
   const trigger=wrap.matches('#save-state')?wrap:wrap.querySelector('button');
   closeInfo(wrap);trigger?.focus({preventScroll:true});
  });
 });
 const saveInfo=document.getElementById('save-state');
 saveInfo.setAttribute('role','button');saveInfo.setAttribute('aria-expanded','false');saveInfo.setAttribute('aria-controls','save-status');
 saveInfo.onclick=()=>saveInfo.setAttribute('aria-expanded',String(saveInfo.classList.toggle('hint-open')));
 saveInfo.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();saveInfo.click();}};
 // Header categories are always available, including when their saved note is empty.
 window.renderProductionNotes=note=>{
  const host=document.getElementById('description');host.replaceChildren();host.className='production-note-icons';host.setAttribute('aria-label','Storyboard tools');host.hidden=false;
  const sentences=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(String(note||''))].map(s=>s.segment.trim()):String(note||'').split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const groups={images:[],edit:[],note:[],clock:[],review:[],archive:[],landscape:[]};
  sentences.flatMap(s=>/^\d+[^;]+;\s*\d+/.test(s)?s.split(/;\s*/):[s]).filter(Boolean).forEach(point=>{
   const kind=/unapproved|approval|approved/i.test(point)?'review':/timing|untimed|listening/i.test(point)?'clock':/alternates|archive/i.test(point)?'archive':/continuity|revised|revision/i.test(point)?'edit':/opening|landscape/i.test(point)?'landscape':/images?|candidates?/i.test(point)?'images':'note';
   groups[kind].push(point);
  });
  const definitions={images:['Image candidates','Browse all images'],edit:['Revision note','Open shot revision'],note:['Production notes',''],clock:['Timing note','Open playback timing'],review:['Approval note','Review current image'],archive:['Preserved alternates','Browse all images'],landscape:['Opening and preserved shots','View current shot']};
  function goTo(element){if(!element)return; element.scrollIntoView({block:'center',behavior:'instant'});if(!element.hasAttribute('tabindex'))element.tabIndex=-1;element.focus({preventScroll:true});}
  function openView(kind){
   if(['images','archive'].includes(kind)){document.getElementById('library-tab-storyboard')?.click();goTo(document.getElementById('image-library')||document.getElementById('shots'));}
   else if(['edit','review'].includes(kind)){window.openCurrentShotReview?.();}
   else if(kind==='clock'){
    const timing=document.getElementById('beat-edit');
    if(timing)goTo(timing);
    else {const text=document.getElementById('playback-timing-status'),button=text?.parentElement.querySelector('button');goTo(document.getElementById('audio'));requestAnimationFrame(()=>{if(button?.getAttribute('aria-expanded')!=='true')button?.click();});}
   }else document.getElementById('view-shot')?.click();
  }
  for(const kind of ['images','edit','note','clock','review',...['archive','landscape'].filter(k=>groups[k].length)]){
   const [label,actionLabel]=definitions[kind],wrap=document.createElement('span');wrap.className='production-note';wrap.dataset.kind=kind;
   const button=document.createElement('button');button.type='button';button.className='review-icon';button.innerHTML=svg(kind);button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');
   const panel=document.createElement('dialog');panel.className='production-notes-body header-note-sheet';panel.id=kind==='note'?'production-notes-sheet':'production-'+kind+'-sheet';panel.setAttribute('aria-labelledby',panel.id+'-heading');button.setAttribute('aria-controls',panel.id);
   const heading=document.createElement('div');heading.className='production-notes-sheet-heading';const title=document.createElement('h2');title.id=panel.id+'-heading';title.textContent=label;
   const close=document.createElement('button');close.type='button';close.className='review-icon';close.textContent='×';close.setAttribute('aria-label','Close '+label.toLowerCase());close.onclick=()=>panel.close();heading.append(title,close);
   const body=document.createElement('div');body.className='header-note-content';
   const actions=document.createElement('div');actions.className='header-note-actions';
   if(actionLabel){const action=document.createElement('button');action.type='button';action.textContent=actionLabel;action.onclick=()=>{panel.close();openView(kind);};actions.append(action);}
   const add=document.createElement('button');add.type='button';add.onclick=()=>{panel.close();window.storyboardProductionNotes?.open();};actions.append(add);
   panel.append(heading,body,actions);wrap.append(button,panel);host.append(wrap);
   const description=label+' — '+(actionLabel?actionLabel.toLowerCase()+' and view saved notes.':'view or add story and production notes.');describePurpose(button,description);
   function placeSheet(){
    const bounds=document.getElementById('screen')?.getBoundingClientRect(),height=panel.getBoundingClientRect().height,width=panel.getBoundingClientRect().width;
    const centerX=bounds?bounds.left+bounds.width/2:innerWidth/2,centerY=bounds?bounds.top+bounds.height/2:innerHeight/2;
    panel.style.left=Math.max(16,Math.min(centerX-width/2,innerWidth-width-16))+'px';panel.style.top=Math.max(16,Math.min(centerY-height/2,innerHeight-height-16))+'px';
   }
   button.onclick=()=>{
    if(panel.open){panel.close();return;}
    const saved=window.storyboardProductionNotes?.text()||'';body.replaceChildren();
    if(groups[kind].length){const list=document.createElement('ul');for(const text of groups[kind]){const item=document.createElement('li');item.textContent=text;list.append(item);}body.append(list);}
    if(kind==='note'&&saved.trim()){const heading=document.createElement('h3');heading.textContent='Library production note';const text=document.createElement('p');text.className='saved-production-feedback';text.textContent=saved;body.append(heading,text);}
    if(!body.childElementCount){const empty=document.createElement('p');empty.textContent=kind==='note'?'No production notes yet.':'No saved '+label.toLowerCase()+'.';body.append(empty);}
    add.textContent=saved.trim()?'Edit production note':'Add production note';
    hidePurpose();panel.showModal();button.setAttribute('aria-expanded','true');placeSheet();
   };
   panel.addEventListener('close',()=>{button.setAttribute('aria-expanded','false');});
   panel.addEventListener('click',event=>{if(event.target!==panel)return;const bounds=panel.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)panel.close();});
   window.addEventListener('resize',()=>{if(panel.open)placeSheet();});
  }
 };
 const storyboardTitle=document.getElementById('title'),titleRow=document.createElement('div'),titleHelp=document.createElement('span');
 titleRow.className='storyboard-title-row';storyboardTitle.before(titleRow);titleRow.append(storyboardTitle,titleHelp);titleHelp.id='storyboard-title-help';titleHelp.textContent='This is the title of the storyboard/version you are viewing in the library. The song name appears above it. Labels such as “source manifest gallery” describe how this version was imported; they are not part of the song title.';window.compactInfo(titleHelp,'About this storyboard title','info');
 const audit=document.getElementById('source-audit'),sourceButton=document.getElementById('source-audit-toggle');
 sourceButton.onclick=()=>{audit.open=!audit.open};audit.addEventListener('toggle',()=>sourceButton.setAttribute('aria-expanded',String(audit.open)));
 const actions=document.querySelector('.header-actions'),advanced=document.createElement('div'),advancedButton=document.createElement('button'),advancedPanel=document.createElement('div');
 advanced.className='advanced-controls';advancedButton.type='button';advancedButton.className='advanced-toggle';advancedButton.textContent='Advanced';advancedButton.setAttribute('aria-expanded','false');advancedButton.setAttribute('aria-controls','storyboard-advanced-panel');
 advancedPanel.id='storyboard-advanced-panel';advancedPanel.className='advanced-panel';advancedPanel.hidden=true;advancedPanel.setAttribute('role','region');advancedPanel.setAttribute('aria-label','Advanced storyboard controls');
 actions.before(advanced);advanced.append(advancedButton,advancedPanel);advancedPanel.append(actions,audit);
 const headerTools=document.createElement('div'),description=document.getElementById('description');headerTools.className='header-review-tools';description.before(headerTools);headerTools.append(description,advanced);
 function setAdvanced(open){advancedPanel.hidden=!open;advancedButton.setAttribute('aria-expanded',String(open));}
 advancedButton.onclick=()=>setAdvanced(advancedPanel.hidden);
 document.addEventListener('click',event=>{if(!advanced.contains(event.target))setAdvanced(false);});
 advanced.addEventListener('keydown',event=>{if(event.key==='Escape'&&!advancedPanel.hidden){event.stopPropagation();setAdvanced(false);advancedButton.focus({preventScroll:true});}});

 const toggle=document.getElementById('feedback-toggle');toggle.innerHTML=svg('chat');
 document.getElementById('save').innerHTML=svg('save');
 const feedbackBody=document.getElementById('feedback-body'),feedbackSheet=document.createElement('dialog');
 feedbackSheet.id='feedback-sheet';feedbackSheet.className='feedback-sheet';feedbackSheet.setAttribute('aria-labelledby','feedback-heading');
 const feedbackHeading=feedbackBody.querySelector('h2');feedbackHeading.id='feedback-heading';
 const feedbackHeader=document.createElement('div');feedbackHeader.className='feedback-sheet-heading';
 const feedbackClose=document.createElement('button');feedbackClose.type='button';feedbackClose.className='review-icon';feedbackClose.textContent='×';feedbackClose.setAttribute('aria-label','Close feedback');
 feedbackHeader.append(feedbackHeading,feedbackClose);feedbackSheet.append(feedbackHeader,feedbackBody);document.body.append(feedbackSheet);
 toggle.setAttribute('aria-controls',feedbackSheet.id);toggle.setAttribute('aria-haspopup','dialog');
 window.setFeedbackOpen=open=>{
  if(open){feedbackBody.hidden=false;if(!feedbackSheet.open)feedbackSheet.showModal();toggle.setAttribute('aria-expanded','true');}
  else if(feedbackSheet.open)feedbackSheet.close();
 };
 feedbackClose.onclick=()=>window.setFeedbackOpen(false);
 feedbackSheet.addEventListener('close',()=>{if(feedbackSheet.open)return;feedbackBody.hidden=true;toggle.setAttribute('aria-expanded','false');feedbackSheet.querySelectorAll('.info-control.hint-open').forEach(closeInfo);});
 feedbackSheet.addEventListener('click',event=>{if(event.target!==feedbackSheet)return;const r=feedbackSheet.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)feedbackSheet.close();});
 toggle.onclick=()=>window.setFeedbackOpen(!feedbackSheet.open);
 window.compactInfo(document.getElementById('autosave-info'),'About autosave','info');
 const book=window.compactInfo(document.getElementById('shot-status'),'Image status','book');
 const title=document.getElementById('shot-title'),heading=document.createElement('div');heading.className='shot-heading';title.before(heading);heading.append(title,book);title.setAttribute('aria-label','Current shot description');
 const prompt=document.getElementById('prompt'),old=prompt.parentElement,panel=document.createElement('div');
 panel.id='source-prompt-panel';panel.hidden=true;panel.className='source-prompt-panel';old.replaceWith(panel);panel.append(prompt);
 const brain=document.createElement('button');brain.id='source-prompt-toggle';brain.type='button';brain.className='review-icon';brain.innerHTML=svg('brain');brain.title='Source prompt';brain.setAttribute('aria-label','Source prompt');brain.setAttribute('aria-expanded','false');brain.setAttribute('aria-controls',panel.id);heading.append(brain);
 brain.onclick=()=>{panel.hidden=!panel.hidden;brain.setAttribute('aria-expanded',String(!panel.hidden))};
})();
