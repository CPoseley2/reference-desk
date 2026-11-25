/* Browsing preferences never write storyboard assignments. */
window.storyboardLibraryRows=function(catalog,slots,related,usage){
 return catalog.map((a,index)=>{
  const peers=related.filter(r=>r.id===a.id||(r.equivalent_ids||[]).includes(a.id)||(a.image&&r.image===a.image)||(a.desk_asset_id&&a.desk_asset_id===(r.desk_id||r.id)));
  const tags=[...new Set(peers.length?peers.flatMap(r=>r.tags||[]):(a.tags||[]))];
  const used=usage(a.id),ids=new Set([a.id,...peers.flatMap(r=>[r.id,...(r.equivalent_ids||[])])]);
  const shotIds=slots.filter((s,i)=>used.includes(i+1)||(s.recommended||[]).some(id=>ids.has(id))||new RegExp('\\b'+s.id+'\\b','i').test(a.title)).map(s=>s.id);
  const text=[a.title,a.version,...tags,...peers.flatMap(r=>[r.title,...(r.location_names||[])]),...slots.filter(s=>shotIds.includes(s.id)).map(s=>s.title)].join(' ').toLowerCase();
  return {a,index,tags,used,shotIds,text};
 });
};
window.filterStoryboardLibrary=function(rows,p){
 const terms=(p.query||'').toLowerCase().trim().split(/\s+/).filter(Boolean);
 const result=rows.filter(r=>(p.usage==='all'||(p.usage==='used')===!!r.used.length)&&(!p.shot||r.shotIds.includes(p.shot))&&(!p.version||r.a.version===p.version)&&(!p.tag||r.tags.some(t=>t.toLowerCase()===p.tag.toLowerCase()))&&terms.every(t=>r.text.includes(t)));
 return result.sort((a,b)=>p.sort==='recent'?b.index-a.index:p.sort==='title'?a.a.title.localeCompare(b.a.title,undefined,{numeric:true}):p.sort==='used'?b.used.length-a.used.length||a.index-b.index:(a.shotIds[0]||'ZZZ').localeCompare(b.shotIds[0]||'ZZZ',undefined,{numeric:true})||a.index-b.index);
};
/* Shot assignments are independent of generated source data and review notes. */
window.initStoryboardEditor=async function(){
 if(!V?.shots?.length){const notice=document.createElement('p');notice.textContent='This historical source has no indexed shot slots. Open its original layout above; there are no recovered shots to arrange.';$('shots').before(notice);return;}
 const heading=$('shots').previousElementSibling;
 heading.textContent='Shot arrangement';
 const host=document.createElement('section');host.id='arrangement-editor';document.querySelector('.viewer').after(host);$('shots').hidden=true;heading.hidden=true;
 host.innerHTML='<p id="arrange-status" role="status">Loading shot arrangement…</p>';
 try{
 const [cr,sr]=await Promise.all([fetch('image-libraries/'+id+'.json',{cache:'no-store'}),fetch('/library-api/arrangement?id='+id,{cache:'no-store'})]);
 if(!cr.ok||!sr.ok)throw Error('Could not load saved arrangement');
 const catalog=await cr.json(),saved=await sr.json();
 await window.initBeatEdit?.(V,catalog);
 if(catalog.structure?.enabled)window.applyShotStructureToView?.(V,catalog);
 const original=V.shots.map(s=>({...s,id:String(s.id)}));
 let relatedResult=true?await fetch('/library-api/related-images?id='+id+'&scope=all',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()}).catch(()=>({assets:[],error:'Reference Desk is unavailable. Reload to try again.'})):{assets:[]};
 let related=relatedResult.assets||[];
 const assets=new Map([...catalog.assets,...(saved.related_assets||[]),...related].map(a=>[a.id,a])),slots=catalog.slots,storageKey='owl-arrangement-draft-'+id;
 let assignments={...saved.assignments},revision=saved.revision,csrf=saved.csrf_token,selected=null,undo=[],busy=false,dirty=false,conflict=false,saveTimer,drag=null,filter='all',query='',relatedQuery='',relatedMatch='all',relatedState='active',relatedScope='related',relatedSort='newest',refreshingRelated=false;
 const browseKey='owl-library-browse-'+id;
 let browse={query:'',usage:'all',shot:'',version:'',tag:'',sort:'shot',display:'compact',details:true};
 try{const p=JSON.parse(localStorage.getItem(browseKey)||'null');if(p&&typeof p==='object')Object.keys(browse).forEach(k=>{if(typeof p[k]===typeof browse[k])browse[k]=p[k]});}catch{}
 if(!['all','used','unused'].includes(browse.usage))browse.usage='all';
 if(!['shot','recent','title','used'].includes(browse.sort))browse.sort='shot';
 if(!['compact','large','list'].includes(browse.display))browse.display='compact';
 let draft;try{draft=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
 if(draft&&Object.keys(draft.assignments||{}).length===slots.length&&slots.every(s=>Object.hasOwn(draft.assignments,s.id))&&Object.values(draft.assignments).every(a=>a===null||assets.has(a))){
  if(JSON.stringify(draft.assignments)!==JSON.stringify(saved.assignments)){assignments=draft.assignments;dirty=true;conflict=true;}
 }
 host.innerHTML=`<details id="arrangement-controls" class="arrangement-controls"><summary class="review-icon" aria-label="Arrangement controls" title="Arrangement controls"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 0-9 9h9l-4-4"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="6.5" r="2"/><circle cx="6.5" cy="12" r="2"/><circle cx="17.5" cy="12" r="2"/><circle cx="12" cy="17.5" r="2"/></svg></summary><div class="arrange-bar"><p id="arrangement-help">Drag an image into a slot. Drag a filled slot to another to move or swap it. Or select an image below, then choose a slot.</p><div class="toolbar"><button id="recommend-all">Use all recommendations</button><button id="arrange-undo" disabled>Undo</button><button id="arrange-save">Save arrangement</button></div><p id="arrange-status" role="status" aria-live="polite"></p><div id="arrange-conflict" hidden><p>A browser draft differs from the saved arrangement. Nothing will be saved until you choose which version to keep.</p><button id="arrange-load">Load saved arrangement</button><button id="arrange-overwrite">Save my arrangement instead</button></div></div></details><div class="arrangement-workspace"><section class="slots-pane"><h2>Shot slots</h2><div id="slot-grid" class="slot-grid"></div></section><section id="image-library">${true?`<div class="library-tabs" role="tablist" aria-label="Image sources"><button id="library-tab-storyboard" role="tab" aria-selected="true" aria-controls="library-panel-storyboard">Storyboard images (${catalog.assets.length})</button><button id="library-tab-related" role="tab" aria-selected="false" aria-controls="library-panel-related" tabindex="-1">Reference Desk (${related.filter(a=>a.matches.length).length})</button></div>`:''}<div id="library-panel-storyboard" role="tabpanel" aria-labelledby="library-tab-storyboard"><h2>Storyboard images <span id="asset-count"></span></h2><div class="asset-browser-controls"><label class="asset-search-label">Search images<input id="asset-search" type="search" placeholder="Title, shot, tag or location"></label><div class="asset-filter-row"><label>Usage<select id="asset-filter"><option value="all">All images</option><option value="used">Used in this storyboard</option><option value="unused">Unused</option></select></label><label>Shot<select id="asset-shot"><option value="">All shots</option>${slots.map(s=>`<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.title)}</option>`).join('')}</select></label></div><details class="asset-more-filters"><summary>Tags &amp; versions</summary><div class="asset-filter-row"><label>Tag<select id="asset-tag"></select></label><label>Version<select id="asset-version"></select></label></div></details><div class="asset-filter-row"><label>Sort<select id="asset-sort"><option value="shot">Shot order</option><option value="recent">Recently added</option><option value="title">Title A–Z</option><option value="used">Most used</option></select></label><label>Display<select id="asset-display"><option value="compact">Compact grid</option><option value="large">Large thumbnails</option><option value="list">List</option></select></label></div><div class="asset-browser-footer"><label><input id="asset-details" type="checkbox"> Show version notes</label><button id="asset-reset" type="button">Clear filters</button></div></div><p id="asset-results" class="small" role="status" aria-live="polite"></p><div id="asset-grid" class="asset-grid"></div></div>${true?`<div id="library-panel-related" role="tabpanel" aria-labelledby="library-tab-related" hidden><div class="desk-library-heading"><h2>Reference Desk</h2><button id="related-refresh" title="Refresh images from Reference Desk">↻ Refresh</button></div><details class="desk-library-help"><summary aria-label="About Reference Desk images" title="About Reference Desk images">ⓘ <span>Using these images</span></summary><p>Includes linked locations, Generate Beta results, matching tags and character references. Select or drag an image into a shot slot. Preview to review or approve an image. Adding it to a slot does not change approval.</p></details><div class="asset-browser-controls desk-browser-controls"><label for="related-search">Search images<input id="related-search" type="search" placeholder="Title, tag, character or location"></label><label for="related-scope">Browse<select id="related-scope"><option value="related">Matching configured tags</option><option value="generated">All generations</option><option value="all">All Reference Desk images</option></select></label><details class="asset-more-filters" id="related-filters"><summary>Filters &amp; display <span id="related-filter-summary"></span></summary><div class="asset-filter-row"><label for="related-match">Match<select id="related-match"><option value="all">Any match</option></select></label><label for="related-state">Show<select id="related-state"><option value="active">Active images</option><option value="all">Include obsolete</option><option value="obsolete">Obsolete only</option></select></label><label for="related-sort">Sort<select id="related-sort"><option value="newest">Newest added first</option><option value="title">Title A–Z</option></select></label><label for="related-display">Display<select id="related-display"><option value="compact">Compact grid</option><option value="large">Large thumbnails</option><option value="list">List</option></select></label></div><button id="related-reset" type="button">Reset filters</button></details></div><p id="related-count" role="status"></p><div id="related-grid" class="asset-grid" data-display="compact"></div></div>`:''}</section></div><dialog id="related-preview"><button id="related-preview-close">Close preview ×</button><h2 id="related-preview-title"></h2><section id="preview-image-approval" class="storyboard-image-approval"></section><img id="related-preview-image" alt=""><p id="related-preview-caption"></p><button id="related-preview-select">Select for a shot slot</button><a id="shot-revise" class="button" target="_blank" rel="noopener" hidden>Revise image</a><p id="shot-revise-status" role="status"></p></dialog><dialog id="image-info-dialog" aria-labelledby="image-info-heading"><div class="image-info-heading"><h2 id="image-info-heading">Image info</h2><button id="image-info-close" type="button">Close ×</button></div><div id="image-info-content"></div></dialog>`;

 const libraryPanel=$('library-panel-storyboard'),libraryHeading=libraryPanel.querySelector('h2'),filterPanel=libraryPanel.querySelector('.asset-browser-controls'),filterHeading=document.createElement('div'),filterButton=document.createElement('button');
 filterHeading.className='library-filter-heading';libraryHeading.before(filterHeading);filterHeading.append(libraryHeading,filterButton);filterPanel.id='storyboard-library-filters';filterPanel.hidden=true;
 filterButton.id='library-filter-toggle';filterButton.type='button';filterButton.className='review-icon';filterButton.title='Filters';filterButton.setAttribute('aria-label','Filters');filterButton.setAttribute('aria-expanded','false');filterButton.setAttribute('aria-controls',filterPanel.id);filterButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/></svg>';
 filterButton.onclick=()=>{filterPanel.hidden=!filterPanel.hidden;filterButton.setAttribute('aria-expanded',String(!filterPanel.hidden))};
 const filterActions=document.createElement('div'),clearFilters=$('asset-reset');filterActions.className='library-filter-actions';filterHeading.append(filterActions);filterActions.append(filterButton,clearFilters);clearFilters.className='review-icon';clearFilters.title='Clear all filters';clearFilters.setAttribute('aria-label','Clear all filters');clearFilters.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m16 3 5 5a2 2 0 0 1 0 3L11 21H6l-4-4a2 2 0 0 1 0-3L13 3a2 2 0 0 1 3 0Z"/><path d="m7 9 8 8M10 21h12"/></svg>';
 const assetInfo=window.compactInfo($('asset-results'),'Storyboard image counts','info');filterActions.append(assetInfo);
 const assetInfoButton=assetInfo.querySelector('button');
 const arrangement=$('arrangement-controls'),reel=document.createElement('button');
 reel.id='arrangement-toggle';reel.type='button';reel.className='review-icon';reel.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="6" height="6" rx="1"/><rect x="15" y="14" width="6" height="6" rx="1"/><path d="M13 7h8m-3-3 3 3-3 3M11 17H3m3-3-3 3 3 3"/></svg>';reel.setAttribute('aria-label','Arrangement tools');reel.setAttribute('aria-expanded','false');reel.setAttribute('aria-controls','arrangement-controls');
 const nav=$('prev').parentElement;
 if(nav.parentElement.classList.contains('playback-tools'))nav.before(reel);else nav.prepend(reel);
 reel.onclick=()=>{arrangement.open=!arrangement.open};arrangement.addEventListener('toggle',()=>reel.setAttribute('aria-expanded',String(arrangement.open)));
 (nav.closest('.playback-tools')||nav).after(arrangement);
 window.describeControlPurpose(reel,'Arrangement tools — recommend, undo or save shot arrangements.');
 const arrangementSummary=arrangement.querySelector('summary');arrangementSummary.className='';arrangementSummary.textContent='Arrangement tools';arrangementSummary.removeAttribute('aria-label');arrangementSummary.removeAttribute('title');
 const arrangementHelp=window.compactInfo($('arrangement-help'),'How to arrange images','help');arrangementHelp.classList.add('arrangement-help');arrangement.querySelector('.toolbar').append(arrangementHelp);
 const sheet=document.createElement('dialog');sheet.id='recommendations-sheet';sheet.setAttribute('aria-labelledby','recommendations-heading');
 sheet.innerHTML='<div class="recommendations-sheet-heading"><h2 id="recommendations-heading"></h2><button type="button" id="recommendations-close" aria-label="Close recommendations" title="Close recommendations">×</button></div><div id="recommendations-content"></div>';
 host.append(sheet);$('recommendations-close').onclick=()=>sheet.close();
 let recommendationSlot=null;
 sheet.addEventListener('close',()=>requestAnimationFrame(()=>host.querySelector('[data-action="recommendations"][data-slot="'+CSS.escape(recommendationSlot||'')+'"]')?.focus({preventScroll:true})));
 function openRecommendations(sid){
  const slot=slots.find(s=>s.id===sid);if(!slot)return;recommendationSlot=sid;
  $('recommendations-heading').textContent='Recommended images · Slot '+(slots.indexOf(slot)+1);
  const candidates=(slot.recommended||[]).map(aid=>assets.get(aid)).filter(Boolean);
  $('recommendations-content').innerHTML=candidates.map(a=>`<article><img src="${file(a.image)}" alt="${esc(a.title)}"><h3>${esc(a.title)}</h3><p>${esc(a.version||'')}</p><button type="button" data-action="recommend" data-slot="${esc(sid)}" data-asset="${esc(a.id)}" ${assignments[sid]===a.id?'disabled':''}>${assignments[sid]===a.id?'Currently selected':'Use this image'}</button></article>`).join('')||'<p>No recommended images for this slot. Browse the image library to choose one.</p>';
  sheet.showModal();
 }
 const promptSheet=document.createElement('dialog');promptSheet.id='slot-prompt-sheet';promptSheet.setAttribute('aria-labelledby','slot-prompt-heading');
 promptSheet.innerHTML='<div class="slot-prompt-heading"><h2 id="slot-prompt-heading"></h2><button id="slot-prompt-close" type="button" aria-label="Close prompt">×</button></div><p id="slot-prompt-title"></p><div id="slot-prompt-text"></div>';
 host.append(promptSheet);$('slot-prompt-close').onclick=()=>promptSheet.close();
 let promptSlot=null;
 promptSheet.addEventListener('close',()=>requestAnimationFrame(()=>host.querySelector('[data-action="prompt-sheet"][data-slot="'+CSS.escape(promptSlot||'')+'"]')?.focus({preventScroll:true})));
 function openPromptSheet(sid){
  const slot=slots.find(s=>s.id===sid);if(!slot)return;promptSlot=sid;
  $('slot-prompt-heading').textContent=(slot.generation_prompt?'Full generation prompt':'Shot direction')+' · Slot '+(slots.indexOf(slot)+1);
  $('slot-prompt-title').textContent=slot.title;
  $('slot-prompt-text').textContent=slot.generation_prompt||slot.action||'No prompt is recorded for this slot.';
  promptSheet.showModal();promptSheet.scrollTop=0;
 }
 function fitSlotTitles(){
  for(const title of $('slot-grid').querySelectorAll('.slot-title')){
   let size=15;title.style.fontSize=size+'px';
   while(size>9&&(title.scrollHeight>title.clientHeight+1||title.scrollWidth>title.clientWidth+1)){size-=.5;title.style.fontSize=size+'px';}
  }
 }
 let titleWidth=0;
 if(window.ResizeObserver)new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-titleWidth)>.5){titleWidth=width;requestAnimationFrame(fitSlotTitles)}}).observe($('slot-grid'));
 document.fonts?.ready.then(()=>requestAnimationFrame(fitSlotTitles));

 async function loadImageApproval(container,aid){
  const request=Symbol();container.approvalRequest=request;
  const active=()=>container.isConnected&&container.approvalRequest===request;
  container.innerHTML='<p role="status">Loading image approval…</p>';
  try{
   const response=await fetch('/library-api/image-approval?'+new URLSearchParams({id,asset:aid}),{cache:'no-store'});
   let state=await response.json();if(!active())return;
   if(!response.ok)throw Error(state.error||'Could not load image approval.');
   const drawApproval=(message='')=>{
    container.innerHTML=`<h3>Storyboard approval</h3><p class="image-approval-status ${state.approved?'is-approved':'needs-review'}">${state.approved?'✓ Approved storyboard image':state.obsolete?'Set aside in Reference Desk':'Needs review'}</p><button type="button" class="image-approval-submit" ${state.obsolete&&!state.approved?'disabled':''}>${state.approved?'Revoke storyboard approval':'Approve storyboard image'}</button><p class="small">Applies to this exact image${state.crop?' and crop':''} across storyboard versions. Character and location reference approvals stay separate.</p><p class="image-approval-message" role="status" aria-live="polite">${esc(message|| (state.obsolete?'Restore this image in the Reference Desk before approving it.':''))}</p>`;
    container.querySelector('button').onclick=async()=>{
     const button=container.querySelector('button'),message=container.querySelector('.image-approval-message');
     button.disabled=true;message.textContent='Saving approval…';
     try{
      const r=await fetch('/library-api/image-approval',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':state.csrf_token},body:JSON.stringify({id,asset:aid,key:state.key,sha256:state.sha256,expected_record:state.record,approved:!state.approved})});
      const result=await r.json();if(!active())return;
      if(!r.ok)throw Error(result.error||'Could not save approval.');
      state=result;drawApproval(state.approved?'Approval saved on this Mac.':'Approval revoked. Image and shot assignments are unchanged.');
     }catch(error){if(active()){message.textContent=error.message;button.disabled=false;}}
    };
   };drawApproval();
  }catch(error){if(active()){container.innerHTML=`<p role="status">${esc(error.message)}</p><button type="button">Retry image review</button>`;container.querySelector('button').onclick=()=>loadImageApproval(container,aid);}}
 }
 let infoSequence=0;
 $('image-info-close').onclick=()=>$('image-info-dialog').close();
 $('image-info-dialog').addEventListener('close',()=>infoSequence++);
 async function imageInfo(sid){
  const aid=assignments[sid];if(!aid)return;
  const sequence=++infoSequence,dialog=$('image-info-dialog'),body=$('image-info-content');
  body.innerHTML='<p role="status">Loading image info…</p>';dialog.showModal();
  try{
   const response=await fetch('/library-api/image-info?id='+encodeURIComponent(id)+'&asset='+encodeURIComponent(aid),{cache:'no-store'}),info=await response.json();
   if(sequence!==infoSequence)return;if(!response.ok)throw Error(info.error||'Could not load image info.');
   const size=info.bytes>=1048576?(info.bytes/1048576).toFixed(2)+' MB':(info.bytes/1024).toFixed(1)+' KB';
   body.innerHTML=`<section id="info-image-approval" class="storyboard-image-approval"></section><img class="image-info-preview" src="${file(assets.get(aid).image)}" alt="${esc(info.name)}"><dl><dt>Name</dt><dd>${esc(info.name)}</dd><dt>File</dt><dd>${esc(info.filename)}</dd><dt>Dimensions</dt><dd>${info.width&&info.height?info.width+' × '+info.height+' pixels':'Unavailable'}</dd><dt>File size</dt><dd>${size}</dd></dl>${info.crop?'<p class="small">Size describes the source file; this shot may show a crop.</p>':''}<h3>Tags</h3><div id="image-info-tags" class="image-info-tags"></div><form id="image-info-tag-form"><label for="image-info-new-tags">Add tags</label><input id="image-info-new-tags" placeholder="e.g. village, interior" maxlength="3300" autocomplete="off"><p class="small">Separate tags with commas. Saves to ${esc(info.tag_store)} for this image.</p><button id="image-info-save-tags" type="submit">Add tags</button><p id="image-info-message" role="status" aria-live="polite"></p></form>`;
   loadImageApproval($('info-image-approval'),aid);
   const renderTags=()=>{$('image-info-tags').innerHTML=info.tags.length?info.tags.map(t=>`<span>${esc(t)}</span>`).join(''):'<span class="small">No tags yet</span>';};renderTags();
   $('image-info-tag-form').onsubmit=async event=>{
    event.preventDefault();const input=$('image-info-new-tags'),button=$('image-info-save-tags'),message=$('image-info-message');
    const additions=input.value.split(/[,\n]/).map(t=>t.trim()).filter(Boolean);if(!additions.length){message.textContent='Enter at least one tag.';return;}
    button.disabled=true;message.textContent='Saving tags…';
    try{
     const tokenResponse=await fetch('/library-api/arrangement?id='+encodeURIComponent(id),{cache:'no-store'}),tokenData=await tokenResponse.json();if(!tokenResponse.ok)throw Error('Could not reconnect to the library.');
     const r=await fetch('/library-api/image-tags',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':tokenData.csrf_token},body:JSON.stringify({id,asset:aid,sha256:info.sha256,expected_tags:info.tags,add_tags:additions})}),result=await r.json();if(!r.ok)throw Error(result.error||'Could not save tags.');
     if(sequence!==infoSequence)return;info.tags=result.tags;input.value='';renderTags();message.textContent='Tags saved to '+result.tag_store+'.';
     applyImageTags(aid,info,result.tags);drawAssets();
     if(info.desk_id)await refreshRelated();
    }catch(error){if(sequence===infoSequence)message.textContent=error.message;}
    finally{if(sequence===infoSequence)button.disabled=false;}
   };
  }catch(error){if(sequence===infoSequence)body.innerHTML=`<p role="status">${esc(error.message)}</p>`;}
 }
 function status(t){$('arrange-status').textContent=t;if(conflict||/fail|error/i.test(t))$('arrangement-controls').open=true;}
 function remember(){try{localStorage.setItem(storageKey,JSON.stringify({revision,assignments}))}catch{status('Browser backup unavailable. Keep this tab open until disk save succeeds.')}}
 function usage(a){const ids=new Set([a,...(assets.get(a)?.equivalent_ids||[])]);related.forEach(r=>{if(r.id===a||(r.equivalent_ids||[]).includes(a))ids.add(r.id)});return slots.flatMap((s,i)=>ids.has(assignments[s.id])?[i+1]:[])}
 function draw(){
  V.shots=original.map(s=>{const a=assets.get(assignments[s.id]);return {...s,image:a?.image||null,crop:a?.crop||null,available:!!a,status:a?'Selected image · '+a.title:(s.status==='proposed_new_coverage'?'Proposed new coverage · not generated':'Empty slot · choose a recommendation or library image')};});
  $('slot-grid').innerHTML=slots.map((s,i)=>{const a=assets.get(assignments[s.id]);return `<article class="edit-slot" data-slot="${esc(s.id)}" data-slot-number="${i+1}"><div class="slot-label"><strong>Slot ${i+1}</strong><span>${esc(s.duration_label||(Number.isFinite(s.duration)?s.duration.toFixed(2)+'s':'Untimed'))} · ${esc(s.id)}</span></div><button class="slot-target ${a?'filled':''}" data-action="place" data-slot="${s.id}" draggable="${!!a}" aria-label="${a?'Preview or revise image in':'Choose image for'} slot ${i+1}">${a?`<img src="${file(a.image)}" loading="lazy" alt="${esc(a.title)}">`:`<span class="empty-slot">${String(i+1).padStart(2,'0')}<small>Drop image here</small></span>`}</button><h3 class="slot-title" title="${esc(s.title)}">${esc(s.title)}</h3><button type="button" class="slot-prompt-button" data-action="prompt-sheet" data-slot="${esc(s.id)}" aria-haspopup="dialog" aria-label="${s.generation_prompt?'Full generation prompt':'Shot direction'} for slot ${i+1}">${s.generation_prompt?"Full generation prompt":"Shot direction"}</button>${s.generation_prompt?`<a href="${esc(s.prompt_url||'#prompt-'+s.id)}">Read full prompt in context</a>`:""}<div class="slot-actions">${a?`<button class="image-info-button" data-action="image-info" data-slot="${s.id}" aria-label="Image info for slot ${i+1}" title="Image approval, name, size and tags">ⓘ</button>`:''}<button type="button" class="review-icon" data-action="view" data-slot="${s.id}" title="Preview shot ${i+1}" aria-label="Preview shot ${i+1}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg></button><button class="slot-clear-button" data-action="clear" data-slot="${s.id}" title="Clear" aria-label="Clear slot ${i+1}" ${a?'':'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m16 3 5 5a2 2 0 0 1 0 3L11 21H7l-4-4a2 2 0 0 1 0-3L13 3a2 2 0 0 1 3 0ZM8 9l8 8M11 21h10"/></svg></button><button class="review-icon" type="button" data-action="recommendations" data-slot="${esc(s.id)}" aria-label="Recommendations for slot ${i+1}" title="Recommended images" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 5 4M16 5h4v3a4 4 0 0 1-5 4M12 13v5M8 21h8M9 18h6v3H9Z"/></svg></button></div></article>`}).join('');
  requestAnimationFrame(fitSlotTitles);
  drawAssets();$('arrange-undo').disabled=!undo.length;$('arrange-conflict').hidden=!conflict;show(current);
 }
 window.addEventListener('owl-timing-change',e=>{let start=0;e.detail.ends.forEach((end,i)=>{Object.assign(original[i],{start:start/e.detail.fps,end:i===e.detail.ends.length-1&&Number.isFinite(e.detail.exactDuration)?e.detail.exactDuration:end/e.detail.fps});Object.assign(slots[i],{start:start/e.detail.fps,end:i===e.detail.ends.length-1&&Number.isFinite(e.detail.exactDuration)?e.detail.exactDuration:end/e.detail.fps,duration:(end-start)/e.detail.fps});start=end});draw();});

 const expandedTags=new Set(),tagInfo=new Map();
 function tagCard(a,tags){
  return `<details class="card-tags" data-tag-asset="${esc(a.id)}" ${expandedTags.has(a.id)?'open':''}><summary>Tags (${tags.length})</summary><div class="card-tag-editor">${tagEditor(a.id)}</div></details>`;
 }
 function tagEditor(aid){
  const state=tagInfo.get(aid);
  if(!state)return '<p class="small" role="status">Loading tags…</p>';
  if(state.error)return `<p role="status">${esc(state.error)}</p><button type="button" data-action="retry-tags" data-tag-id="${esc(aid)}">Retry</button>`;
  const info=state.info;
  return `<div class="related-matches editable-tags">${info.tags.map(t=>`<span>${esc(t)}<button type="button" data-action="remove-tag" data-tag-id="${esc(aid)}" data-tag="${esc(t)}" aria-label="Remove tag ${esc(t)}" ${state.busy?'disabled':''}>×</button></span>`).join('')||'<small>No tags yet</small>'}</div><form class="card-tag-form" data-tag-id="${esc(aid)}"><label>Add tags<input name="tags" placeholder="Separate with commas" maxlength="3300" autocomplete="off" value="${esc(state.draft||'')}" ${state.busy?'disabled':''}></label><button type="submit" ${state.busy?'disabled':''}>Add tags</button></form><p class="small">Saves to ${esc(info.tag_store)}.</p><p class="small" role="status" aria-live="polite">${esc(state.message||'')}</p>`;
 }
 function renderTagEditor(aid){
  host.querySelectorAll('.card-tags').forEach(el=>{if(el.dataset.tagAsset===aid){el.querySelector('.card-tag-editor').innerHTML=tagEditor(aid);const info=tagInfo.get(aid)?.info;if(info)el.querySelector('summary').textContent=`Tags (${info.tags.length})`;}});
 }
 async function loadCardTags(aid){
  try{
   const r=await fetch('/library-api/image-info?id='+encodeURIComponent(id)+'&asset='+encodeURIComponent(aid),{cache:'no-store'}),info=await r.json();
   if(!r.ok)throw Error(info.error||'Could not load tags.');
   tagInfo.set(aid,{info});
  }catch(e){tagInfo.set(aid,{error:e.message});}
  renderTagEditor(aid);
 }
 function applyImageTags(aid,info,tags){
  const asset=assets.get(aid);
  for(const a of [...catalog.assets,...related,...assets.values()]){
   if(a.id===aid||a.image===asset?.image||(info.desk_id&&(a.desk_id===info.desk_id||a.desk_asset_id===info.desk_id||a.id===info.desk_id))||(a.equivalent_ids||[]).includes(aid))a.tags=[...tags];
  }
  for(const state of tagInfo.values())if(state.info?.sha256===info.sha256)state.info.tags=[...tags];
 }
 async function saveCardTags(aid,additions,removals){
  const state=tagInfo.get(aid);if(!state?.info||state.busy)return;
  if(!additions.length&&!removals.length){state.message='Enter at least one tag.';renderTagEditor(aid);return;}
  state.busy=true;state.message='Saving tags…';renderTagEditor(aid);
  try{
   const tokenResponse=await fetch('/library-api/arrangement?id='+encodeURIComponent(id),{cache:'no-store'}),tokenData=await tokenResponse.json();
   if(!tokenResponse.ok)throw Error('Could not reconnect to the library.');
   const r=await fetch('/library-api/image-tags',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':tokenData.csrf_token},body:JSON.stringify({id,asset:aid,sha256:state.info.sha256,expected_tags:state.info.tags,add_tags:additions,remove_tags:removals})}),result=await r.json();
   if(!r.ok){if(r.status===409){const fresh=await fetch('/library-api/image-info?id='+encodeURIComponent(id)+'&asset='+encodeURIComponent(aid),{cache:'no-store'});if(fresh.ok)state.info=await fresh.json();}throw Error(result.error||'Could not save tags.');}
   applyImageTags(aid,state.info,result.tags);state.info.tags=result.tags;state.draft='';state.message='Tags saved.';
  }catch(e){state.message=e.message;}
  finally{state.busy=false;drawAssets();renderTagEditor(aid);}
 }
 host.addEventListener('toggle',e=>{const el=e.target;if(!el.matches('.card-tags'))return;const aid=el.dataset.tagAsset;if(el.open){expandedTags.add(aid);if(!tagInfo.has(aid)){tagInfo.set(aid,null);loadCardTags(aid);}}else expandedTags.delete(aid);},true);
 host.addEventListener('input',e=>{const form=e.target.closest('.card-tag-form');if(form&&tagInfo.get(form.dataset.tagId))tagInfo.get(form.dataset.tagId).draft=e.target.value;});
 host.addEventListener('submit',e=>{const form=e.target.closest('.card-tag-form');if(!form)return;e.preventDefault();saveCardTags(form.dataset.tagId,form.elements.tags.value.split(/[,\n]/).map(t=>t.trim()).filter(Boolean),[]);});
 const imageTrack=$('asset-grid');
 imageTrack.tabIndex=0;imageTrack.setAttribute('role','region');imageTrack.setAttribute('aria-label','Storyboard Images — scroll horizontally');
 function drawAssets(){
  const grid=$('asset-grid'),scroll=grid.scrollLeft,rows=window.storyboardLibraryRows(catalog.assets,slots,related,usage);
  const optionList=(key,values,label)=>{const el=$('asset-'+key),options=[...new Set(values)].sort((a,b)=>a.localeCompare(b));el.innerHTML=`<option value="">${label}</option>`+options.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(browse[key]&&!options.includes(browse[key]))browse[key]='';el.value=browse[key];};
  optionList('tag',rows.flatMap(r=>r.tags),'All tags');optionList('version',rows.map(r=>r.a.version).filter(Boolean),'All versions');
  if(browse.shot&&!slots.some(s=>s.id===browse.shot))browse.shot='';
  const matching=window.filterStoryboardLibrary(rows,browse);
  $('asset-count').textContent=`(${catalog.assets.length})`;
  $('asset-results').textContent=`${matching.length} of ${catalog.assets.length} images · ${rows.filter(r=>r.used.length).length} used in this storyboard`;
  assetInfoButton.title=$('asset-results').textContent;
  grid.dataset.display=browse.display;grid.classList.toggle('hide-asset-details',!browse.details);
  grid.innerHTML=matching.map(({a,tags,used})=>`<article class="library-asset ${selected===a.id?'chosen':''} ${focusedAsset===a.id?'shot-image-current':''}"><button data-asset="${esc(a.id)}" draggable="true" aria-pressed="${selected===a.id}" aria-label="Select ${esc(a.title)}"><img src="${file(a.image)}" loading="lazy" alt="${esc(a.title)}"><strong>${esc(a.title)}</strong></button><div class="asset-card-meta"><small class="asset-extra">${esc(a.version||'')}</small>${tagCard(a,tags)}<p class="usage ${used.length?'used':''}">${used.length?'Used · '+used.map(n=>`<a href="#slot-${n}">Slot ${n}</a>`).join(', '):'Unused'}</p><button class="asset-preview-button" data-action="preview-library" data-asset="${esc(a.id)}" aria-label="Preview ${esc(a.title)}">Preview</button></div></article>`).join('')||'<div class="asset-empty"><p>No images match these filters.</p><button type="button" data-action="reset-filters">Clear filters</button></div>';
  grid.scrollLeft=scroll;
  drawRelated();
  document.querySelectorAll('.edit-slot').forEach((e,i)=>e.id='slot-'+(i+1));
 }
 function drawRelated(){
  if(!$('related-grid'))return;
  const matching=related.filter(a=>(relatedScope==='all'||(relatedScope==='generated'?a.generated:a.matches.length>0))&&(relatedState==='all'||(relatedState==='obsolete')===a.obsolete)&&(relatedMatch==='all'||a.matches.includes(relatedMatch))&&(!relatedQuery||[a.title,...a.tags,...a.matches,...(a.location_names||[]),...(a.location_tags||[])].join(' ').toLowerCase().includes(relatedQuery)));
  matching.sort((a,b)=>relatedSort==='title'?a.title.localeCompare(b.title):(b.added_order||0)-(a.added_order||0));
  $('library-tab-related').textContent=`Reference Desk (${related.filter(a=>relatedScope==='all'||(relatedScope==='generated'?a.generated:a.matches.length>0)).length})`;
  $('related-filter-summary').textContent=[relatedMatch!=='all'?relatedMatch:'',relatedState==='obsolete'?'Obsolete only':relatedState==='all'?'Includes obsolete':'',relatedSort==='title'?'A–Z':''].filter(Boolean).join(' · ');
  $('related-count').textContent=relatedResult.error||`${matching.length} images shown · ${relatedScope==='generated'?'All generations':relatedScope==='all'?'All Reference Desk images':'Matching configured tags'}`;
  $('related-grid').innerHTML=matching.map(a=>{
   const used=usage(a.id);
   return `<article class="library-asset ${selected===a.id?'chosen':''} ${focusedAsset===a.id?'shot-image-current':''}"><button data-asset="${esc(a.id)}" draggable="true" aria-pressed="${selected===a.id}" aria-label="Select ${esc(a.title)}" title="${esc(a.title)}"><img src="${file(a.thumbnail||a.image)}" loading="lazy" alt="${esc(a.title)}"><strong>${esc(a.title)}</strong></button><div class="desk-card-meta"><div class="desk-card-actions"><span class="desk-source-status">${esc(a.source_status)}${a.obsolete?' · Obsolete':''}</span><button class="related-preview-button" data-action="preview-related" data-asset="${esc(a.id)}">Preview</button></div><p class="usage ${used.length?'used':''}">${used.length?'Used · '+used.map(n=>`<a href="#slot-${n}">Slot ${n}</a>`).join(', '):'Unused'}</p>${tagCard(a,a.tags||[])}<details class="desk-card-details"><summary>Source details</summary><p>${esc(a.title)}</p><p>${a.generated?'Generated · ':''}Desk source: ${esc(a.source_status)}${a.preference!=='Unreviewed'?' · '+esc(a.preference):''}</p>${(a.location_names||[]).length?`<p>${a.location_names.map(esc).join(' · ')}</p>`:''}<div class="related-matches">${a.matches.map(m=>`<span>${esc(m)}</span>`).join(' ')}</div></details></div></article>`;
  }).join('')||'<p class="asset-empty">No matching images. Try another filter or reset filters.</p>';
 }
 async function refreshRelated(){
  if(refreshingRelated||!$('related-grid'))return;
  refreshingRelated=true;$('related-refresh').disabled=true;
  try{
   const r=await fetch('/library-api/related-images?id='+id+'&scope=all',{cache:'no-store'});
   if(!r.ok)throw Error('Reference Desk refresh failed. Existing images remain available.');
   const next=await r.json();if(next.error)throw Error(next.error);
   const changed=JSON.stringify(next.assets)!==JSON.stringify(related)||relatedResult.error;
   relatedResult=next;related=next.assets||[];related.forEach(a=>assets.set(a.id,a));
   if(changed)drawAssets();
  }catch(e){relatedResult.error=e.message;drawRelated();}
  finally{refreshingRelated=false;$('related-refresh').disabled=false;}
 }
 function selectAsset(a){selected=a;drawAssets();}
 let focusedAsset=null;
 function revealShotImages(sid){
  const slot=slots.find(s=>s.id===sid);if(!slot)return;
  const aid=assignments[sid],asset=assets.get(aid);
  focusedAsset=aid||null;
  // Browsing a shot never arms an image for placement or changes assignments.
  const inCatalog=!aid||catalog.assets.some(a=>a.id===aid||a.image===asset?.image);
  if(inCatalog){
   $('library-tab-storyboard')?.click();
   Object.assign(browse,{query:'',usage:'all',shot:sid,version:'',tag:''});
   syncBrowse();drawAssets();saveBrowse();
  }else{
   relatedScope='all';relatedState='all';relatedMatch='all';relatedQuery='';
   $('related-scope').value='all';$('related-state').value='all';$('related-match').value='all';$('related-search').value='';
   $('library-tab-related')?.click();drawRelated();
  }
  requestAnimationFrame(()=>{
   const grid=$(inCatalog?'asset-grid':'related-grid');
   const card=[...grid.querySelectorAll('.library-asset')].find(el=>{
    const a=assets.get(el.querySelector('[data-asset]')?.dataset.asset);
    return a&&(a.id===aid||a.image===asset?.image||(a.equivalent_ids||[]).includes(aid));
   });
   grid.querySelectorAll('.library-asset').forEach(el=>el.classList.toggle('shot-image-current',el===card));
   if(inCatalog){
    grid.scrollLeft=card?grid.scrollLeft+card.getBoundingClientRect().left-grid.getBoundingClientRect().left-6:0;
   }else{
    grid.scrollTop=card?grid.scrollTop+card.getBoundingClientRect().top-grid.getBoundingClientRect().top-6:0;
   }
   syncPaneHeight();
  });
 }
 // Shot slots are one horizontal track, never a nested vertical scroller.
 const slotTrack=$('slot-grid'),carouselBar=document.createElement('div'),slotPane=host.querySelector('.slots-pane'),slotHeading=slotPane.querySelector('h2');
 const slotHeader=document.createElement('div'),slotActions=document.createElement('div');
 slotHeader.className='slot-panel-header library-filter-heading';slotActions.className='slot-header-actions';
 slotHeading.before(slotHeader);slotHeader.append(slotHeading,slotActions);
 const makeRailSpacer=track=>{const spacer=document.createElement('div');spacer.className='image-rail-spacer';spacer.setAttribute('aria-hidden','true');track.before(spacer);return spacer};
 const slotSpacer=makeRailSpacer(slotTrack),assetSpacer=makeRailSpacer(imageTrack);
 const slotViewKey='storyboard-slot-view';let thumbnailView=false;
 try{thumbnailView=localStorage.getItem(slotViewKey)==='thumbnails';}catch{}
 const slotViewControls=document.createElement('div');slotViewControls.className='slot-view-controls';slotViewControls.setAttribute('role','group');slotViewControls.setAttribute('aria-label','Shot slot display');
 slotViewControls.innerHTML='<button type="button" id="slot-view-cards" class="review-icon" aria-pressed="true" aria-label="Shot cards" title="Shot cards"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 14h16m-12 3h6"/></svg></button><button type="button" id="slot-view-thumbnails" class="review-icon" aria-pressed="false" aria-label="Shot thumbnails" title="Shot thumbnails"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg></button>';
 slotActions.append(slotViewControls);
 function setSlotView(thumbnails,remember=false){
  thumbnailView=thumbnails;slotTrack.dataset.view=thumbnails?'thumbnails':'cards';carouselBar.hidden=thumbnails;
  $('slot-view-cards').setAttribute('aria-pressed',String(!thumbnails));$('slot-view-thumbnails').setAttribute('aria-pressed',String(thumbnails));
  slotTrack.setAttribute('aria-label',thumbnails?'Shot thumbnails in shot order — drag an image onto a slot to replace it':'Shot cards — scroll horizontally or use left and right arrows');
  if(thumbnails)slotTrack.removeAttribute('aria-roledescription');else slotTrack.setAttribute('aria-roledescription','carousel');
  if(remember)try{localStorage.setItem(slotViewKey,thumbnails?'thumbnails':'cards');}catch{}
  requestAnimationFrame(()=>{scrollToSlot(current);fitSlotTitles();syncPaneHeight();});
 }
 $('slot-view-cards').onclick=()=>setSlotView(false,true);$('slot-view-thumbnails').onclick=()=>setSlotView(true,true);

 carouselBar.className='slot-carousel-bar';carouselBar.innerHTML='<button type="button" class="review-icon" id="slots-back" aria-label="Previous shot cards" title="Previous shot cards">←</button><span id="slots-range" role="status" aria-live="polite"></span><button type="button" class="review-icon" id="slots-forward" aria-label="Next shot cards" title="Next shot cards">→</button>';
 slotActions.append(carouselBar);slotTrack.tabIndex=0;slotTrack.setAttribute('role','region');slotTrack.setAttribute('aria-label','Shot cards — scroll horizontally or use left and right arrows');slotTrack.setAttribute('aria-roledescription','carousel');
 function carouselMetrics(){
  const card=slotTrack.querySelector('.edit-slot');if(!card)return {step:1,first:0,count:1};
  const style=getComputedStyle(slotTrack),gap=parseFloat(style.columnGap)||0,step=card.getBoundingClientRect().width+gap;
  const count=Math.max(1,Math.round((slotTrack.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+gap)/step));
  return {step,count,first:Math.min(slots.length-1,Math.max(0,Math.round(slotTrack.scrollLeft/step)))};
 }
 function syncCarousel(){
  if(thumbnailView)return;
  const {first,count}=carouselMetrics();$('slots-range').textContent=`${first+1}–${Math.min(slots.length,first+count)} / ${slots.length}`;
  $('slots-back').disabled=slotTrack.scrollLeft<=1;$('slots-forward').disabled=slotTrack.scrollLeft>=slotTrack.scrollWidth-slotTrack.clientWidth-1;
 }
 function scrollToSlot(index){if(thumbnailView){const card=slotTrack.children[Math.max(0,index)];if(card)slotTrack.scrollTo({left:0,top:Math.max(0,card.offsetTop-10),behavior:'instant'});return;}const {step}=carouselMetrics();slotTrack.scrollTo({left:Math.max(0,index)*step,behavior:'instant'});syncCarousel();}
 $('slots-back').onclick=()=>{const {first,count}=carouselMetrics();scrollToSlot(first-count)};
 $('slots-forward').onclick=()=>{const {first,count}=carouselMetrics();scrollToSlot(first+count)};
 slotTrack.addEventListener('scroll',syncCarousel,{passive:true});
 slotTrack.addEventListener('keydown',event=>{if(event.target!==slotTrack||thumbnailView)return;const {first,count}=carouselMetrics();const target=({ArrowLeft:first-count,ArrowRight:first+count,Home:0,End:slots.length-count})[event.key];if(target!==undefined){event.preventDefault();scrollToSlot(target)}});
 function syncPaneHeight(){
  slotTrack.style.removeProperty('height');slotTrack.style.removeProperty('max-height');
  const library=$('image-library');
  const sideBySide=!libraryPanel.hidden&&library.getBoundingClientRect().left>slotPane.getBoundingClientRect().left+1;
  let offset=0;
  if(sideBySide){
   const slotStart=slotTrack.getBoundingClientRect().top-slotSpacer.getBoundingClientRect().height;
   const assetStart=imageTrack.getBoundingClientRect().top-assetSpacer.getBoundingClientRect().height;
   offset=assetStart-slotStart;
  }
  const setSpacer=(spacer,px)=>{const size=Math.max(0,px).toFixed(2)+'px';if(spacer.style.height!==size)spacer.style.height=size;};
  setSpacer(slotSpacer,offset);setSpacer(assetSpacer,-offset);
  const height=slotPane.getBoundingClientRect().height;
  if(height>0)library.style.setProperty('--shot-pane-height',height+'px');
  requestAnimationFrame(syncCarousel);
 }
 if(window.ResizeObserver){const paneObserver=new ResizeObserver(syncPaneHeight);[slotTrack,slotPane,slotHeader,filterHeading,filterPanel,libraryPanel,$('image-library').querySelector('.library-tabs')].filter(Boolean).forEach(el=>paneObserver.observe(el));}
 window.addEventListener('resize',syncPaneHeight);
 // Timeline updates only mark the current card; scrolling is an explicit action.
 const viewShot=document.createElement('button');viewShot.id='view-shot';viewShot.type='button';viewShot.textContent='View shot ↓';
 $('counter').after(viewShot);
 const currentShotLabel=document.createElement('span');currentShotLabel.id='current-storyboard-shot';currentShotLabel.className='current-storyboard-shot';
 slotActions.prepend(currentShotLabel);
 const slotInfo=window.compactInfo(currentShotLabel,'Current shot slot','info'),slotInfoButton=slotInfo.querySelector('button');
 function markCurrentShot(){
  const sid=V.shots[current]?.id;
  host.querySelectorAll('.edit-slot').forEach(card=>{
   const active=card.dataset.slot===sid;card.classList.toggle('timeline-current',active);
   if(active)card.setAttribute('aria-current','true');else card.removeAttribute('aria-current');
  });
  currentShotLabel.textContent=sid?'Viewing Slot '+(current+1)+' · '+sid:'No current shot slot';
  slotInfoButton.title=currentShotLabel.textContent;
  viewShot.disabled=!sid;viewShot.setAttribute('aria-label',sid?'View shot '+sid+' in storyboard':'View shot');
 }
 window.addEventListener('owl-shot-change',markCurrentShot);
 viewShot.onclick=()=>{
  const sid=V.shots[current]?.id;if(!sid)return;
  revealShotImages(sid);
  requestAnimationFrame(()=>{
   const card=[...host.querySelectorAll('.edit-slot')].find(el=>el.dataset.slot===sid);if(!card)return;
   scrollToSlot(slots.findIndex(s=>s.id===sid));card.tabIndex=-1;card.focus({preventScroll:true});slotTrack.scrollIntoView({block:'nearest',behavior:'instant'});
  });
 };
 for(const name of ['prev','next','screen'])$(name)?.addEventListener('click',()=>revealShotImages(V.shots[current]?.id));
 $('shots').addEventListener('click',()=>revealShotImages(V.shots[current]?.id));
 let previewAsset=null,previewSequence=0;
 window.openCurrentShotReview=()=>{const sid=V.shots[current]?.id;if(assets.get(assignments[sid]))previewSlot(sid);else viewShot.click();};
 async function previewSlot(sid){
  const slot=slots.find(s=>s.id===sid),asset=assets.get(assignments[sid]);if(!slot||!asset)return;
  const seq=++previewSequence;previewAsset=asset.id;
  $('related-preview-title').textContent='Slot '+(slots.indexOf(slot)+1)+' · '+sid+' · '+slot.title;
  $('related-preview-image').src=file(asset.image);$('related-preview-image').alt=asset.title;
  $('related-preview-caption').textContent=asset.title;
  $('related-preview-select').hidden=true;$('shot-revise').hidden=true;$('shot-revise').removeAttribute('href');
  $('shot-revise-status').textContent='Preparing the exact image and saved shot prompt…';
  $('related-preview').showModal();
  loadImageApproval($('preview-image-approval'),asset.id);
  try{
   const r=await fetch('/library-api/revision-context?'+new URLSearchParams({id,slot:sid,asset:asset.id}),{cache:'no-store'}),context=await r.json();
   if(seq!==previewSequence)return;if(!r.ok)throw Error(context.error||'Could not prepare revision.');
   $('shot-revise').href=context.desk_url+'#storyboard-revise='+encodeURIComponent(JSON.stringify(context));
   $('shot-revise').hidden=false;
   $('shot-revise-status').textContent='Opens Generate Beta with this image and shot prompt. Your current shot stays unchanged.';
  }catch(e){if(seq===previewSequence)$('shot-revise-status').textContent=e.message;}
 }

 $('related-preview-close').onclick=()=>$('related-preview').close();
 $('related-preview').addEventListener('close',()=>{previewSequence++});
 $('related-preview-select').onclick=()=>{if(previewAsset)selectAsset(previewAsset);$('related-preview').close()};
 if($('library-tab-related')){
  const names=['storyboard','related'];
  function switchLibrary(name,focus=false){names.forEach(n=>{const tab=$('library-tab-'+n);tab.setAttribute('aria-selected',String(n===name));tab.tabIndex=n===name?0:-1;$('library-panel-'+n).hidden=n!==name});if(focus)$('library-tab-'+name).focus({preventScroll:true});if(name==='related')refreshRelated();}
  names.forEach(n=>{$('library-tab-'+n).onclick=()=>switchLibrary(n);$('library-tab-'+n).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();switchLibrary(e.key==='Home'?'storyboard':e.key==='End'?'related':n==='storyboard'?'related':'storyboard',true)}}});
  $('related-refresh').onclick=refreshRelated;
  $('related-scope').onchange=e=>{relatedScope=e.target.value;drawRelated();refreshRelated()};
  $('related-sort').onchange=e=>{relatedSort=e.target.value;drawRelated()};
  $('related-display').onchange=e=>{$('related-grid').dataset.display=e.target.value;syncPaneHeight()};
  $('related-reset').onclick=()=>{relatedQuery='';relatedMatch='all';relatedState='active';relatedSort='newest';$('related-search').value='';$('related-match').value='all';$('related-state').value='active';$('related-sort').value='newest';drawRelated()};
  window.addEventListener('focus',()=>{if(!$('library-panel-related').hidden)refreshRelated()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!$('library-panel-related').hidden)refreshRelated()});
  $('related-search').oninput=e=>{relatedQuery=e.target.value.trim().toLowerCase();drawRelated()};
  $('related-match').onchange=e=>{relatedMatch=e.target.value;drawRelated()};
  $('related-state').onchange=e=>{relatedState=e.target.value;drawRelated()};
 }
 function change(fn){const before=JSON.stringify(assignments);fn();if(JSON.stringify(assignments)===before)return;undo.push(JSON.parse(before));if(undo.length>100)undo.shift();dirty=true;remember();draw();status(conflict?'Save conflict — your draft is retained.':'Unsaved arrangement…');clearTimeout(saveTimer);saveTimer=setTimeout(saveArrangement,500);}
 async function saveArrangement(){
  if(busy||!dirty||conflict)return;busy=true;const snapshot=JSON.stringify(assignments);status('Saving arrangement to disk…');
  try{const r=await fetch('/library-api/arrangement',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':csrf},body:JSON.stringify({id,revision,assignments:JSON.parse(snapshot)})});const d=await r.json();
   if(r.status===409){conflict=true;$('arrange-conflict').hidden=false;throw Error(d.error)}
   if(!r.ok)throw Error(d.error||r.status);revision=d.revision;dirty=JSON.stringify(assignments)!==snapshot;
   if(dirty)remember();else try{localStorage.removeItem(storageKey)}catch{}
   status(dirty?'New changes pending…':`Arrangement saved to disk · revision ${revision} · ${Object.values(assignments).filter(Boolean).length}/${slots.length} slots filled`);
  }catch(e){remember();status('Save failed: '+e.message+' Your draft is retained.')}finally{busy=false;if(dirty&&!conflict&&JSON.stringify(assignments)!==snapshot)saveTimer=setTimeout(saveArrangement,500);}
 }
 host.addEventListener('dragstart',e=>{const el=e.target.closest('[draggable="true"]');if(!el)return;drag=el.dataset.asset?{asset:el.dataset.asset}:{slot:el.dataset.slot};e.dataTransfer.setData('application/x-owl-shot',JSON.stringify(drag));e.dataTransfer.effectAllowed='copyMove';});
 host.addEventListener('dragover',e=>{if(e.target.closest('.edit-slot')&&(drag||Array.from(e.dataTransfer.types).includes('application/x-owl-shot'))){e.preventDefault();e.dataTransfer.dropEffect=drag?.slot?'move':'copy';e.target.closest('.edit-slot').classList.add('drop-over')}});
 host.addEventListener('dragleave',e=>{const s=e.target.closest('.edit-slot');if(s&&!s.contains(e.relatedTarget))s.classList.remove('drop-over')});
 host.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.drop-over').forEach(e=>e.classList.remove('drop-over'))});
 host.addEventListener('drop',e=>{const slot=e.target.closest('.edit-slot');if(!slot)return;e.preventDefault();let d;try{d=JSON.parse(e.dataTransfer.getData('application/x-owl-shot'))}catch{return}const target=slot.dataset.slot;change(()=>{if(d.slot&&Object.hasOwn(assignments,d.slot)){[assignments[target],assignments[d.slot]]=[assignments[d.slot],assignments[target]];}else if(assets.has(d.asset))assignments[target]=d.asset;});drag=null;});
 host.addEventListener('click',e=>{
  const card=e.target.closest('.edit-slot');
  if(card&&!e.target.closest('button,a,input,select,summary'))revealShotImages(card.dataset.slot);
  const b=e.target.closest('button');if(!b)return;const sid=b.dataset.slot,a=b.dataset.asset,action=b.dataset.action;
  if(sid&&['image-info','view','place'].includes(action)&&!(action==='place'&&selected))revealShotImages(sid);
  if(action==='remove-tag')saveCardTags(b.dataset.tagId,[],[b.dataset.tag]);
  else if(action==='retry-tags')loadCardTags(b.dataset.tagId);
  else if(action==='reset-filters')resetBrowse();
  else if(action==='image-info')imageInfo(sid);
  else if(action==='clear')change(()=>assignments[sid]=null);
  else if(action==='recommendations')openRecommendations(sid);
  else if(action==='prompt-sheet')openPromptSheet(sid);
  else if(action==='recommend'){sheet.close();change(()=>assignments[sid]=a);}
  else if(action==='view'){previewSlot(sid);}
  else if(action==='place'){if(selected)change(()=>assignments[sid]=selected);else if(thumbnailView)show(slots.findIndex(s=>s.id===sid));else if(assignments[sid])previewSlot(sid);else{status('Select an image in All images, then click this empty slot.');}}
  else if(action==='preview-related'||action==='preview-library'){previewSequence++;$('shot-revise').hidden=true;$('shot-revise-status').textContent='';$('related-preview-select').hidden=false;const asset=assets.get(a);previewAsset=a;$('related-preview-title').textContent=asset.title;$('related-preview-image').src=file(asset.image);$('related-preview-image').alt=asset.title;$('related-preview-caption').textContent=action==='preview-library'?(asset.version||'Storyboard image'):'OWL Reference Desk · '+asset.matches.join(' · ')+' · Source status: '+asset.source_status;$('related-preview').showModal();loadImageApproval($('preview-image-approval'),asset.id);}
  else if(a)selectAsset(a);
 });
 function saveBrowse(){try{localStorage.setItem(browseKey,JSON.stringify(browse))}catch{}}
 function syncBrowse(){for(const [control,key] of [['search','query'],['filter','usage'],['shot','shot'],['sort','sort'],['display','display']])$('asset-'+control).value=browse[key];$('asset-details').checked=browse.details;}
 function resetBrowse(){focusedAsset=null;Object.assign(browse,{query:'',usage:'all',shot:'',version:'',tag:''});syncBrowse();drawAssets();imageTrack.scrollLeft=0;saveBrowse();}
 for(const [control,key] of [['search','query'],['filter','usage'],['shot','shot'],['tag','tag'],['version','version'],['sort','sort'],['display','display']]){
  $('asset-'+control)[control==='search'?'oninput':'onchange']=e=>{browse[key]=e.target.value;drawAssets();imageTrack.scrollLeft=0;saveBrowse();};
 }
 $('asset-details').onchange=e=>{browse.details=e.target.checked;drawAssets();saveBrowse();};
 $('asset-reset').onclick=resetBrowse;syncBrowse();
 window.initLibraryImageAdd?.({id,host,actions:filterActions,onAdded:a=>{
  const index=catalog.assets.findIndex(x=>x.id===a.id);
  if(index<0)catalog.assets.push(a);else catalog.assets[index]=a;
  assets.set(a.id,a);focusedAsset=null;Object.assign(browse,{query:'',usage:'all',shot:'',version:'',tag:'',sort:'recent'});syncBrowse();drawAssets();saveBrowse();imageTrack.scrollLeft=0;
 }});


 $('recommend-all').onclick=()=>change(()=>slots.forEach(s=>assignments[s.id]=s.recommended[0]||null));
 $('arrange-undo').onclick=()=>{if(!undo.length)return;assignments=undo.pop();dirty=true;remember();draw();saveArrangement()};
 $('arrange-save').onclick=async()=>{if(conflict)return;try{const r=await fetch('/library-api/arrangement?id='+id,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error);csrf=d.csrf_token;}catch(e){status('Cannot reconnect: '+e.message);return}saveArrangement()};
 async function resolve(keep){try{const r=await fetch('/library-api/arrangement?id='+id,{cache:'no-store'});if(!r.ok)throw Error('Cannot read disk arrangement');const d=await r.json();revision=d.revision;csrf=d.csrf_token;conflict=false;if(!keep){undo.push({...assignments});(d.related_assets||[]).forEach(a=>assets.set(a.id,a));assignments=d.assignments;dirty=false;localStorage.removeItem(storageKey);}else{dirty=true;remember()}draw();status('Loaded disk arrangement · revision '+revision);if(keep)saveArrangement();}catch(e){status(e.message)}}
 $('arrange-load').onclick=()=>resolve(false);$('arrange-overwrite').onclick=()=>resolve(true);
 draw();status(conflict?'Browser draft recovered — choose the saved arrangement or explicitly save this draft.':dirty?'Recovered unsaved arrangement.':`Arrangement loaded · ${Object.values(assignments).filter(Boolean).length}/${slots.length} slots filled. Choose images below.`);
 window.initShotFlags?.({id,host,view:V,getCurrent:()=>current,show,position:storyboardPlaybackPosition});
 window.orderPlaybackTools();
 // Layout is a local viewing preference; reuse the same live canvas and editor.
 const mainLayout=document.createElement('div'),viewer=document.querySelector('.viewer');
 mainLayout.className='storyboard-main-layout';viewer.before(mainLayout);mainLayout.append(viewer,host);
 const landscapeSwitch=document.createElement('button');landscapeSwitch.id='landscape-view-toggle';landscapeSwitch.type='button';landscapeSwitch.className='landscape-view-toggle';landscapeSwitch.setAttribute('role','switch');landscapeSwitch.setAttribute('aria-label','Landscape view');landscapeSwitch.setAttribute('aria-checked','false');
 landscapeSwitch.innerHTML='<span class="layout-option layout-portrait" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M5 14h14M12 14v8"/></svg></span><span class="layout-option layout-landscape" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M13 4v16M18 4v16"/></svg></span>';
 document.querySelector('.header-review-tools').append(landscapeSwitch);
 window.describeControlPurpose(landscapeSwitch,'Portrait / landscape layout — switch between panels below the canvas and panels beside it. The highlighted icon shows the selected layout; narrow windows stay stacked.');
 const layoutPreference='storyboard-landscape-view';let landscape=false;
 try{landscape=localStorage.getItem(layoutPreference)==='true';}catch{}
 function applyLandscape(enabled,rememberPreference=false){
  const first=carouselMetrics().first;landscape=enabled;document.body.classList.toggle('landscape-view',enabled);landscapeSwitch.setAttribute('aria-checked',String(enabled));
  if(rememberPreference)try{localStorage.setItem(layoutPreference,String(enabled));}catch{}
  requestAnimationFrame(()=>{fitSlotTitles();scrollToSlot(first);syncPaneHeight();});
 }
 landscapeSwitch.onclick=()=>applyLandscape(!landscape,true);
 applyLandscape(landscape);
 setSlotView(thumbnailView);
 window.initShotStructureEditor?.({id,catalog,slots,getCurrent:()=>V.shots[current]?.id,show,scrollToSlot,setSlotView});
 const requestedShot=new URLSearchParams(location.search).get('shot');
 if(requestedShot){const target=slots.findIndex(s=>s.id===requestedShot);if(target>=0){show(target);requestAnimationFrame(()=>scrollToSlot(target));}}

 window.ReferenceDeskBridge?.register('arrangement',{
  state:()=>({dirty:dirty||[...tagInfo.values()].some(s=>s?.draft?.trim()),inflight:busy||[...tagInfo.values()].some(s=>s?.busy),conflicted:conflict}),
  flush:async()=>{
   await window.ReferenceDeskBridge.waitUntil(()=>busy||[...tagInfo.values()].some(s=>s?.busy));
   if(conflict)throw Error('Resolve the arrangement conflict before leaving.');
   if([...tagInfo.values()].some(s=>s?.draft?.trim()))throw Error('Save or clear the image tag text before leaving.');
   clearTimeout(saveTimer);if(dirty)await saveArrangement();
   if(dirty||conflict)throw Error('The shot arrangement has not saved. Use Save arrangement and retry.');
  }
 });
 window.addEventListener('beforeunload',e=>{if(dirty){remember();e.preventDefault();e.returnValue=''}});
 }catch(e){if(localStorage.getItem('owl-arrangement-draft-'+id))window.ReferenceDeskBridge?.register('arrangement',{state:()=>({dirty:true}),flush:async()=>{throw Error('Reconnect the shot editor to recover and save your arrangement draft.')}});host.textContent='Shot editor unavailable: '+e.message+'. Reload to retry.';$('shots').hidden=false;}
};
