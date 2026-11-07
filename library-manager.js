/* The app owns library navigation. Every open page retains a fixed library URL. */
(()=>{
 if(location.protocol === 'file:') return;
 const context=window.DESKContext,host=document.getElementById('librarySwitcher'),cards=document.getElementById('libraryCards');
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let list=[],appToken=null;
 const status=document.getElementById('libraryStatus')||document.createElement('p');
 if(host){status.className='library-switch-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');}
 const dialog=document.createElement('dialog');dialog.id='libraryDialog';dialog.setAttribute('aria-labelledby','libraryDialogTitle');document.body.append(dialog);
 function renderLibraryMenu(){
  if(!host||!context)return;
  const libraries=list.length?list:[{id:context.id,name:context.name,url:context.base}];
  host.innerHTML=`<details id="libraryMenu" class="library-menu"><summary aria-label="Libraries" title="Libraries · ${escape(context.name)}" aria-controls="libraryMenuPanel"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3-1 4 15-3 1zM4 8h4M10 8h4"/></svg></summary><div id="libraryMenuPanel" class="library-menu-panel"><p class="library-menu-caption">CURRENT LIBRARY</p><p class="library-menu-current">${escape(context.name)}</p>${context.linked_media?'<p class="library-linked-note">Original images are linked read-only. New images and edits save in this library.</p>':''}<nav class="library-menu-list" aria-label="Switch library">${libraries.map(l=>`<a href="${l.url}" data-library-id="${l.id}" ${l.id===context.id?'aria-current="page"':''}><span>${escape(l.name)}</span>${l.id===context.id?'<span class="library-menu-check" aria-hidden="true">✓</span>':''}</a>`).join('')}</nav><div class="library-menu-actions"><button type="button" data-create-library><span aria-hidden="true">＋</span> Create new library</button><a href="/" id="allLibraries">All libraries <span aria-hidden="true">→</span></a></div></div></details>`;
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
   cards.innerHTML=list.map(l=>`<article class="library-card"><div class="library-card-top"><span class="library-card-icon" aria-hidden="true">▤</span>${last===l.id?'<span class="library-recent">Last opened</span>':''}</div><h2>${escape(l.name)}</h2>${l.linked_media?`<p class="library-linked-note">${l.linked_source_available?'Original images linked · read-only':'Original image folder unavailable. Restore its location to view linked images.'}</p>`:''}<dl><div><dt>Characters</dt><dd>${l.characters}</dd></div><div><dt>Locations</dt><dd>${l.locations}</dd></div><div><dt>Images</dt><dd>${l.images}</dd></div></dl><a class="library-open" href="${l.url}">Open library <span aria-hidden="true">→</span></a></article>`).join('');
  }
  status.textContent='';
 }
 async function readyToLeave(){
  const autosave=window.DESKAutosave;if(!autosave)return;
  if(autosave.state().dirty||autosave.state().inflight){status.textContent='Saving your current library…';await autosave.flush();}
  if(autosave.state().dirty||autosave.state().inflight||autosave.state().conflicted)throw Error('Finish saving or resolve the review conflict before switching libraries. Your current library is still open.');
 }
 async function navigate(url){
  if(url!=='/'&&!/^\/libraries\/[a-f0-9]{32}\/$/.test(url||''))throw Error('Choose an available library.');
  await readyToLeave();window.location.assign(url);
 }
 function createDialog(){
  const menu=document.getElementById('libraryMenu');if(menu)menu.open=false;
  dialog.innerHTML=`<form id="newLibraryForm"><div class="library-dialog-heading"><h2 id="libraryDialogTitle">Create new library</h2><button type="button" data-library-cancel aria-label="Close create library">×</button></div><p>Start with an empty library for a new project. Its characters, references, and saved decisions stay together.</p><label for="newLibraryName">Library name<input id="newLibraryName" name="name" required maxlength="100" placeholder="e.g. Snowshoe Thompson" autocomplete="off"></label><p id="newLibraryStatus" class="library-form-status" role="status" aria-live="polite"></p><div class="library-dialog-actions"><button type="button" data-library-cancel>Cancel</button><button type="submit" class="library-primary">Create library</button></div></form>`;
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
 document.addEventListener('click',event=>{if(event.target.closest('[data-create-library]'))createDialog();});
 load().catch(error=>{status.textContent=error.message;const menu=document.getElementById('libraryMenu');if(menu)menu.open=true;});
})();
