/* Import candidates without touching shot assignments or reloading unsaved work. */
window.initLibraryImageAdd=function({id,host,actions,onAdded}){
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const media=p=>'/files'+encodeURI(p).replace(/#/g,'%23').replace(/\?/g,'%3F');
 const button=document.createElement('button');button.id='library-add-image';button.type='button';button.className='review-icon';button.title='Add image';button.setAttribute('aria-label','Add image');button.setAttribute('aria-haspopup','dialog');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8M16 5h6m-3-3v6M3 16l5-5 8 10m-3-7 3-3 5 5"/><circle cx="8" cy="7" r="1"/></svg>';actions.prepend(button);
 const sheet=document.createElement('dialog');sheet.id='library-add-sheet';sheet.setAttribute('aria-labelledby','library-add-title');sheet.innerHTML=`<div class="library-add-heading"><h2 id="library-add-title">Add image</h2><button type="button" id="library-add-close" aria-label="Close add image">×</button></div><p class="small">Add to this storyboard’s image set, then choose where to use it.</p><div class="library-add-sources" role="group" aria-label="Image source"><button type="button" id="library-add-computer" aria-pressed="true">From computer</button><button type="button" id="library-add-desk" aria-pressed="false">Reference Desk</button></div><section id="library-add-upload"><label>Image file<input id="library-add-file" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="small">PNG, JPEG or WebP · up to 20 MB</p><img id="library-add-preview" alt="Selected image preview" hidden><label>Title<input id="library-add-name" maxlength="500"></label><label>Tags<input id="library-add-tags" placeholder="Separate tags with commas"></label><button type="button" id="library-add-submit" disabled>Add to image set</button></section><section id="library-add-reference" hidden><label>Search Reference Desk<input type="search" id="library-add-search" placeholder="Title, character or tag"></label><p id="library-add-count" class="small"></p><div id="library-add-results"></div><button type="button" id="library-add-more" hidden>Load more</button></section><p id="library-add-status" role="status" aria-live="polite"></p>`;host.append(sheet);
 const $=name=>sheet.querySelector('#library-add-'+name);
 let source='computer',file=null,previewURL=null,deskRows=[],nextOffset=null,query='',generation=0,controller=null,timer,busy=false;
 const added=new Set();
 const status=s=>{$('status').textContent=s};
 function lock(value){busy=value;$('submit').disabled=value||!file;$('file').disabled=value;$('computer').disabled=value;$('desk').disabled=value;sheet.querySelectorAll('[data-import-desk]').forEach(b=>{b.disabled=value||added.has(b.dataset.importDesk)})}
 function mode(value){source=value;$('upload').hidden=value!=='computer';$('reference').hidden=value!=='desk';$('computer').setAttribute('aria-pressed',String(value==='computer'));$('desk').setAttribute('aria-pressed',String(value==='desk'));status('');if(value==='desk')loadDesk(false);}
 function renderDesk(){
  $('results').innerHTML=deskRows.map(a=>`<article><img loading="lazy" src="${esc(media(a.thumbnail||a.image))}" alt="${esc(a.title)}"><h3>${esc(a.title)}</h3><button type="button" data-import-desk="${esc(a.id)}" ${added.has(a.id)||busy?'disabled':''}>${added.has(a.id)?'In image set':'Add to image set'}</button></article>`).join('')||'<p>No images match this search.</p>';
  $('more').hidden=nextOffset===null;
 }
 async function loadDesk(more){
  const request=++generation;controller?.abort();controller=new AbortController();status('Loading Reference Desk…');$('more').disabled=true;
  try{
   const r=await fetch('/library-api/image-import-options?'+new URLSearchParams({id,q:query,offset:more?nextOffset||0:0}),{cache:'no-store',signal:controller.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not load Reference Desk.');if(request!==generation)return;
   deskRows=more?[...deskRows,...d.assets]:d.assets;d.assets.filter(a=>a.added).forEach(a=>added.add(a.id));nextOffset=d.next_offset;renderDesk();$('count').textContent=`${deskRows.length} of ${d.total} images`;status(d.total?'':'Try a different title, character or tag.');
  }catch(e){if(e.name!=='AbortError'&&request===generation)status('Could not load Reference Desk: '+e.message)}finally{if(request===generation)$('more').disabled=false;}
 }
 async function send(payload){
  lock(true);status('Adding image…');
  try{
   const fresh=await fetch('/library-api/arrangement?id='+id,{cache:'no-store'});const session=await fresh.json();if(!fresh.ok)throw Error(session.error||'Could not connect.');
   const r=await fetch('/library-api/image-import',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':session.csrf_token},body:JSON.stringify({id,...payload})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not add image.');
   onAdded(d.asset);if(payload.desk_asset_id){added.add(payload.desk_asset_id);renderDesk()}
   status(d.created?'Added to this storyboard’s image set.':'This image is already in the image set.');
  }catch(e){status('Could not add image: '+e.message)}finally{lock(false)}
 }
 button.onclick=()=>{sheet.showModal();$('close').focus()};$('close').onclick=()=>sheet.close();sheet.addEventListener('cancel',e=>{if(busy){e.preventDefault();status('Finishing the image addition…')}});sheet.addEventListener('close',()=>button.focus());
 $('computer').onclick=()=>mode('computer');$('desk').onclick=()=>mode('desk');
 $('search').oninput=e=>{query=e.target.value.trim();clearTimeout(timer);controller?.abort();generation++;timer=setTimeout(()=>loadDesk(false),250)};$('more').onclick=()=>loadDesk(true);
 $('results').onclick=e=>{const b=e.target.closest('[data-import-desk]');if(b&&!busy)send({desk_asset_id:b.dataset.importDesk})};
 $('file').onchange=()=>{
  file=$('file').files[0]||null;if(previewURL)URL.revokeObjectURL(previewURL);$('preview').hidden=true;status('');
  if(file&&(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)){status('Choose a PNG, JPEG or WebP image, 20 MB or smaller.');file=null;}
  if(file){previewURL=URL.createObjectURL(file);$('preview').src=previewURL;$('preview').hidden=false;$('name').value=file.name.replace(/\.[^.]+$/,'');}
  $('submit').disabled=!file;
 };
 $('submit').onclick=async()=>{
  if(!file||busy)return;lock(true);status('Reading image…');const selected=file;
  try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('The file could not be read.'));reader.readAsDataURL(selected)});await send({title:$('name').value.trim(),tags:$('tags').value.split(',').map(s=>s.trim()).filter(Boolean),upload:{name:selected.name,data:encoded}})}catch(e){status(e.message);lock(false)}
 };
};
