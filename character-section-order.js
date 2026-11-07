/* Personal section order; never changes reference selections or image ranks. */
(()=>{
'use strict';
const prefix='desk-character-section-order-v1:';
function mount(cid){
 const root=document.getElementById('content'),legend=root?.querySelector(':scope > .section-status-legend');if(!legend)return;
 root.querySelector(':scope > .character-section-order')?.remove();
 const sections=[];for(let node=legend.nextElementSibling;node;node=node.nextElementSibling)sections.push(node);
 if(!sections.length)return;
 const rows=sections.map((node,index)=>{
  const heading=node.querySelector('h2'),summary=node.querySelector(':scope > summary');
  const title=node.classList.contains('obsoleteSection')?'Obsolete images':heading?.textContent.trim()||summary?.childNodes[0]?.textContent.trim()||'References';
  let id=node.dataset.categoryDisclosure?'category:'+JSON.parse(node.dataset.categoryDisclosure)[1]:node.classList.contains('canonpanel')?'selected':node.classList.contains('costume-looks-section')?'wardrobe':node.classList.contains('reference-review-section')?'coverage':node.classList.contains('obsoleteSection')?'obsolete':node.dataset.featuredDisclosure?'featured:'+JSON.parse(node.dataset.featuredDisclosure)[1]:node.id||title;
  node.dataset.sectionOrderId=id;return {node,id,title,index};
 });
 let prefs={mode:'importance',order:rows.map(r=>r.id)};
 try{const saved=JSON.parse(DESKStorage.getItem(prefix+cid)||'null');if(saved){if(['importance','alpha','custom'].includes(saved.mode))prefs.mode=saved.mode;if(Array.isArray(saved.order))prefs.order=[...new Set(saved.order.filter(id=>typeof id==='string'))];}}catch(_){}
 for(const row of rows)if(!prefs.order.includes(row.id))prefs.order.push(row.id);
 const toolbar=document.createElement('section');toolbar.className='character-section-order';toolbar.setAttribute('aria-label','Character section order');
 toolbar.innerHTML='<label>Section order <select aria-label="Section order"><option value="importance">Importance</option><option value="alpha">Alphabetical (A–Z)</option><option value="custom">Custom order</option></select></label><span class="section-order-hint"></span><details class="section-order-editor"><summary>Arrange sections</summary><ol></ol></details><span class="save-sr-only" role="status" aria-live="polite"></span>';
 legend.after(toolbar);
 const select=toolbar.querySelector('select'),hint=toolbar.querySelector('.section-order-hint'),editor=toolbar.querySelector('details'),list=toolbar.querySelector('ol'),status=toolbar.querySelector('[role=status]');
 function save(){try{DESKStorage.setItem(prefix+cid,JSON.stringify(prefs));}catch(_){status.textContent='This order works for now, but could not be saved in this browser.';}}
 function ordered(){return rows.slice().sort((a,b)=>prefs.mode==='alpha'?a.title.localeCompare(b.title)||a.index-b.index:prefs.mode==='custom'?prefs.order.indexOf(a.id)-prefs.order.indexOf(b.id):({images:0,selection:1,ready:2}[a.node.dataset.actionState]??2)-({images:0,selection:1,ready:2}[b.node.dataset.actionState]??2)||a.index-b.index);}
 function renderEditor(){
  list.replaceChildren();const orderedRows=ordered();
  orderedRows.forEach((row,index)=>{
   const li=document.createElement('li'),label=document.createElement('span');label.textContent=row.title;li.append(label);
   for(const [direction,symbol]of [[-1,'↑'],[1,'↓']]){const button=document.createElement('button');button.type='button';button.textContent=symbol;button.title='Move '+row.title+(direction<0?' up':' down');button.setAttribute('aria-label',button.title);button.disabled=index+direction<0||index+direction>=orderedRows.length;button.onclick=()=>move(row.id,direction);li.append(button);}
   list.append(li);
  });
 }
 function apply(){
  select.value=prefs.mode;editor.hidden=prefs.mode!=='custom';
  hint.textContent=prefs.mode==='importance'?'Images needed first, then selections needed.':prefs.mode==='alpha'?'Sections from A to Z.':'Saved for this character on this browser.';
  let previous=toolbar;for(const row of ordered()){if(previous.nextElementSibling!==row.node)previous.after(row.node);previous=row.node;}
  if(prefs.mode==='custom')renderEditor();
 }
 function move(id,direction){
  const visible=ordered(),index=visible.findIndex(r=>r.id===id),target=visible[index+direction];if(!target)return;
  const from=prefs.order.indexOf(id),to=prefs.order.indexOf(target.id);[prefs.order[from],prefs.order[to]]=[prefs.order[to],prefs.order[from]];save();apply();
  const label='Move '+rows.find(r=>r.id===id).title+(direction<0?' up':' down');const button=[...list.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label);if(button&&!button.disabled)button.focus();else list.querySelectorAll('li')[index+direction]?.querySelector('button:not(:disabled)')?.focus();
  status.textContent=rows.find(r=>r.id===id).title+' moved to position '+(index+direction+1)+'.';
 }
 select.onchange=()=>{prefs.mode=select.value;save();apply();if(prefs.mode==='custom')editor.open=true;};
 apply();
 toolbar.refreshOrder=()=>{if(prefs.mode==='importance')apply();};
}
window.DESKSectionOrder={mount,refresh(){document.querySelector('#content > .character-section-order')?.refreshOrder?.();}};
})();
