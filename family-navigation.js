'use strict';
(() => {
 const nav=document.getElementById('families'),panel=document.getElementById('familyPanel'),sort=document.getElementById('familySort'),moves=document.getElementById('familyMoves'),announcement=document.getElementById('familyAnnouncement');
 const storageKey='desk-family-navigation-v1';
 const buttons=[...nav.querySelectorAll('button[data-group]')],all=buttons.find(b=>b.dataset.group==='');
 const groups=buttons.filter(b=>b.dataset.group).map((button,index)=>({id:button.dataset.group,label:button.childNodes[0].textContent.trim(),count:Number(button.querySelector('span').textContent),button,index}));
 const ids=groups.map(g=>g.id),byId=new Map(groups.map(g=>[g.id,g]));
 let prefs={mode:'custom',order:ids,collapsed:matchMedia('(max-width:680px)').matches},selected=null,dragged=null;
 try {const saved=JSON.parse(DESKStorage.getItem(storageKey)||'null');if(saved){if(['custom','alpha','largest','smallest'].includes(saved.mode))prefs.mode=saved.mode;if(Array.isArray(saved.order))prefs.order=[...new Set(saved.order.filter(id=>byId.has(id))),...ids.filter(id=>!saved.order.includes(id))];if(typeof saved.collapsed==='boolean')prefs.collapsed=saved.collapsed;}} catch (_) {}
 function persist(){try{DESKStorage.setItem(storageKey,JSON.stringify(prefs));}catch(_){announcement.textContent='Your arrangement works for this visit, but this browser could not remember it.';}}
 function ordered(){const list=groups.slice();if(prefs.mode==='alpha')return list.sort((a,b)=>a.label.localeCompare(b.label));if(prefs.mode==='largest'||prefs.mode==='smallest')return list.sort((a,b)=>(prefs.mode==='largest'?b.count-a.count:a.count-b.count)||a.label.localeCompare(b.label));return prefs.order.map(id=>byId.get(id));}
 function updateSelection(){for(const row of nav.querySelectorAll('[data-family-row]')){const chosen=row.dataset.familyRow===selected;row.classList.toggle('reorder-selected',chosen);row.querySelector('.family-grip')?.setAttribute('aria-pressed',String(chosen));}const i=prefs.order.indexOf(selected);document.getElementById('familyUp').disabled=i<=0;document.getElementById('familyDown').disabled=i<0||i===prefs.order.length-1;}
 function choose(id){selected=id;updateSelection();}
 function draw(){sort.value=prefs.mode;moves.hidden=prefs.mode!=='custom';nav.replaceChildren(all);all.classList.add('family-choice');const list=document.createElement('ol');list.className='family-list';for(const g of ordered()){const row=document.createElement('li');row.className='family-row';row.dataset.familyRow=g.id;
  if(prefs.mode==='custom'){const grip=document.createElement('button');grip.type='button';grip.className='family-grip';grip.draggable=true;grip.textContent='⋮⋮';grip.dataset.familyGrip=g.id;grip.setAttribute('aria-label','Reorder '+g.label);grip.setAttribute('aria-describedby','familyReorderHelp');grip.title='Drag to reorder, or use ↑ and ↓ while focused';grip.addEventListener('focus',()=>choose(g.id));grip.addEventListener('click',()=>{choose(g.id);grip.focus();});grip.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const i=prefs.order.indexOf(g.id);move(g.id,e.key==='Home'?0:e.key==='End'?prefs.order.length-1:i+(e.key==='ArrowUp'?-1:1),true);});row.append(grip);}
  g.button.classList.add('family-choice');g.button.classList.toggle('active',g.id===document.getElementById('group').value);row.append(g.button);list.append(row);
 }nav.append(list);updateSelection();}
 function move(id,index,focus=false){const from=prefs.order.indexOf(id);if(from<0||prefs.mode!=='custom')return;index=Math.max(0,Math.min(prefs.order.length-1,index));if(index===from)return;prefs.order.splice(from,1);prefs.order.splice(index,0,id);selected=id;persist();draw();if(focus)[...nav.querySelectorAll('[data-family-grip]')].find(b=>b.dataset.familyGrip===id)?.focus();announcement.textContent=byId.get(id).label+' moved to position '+(index+1)+' of '+prefs.order.length+'.';}
 panel.open=!prefs.collapsed;panel.addEventListener('toggle',()=>{prefs.collapsed=!panel.open;persist();});
 sort.addEventListener('change',()=>{prefs.mode=sort.value;persist();draw();announcement.textContent='Family list sorted by '+sort.selectedOptions[0].textContent+'.';});
 document.getElementById('familyUp').onclick=()=>{if(selected)move(selected,prefs.order.indexOf(selected)-1);};document.getElementById('familyDown').onclick=()=>{if(selected)move(selected,prefs.order.indexOf(selected)+1);};
 function clearDrag(){dragged=null;nav.querySelectorAll('.family-dragging,.family-drop-before,.family-drop-after').forEach(row=>row.classList.remove('family-dragging','family-drop-before','family-drop-after'));}
 nav.addEventListener('dragstart',e=>{const grip=e.target.closest('[data-family-grip]');if(!grip||prefs.mode!=='custom')return;dragged=grip.dataset.familyGrip;choose(dragged);e.dataTransfer?.setData('text/plain',dragged);if(e.dataTransfer)e.dataTransfer.effectAllowed='move';grip.closest('li').classList.add('family-dragging');});
 nav.addEventListener('dragover',e=>{const row=e.target.closest('[data-family-row]');if(!row||!dragged)return;e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='move';nav.querySelectorAll('.family-drop-before,.family-drop-after').forEach(x=>x.classList.remove('family-drop-before','family-drop-after'));const r=row.getBoundingClientRect();row.classList.add(e.clientY<r.top+r.height/2?'family-drop-before':'family-drop-after');});
 nav.addEventListener('drop',e=>{const row=e.target.closest('[data-family-row]');if(!row||!dragged||prefs.mode!=='custom')return;e.preventDefault();const id=dragged,target=row.dataset.familyRow;if(id!==target){const r=row.getBoundingClientRect(),rest=prefs.order.filter(x=>x!==id),index=rest.indexOf(target)+(e.clientY>=r.top+r.height/2?1:0);move(id,index,true);}clearDrag();});
 nav.addEventListener('dragend',clearDrag);
 window.addEventListener('desk-catalog-changed',()=>{
  for(const g of D.groups){
   const count=D.characters.filter(c=>c.group===g.id).length;if(!count)continue;
   let row=byId.get(g.id);
   if(!row){const button=document.createElement('button');button.type='button';button.dataset.group=g.id;row={id:g.id,label:g.label,count,button,index:groups.length};groups.push(row);ids.push(g.id);byId.set(g.id,row);if(!prefs.order.includes(g.id))prefs.order.push(g.id);}
   row.label=g.label;row.count=count;row.button.innerHTML=esc(g.label)+' <span>'+count+'</span>';
  }
  all.innerHTML='All families <span>'+D.audit.season1_entries+'</span>';
  const filter=document.getElementById('group'),selectedGroup=filter.value;
  filter.innerHTML='<option value="">All families &amp; groups</option>'+D.groups.map(g=>`<option value="${esc(g.id)}">${esc(g.label)}</option>`).join('');filter.value=selectedGroup;
  const stats=document.querySelectorAll('#stats .stat strong');if(stats.length){stats[0].textContent=D.audit.season1_entries;stats[1].textContent=D.groups.length;}
  draw();updateApprovedTotal();
 });
 draw();
})();
