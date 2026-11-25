/* The app owns library navigation. Every open page retains a fixed library URL. */
(()=>{
 if(location.protocol === 'file:') return;
 const context=window.DESKContext,host=document.getElementById('librarySwitcher'),cards=document.getElementById('libraryCards');
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let list=[],appToken=null;
 const headerActions=document.querySelector('.desk-header>.topactions');
 if(headerActions&&context){
  const crescendo=document.createElement('a');crescendo.className='header-crescendo';crescendo.href=context.base+'crescendo.html';
  crescendo.setAttribute('aria-label','Crescendo song analyzer');crescendo.title='Crescendo · Song analyzer';
  crescendo.innerHTML='<span aria-hidden="true">♫</span><span>Crescendo</span>';
  crescendo.onclick=event=>{event.preventDefault();navigate(crescendo.getAttribute('href')).catch(error=>alert(error.message));};
  headerActions.prepend(crescendo);
  const storyboard=document.createElement('a');storyboard.className='header-crescendo header-storyboard';storyboard.href=context.base+'storyboard.html';
  storyboard.setAttribute('aria-label','Storyboard Command Center');storyboard.title='Storyboard Command Center';
  storyboard.innerHTML='<span aria-hidden="true">▦</span><span>Storyboards</span>';
  storyboard.onclick=event=>{event.preventDefault();navigate(storyboard.getAttribute('href')).catch(error=>alert(error.message));};
  headerActions.prepend(storyboard);
  const outreach=document.createElement('a');outreach.className='header-outreach';outreach.href=context.base+'outreach.html';
  outreach.setAttribute('aria-label','Theater outreach');outreach.title='Theater outreach';
  outreach.innerHTML='<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 4h18v15H3zM2 21h20M3 7h18M9 7c0 5-2 7-6 8M15 7c0 5 2 7 6 8M6 14v5M18 14v5"/></svg>';
  outreach.onclick=event=>{event.preventDefault();navigate(outreach.getAttribute('href')).catch(error=>alert(error.message));};
  headerActions.prepend(outreach);
 }
 const status=document.getElementById('libraryStatus')||document.createElement('p');
 if(host){status.className='library-switch-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');}
 const photoIcon='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4H4a2 2 0 0 0-2 2v14h18V10M2 17l5-5 4 4 3-3 6 6M19 2v6M16 5h6"/><circle cx="7" cy="8" r="1"/></svg>';
 const coverDialog=document.createElement('dialog');coverDialog.id='libraryCoverDialog';coverDialog.setAttribute('aria-labelledby','coverDialogTitle');document.body.append(coverDialog);
 if(context){
  const view=new URLSearchParams(location.search).get('view');
  const target={characters:'charactersTab',locations:'locationsTab',generation:'generationTab'}[view];
  if(target)document.getElementById(target)?.click();
 }
 const dialog=document.createElement('dialog');dialog.id='libraryDialog';dialog.setAttribute('aria-labelledby','libraryDialogTitle');document.body.append(dialog);
 function renderLibraryMenu(){
  if(!host||!context)return;
  const libraries=list.length?list:[{id:context.id,name:context.name,url:context.base}];
  host.innerHTML=`<details id="libraryMenu" class="library-menu"><summary aria-label="Libraries" title="Libraries · ${escape(context.name)}" aria-controls="libraryMenuPanel"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3-1 4 15-3 1zM4 8h4M10 8h4"/></svg></summary><div id="libraryMenuPanel" class="library-menu-panel"><p class="library-menu-caption">CURRENT LIBRARY</p><p class="library-menu-current">${escape(context.name)}</p>${context.linked_media?'<p class="library-linked-note">Original images are linked read-only. New images and edits save in this library.</p>':''}<nav class="library-menu-list" aria-label="Switch library">${libraries.map(l=>`<a href="${l.url}" data-library-id="${l.id}" ${l.id===context.id?'aria-current="page"':''}><span>${escape(l.name)}</span>${l.id===context.id?'<span class="library-menu-check" aria-hidden="true">✓</span>':''}</a>`).join('')}</nav><div class="library-menu-actions"><button type="button" data-create-library><span aria-hidden="true">＋</span> Create new library</button><a href="/" id="allLibraries">All libraries <span aria-hidden="true">→</span></a></div></div></details>`;
  const outreach=document.createElement('a');outreach.href=context.base+'outreach.html';outreach.textContent='Theater outreach ↗';
  host.querySelector('.library-menu-actions').prepend(outreach);
  const songLink=document.createElement('a');songLink.href=context.base+'crescendo.html';songLink.textContent='Crescendo song analyzer ↗';
  host.querySelector('.library-menu-actions').prepend(songLink);
  const boardLink=document.createElement('a');boardLink.href=context.base+'storyboard.html';boardLink.textContent='Storyboard Command Center ↗';host.querySelector('.library-menu-actions').prepend(boardLink);
  host.querySelector('.library-menu-panel').append(status);
  const menu=host.querySelector('details');
  menu.addEventListener('toggle',()=>{if(menu.open){const settings=document.getElementById('deskTools');if(settings)settings.open=false;}});
  for(const link of host.querySelectorAll('a'))link.onclick=async event=>{
   event.preventDefault();
   if(link.dataset.libraryId===context.id){menu.open=false;return;}
   try{await navigate(link.getAttribute('href'));}catch(error){status.textContent=error.message;}
  };
 }
 renderLibraryMenu();
 document.addEventListener('click',event=>{
  const menu=document.getElementById('libraryMenu');
  if(menu?.open&&!menu.contains(event.target))menu.open=false;
 });
 document.addEventListener('keydown',event=>{
  const menu=document.getElementById('libraryMenu');
  if(event.key==='Escape'&&menu?.open){menu.open=false;menu.querySelector('summary').focus();event.preventDefault();}
 });
 async function load(){
  const response=await fetch('/api/libraries',{cache:'no-store'}),result=await response.json();
  if(!response.ok)throw Error(result.error||'Libraries could not be loaded.');
  list=result.libraries;appToken=result.csrf_token;
  if(context){
   try{window.localStorage.setItem('reference-desk-last-library',context.id);}catch{}
   renderLibraryMenu();
  }
  if(cards){
   let last=null;try{last=window.localStorage.getItem('reference-desk-last-library');}catch{}
   cards.innerHTML=list.map(l=>`<article class="library-card" data-library-card="${l.id}"><div class="library-cover"><a class="library-cover-open" href="${l.url}" aria-label="Open ${escape(l.name)}">${l.cover?.url?`<img src="${escape(l.cover.url)}" alt="" loading="lazy">`:'<span class="library-cover-empty" aria-hidden="true">'+photoIcon+'<span>No cover photo yet</span></span>'}</a><button type="button" class="library-cover-edit" data-cover-library="${l.id}" aria-label="${l.cover?.url?'Change cover photo for':'Add cover photo to'} ${escape(l.name)}" title="${l.cover?.url?'Change or remove cover photo':'Add cover photo'}">${photoIcon}</button>${last===l.id?'<span class="library-recent">Last opened</span>':''}</div><h2><a href="${l.url}">${escape(l.name)}</a></h2>${l.linked_media?`<p class="library-linked-note">${l.linked_source_available?'Original images linked · read-only':'Original image folder unavailable. Restore its location to view linked images.'}</p>`:''}<dl><div><dt>Characters</dt><dd><a href="${l.url}?view=characters" aria-label="${l.characters} characters · Open Characters in ${escape(l.name)}">${l.characters}<span>Characters →</span></a></dd></div><div><dt>Locations</dt><dd><a href="${l.url}?view=locations" aria-label="${l.locations} locations · Open Locations in ${escape(l.name)}">${l.locations}<span>Locations →</span></a></dd></div><div><dt>Images</dt><dd><a href="${l.url}?view=generation" aria-label="${l.images} images · Open Image Generation in ${escape(l.name)}" title="Open Image Generation">${l.images}<span>Images →</span></a></dd></div></dl><a class="library-open" href="${l.url}">Open library <span aria-hidden="true">→</span></a></article>`).join('');
  }
  if(cards)cards.querySelectorAll('.library-card').forEach((card,index)=>{
   const link=document.createElement('a');link.href=list[index].url+'outreach.html';link.className='library-outreach';link.textContent='Theater outreach ↗';card.append(link);const song=document.createElement('a');song.href=list[index].url+'crescendo.html';song.className='library-outreach';song.textContent='♫ Crescendo song analyzer ↗';card.append(song);const board=document.createElement('a');board.href=list[index].url+'storyboard.html';board.className='library-outreach';board.textContent='▦ Storyboard Command Center ↗';card.append(board);
  });
  status.textContent='';
 }
 async function readyToLeave(){
  const autosave=window.DESKAutosave;if(!autosave)return;
  if(autosave.state().dirty||autosave.state().inflight){status.textContent='Saving your current library…';await autosave.flush();}
  if(autosave.state().dirty||autosave.state().inflight||autosave.state().conflicted)throw Error('Finish saving or resolve the review conflict before switching libraries. Your current library is still open.');
 }
 async function navigate(url){
  if(url!=='/'&&!/^\/libraries\/[a-f0-9]{32}\/((outreach|crescendo|storyboard)\.html)?$/.test(url||''))throw Error('Choose an available library.');
  await readyToLeave();window.location.assign(url);
 }
 function createDialog(){
  const menu=document.getElementById('libraryMenu');if(menu)menu.open=false;
  dialog.innerHTML=`<form id="newLibraryForm"><div class="library-dialog-heading"><h2 id="libraryDialogTitle">Create new library</h2><button type="button" data-library-cancel aria-label="Close create library">×</button></div><p>Start with an empty library for a new project. Its characters, references, and saved decisions stay together.</p><label for="newLibraryName">Library name<input id="newLibraryName" name="name" required maxlength="100" placeholder="e.g. The Last Light" autocomplete="off"></label><p id="newLibraryStatus" class="library-form-status" role="status" aria-live="polite"></p><div class="library-dialog-actions"><button type="button" data-library-cancel>Cancel</button><button type="submit" class="library-primary">Create library</button></div></form>`;
  let requestId=crypto.randomUUID(),previousName=null,busy=false;
  const form=dialog.querySelector('form'),input=dialog.querySelector('input'),message=dialog.querySelector('[role=status]'),submit=form.querySelector('[type=submit]');
  for(const b of dialog.querySelectorAll('[data-library-cancel]'))b.onclick=()=>{if(!busy)dialog.close();};
  dialog.oncancel=event=>{if(busy)event.preventDefault();};
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||!form.reportValidity())return;
   const name=input.value.trim();if(!name){message.textContent='Enter a library name.';return;}
   if(previousName!==null&&previousName!==name)requestId=crypto.randomUUID();previousName=name;
   busy=true;submit.disabled=true;input.disabled=true;message.textContent='Creating library…';
   try{
    await readyToLeave();
    // Refresh the application token in case the server was restarted while this page was open.
    const config=await fetch('/api/libraries',{cache:'no-store'});if(!config.ok)throw Error('Library service unavailable.');appToken=(await config.json()).csrf_token;
    const response=await fetch('/api/libraries',{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':appToken},body:JSON.stringify({name,request_id:requestId})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not create library.');
    await navigate(result.library.url);
   }catch(error){message.textContent=error.message;busy=false;submit.disabled=false;input.disabled=false;}
  };
  dialog.showModal();input.focus();
 }
 function editCover(id){
  const library=list.find(l=>l.id===id);if(!library)return;
  let upload=null,busy=false;
  const original=library.cover||{revision:null,url:null};
  coverDialog.innerHTML=`<div class="library-dialog-heading"><h2 id="coverDialogTitle">Cover photo</h2><button type="button" data-cover-close aria-label="Close cover photo">×</button></div><p class="library-cover-name">${escape(library.name)}</p><div class="library-cover-preview">${original.url?`<img src="${escape(original.url)}" alt="Current cover photo">`:'<span>No cover photo yet</span>'}</div><p class="library-cover-help">PNG, JPEG, or WebP · Up to 12 MB. Photos fill a horizontal 16:9 frame.</p><input type="file" id="coverFile" accept="image/png,image/jpeg,image/webp" hidden><p class="library-form-status" role="status" aria-live="polite"></p><div class="library-cover-actions"><button type="button" data-cover-choose>${photoIcon} ${original.url?'Change photo':'Choose photo'}</button>${original.url?'<button type="button" class="library-cover-remove" data-cover-remove>Remove photo</button>':''}</div><div class="library-dialog-actions"><button type="button" data-cover-close>Cancel</button><button type="button" class="library-primary" data-cover-save disabled>Save cover</button></div>`;
  const input=coverDialog.querySelector('input'),preview=coverDialog.querySelector('.library-cover-preview'),feedback=coverDialog.querySelector('[role=status]'),saveButton=coverDialog.querySelector('[data-cover-save]');
  const lock=value=>{busy=value;for(const b of coverDialog.querySelectorAll('button'))b.disabled=value;saveButton.disabled=value||!upload;};
  const close=()=>{if(!busy){coverDialog.close();cards.querySelector(`[data-cover-library="${id}"]`)?.focus();}};
  coverDialog.oncancel=event=>{if(busy)event.preventDefault();};
  for(const b of coverDialog.querySelectorAll('[data-cover-close]'))b.onclick=close;
  coverDialog.querySelector('[data-cover-choose]').onclick=()=>input.click();
  input.onchange=async()=>{
   const file=input.files[0];if(!file)return;
   input.value='';feedback.textContent='';
   if(file.size>12*1024*1024){feedback.textContent='Choose an image smaller than 12 MB.';return;}
   if(!['image/png','image/jpeg','image/webp'].includes(file.type)){feedback.textContent='Choose a PNG, JPEG, or WebP image.';return;}
   lock(true);
   try{
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read this image.'));reader.readAsDataURL(file);});
    const image=new Image();image.alt='New cover photo preview';image.src=data;await image.decode();
    if(image.naturalWidth*image.naturalHeight>40000000)throw Error('Choose a photo up to 40 megapixels.');
    upload={data:data.split(',')[1]};preview.replaceChildren(image);feedback.textContent='Preview ready. Save cover to apply it.';
   }catch(error){feedback.textContent=error.message;}finally{lock(false);}
  };
  async function saveCover(action){
   if(busy)return;lock(true);feedback.textContent=action==='remove'?'Removing cover…':'Saving cover…';
   try{
    const config=await fetch('/api/libraries',{cache:'no-store'});if(!config.ok)throw Error('Library service unavailable.');appToken=(await config.json()).csrf_token;
    const response=await fetch('/api/libraries/'+id+'/cover',{method:'POST',headers:{'Content-Type':'application/json','X-DESK-CSRF':appToken},body:JSON.stringify({action,base_revision:original.revision,upload:action==='set'?upload:undefined})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save the cover.');
    library.cover=result.cover;await load();lock(false);close();
   }catch(error){feedback.textContent=error.message;lock(false);if(error.message.includes('another window'))load().catch(()=>{});}
  }
  saveButton.onclick=()=>saveCover('set');
  coverDialog.querySelector('[data-cover-remove]')?.addEventListener('click',()=>saveCover('remove'));
  coverDialog.showModal();coverDialog.querySelector('[data-cover-choose]').focus();
 }
 document.addEventListener('click',event=>{if(event.target.closest('[data-create-library]'))createDialog();const cover=event.target.closest('[data-cover-library]');if(cover)editCover(cover.dataset.coverLibrary);});
 window.addEventListener('focus',()=>{if(cards&&!coverDialog.open&&!dialog.open)load().catch(error=>{status.textContent=error.message;});});
 load().catch(error=>{status.textContent=error.message;const menu=document.getElementById('libraryMenu');if(menu)menu.open=true;});
})();
