/* Script, casting references and video direction, isolated from still generation and arrangements. */
(()=>{
 const eid=new URLSearchParams(location.search).get('id');if(!/^[a-f0-9]{16}$/.test(eid||''))return;
 const el=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n},clone=x=>JSON.parse(JSON.stringify(x));
 const media=p=>'/files'+encodeURI(p).replace(/#/g,'%23').replace(/\?/g,'%3F');
 let config,records={},bases={},csrf,currentSid=null,activeSid=null,saving=false,queued=false,timer,seq=0,conflicts=new Map(),dirty=new Set(),loaded=false;
 const draftKey='owl-shot-workspace-draft-v1-'+eid;let retained={};try{retained=JSON.parse(localStorage.getItem(draftKey)||'{}')}catch{}
 const asset=id=>config.assets.find(a=>a.id===id),character=id=>config.characters.find(c=>c.id===id),shot=id=>config.shots.find(s=>s.id===id),record=()=>records[activeSid];
 let host,dialog,status;
 function closeNotePopovers(){dialog?.querySelectorAll('.sw-note-popover:popover-open').forEach(panel=>panel.hidePopover())}
 function installNotePopovers(){
  const icons={source:'M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z',direction:'M4 3v18M4 4h14l-3 4 3 4H4M9 16h12m-3-3 3 3-3 3',prompt:'M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h5'};
  for(const [contentId,id,icon]of [['sw-script-note','sw-source-popover','source'],['sw-direction','sw-direction-popover','direction'],['sw-still-prompt','sw-still-popover','prompt']]){
   const details=el(contentId).closest('details'),summary=details.querySelector('summary'),title=summary.textContent;
   const section=details.parentElement;
   let toolbar=section.querySelector('.sw-note-tools');
   if(!toolbar){const row=node('div',undefined,'sw-section-heading'),heading=section.querySelector('h3');toolbar=node('div',undefined,'sw-note-tools');heading.before(row);row.append(heading,toolbar)}
   const trigger=node('button',undefined,'sw-note-trigger');trigger.type='button';trigger.id=id+'-trigger';trigger.title=title;trigger.setAttribute('aria-label',title);trigger.setAttribute('popovertarget',id);trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls',id);
   trigger.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+icons[icon]+'"/></svg>';const tip=node('span',title,'sw-note-tip');tip.setAttribute('aria-hidden','true');trigger.append(tip);
   const panel=node('div',undefined,'sw-note-popover');panel.id=id;panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby',id+'-title');
   const heading=node('div',undefined,'sw-note-heading'),label=node('h3',title),close=node('button','×','sw-note-close');label.id=id+'-title';close.type='button';close.setAttribute('aria-label','Close '+title);close.setAttribute('autofocus','');close.setAttribute('popovertarget',id);close.setAttribute('popovertargetaction','hide');heading.append(label,close);
   const body=node('div',undefined,'sw-note-body');body.tabIndex=0;summary.remove();body.append(...details.childNodes);panel.append(heading,body);details.remove();toolbar.append(trigger);dialog.append(panel);
   panel.addEventListener('toggle',event=>trigger.setAttribute('aria-expanded',String(event.newState==='open')));
  }
 }
 function installCollapsibleSections(){
  for(const [section,id]of [[el('sw-character-panel'),'sw-character-panel'],[el('sw-location-list').closest('section'),'sw-location-panel'],[dialog.querySelector('.sw-video'),'sw-video-panel']]){
   const heading=section.querySelector('h3'),panel=node('details'),summary=node('summary');panel.id=id;panel.className=section.className;panel.classList.add('sw-foldable');panel.open=true;summary.append(heading);panel.append(summary,...section.childNodes);section.replaceWith(panel);
  }
  const controls=[],contents=[];
  for(const [index,section]of [...dialog.querySelectorAll('.sw-script-frame>section')].entries()){
   const row=section.querySelector('.sw-section-heading'),heading=row.querySelector('h3'),toggle=node('button',heading.textContent,'sw-paired-toggle'),body=node('div');body.id=index===0?'sw-script-content':'sw-references-content';
   toggle.type='button';toggle.setAttribute('aria-label',heading.textContent);toggle.setAttribute('aria-expanded','true');toggle.setAttribute('aria-controls','sw-script-content sw-references-content');toggle.setAttribute('aria-description','Expand or collapse Script text and Shot references together.');heading.replaceChildren(toggle);
   body.append(...[...section.childNodes].filter(child=>child!==row));section.append(body);controls.push(toggle);contents.push(body);
  }
  for(const toggle of controls)toggle.onclick=()=>{const expanded=toggle.getAttribute('aria-expanded')!=='true';if(!expanded)closeNotePopovers();controls.forEach(button=>button.setAttribute('aria-expanded',String(expanded)));contents.forEach(body=>body.hidden=!expanded)};
 }
 function installCharacterRail(){
  const rail=el('sw-character-list');rail.tabIndex=0;rail.setAttribute('role','region');rail.setAttribute('aria-label','Character references — scroll horizontally or use arrow keys');
  rail.addEventListener('keydown',event=>{if(event.target!==rail)return;const step=(rail.firstElementChild?.getBoundingClientRect().width||280)+10;const target={ArrowLeft:rail.scrollLeft-step,ArrowRight:rail.scrollLeft+step,Home:0,End:rail.scrollWidth}[event.key];if(target!==undefined){event.preventDefault();rail.scrollLeft=target}});
 }
 function message(t){status.textContent=t}
 function remember(){const out={};for(const sid of dirty)out[sid]={expected:bases[sid],value:records[sid]};try{localStorage.setItem(draftKey,JSON.stringify(out))}catch{message('Browser draft backup unavailable. Save before closing.')}}
 function changed(){dirty.add(activeSid);remember();message('Unsaved changes…');renderIncluded();clearTimeout(timer);timer=setTimeout(saveAll,650)}
 function defaultMessage(){return conflicts.size?'Save conflict — review your draft and the saved version.':dirty.size?'Unsaved changes retained in this browser.':'Loaded from disk — no pending changes.'}
 function showConflict(){const box=el('sw-conflict');box.hidden=!conflicts.has(activeSid);if(!box.hidden){el('sw-disk').textContent=JSON.stringify(conflicts.get(activeSid),null,2);el('sw-mine').textContent=JSON.stringify(records[activeSid],null,2)}}
 async function saveAll(){
  if(saving){queued=true;return}if(!loaded)return;
  saving=true;
  try{
   for(const sid of [...dirty]){
    if(conflicts.has(sid))continue;
    const value=clone(records[sid]),expected=clone(bases[sid]);message('Saving shot '+sid+' to disk…');
    const r=await fetch('/library-api/shot-workspace',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':csrf},body:JSON.stringify({id:eid,shot_id:sid,expected,value})});const out=await r.json();
    if(r.status===409){conflicts.set(sid,out.disk_value);message(out.error);showConflict();continue}
    if(!r.ok)throw Error(out.error||'Could not save the shot.');
    bases[sid]=clone(out.value);if(JSON.stringify(value)===JSON.stringify(records[sid]))dirty.delete(sid);
    remember();message(dirty.size?'Some shot changes remain unsaved.':'Saved to disk.');
   }
  }catch(error){message(error.message+' Your draft is retained. Use Save to retry.')}
  finally{saving=false;if(queued){queued=false;return saveAll()}}
 }
 function img(a,cls){const im=node('img');im.src=media(a.thumbnail||a.image);im.alt=a.title;im.loading='lazy';if(cls)im.className=cls;return im}
 function openAsset(a){const link=node('a','Open reference');link.href=media(a.image);link.target='_blank';link.rel='noopener';return link}
 function included(){return new Set(Object.values(records).flatMap(r=>r.character_ids))}
 function renderIncluded(){
  const list=el('sw-included-list');list.replaceChildren();const ids=included();el('sw-included-count').textContent='Included characters · '+ids.size;
  for(const c of config.characters.filter(c=>ids.has(c.id))){const b=node('button',undefined,'sw-included-person');b.type='button';b.title=c.name+' · '+c.status;b.setAttribute('aria-label','Choose '+c.name+' for a shot');const a=asset(c.reference_ids[0]);if(a)b.append(img(a));else b.append(node('span','?', 'sw-no-face'));b.append(node('span',c.name));b.onclick=async()=>{await open(currentSid);el('sw-character-panel').open=true;el('sw-character-search').value=c.name;renderCharacters();el('sw-character-panel').scrollIntoView({block:'start'})};list.append(b)}
 }
 function renderCharacters(){
  const list=el('sw-character-list'),query=el('sw-character-search').value.trim().toLowerCase(),all=el('sw-all-characters').checked,s=record(),relevant=new Set([...config.initial_included_character_ids,...s.character_ids]);list.replaceChildren();list.scrollLeft=0;
  for(const c of config.characters.filter(c=>(all||relevant.has(c.id))&&(!query||c.name.toLowerCase().includes(query)))){
   const label=node('label',undefined,'sw-choice');const check=node('input');check.type='checkbox';check.checked=s.character_ids.includes(c.id);check.setAttribute('aria-label','Include '+c.name+' in '+activeSid);
   check.onchange=()=>{if(check.checked)s.character_ids.push(c.id);else{s.character_ids=s.character_ids.filter(x=>x!==c.id);Object.keys(s.placements).forEach(a=>s.placements[a]=s.placements[a].filter(x=>x!==c.id))}changed();renderPairings()};label.append(check);const a=asset(c.reference_ids[0]);if(a)label.append(img(a));else label.append(node('span','Reference needed','sw-placeholder'));const text=node('span');text.append(node('strong',c.name),node('small',c.status));label.append(text);label.title=c.description;list.append(label)
  }
 }
 function renderLocations(){
  const list=el('sw-location-list'),s=record();list.replaceChildren();for(const aid of config.location_ids){const a=asset(aid);if(!a)continue;const label=node('label',undefined,'sw-choice sw-location');const check=node('input');check.type='checkbox';check.checked=s.location_ids.includes(aid);check.setAttribute('aria-label','Use location '+a.title);check.onchange=()=>{if(check.checked)s.location_ids.push(aid);else{s.location_ids=s.location_ids.filter(x=>x!==aid);delete s.placements[aid]}changed();renderPairings()};label.append(check,img(a),node('span',a.title));list.append(label)}
 }
 function renderPairings(){
  const list=el('sw-pairings'),s=record();list.replaceChildren();let count=0;
  for(const [aid,cids]of Object.entries(s.placements)){
   if(!cids.length)continue;count++;const a=asset(aid),card=node('article',undefined,'sw-pairing');card.append(img(a),node('strong',a.title));const row=node('div',undefined,'sw-paired-cast');
   for(const cid of cids){const c=character(cid),chip=node('div',undefined,'sw-cast-chip'),ref=asset(c.reference_ids[0]);if(ref)chip.append(img(ref));chip.append(node('span',c.name));const remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Remove '+c.name+' from '+a.title);remove.onclick=()=>{s.placements[aid]=s.placements[aid].filter(x=>x!==cid);changed();renderPairings()};chip.append(remove);row.append(chip)}card.append(row,openAsset(a));const details=node('details');details.append(node('summary','Original location image prompt'),node('pre',a.original_prompt||'Original image prompt not recorded.'));card.append(details);list.append(card)
  }
  if(!count)list.append(node('p','Select characters and locations above, then add their reference pairings. No composite image is generated.','sw-muted'));
  el('sw-add-pairings').disabled=!s.character_ids.length||!s.location_ids.length;
 }
 function frameOptions(){const chosen=new Set([...config.location_ids,...config.shots.map(s=>s.default.start_frame),...record().location_ids,record().start_frame,record().end_frame]);for(const a of config.assets)chosen.add(a.id);
  for(const [id,optional]of [['sw-start',true],['sw-end',true]]){const select=el(id);select.replaceChildren();if(optional)select.add(new Option('None — frame pending',''));for(const aid of chosen){const a=asset(aid);if(a)select.add(new Option(a.id+' · '+a.title,a.id))}}
 }
 function renderFrames(){const s=record();for(const [key,id]of [['start_frame','sw-start'],['end_frame','sw-end']]){el(id).value=s[key];const box=el(id+'-preview');box.replaceChildren();const a=asset(s[key]);if(a){box.append(img(a),openAsset(a))}else box.append(node('div','Frame not selected','sw-frame-empty'))}const a=asset(s.start_frame);el('sw-still-prompt').textContent=a?.original_prompt||'Original still/image prompt not recorded for this reference.'}
 const directionDrafts=new Map();
 function directionDraft(){if(!directionDrafts.has(activeSid)){const base=record().video_prompt;directionDrafts.set(activeSid,{base,values:PromptControls.readDirection(base),presets:{}})}return directionDrafts.get(activeSid)}
 function renderAngles(){
  const draft=directionDraft();
  for(const key of ['viewpoint','framing','movement']){el('sw-'+key+'-wording').value=draft.values[key];if(key!=='movement')el('sw-'+key+'-preset').value=draft.presets[key]||''}
  const initial=PromptControls.readDirection(draft.base),pending=Object.entries(draft.values).some(([key,value])=>value!==initial[key]);
  el('sw-direction-status').textContent=pending?'Preview changed — click Apply to prompt when ready.':'Preview only — edit the wording, then click Apply to prompt.';
 }
 function installDirectionControls(){
  for(const [key,groups]of [['viewpoint',PromptControls.viewpointGroups],['framing',PromptControls.framingGroups]]){
   const select=el('sw-'+key+'-preset');select.add(new Option('Current / custom wording',''));
   for(const group of groups){const optgroup=node('optgroup');optgroup.label=group.label;for(const [label,wording]of group.options){const option=new Option(label,wording);optgroup.append(option)}select.append(optgroup)}
   select.onchange=()=>{if(!select.value)return;const draft=directionDraft();draft.values[key]=select.value;draft.presets[key]=select.value;el('sw-'+key+'-wording').value=select.value;el('sw-direction-status').textContent='Preview changed — click Apply to prompt when ready.'};
  }
  for(const key of ['viewpoint','framing','movement'])el('sw-'+key+'-wording').oninput=()=>{const draft=directionDraft();draft.values[key]=el('sw-'+key+'-wording').value;if(key!=='movement'){draft.presets[key]='';el('sw-'+key+'-preset').value=''}el('sw-direction-status').textContent='Preview changed — click Apply to prompt when ready.'};
  el('sw-direction-reset').onclick=()=>{directionDrafts.delete(activeSid);renderAngles()};
  el('sw-direction-apply').onclick=()=>{
   const draft=directionDraft(),initial=PromptControls.readDirection(draft.base),patch=Object.fromEntries(Object.entries(draft.values).filter(([key,value])=>value!==initial[key]));
   const result=PromptControls.applyDirection(record().video_prompt,draft.base,patch);
   if(result.error){el('sw-direction-status').textContent=result.error;return}
   if(result.text===record().video_prompt){el('sw-direction-status').textContent='No preview changes to apply.';return}
   record().video_prompt=result.text;
   // The legacy enum is no longer the source of camera wording; the prompt holds the exact direction.
   if(Object.hasOwn(patch,'viewpoint'))record().angle='';
   el('sw-prompt').value=result.text;directionDrafts.delete(activeSid);renderAngles();changed();el('sw-direction-status').textContent='Applied to video text. Shot direction and other prompt text preserved.';
  };
 }
 function draw(){
  closeNotePopovers();
  const s=shot(activeSid),r=record();el('sw-shot-select').value=activeSid;el('sw-heading').textContent=activeSid+' · '+s.title;el('sw-script-label').textContent=config.source.title+(s.script_start==null?' · script excerpt unassigned':' · lines '+s.script_start+'–'+s.script_end);el('sw-script').textContent=s.script_text;el('sw-script-note').textContent=config.source.note;el('sw-cast-note').textContent=s.cast_note;el('sw-direction').textContent=s.direction;el('sw-prompt').value=r.video_prompt;el('sw-seam').value=r.seam_note;el('sw-feedback').value=r.feedback;el('sw-character-search').value='';renderCharacters();renderLocations();renderPairings();frameOptions();renderFrames();renderAngles();showConflict();message(defaultMessage());
 }
 async function open(sid){if(!loaded||!records[sid])return;activeSid=sid;draw();if(!dialog.open)dialog.showModal()}
 function installCardButtons(){document.querySelectorAll('#slot-grid [data-slot].edit-slot').forEach(card=>{if(card.querySelector('.sw-open-shot'))return;const b=node('button','Shot Workspace','sw-open-shot');b.type='button';b.setAttribute('aria-label','Shot Workspace for '+card.dataset.slot);b.title='Open Shot Workspace — script, characters, references and video prompt';b.onclick=()=>open(card.dataset.slot);card.querySelector('.slot-title')?.after(b)})}
 async function init(){
  const mount=document.querySelector('.storyboard-main-layout');if(!mount)return;
  host=node('section',undefined,'sw-board');host.id='sw-board';host.innerHTML='<div class="sw-board-heading"><h2 id="sw-included-count">Included characters</h2><button id="sw-open-current" type="button">Shot Workspace · current shot</button></div><div id="sw-included-list" class="sw-included-list"></div><p id="sw-board-status" class="sw-muted">Loading script and character references…</p>';mount.before(host);
  dialog=node('dialog');dialog.id='shot-workspace-dialog';dialog.setAttribute('aria-labelledby','sw-heading');dialog.innerHTML=`<div class="sw-modal-top"><div><small class="sw-workspace-kicker"><span>Shot direction · <em>SHOT WORKSPACE</em></span><button type="button" class="sw-workspace-info" aria-label="Director's Tools, Copyright 2026" title="Director's Tools, Copyright 2026"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg><span class="sw-note-tip" aria-hidden="true">Director's Tools, Copyright 2026</span></button></small><h2 id="sw-heading"></h2></div><label>Shot<select id="sw-shot-select"></select></label><button type="button" id="sw-close" aria-label="Close shot workspace">×</button></div><div class="sw-modal-body"><div class="sw-script-frame"><section><h3>Script text</h3><p id="sw-script-label"></p><pre id="sw-script"></pre><details><summary>Script source &amp; staging note</summary><p id="sw-script-note"></p><p id="sw-cast-note"></p><p id="sw-source-id"></p></details><details><summary>Shot direction &amp; seam plan</summary><pre id="sw-direction"></pre></details></section><section><h3>Shot references</h3><div class="sw-frames"><div><label for="sw-start">Start Frame / shot reference</label><select id="sw-start"></select><div id="sw-start-preview"></div></div><div><label for="sw-end">End Frame · optional</label><select id="sw-end"></select><div id="sw-end-preview"></div></div></div><p class="sw-muted">Existing reference imagery. Exact production keyframes require review.</p><details><summary>Original still/image prompt · read only</summary><pre id="sw-still-prompt"></pre></details></section></div><section id="sw-character-panel"><h3>Characters for this shot</h3><div class="sw-filter"><label class="sw-icon-label sw-character-search-label" title="Find a character"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input id="sw-character-search" type="search" aria-label="Find a character" placeholder="Name or script role"><span class="sw-note-tip" aria-hidden="true">Find a character</span></label><label class="sw-icon-label sw-all-characters-label" title="All Desk characters"><input id="sw-all-characters" type="checkbox" aria-label="All Desk characters"><svg class="sw-rainbow" viewBox="0 0 28 24" aria-hidden="true" focusable="false"><path d="M3 21v-5a11 11 0 0 1 22 0v5" stroke="#f17d84"/><path d="M6 21v-5a8 8 0 0 1 16 0v5" stroke="#f3b862"/><path d="M9 21v-5a5 5 0 0 1 10 0v5" stroke="#8bd7a0"/><path d="M12 21v-5a2 2 0 0 1 4 0v5" stroke="#aaa7ef"/></svg><span class="sw-note-tip" aria-hidden="true">All Desk characters</span></label></div><div id="sw-character-list" class="sw-character-list"></div></section><section><h3>Location images</h3><div id="sw-location-list" class="sw-location-list"></div><button id="sw-add-pairings" type="button">Add selected characters to selected locations</button><p class="sw-muted">Save character and location references together for this shot. Existing image pixels stay unchanged.</p><div id="sw-pairings"></div></section><section class="sw-video"><h3>Video Prompt</h3><div class="sw-direction-controls"><div><label for="sw-viewpoint-preset">Viewpoint preset</label><select id="sw-viewpoint-preset"></select><label for="sw-viewpoint-wording">Viewpoint wording preview</label><textarea id="sw-viewpoint-wording" rows="4" maxlength="5000" aria-describedby="sw-direction-help"></textarea></div><div><label for="sw-framing-preset">Framing preset</label><select id="sw-framing-preset"></select><label for="sw-framing-wording">Framing wording preview</label><textarea id="sw-framing-wording" rows="4" maxlength="5000" aria-describedby="sw-direction-help"></textarea></div><div class="sw-movement-control"><label for="sw-movement-wording">Movement wording preview</label><textarea id="sw-movement-wording" rows="3" maxlength="5000" aria-describedby="sw-direction-help"></textarea></div></div><p id="sw-direction-help" class="sw-muted">Edit each preview independently. Apply replaces only changed camera, framing or movement lines. The shot direction below stays as written; review it for consistency with your choices.</p><div class="sw-direction-actions"><button type="button" id="sw-direction-apply">Apply to prompt</button><button type="button" id="sw-direction-reset">Reset preview from prompt</button></div><p id="sw-direction-status" class="sw-muted" role="status" aria-live="polite"></p><label for="sw-prompt">Editable video text</label><textarea id="sw-prompt" rows="11" maxlength="30000"></textarea><button id="sw-copy" type="button">Copy Prompt</button><details><summary>Seam note &amp; returned clip feedback</summary><label for="sw-seam">Seam note</label><textarea id="sw-seam" rows="4" maxlength="10000"></textarea><label for="sw-feedback">Returned clip feedback</label><textarea id="sw-feedback" rows="3" maxlength="10000"></textarea></details></section><section id="sw-conflict" hidden><h3>This shot changed elsewhere</h3><details><summary>Your retained draft</summary><pre id="sw-mine"></pre></details><details><summary>Saved version</summary><pre id="sw-disk"></pre></details><button id="sw-use-disk" type="button">Use saved version</button><button id="sw-keep-mine" type="button">Keep my draft and retry</button></section></div><footer class="sw-footer"><span id="sw-status" role="status" aria-live="polite"></span><button id="sw-save" type="button">Save shot workspace</button></footer>`;document.body.append(dialog);status=el('sw-status');
  installNotePopovers();installCollapsibleSections();installCharacterRail();installDirectionControls();
  el('sw-close').onclick=()=>{closeNotePopovers();clearTimeout(timer);saveAll();dialog.close()};dialog.addEventListener('close',()=>{closeNotePopovers();clearTimeout(timer);saveAll()});el('sw-save').onclick=()=>{clearTimeout(timer);saveAll()};
  try{const r=await fetch('/library-api/shot-workspace?id='+eid,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Workspace unavailable');config=d.config;csrf=d.csrf_token;records=clone(d.shots);bases=clone(d.shots);
   for(const [sid,draft]of Object.entries(retained)){if(!records[sid]||!draft?.value)continue;if(JSON.stringify(draft.value)===JSON.stringify(records[sid]))continue;records[sid]=draft.value;dirty.add(sid);if(JSON.stringify(draft.expected)!==JSON.stringify(bases[sid]))conflicts.set(sid,bases[sid]);else bases[sid]=draft.expected}
   loaded=true;currentSid=config.shots[0]?.id;remember();renderIncluded();el('sw-board-status').textContent=config.shots.length+' shots · script excerpts and reference choices · open a shot workspace to edit.';el('sw-source-id').textContent='Source SHA-256: '+config.source.sha256;
   for(const s of config.shots)el('sw-shot-select').add(new Option(s.id+' · '+s.title,s.id));el('sw-shot-select').onchange=()=>open(el('sw-shot-select').value);el('sw-open-current').onclick=()=>open(currentSid);
   el('sw-character-search').oninput=renderCharacters;el('sw-all-characters').onchange=renderCharacters;
   el('sw-add-pairings').onclick=()=>{const s=record();for(const aid of s.location_ids)s.placements[aid]=[...new Set([...(s.placements[aid]||[]),...s.character_ids])];changed();renderPairings()};
   for(const [id,key]of [['sw-start','start_frame'],['sw-end','end_frame']])el(id).onchange=()=>{record()[key]=el(id).value;changed();renderFrames()};
   for(const [id,key]of [['sw-prompt','video_prompt'],['sw-seam','seam_note'],['sw-feedback','feedback']])el(id).oninput=()=>{record()[key]=el(id).value;changed()};
   el('sw-copy').onclick=async()=>{try{await navigator.clipboard.writeText(PromptControls.copyText(record()));message('Copied editable video text only.')}catch{el('sw-prompt').focus();el('sw-prompt').select();message('Clipboard unavailable. Video text is selected; copy it manually.')}};
   el('sw-use-disk').onclick=()=>{directionDrafts.delete(activeSid);records[activeSid]=clone(conflicts.get(activeSid));bases[activeSid]=clone(records[activeSid]);conflicts.delete(activeSid);dirty.delete(activeSid);remember();draw();renderIncluded()};el('sw-keep-mine').onclick=()=>{bases[activeSid]=clone(conflicts.get(activeSid));conflicts.delete(activeSid);dirty.add(activeSid);remember();showConflict();saveAll()};
   installCardButtons();new MutationObserver(installCardButtons).observe(el('slot-grid'),{childList:true,subtree:true});
   // Eye buttons retain the image approval/revision preview; workspace buttons open directing tools.
   window.openCurrentShotWorkspace=()=>open(currentSid);
   window.openShotWorkspace=open;
   window.ReferenceDeskBridge?.register('shot-workspace',{state:()=>({dirty:dirty.size>0,inflight:saving,conflicted:conflicts.size>0}),flush:async()=>{clearTimeout(timer);await window.ReferenceDeskBridge.waitUntil(()=>saving);await saveAll();if(dirty.size||conflicts.size)throw Error('Save or resolve the shot workspace before leaving.')}});
   if(dirty.size&&!conflicts.size)saveAll();
  }catch(error){el('sw-board-status').textContent='Script workspace unavailable: '+error.message+'. Reload to retry.';el('sw-open-current').disabled=true;if(Object.keys(retained).length)window.ReferenceDeskBridge?.register('shot-workspace',{state:()=>({dirty:true}),flush:async()=>{throw Error('Reconnect the script workspace to recover its pending draft.')}})}
 }
 window.addEventListener('owl-shot-change',e=>{currentSid=e.detail?.shotId||currentSid});
 const observer=new MutationObserver(()=>{if(document.querySelector('.storyboard-main-layout')&&el('slot-grid')){observer.disconnect();init()}});observer.observe(document.body,{childList:true,subtree:true});
 if(document.querySelector('.storyboard-main-layout')&&el('slot-grid')){observer.disconnect();init()}
})();
