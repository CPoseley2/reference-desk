/* Stable shot IDs and a separate structure layer keep source cuts and references intact. */
window.applyShotStructureToView=function(view,catalog){
 const original=new Map(view.shots.map(s=>[String(s.id),s]));
 view.shots=catalog.slots.map(slot=>{
  const source=original.get(slot.id);return {...(source||{id:slot.id,image:null,crop:null,available:false,start:null,end:null,status:'Empty slot · choose an image'}),title:slot.title,prompt:slot.action??source?.prompt??'',source_lines:slot.source_lines};
 });
};
window.initShotStructureEditor=function({id,catalog,slots,getCurrent,show,scrollToSlot,setSlotView}){
 if(!catalog.structure?.enabled)return;
 const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n},clone=x=>JSON.parse(JSON.stringify(x));
 const grid=$('slot-grid'),controls=document.querySelector('.slot-view-controls'),storage='owl-shot-structure-draft-'+id;
 let data,ctx=null,formDirty=false,committing=false,busy=false,uncertain=false,attempt=null,token='',listMode=false;
 const resume=node('button','Resume shot edit','ss-resume');resume.type='button';resume.hidden=true;document.querySelector('.slot-header-actions').append(resume);
 const addFirst=node('button','+','ss-add-first');addFirst.type='button';addFirst.title='Insert a shot before the first shot';addFirst.setAttribute('aria-label',addFirst.title);document.querySelector('.slot-header-actions').append(addFirst);
 const list=node('button','≡','review-icon');list.type='button';list.id='slot-view-list';list.title='Shot list';list.setAttribute('aria-label','Shot list');list.setAttribute('aria-pressed','false');controls.append(list);
 function applyList(on,remember=true){listMode=on;list.setAttribute('aria-pressed',String(on));if(on){setSlotView(true);grid.dataset.view='list';$('slot-view-cards').setAttribute('aria-pressed','false');$('slot-view-thumbnails').setAttribute('aria-pressed','false');grid.setAttribute('aria-label','Editable shot list in shot order');}if(remember)try{localStorage.setItem('owl-shot-list-'+id,String(on))}catch{}}
 list.onclick=()=>applyList(true);for(const key of ['slot-view-cards','slot-view-thumbnails'])$(key).addEventListener('click',()=>applyList(false));
 try{if(localStorage.getItem('owl-shot-list-'+id)==='true')applyList(true,false)}catch{}
 const dialog=node('dialog');dialog.id='shot-structure-dialog';dialog.setAttribute('aria-labelledby','ss-heading');dialog.innerHTML=`<header class="ss-header"><h2 id="ss-heading"></h2><button id="ss-close" type="button" aria-label="Close shot editor">×</button></header><div class="ss-body"><p id="ss-context"></p><label id="ss-position-label">Insert after<select id="ss-position"></select></label><label for="ss-title">Shot title</label><input id="ss-title" type="text" maxlength="240" autocomplete="off"><div class="ss-fields"><label>Planning duration (seconds)<input id="ss-duration" type="number" min="0.001" max="3600" step="any" placeholder="Untimed"></label><label>Script start line<input id="ss-script-start" type="number" min="1" step="1" placeholder="Unassigned"></label><label>Script end line<input id="ss-script-end" type="number" min="1" step="1" placeholder="Unassigned"></label></div><p class="ss-note">Planning duration does not shift existing cut timestamps. Leave script lines blank until the excerpt is chosen.</p><details id="ss-script-details"><summary>Script excerpt preview</summary><pre id="ss-script-preview"></pre></details><label for="ss-direction">Shot direction</label><textarea id="ss-direction" rows="7" maxlength="15000" placeholder="Action, camera movement, continuity and seam notes"></textarea><div id="ss-conflict" hidden><p id="ss-conflict-message"></p><details><summary>Saved shot details</summary><pre id="ss-conflict-disk"></pre></details><button id="ss-load-saved" type="button">Use saved details</button><button id="ss-retry-draft" type="button">Keep my draft and retry</button></div><p id="ss-status" role="status" aria-live="polite"></p></div><footer class="ss-footer"><button id="ss-workspace" type="button">Characters, references &amp; video prompt</button><button id="ss-cancel" type="button">Cancel</button><button id="ss-save" type="button">Save shot</button></footer>`;document.body.append(dialog);
 const fields=['ss-title','ss-duration','ss-script-start','ss-script-end','ss-direction'];
 function status(text){$('ss-status').textContent=text}
 function value(){const num=k=>$(k).value.trim()===''?null:Number($(k).value);return {title:$('ss-title').value,direction:$('ss-direction').value,planning_duration:num('ss-duration'),script_start:num('ss-script-start'),script_end:num('ss-script-end')}}
 function remember(){if(!ctx)return;try{localStorage.setItem(storage,JSON.stringify({ctx,value:value(),attempt,uncertain}));resume.hidden=false}catch{status('Browser draft backup unavailable. Save before closing.')}}
 function clearDraft(){try{localStorage.removeItem(storage)}catch{}resume.hidden=true;formDirty=false;attempt=null;uncertain=false}
 function preview(){const v=value(),lo=v.script_start,hi=v.script_end;let text='No script excerpt assigned.';if(lo!==null||hi!==null){text=Number.isInteger(lo)&&Number.isInteger(hi)&&lo>=1&&hi>=lo&&hi<=data.script_lines.length?data.script_lines.slice(lo-1,hi).join('\n'):'Enter a valid start and end line.';}$('ss-script-preview').textContent=text}
 function position(){const after=$('ss-position').value||null,index=after===null?0:data.order.indexOf(after)+1,before=data.order[index]||null;ctx.after=after;ctx.before=before;$('ss-context').textContent='Insert '+(after?'after '+after+' · '+data.edits[after].title:'at the beginning')+(before?', before '+before+' · '+data.edits[before].title:'. This will be the last shot.');}
 function fill(v){$('ss-title').value=v.title;$('ss-duration').value=v.planning_duration??'';$('ss-script-start').value=v.script_start??'';$('ss-script-end').value=v.script_end??'';$('ss-direction').value=v.direction;preview()}
 function lock(yes){for(const key of [...fields,'ss-position'])$(key).disabled=yes;$('ss-save').disabled=busy;$('ss-workspace').disabled=yes||ctx?.operation==='insert';$('ss-cancel').disabled=busy}
 async function fetchState(){const r=await fetch('/library-api/shot-structure?id='+id,{cache:'no-store'}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load shot details.');token=d.csrf_token;return d}
 async function open(operation,sid,after=null,restore=null){
  if(formDirty){status('Finish or cancel the current shot edit first.');if(!dialog.open)dialog.showModal();return}
  try{data=await fetchState();ctx=restore?.ctx||{operation,shot_id:sid||'YB-I-'+crypto.randomUUID().replace(/-/g,'').slice(0,12),after,before:null,expected_revision:data.revision,expected:operation==='edit'?clone(data.edits[sid]):null};attempt=restore?.attempt||null;uncertain=!!restore?.uncertain;
   $('ss-heading').textContent=ctx.operation==='insert'?'Insert a shot':'Edit '+ctx.shot_id;$('ss-save').textContent=uncertain?'Retry save':ctx.operation==='insert'?'Insert shot':'Save shot';$('ss-position-label').hidden=ctx.operation!=='insert';$('ss-conflict').hidden=true;
   $('ss-position').replaceChildren(new Option('Before the first shot',''));for(const key of data.order)$('ss-position').add(new Option(key+' · '+data.edits[key].title,key));
   if(ctx.operation==='insert'){$('ss-position').value=ctx.after||'';if(!attempt)position();}
   else $('ss-context').textContent=ctx.shot_id+' · Existing references, character choices and timing stay with this shot.';
   fill(restore?.value||(ctx.operation==='edit'?data.edits[ctx.shot_id]:{title:'',direction:'',planning_duration:null,script_start:null,script_end:null}));formDirty=!!restore;lock(uncertain);status(uncertain?'The previous save was not confirmed. Retry the same save to check safely.':'');if(!dialog.open)dialog.showModal();$('ss-title').focus();
  }catch(e){window.alert('Shot editor: '+e.message)}
 }
 async function save(){
  if(busy)return;
  const v=value();if(!attempt){if(!v.title.trim()){status('Enter a title for this shot.');$('ss-title').focus();return}for(const f of ['ss-duration','ss-script-start','ss-script-end'])if(!$(f).checkValidity()){$(f).reportValidity();return}}
  busy=true;committing=true;lock(true);status('Saving other pending storyboard changes…');
  try{
   await window.ReferenceDeskBridge?.flush();
   if(!attempt){attempt={id,operation:ctx.operation,shot_id:ctx.shot_id,expected_revision:ctx.expected_revision,expected:ctx.expected,after:ctx.after,before:ctx.before,value:v,mutation_id:crypto.randomUUID()};remember()}
   // Token refresh never replaces the expected shot details or insertion boundary.
   const fresh=await fetchState();token=fresh.csrf_token;status('Saving shot to disk…');
   const r=await fetch('/library-api/shot-structure',{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':token},body:JSON.stringify(attempt)}),out=await r.json();
   if(r.status===409){data=out.current;attempt=null;uncertain=false;$('ss-conflict').hidden=false;$('ss-conflict-message').textContent=out.error;$('ss-conflict-disk').textContent=JSON.stringify(data.edits[ctx.shot_id]||data.order,null,2);$('ss-load-saved').hidden=ctx.operation==='insert';status('Your draft is retained. Review the saved details or insertion position before retrying.');remember();return}
   if(!r.ok){attempt=null;uncertain=false;throw Error(out.error||'Save failed.')}
   clearDraft();status('Saved to disk. Reopening the updated board…');const u=new URL(location.href);u.searchParams.set('shot',out.shot_id);location.assign(u.href);
  }catch(e){uncertain=!!attempt;remember();status(e.message+(uncertain?' Save outcome unconfirmed; Retry safely checks the same request.':' Your draft is retained.'));$('ss-save').textContent=uncertain?'Retry save':'Save shot';}
  finally{busy=false;committing=false;lock(uncertain)}
 }
 fields.forEach(key=>$(key).oninput=()=>{formDirty=true;preview();remember();status('Unsaved shot details.');});$('ss-position').onchange=()=>{position();formDirty=true;remember()};
 $('ss-close').onclick=()=>{if(!busy)dialog.close()};$('ss-cancel').onclick=()=>{if(busy)return;clearDraft();dialog.close()};$('ss-save').onclick=save;
 $('ss-workspace').onclick=()=>{if(formDirty){status('Save or cancel these shot details before opening references.');return}dialog.close();window.openShotWorkspace?.(ctx.shot_id)};
 $('ss-load-saved').onclick=()=>{fill(data.edits[ctx.shot_id]);ctx.expected=clone(data.edits[ctx.shot_id]);ctx.expected_revision=data.revision;attempt=null;uncertain=false;$('ss-conflict').hidden=true;clearDraft();status('Loaded the latest saved shot details.')};
 $('ss-retry-draft').onclick=()=>{ctx.expected_revision=data.revision;if(ctx.operation==='edit')ctx.expected=clone(data.edits[ctx.shot_id]);else{const after=ctx.after;$('ss-position').replaceChildren(new Option('Before the first shot',''));for(const key of data.order)$('ss-position').add(new Option(key+' · '+data.edits[key].title,key));$('ss-position').value=data.order.includes(after)?after:'';position();$('ss-conflict').hidden=true;status('Insertion position refreshed above. Review it, then click Insert shot.');remember();return}attempt=null;$('ss-conflict').hidden=true;save()};
 function decorate(){
  grid.querySelectorAll('.edit-slot').forEach(card=>{if(card.querySelector('.ss-edit-tools'))return;const sid=card.dataset.slot,index=slots.findIndex(s=>s.id===sid),next=slots[index+1]?.id||null;
   const tools=node('div',undefined,'ss-edit-tools'),edit=node('button','✎','ss-edit');edit.type='button';edit.setAttribute('aria-label','Edit shot '+sid);edit.title='Edit title, script excerpt and shot direction';edit.onclick=()=>open('edit',sid);const reference=node('button','▤','ss-references');reference.type='button';reference.title='Script, characters and prompt';reference.setAttribute('aria-label','Script characters and prompt for '+sid);reference.onclick=()=>window.openShotWorkspace?.(sid);tools.append(edit,reference);card.append(tools);
   const plus=node('button','+','ss-insert-after');plus.type='button';plus.title=next?'Insert shot between '+sid+' and '+next:'Add a shot after '+sid;plus.setAttribute('aria-label',plus.title);plus.onclick=()=>open('insert',null,sid);card.append(plus);
   const title=card.querySelector('.slot-title');if(title){title.title='Edit '+sid+' · '+slots[index].title;title.style.cursor='pointer';title.onclick=()=>open('edit',sid)}
   if(slots[index].action){const excerpt=node('p',slots[index].action,'ss-direction-excerpt');card.append(excerpt)}
  });
 }
 decorate();new MutationObserver(decorate).observe(grid,{childList:true,subtree:true});
 addFirst.onclick=()=>open('insert',null,null);resume.onclick=()=>{try{const draft=JSON.parse(localStorage.getItem(storage));formDirty=false;open(draft.ctx.operation,draft.ctx.shot_id,draft.ctx.after,draft)}catch{status('Could not recover the draft.')}};
 try{resume.hidden=!localStorage.getItem(storage)}catch{}
 window.ReferenceDeskBridge?.register('shot-structure',{state:()=>({dirty:formDirty&&!committing,inflight:false,conflicted:!$('ss-conflict').hidden&&!committing}),flush:async()=>{if(formDirty&&!committing)throw Error('Save or cancel the open shot edit before leaving.')}});
};
