/* Location coverage lives in the catalogue; it never modifies character approvals. */
(()=>{
const P=window.DESKProduction;
const icon={filter:'<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>',script:'<path d="M6 3h11a2 2 0 0 1 2 2v13M6 3a3 3 0 0 0-3 3v2h5V6a3 3 0 0 0-2-3ZM6 8v11a2 2 0 0 0 2 2h10a3 3 0 0 0 3-3H10a3 3 0 0 1-2 3M10 8h5M10 12h5"/>',library:'<path d="M4 4v16M8 4v16M12 4v16M16 4l4 16M3 20h18"/>',plus:'<path d="M12 5v14M5 12h14"/>',help:'<path d="M9 18h6M10 21h4M8.5 14.5a6 6 0 1 1 7 0c-1 .8-1 1.5-1 2.5h-5c0-1 0-1.7-1-2.5Z"/>',back:'<path d="m14 6-6 6 6 6"/>',search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>'};
const svg=k=>`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon[k]}</svg>`;
const slots=l=>window.DESKLocationTemplates.slots(l);const find=id=>(D.locations||[]).find(l=>l.id===id);
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[“”’']/g,'').replace(/[-_\s]+/g,' ').trim();
const tagged=(a,l)=>{
 const names=[l.id,l.name,l.slug,l.id.replace(/-[a-f0-9]{8}$/i,''),...(l.aliases||[])].filter(Boolean).map(norm);
 const namedTags=(l.tags||[]).filter(t=>/^location:/i.test(t)).map(t=>norm(t.replace(/^location:/i,'')));
 return a.location_id===l.id||(a.location_ids||[]).includes(l.id)||(a.tags||[]).some(t=>names.includes(norm(t))||(/^location:/i.test(t)&&[...names,...namedTags].includes(norm(t.replace(/^location:/i,'')))));
};
const locationCandidates=l=>{
 const attached=new Set([l.canonical_source?.id,...Object.values(l.references||{}).flat(),...Object.values(l.selections||{}).map(r=>r.id)].filter(Boolean));
 return D.assets.filter(a=>effectiveStatus(a)!=='Obsolete'&&(attached.has(a.id)||tagged(a,l)));
};
const approved=(a,l)=>l.approvals?.[a.id]?.approved===true&&l.approvals[a.id].source_sha256===a.sha256;
const status=(a,l)=>effectiveStatus(a)==='Obsolete'?'Obsolete':approved(a,l)?'Approved reference':l.canonical_source?.id===a.id&&l.canonical_source?.source_sha256===a.sha256?'Canonical source':'Needs review';
const badge=(a,l)=>`<span class="badge ${['Canonical source','Approved reference'].includes(status(a,l))?'confirmed':status(a,l)==='Obsolete'?'obsolete':'candidate'}">${esc(status(a,l))}</span>`;
const rows=(l,s)=>(l.references?.[s]||[]).map(id=>assets.get(id)).filter(Boolean);
const usable=(l,s)=>rows(l,s).filter(a=>effectiveStatus(a)!=='Obsolete');
const filled=l=>slots(l).filter(s=>s.required&&usable(l,s.id).length).length;
let active=false,selected=null;
const featuredViews=new Map();
const detailTabs=new Map();
function remember(){try{DESKSessionStorage.setItem('desk-desk-collection',active?'locations':'characters');DESKSessionStorage.setItem('desk-location-id',selected||'');}catch{}}
function toggle(){ $('familyPanel').hidden=active;$('locationNav').hidden=!active;document.querySelector('.record-toolbar').hidden=active;$('charactersTab').setAttribute('aria-pressed',String(!active));$('locationsTab').setAttribute('aria-pressed',String(active));document.body.classList.toggle('location-mode',active);}
function deactivate(){$('content').style.minHeight='';active=false;selected=null;toggle();remember();}
const journeyGroups=D.journey_groups||[[999,'Locations']];
const relatedRoute=D.location_order||{};
const atlasNumber=l=>Math.min(...(l.website_sources||[]).map(p=>p.place_number).filter(n=>Number.isInteger(n)&&n>0));
const routeRank=l=>Number.isFinite(atlasNumber(l))?atlasNumber(l):(relatedRoute[l.id]??999);
const routeGroup=l=>journeyGroups.find(([end])=>routeRank(l)<end+0.99)?.[1]||'Other locations';
const imageRefs=l=>[...new Set(Object.values(l.references||{}).flat())].map(id=>assets.get(id)).filter(Boolean);
const defaultFilters=()=>({view:'production',membership:'',act:'',episode:'',order:'trail',region:'',kind:'',source:'',coverage:'',query:''});
let filters=defaultFilters();
try{const saved=JSON.parse(DESKStorage.getItem('desk-location-filters-v1')||'null');if(saved&&typeof saved==='object')for(const k of Object.keys(filters))if(typeof saved[k]==='string')filters[k]=saved[k];}catch{}
if(!['production','atlas'].includes(filters.view))filters.view='production';
if(!['trail','region','alpha'].includes(filters.order))filters.order='trail';
function saveFilters(){try{DESKStorage.setItem('desk-location-filters-v1',JSON.stringify(filters));}catch{}}
const alpha=(a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true});
function filteredLocations(f=filters){
 const q=norm(f.query||'');return (D.locations||[]).filter(l=>{
  const aa=imageRefs(l),live=aa.filter(a=>effectiveStatus(a)!=='Obsolete');
  return (!f.membership||P.source(l)===f.membership)&&(!(f.act||f.episode)||P.scenes(l,f).length>0)&&(!q||norm([l.name,l.description,l.region,...(l.aliases||[]),...(l.tags||[]),...aa.flatMap(a=>a.tags||[])].join(' ')).includes(q))&&(!f.region||l.region===f.region)&&(!f.kind||l.kind===f.kind)&&
   (!f.source||(f.source==='website'?!!l.website_sources?.length:f.source==='script'?!!l.script_sources?.length:f.source==='storyboard'?aa.some(a=>(a.location_provenance||[]).some(p=>p.board_id&&p.source_kind!=='website')):f.source==='maps'?aa.some(a=>(a.tags||[]).some(t=>norm(t)==='historical map')):false))&&
   (!f.coverage||(f.coverage==='has'?live.length>0:f.coverage==='none'?live.length===0:f.coverage==='review'?live.some(a=>status(a,l)==='Needs review'):f.coverage==='approved'?live.some(a=>approved(a,l)||status(a,l)==='Canonical source'):f.coverage==='missing'?P.stats(l,f).needed>0:f.coverage==='planning'?P.stats(l,f).pending>0:false));
 }).sort((a,b)=>f.order==='alpha'?alpha(a,b):f.order==='region'?(a.region||'Other locations').localeCompare(b.region||'Other locations')||alpha(a,b):routeRank(a)-routeRank(b)||alpha(a,b));
}
const options=(values,chosen)=>values.map(([value,label])=>`<option value="${esc(value)}" ${chosen===value?'selected':''}>${esc(label)}</option>`).join('');
const orders=[['trail','Map library · Project order'],['region','Region'],['alpha','Alphabetical · A–Z']];
const regions=()=>[['','All regions'],...[...new Set((D.locations||[]).map(l=>l.region).filter(Boolean))].sort((a,b)=>a.localeCompare(b)).map(v=>[v,v])];
function filterControls(){return `<details id="locationFilterDisclosure" class="location-filter-disclosure" ${$('locationFilterDisclosure')?.open?'open':''}><summary aria-label="Search and filter locations" title="Search and filter locations">${svg('search')}</summary><div class="location-filters" aria-label="Location filters"><label class="location-query">Search<input id="locationSearch" type="search" placeholder="Name, place, character or tag" value="${esc(filters.query)}"></label><label ${filters.view==='production'?'hidden':''}>Order<select data-location-filter="order">${options(orders,filters.order)}</select></label><label>Region<select data-location-filter="region">${options(regions(),filters.region)}</select></label><label>Type<select data-location-filter="kind">${options([['','All types'],...['building','landscape','camp','mobile','atlas'].map(v=>[v,v==='atlas'?'Map collection':v[0].toUpperCase()+v.slice(1)])],filters.kind)}</select></label><label>Evidence<select data-location-filter="source">${options([['','All sources'],['script','Episodic script'],['website','Places / Map library'],['storyboard','Cinematic storyboards'],['maps','Historical maps']],filters.source)}</select></label><label>Images<select data-location-filter="coverage">${options([['','Any image status'],['has','Has images'],['none','No active images'],['review','Needs review'],['approved','Has approved / canonical'],['missing','Production images needed'],['planning','Scene briefs to review']],filters.coverage)}</select></label><button data-location-clear>Clear filters</button></div></details>`;}
function sidebar(){
 const list=filteredLocations(),group=new Map();for(const l of list){const key=filters.order==='region'?l.region||'Other locations':filters.order==='trail'?routeGroup(l):'';if(!group.has(key))group.set(key,[]);group.get(key).push(l);}
 const button=l=>{const n=P.navigationState(l);return `<div class="location-nav-item location-progress-${n.state} ${selected===l.id?'active':''}" role="group" aria-label="${esc(l.name)}"><button class="location-nav-open" data-location-open="${esc(l.id)}" title="${esc(n.label)}"><span class="location-nav-name">${Number.isFinite(atlasNumber(l))?`<small>${atlasNumber(l)}.</small> `:''}${esc(l.name)}${P.sourceBadge(l,true)}</span>${P.navigationStatusIcon(n)}</button>${P.navigationProgress(n,l.id)}</div>`;};
 $('locationNav').innerHTML=`<details id="locationSidebarFilters" class="location-sidebar-filters" ${$('locationSidebarFilters')?.open?'open':''}><summary aria-label="Filters" title="Filters">${svg('filter')}</summary><div class="location-sidebar-filter-options">${P.controls(filters)}<div class="location-nav-controls" ${filters.view==='production'?'hidden':''}><label>Order<select data-location-filter="order">${options(orders,filters.order)}</select></label><label>Region<select data-location-filter="region">${options(regions(),filters.region)}</select></label></div></div></details><nav aria-label="Location navigation">${filters.view==='production'?P.navigation(list,filters,selected):[...group].map(([key,ls])=>key?`<details class="location-region" ${ls.some(l=>l.id===selected)||group.size===1?'open':''}><summary>${esc(key)} <span>${ls.length}</span></summary>${ls.map(button).join('')}</details>`:ls.map(button).join('')).join('')}${list.length?'':'<p>No matching locations.</p>'}</nav><button class="location-new" data-location-new aria-label="Add location" title="Add location">${svg('plus')}<span>Add location</span></button>`;
}


const help=()=>`<details class="location-help"><summary aria-label="Location coverage guide" title="Location coverage guide">${svg('help')}</summary><div><strong>Plan images from scene use</strong><p>Explore website locations as a reference library. In Production, review each scene brief and choose the views that support the story. Add shared reference views as they become useful.</p><p>Use source badges to see each location’s website and script connections. Start with suggested views, then save the scene brief to confirm your requirements.</p><p>Choose an overhead aerial for a top-down view, an orthographic view for a parallel projection, or an oblique aerial for an angled view. Label inferred geometry as a visual study and use measured sources to establish dimensions.</p><p>Choose working references to explore the design. Use Approve image to confirm an exact image version for the location. Reuse approved images across scenes and use the canonical source to guide visual consistency. Earlier images remain available in the picker.</p><p>Use + to add existing images or upload new ones. Tag each image with its locations, characters, families or subjects so you can find and reuse it.</p></div></details>`;
function show(id=null,{preserveScroll=false}={}){
 const x=window.scrollX,y=window.scrollY,nav=$('locationNav'),side=$('familySidebar');
 const navTop=nav.scrollTop,sideTop=side.scrollTop;
 const expanded=preserveScroll?[...nav.querySelectorAll('details')].map(d=>({label:d.querySelector(':scope > summary')?.textContent,open:d.open})):[];
 active=true;selected=id;current=null;toggle();remember();renderLocation();
 if(preserveScroll){
  for(const d of nav.querySelectorAll('details')){const old=expanded.find(v=>v.label===d.querySelector(':scope > summary')?.textContent);if(old)d.open=old.open;}
  const restore=()=>{nav.scrollTop=navTop;side.scrollTop=sideTop;window.scrollTo(x,y);};
  restore();requestAnimationFrame(restore);
 }else window.scrollTo(0,0);
}
let metricFrame=0;
function openNavigationMetric(button,{keyboard=false}={}){
 const id=button.dataset.metricLocation,kind=button.dataset.locationMetric,episode=button.dataset.metricEpisode;
 if(!find(id))return;
 cancelAnimationFrame(metricFrame);
 // Same-location shortcuts operate on the existing DOM, preserving open sections and images.
 if(selected!==id||!active){
  active=true;selected=id;current=null;toggle();remember();renderLocation({preserveNavigation:true});
  for(const row of document.querySelectorAll('#locationNav .location-nav-item'))row.classList.toggle('active',row.querySelector('[data-location-open]')?.dataset.locationOpen===id);
 }
 document.querySelector('.generation-activity')?.removeAttribute('open');
 activateLocationTab(kind==='scenes'?'scenes':kind==='references'?'images':'references',{preservePosition:false});
 let target;
 if(kind==='scenes'){
  const checklist=document.querySelector('.location-completion');
  if(checklist){
   checklist.open=true;
   const scene=episode?checklist.querySelector('[data-scene-episode="'+episode+'"]'):null;
   target=scene&&scene!==checklist.querySelector('.simple-scene-review')?scene:checklist;
  }else target=$('location-panel-scenes');
 }else if(kind==='references'){
  target=document.querySelector('.location-saved-gallery');
  if(target){for(const [name,value] of [['kind',''],['query',''],['status','approved']]){const field=target.querySelector('[data-gallery-filter="'+name+'"]');if(field&&field.value!==value){field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));}}}
 }
 if(!target){
  const library=document.querySelector('.location-detail-disclosure[data-section="library"]');
  if(library){library.open=true;target=library;}
  else target=$('location-panel-references');
 }
 if(!target)return;
 metricFrame=requestAnimationFrame(()=>{
  if(!target.isConnected)return;
  if(keyboard){target.tabIndex=-1;target.focus({preventScroll:true});}
  const rect=target.getBoundingClientRect(),top=(document.querySelector('body>header')?.getBoundingClientRect().bottom||0)+(document.querySelector('.location-detail-tabs')?.offsetHeight||0)+20;
  // Leave an already usable section in place; move only enough to reveal its heading and actions.
  const preview=Math.min(rect.height,260),bottom=window.innerHeight-24;
  if(rect.top>=top-2&&rect.top+preview<=bottom)return;
  window.scrollTo({top:Math.max(0,window.scrollY+rect.top-top),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 });
}
// Keep the existing controls mounted while switching between focused location views.
const locationTabNames=[['images','Images'],['scenes','Scene review'],['references','Reference views'],['details','Details']];
function installLocationTabs(l){
 const content=$('content'),toolbar=content.querySelector(':scope > .location-toolbar');
 if(!toolbar)return;
 const nodes=[...content.children].filter(el=>el!==toolbar),panels=new Map();
 const bar=document.createElement('div');bar.className='location-detail-tabs';bar.setAttribute('role','tablist');bar.setAttribute('aria-label','Location views');
 const chosen=detailTabs.get(l.id)||'images';
 for(const [key,label] of locationTabNames){
  const tab=document.createElement('button');tab.type='button';tab.id='location-tab-'+key;tab.dataset.locationTab=key;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','location-panel-'+key);tab.textContent=label;bar.append(tab);
  const panel=document.createElement('section');panel.id='location-panel-'+key;panel.className='location-tab-panel';panel.dataset.locationPanel=key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panel.tabIndex=0;panels.set(key,panel);
 }
 let library=false;
 for(const node of nodes){
  if(node.matches('.location-detail-disclosures')){
   for(const section of [...node.children]){
    const kind=section.dataset.section;
    if(kind==='production')panels.get('scenes').append(section);
    else if(kind==='library'){
     const heading=document.createElement('h2');heading.className='location-library-heading';heading.textContent='Reference views';panels.get('references').append(heading,...section.querySelector('.location-disclosure-body').children);section.remove();
    }
   }
   panels.get('details').append(node);
  }else{
   if(node.matches('.location-library-heading'))library=true;
   const key=library?'references':node.matches('.location-completion,.production-detail')?'scenes':node.matches('.location-feature,.location-saved-gallery')?'images':'details';
   panels.get(key).append(node);
  }
 }
 toolbar.after(bar);
 for(const [key,panel] of panels){
  if(!panel.children.length)panel.innerHTML='<p class="notice">'+(key==='scenes'?'No scene review is required for this reference location.':key==='images'?'No images saved yet. Use Generate image to start a reference.':'No additional information recorded.')+'</p>';
  content.append(panel);
 }
 activateLocationTab(chosen,{preservePosition:false});
}
function activateLocationTab(key,{focus=false,preservePosition=true}={}){
 const bar=document.querySelector('.location-detail-tabs'),panel=$('location-panel-'+key);
 if(!bar||!panel)return;
 const content=$('content'),x=scrollX,y=scrollY;
 // Reserve only enough page height to keep the current viewport when a shorter tab opens.
 // Otherwise the browser clamps scrollY and pulls the title and tabs down the screen.
 if(preservePosition){
  content.style.minHeight=Math.max(parseFloat(content.style.minHeight)||0,innerHeight-content.getBoundingClientRect().top+1)+'px';
  window.scrollTo({left:x,top:y,behavior:'instant'});
 }else content.style.minHeight='';
 detailTabs.set(selected,key);
 for(const tab of bar.querySelectorAll('[role="tab"]')){const on=tab.dataset.locationTab===key;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;if(on&&focus)tab.focus({preventScroll:true});}
 for(const el of document.querySelectorAll('.location-tab-panel'))el.hidden=el!==panel;
 if(key==='scenes'){const checklist=panel.querySelector('.location-completion');if(checklist)checklist.open=true;}
 // Tab buttons replace content in place; sidebar shortcuts handle their own navigation.
 if(preservePosition)window.scrollTo({left:x,top:y,behavior:'instant'});
}
document.addEventListener('keydown',e=>{
 const tab=e.target.closest('[data-location-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const keys=locationTabNames.map(x=>x[0]),i=keys.indexOf(tab.dataset.locationTab),next=e.key==='Home'?0:e.key==='End'?keys.length-1:(i+(e.key==='ArrowRight'?1:-1)+keys.length)%keys.length;
 activateLocationTab(keys[next],{focus:true});
});
function locationDescription(l){if(!l.description)return '';const ss=l.script_sources||[],ws=l.website_sources||[];return `<section class="location-description" aria-label="Location summary"><h2>Location summary</h2><p>${esc(l.description)}</p><details class="location-description-source"><summary>Source & context</summary><p>Catalog description saved for this location. Use the linked evidence to review the wording and design interpretation.</p>${l.script_source&&ss.length?`<p><strong>Script context:</strong> <a href="${esc(l.script_source.asset)}" download>${esc(l.script_source.title)}</a></p><p>${ss.map(s=>`Episode ${esc(s.episode)} · line ${esc(s.line)}`).join('; ')}. Read the exact passages in Script evidence below.</p>`:''}${ws.length?`<p><strong>Website context:</strong> ${ws.map(w=>`<a href="${esc(w.page_url)}" target="_blank" rel="noopener">${esc(w.name||w.collection||'Website source')}</a>`).join(' · ')}</p>`:''}</details></section>`;}
function sourceEvidence(l){if(!l.script_sources?.length)return '';return `<details class="location-evidence location-script-evidence"><summary>${svg('script')} Script evidence · ${l.script_sources.length} scene${l.script_sources.length===1?'':'s'} · Episodes ${[...new Set(l.script_sources.map(s=>s.episode))].join(', ')}</summary><p>${esc(l.inventory_basis||'')} · <a href="${esc(l.script_source.asset)}" download>Download source script</a></p>${l.script_sources.map(s=>`<details><summary>Episode ${s.episode} · line ${s.line} · ${esc(s.heading)}</summary><p class="small">${esc(s.basis)}</p><pre>${esc(s.excerpt)}</pre></details>`).join('')}<p class="small">Source: ${esc(l.script_source.title)} · SHA-256 ${esc(l.script_source.sha256)}</p></details>`;}

function websiteEvidence(l){if(!l.website_sources?.length)return '';return `<details class="location-evidence website-evidence"><summary>Website sources · Places / Map library</summary>${l.website_sources.map(p=>`<h3>${esc(p.name)}</h3><p>${esc(p.description||p.design_note||'')}</p>${p.caption?`<p><strong>Original caption:</strong> ${esc(p.caption)}</p>`:''}<p class="small">${esc(p.location_note||'')} ${p.latitude!==undefined?'Representative coordinates: '+esc(p.latitude)+', '+esc(p.longitude):''}</p><p><a target="_blank" rel="noopener" href="${esc(p.page_url)}">Open website source</a>${p.historical_source?` · <a target="_blank" rel="noopener" href="${esc(p.historical_source)}">Source cited by website</a>`:''}</p><p class="small">${esc(p.retrieval_note||'')}</p>`).join('')}</details>`;}
function provenanceNotes(a){return (a.location_provenance||[]).map(p=>p.source_kind==='website'?`<p><strong>${esc(p.collection)}</strong> · ${esc(p.source_status)}</p><p>${esc(p.caption||'')}</p><p>${esc(p.design_note||'')}</p><p class="small">${esc(p.rights||'')} ${esc(p.provenance||'')} ${esc(p.location_note||'')}</p><p><a target="_blank" rel="noopener" href="${esc(p.page_url)}">Open website source</a> · <a target="_blank" rel="noopener" href="${esc(p.image_url)}">Website image</a>${p.historical_source?` · <a target="_blank" rel="noopener" href="${esc(p.historical_source)}">Source cited by website</a>`:''}</p><p class="small">${esc(p.retrieval_note)}<br>Local source commit: ${esc(p.source_commit)}</p>`:`<p><strong>${esc(p.shot_id)}</strong> · Source status: ${esc(p.source_status||'Unspecified')}</p><p class="small">${esc(p.source)}<br>${esc(p.design_note||'')}</p>${p.board_id&&p.board_id!=='landscape-plates-20261027'?`<a target="_blank" rel="noopener" href="http://127.0.0.1:8899/viewer.html?id=${encodeURIComponent(p.board_id)}">Open source storyboard</a>`:''}`).join('');}

function renderLocation({preserveNavigation=false}={}){current=null;toggle();if(!preserveNavigation)sidebar();document.querySelector('.intro').hidden=true;$('characterTools').replaceChildren();$('results').replaceChildren();const l=find(selected);
 if(!l){selected=null;$('content').style.minHeight='';$('content').innerHTML=`<div class="location-toolbar"><h1>Locations</h1>${help()}<button data-location-new aria-label="Add location" title="Add location">${svg('plus')}</button></div>${filterControls()}<div class="location-info-strip" aria-label="Location information"><details class="location-count-help" name="location-info"><summary id="locationCountHelp" aria-label="About location counts">?</summary><p id="locationCount" class="small" role="status" aria-live="polite"></p></details><details class="location-count-help" name="location-info"><summary id="locationOrderHelp" aria-label="Location navigation tips">${svg('help')}</summary><p class="small" id="locationOrderNote"></p></details>${D.location_inventory?`<details class="location-inventory location-count-help" name="location-info"><summary aria-label="Sources & inventory" title="Sources & inventory">${svg('library')}</summary><p>${esc(D.location_inventory.scope)} <a href="${esc(D.location_inventory.source_asset)}" download>Source script</a></p></details>`:''}</div><div class="location-grid" id="locationCards"></div>`;drawCards();$('locationSearch').oninput=()=>{filters.query=$('locationSearch').value;saveFilters();sidebar();drawCards();};return;}
 const candidate=assets.get(l.canonical_source?.id),canon=candidate&&status(candidate,l)==='Canonical source'?candidate:null;
 if(l.kind!=='atlas'&&DESKLocationTemplates.resolve(l).mode==='ext'){
  $('content').innerHTML=exteriorDetail(l,canon);installLocationTabs(l);return;
 }
 $('content').innerHTML=`<div class="location-toolbar"><button data-location-home aria-label="Back to locations" title="Back to locations">${svg('back')}</button><h1>${esc(l.name)}</h1>${help()}<div class="location-generator-switch" role="group" aria-label="Image generator"><button class="location-generate-primary" data-location-chat="${esc(slots(l).find(s=>s.id==='interior-front')?.id||slots(l)[0]?.id||'scene-references')}">Generate</button><button class="location-beta-launch" data-location-beta="${esc(l.id)}" data-beta-slot="${esc(slots(l).find(s=>s.id==='interior-front')?.id||slots(l)[0]?.id||'scene-references')}">Generate (beta)</button></div></div>${P.progressDetail(l,filters)}${exteriorFeature(l,canon)}${window.DESKImageGalleries?.location(l)||''}${DESKLocationTemplates.control(l)}${locationDescription(l)}${P.detail(l,filters)}${sourceEvidence(l)}${websiteEvidence(l)}<p class="reference-tags">${(l.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</p><div class="production-section-heading location-library-heading"><h2>Reference library</h2><details class="location-count-help production-heading-help" name="location-detail-help"><summary aria-label="About the reference library" title="Optional shared views and source images. Add only what supports your design and scene requirements.">${svg('library')}</summary><p>Optional shared views and source images. Add only what supports your design and scene requirements.</p></details></div>${canon?`<section class="location-canonical"><a href="${esc(canon.asset)}" target="_blank" rel="noopener"><img src="${esc(canon.thumbnail)}" alt="Canonical source for ${esc(l.name)}"></a><div><strong>Canonical source</strong><p>${esc(l.canonical_source.basis)}</p><p class="small">${esc(canon.id)} · Exact source version retained.</p></div></section>`:''}${l.geometry_note?`<p class="notice">${esc(l.geometry_note.replace('Revision-02 studies are UNAPPROVED.','Revision-02 studies are proposals; each image shows its current approval status.'))}</p>`:''}${referenceLibrary(l)}`;
 installLocationTabs(l);
}

function selectedReference(l,sid){
 const choice=l.selections?.[sid];
 return choice&&rows(l,sid).find(a=>a.id===choice.id&&a.sha256===choice.source_sha256&&effectiveStatus(a)!=='Obsolete');
}
function featuredView(l,canon){
 const available=slots(l),remembered=featuredViews.get(l.id);
 if((remembered==='canonical'&&canon)||available.some(s=>s.id===remembered))return remembered;
 const chosen=available.filter(s=>selectedReference(l,s.id)).sort((a,b)=>(l.selections[b.id].selected_at||0)-(l.selections[a.id].selected_at||0));
 return chosen[0]?.id||(canon?'canonical':available.find(s=>usable(l,s.id).some(a=>approved(a,l)))?.id||available.find(s=>usable(l,s.id).length)?.id)||(l.kind==='landscape'?'landscape-wide':'scene-references');
}
function featuredViewApproval(l,sid,canon){
 if(sid==='canonical'&&canon)return {state:'approved',marker:'🟢',text:'Canonical source',hint:'Canonical source reference'};
 const images=usable(l,sid),n=images.length,approvedCount=images.filter(a=>approved(a,l)).length;
 const state=approvedCount?'approved':n?'review':'empty';
 const text=n?`${approvedCount}/${n} approved`:rows(l,sid).length?'No active image':'No image';
 const hint=n?`${approvedCount} approved · ${n-approvedCount} need review · ${n} active image${n===1?'':'s'}. Green means an approved image is available; orange means approval is needed.`:rows(l,sid).length?'All images in this category are set aside.':'No image attached to this category.';
 return {state,marker:approvedCount?'🟢':n?'🟠':'⚪',text,hint};
}
function featuredViewSelector(l,sid,canon){
 const entries=[...(canon?[{id:'canonical',label:'Canonical source'}]:[]),...slots(l)];
 const current=featuredViewApproval(l,sid,canon);
 return `<select id="locationFeaturedView" class="location-view-${current.state}" title="${esc(current.hint)}">${entries.map(s=>{const v=featuredViewApproval(l,s.id,canon);return `<option value="${esc(s.id)}" ${s.id===sid?'selected':''} title="${esc(v.hint)}">${v.marker} ${esc(s.id==='canonical'?s.label:v.text+' · '+s.label)}</option>`;}).join('')}</select>`;
}
function exteriorFeature(l,canon){
 const sid=featuredView(l,canon),canonical=sid==='canonical',a=canonical?canon:selectedReference(l,sid)||usable(l,sid).find(a=>approved(a,l)),target=canonical?'scene-references':sid;
 const count=locationCandidates(l).length;
 const viewLabel=sid.startsWith('interior-')||sid==='furniture-details'?'INT · Interior':sid==='landscape-wide'?'ENV · Landscape':sid.startsWith('exterior-')?'EXT · Exterior':sid.startsWith('aerial-')?'Aerial view':'Location reference';
 return `<section class="location-feature" aria-label="Featured location image"><div class="location-feature-heading"><div><span class="production-eyebrow">${esc(viewLabel)}</span><h2>${a?(canonical?'Canonical source':selectedReference(l,sid)?'Selected image':'Approved image'):'Choose an image'}</h2></div><label>View${featuredViewSelector(l,sid,canon)}</label></div>${a?`<figure><a href="${esc(a.asset)}" target="_blank" rel="noopener" aria-label="Open full image: ${esc(a.title)}"><img class="location-feature-image" src="${esc(a.asset)}" alt="${esc(a.title)}"></a><figcaption><span>${esc(a.title)}</span>${badge(a,l)}</figcaption></figure>`:`<div class="location-feature-empty"><svg viewBox="0 0 64 48" width="76" height="57" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="1" y="1" width="62" height="46" rx="5"/><circle cx="44" cy="13" r="5"/><path d="m4 42 18-23 14 17 8-9 16 15"/></svg><h3>Start the view for ${esc(l.name)}</h3><p>${count?`${count} reference image${count===1?' is':'s are'} available to choose.`:'Generate a new image or choose an existing reference.'}</p></div>`}<div class="location-feature-actions"><button data-location-chat="${esc(target)}">${svg('plus')} Generate image</button>${window.DESKLocationEditing?.button(l,target,a,a?'Refine image (beta)':'Generate (beta)')||''}<button data-location-feature-choose="${esc(target)}">${a?'Change image':'Choose image'}</button><button data-location-add="${esc(target)}">${svg('plus')} Add image</button>${a&&!canonical?`<button data-location-review="${esc(sid)}" data-location-asset="${esc(a.id)}">Review image</button>`:''}</div></section>`;
}
function exteriorDetail(l,canon){
 const existing=document.querySelector('.location-detail-disclosures');
 const expanded=new Set(existing?.dataset.locationId===l.id?[...$('content').querySelectorAll('.location-detail-disclosure[open]')].map(d=>d.dataset.section):[]);
 if($('locationTemplate')?.disabled)expanded.add('template');
 const disclosure=(key)=>`class="location-detail-disclosure" data-section="${key}" ${expanded.has(key)?'open':''}`;
 return `<div class="location-toolbar"><button data-location-home aria-label="Back to locations" title="Back to locations">${svg('back')}</button><h1>${esc(l.name)}</h1>${help()}<div class="location-generator-switch" role="group" aria-label="Image generator"><button class="location-generate-primary" data-location-chat="${esc(featuredView(l,canon)==='canonical'?'scene-references':featuredView(l,canon))}">Generate</button><button class="location-beta-launch" data-location-beta="${esc(l.id)}" data-beta-slot="${esc(featuredView(l,canon)==='canonical'?'scene-references':featuredView(l,canon))}">Generate (beta)</button></div></div>${P.progressDetail(l,filters)}${exteriorFeature(l,canon)}${window.DESKImageGalleries?.location(l)||''}<div class="location-detail-disclosures" data-location-id="${esc(l.id)}"><details ${disclosure('template')}><summary>Template settings <span>EXT · Exterior</span></summary><div class="location-disclosure-body">${DESKLocationTemplates.control(l)}</div></details><details ${disclosure('sources')}><summary>Location summary & sources <span>${P.source(l)==='both'?'Website + script':P.source(l)==='script-only'?'Script only':P.source(l)==='website-only'?'Website only':'Reference'}</span></summary><div class="location-disclosure-body">${locationDescription(l)}${sourceEvidence(l)}${websiteEvidence(l)}<p class="reference-tags">${(l.tags||[]).map(t=>`<span class="chip">${esc(t)}</span>`).join('')}</p></div></details><details ${disclosure('production')}><summary>Canonical references & scene briefs <span>${esc(P.summary(l,filters))}</span></summary><div class="location-disclosure-body">${P.detail(l,filters)}</div></details><details ${disclosure('library')}><summary>Reference library <span>${imageRefs(l).length} image${imageRefs(l).length===1?'':'s'}</span></summary><div class="location-disclosure-body">${canon?`<p><strong>Canonical source:</strong> ${esc(l.canonical_source.basis)}</p>`:''}${l.geometry_note?`<p class="notice">${esc(l.geometry_note.replace('Revision-02 studies are UNAPPROVED.','Revision-02 studies are proposals; each image shows its current approval status.'))}</p>`:''}${referenceLibrary(l)}</div></details></div>`;
}
function chooseFeaturedImage(sid){
 const l=find(selected);if(!l)return;
 const candidates=locationCandidates(l).sort((a,b)=>Number(approved(b,l))-Number(approved(a,l)));
 openModal('Choose image · '+l.name,`<p>All images attached or tagged to ${esc(l.name)}. Choosing an image approves it and selects it for ${esc(slots(l).find(s=>s.id===sid)?.label||sid)}.</p><div class="location-feature-actions"><button data-location-add="${esc(sid)}">+ Add existing image or upload</button><button data-location-chat="${esc(sid)}">Generate image</button></div><p id="locationFeatureStatus" role="status" aria-live="polite"></p><div class="reference-grid">${candidates.map(a=>`<article class="reference-choice"><img src="${esc(a.thumbnail)}" alt="${esc(a.title)}"><p>${esc(a.title)}</p>${badge(a,l)}<button data-location-feature-select="${esc(a.id)}" data-feature-slot="${esc(sid)}" ${selectedReference(l,sid)?.id===a.id&&approved(a,l)?'disabled':''}>${selectedReference(l,sid)?.id===a.id&&approved(a,l)?'Selected image':'Use this image'}</button><button data-location-review="${esc(sid)}" data-location-asset="${esc(a.id)}">Review image</button></article>`).join('')||'<p>No active images are attached or tagged to this location. Add an image to get started.</p>'}</div>`);
}
async function approveAndSelectReference(l,sid,a){
 return DESKReferenceLibrary.post('api/location-adopt',{location_id:l.id,slot_id:sid,asset_id:a.id,source_sha256:a.sha256,destination:'view',expected_approval:l.approvals?.[a.id]||null,expected_selection:l.selections?.[sid]||null});
}
async function selectFeaturedImage(b){
 const l=find(selected),sid=b.dataset.featureSlot,a=assets.get(b.dataset.locationFeatureSelect);if(!l||!a)return;
 b.disabled=true;
 try{await approveAndSelectReference(l,sid,a);featuredViews.set(l.id,sid);$('modal').close();renderLocation();toast('Image approved and selected for this view.');}
 catch(error){if($('locationFeatureStatus'))$('locationFeatureStatus').textContent=error.message;b.disabled=false;}
}

function referenceSlots(l,list){return `<div class="location-slot-grid">${list.map(s=>{const aa=rows(l,s.id),valid=usable(l,s.id),sel=l.selections?.[s.id],chosen=aa.find(a=>a.id===sel?.id&&a.sha256===sel?.source_sha256&&effectiveStatus(a)!=='Obsolete');return `<section class="location-slot ${valid.length?'available':'optional'}"><div class="location-slot-head"><h2>${esc(s.label)}</h2><button data-location-add="${esc(s.id)}" aria-label="Add reference: ${esc(s.label)}" title="Add reference">${svg('plus')}</button></div><p class="small">${s.required?(valid.length?valid.length+' available':'Missing'):'Optional references · '+valid.length+' available'}${aa.length>valid.length?' · '+(aa.length-valid.length)+' obsolete':''}${chosen?' · Working reference chosen':''}</p>${aa.length?`<div class="location-thumbs">${aa.slice(0,4).map(a=>`<button data-location-review="${esc(s.id)}" data-location-asset="${esc(a.id)}" title="Review ${esc(a.title)}"><img loading="lazy" src="${esc(a.thumbnail)}" alt="${esc(a.title)}">${badge(a,l)}</button>`).join('')}</div><button data-location-slot="${esc(s.id)}">Review ${aa.length} image${aa.length===1?'':'s'}</button>`:'<p class="small">Add existing references or upload from your computer.</p>'}<p><button data-location-chat="${esc(s.id)}">${valid.length?'Generate another image':'Generate image'}</button></p></section>`;}).join('')}</div>`;}
function referenceLibrary(l){const activeSlots=slots(l),ids=new Set(activeSlots.map(s=>s.id)),populated=activeSlots.filter(s=>rows(l,s.id).length),empty=activeSlots.filter(s=>!rows(l,s.id).length),retained=slots().filter(s=>!ids.has(s.id)&&rows(l,s.id).length),template=l.kind==='atlas'?'Map':DESKLocationTemplates.resolve(l).mode.toUpperCase();return `${populated.length?referenceSlots(l,populated):'<p>No reference images attached yet.</p>'}${empty.length?`<details class="location-extra-views"><summary>${template} template views · ${empty.length} optional categories</summary><p class="small">Choose reference views that establish the location and support your scenes.</p>${referenceSlots(l,empty)}</details>`:''}${retained.length?`<details class="location-extra-views"><summary>Saved references outside this template · ${retained.length} categories</summary><p class="small">Existing images and their approvals remain available here.</p>${referenceSlots(l,retained)}</details>`:''}`;}

const generationRoles=[{id:'overhead',label:'Overhead view',slots:['aerial-overhead','aerial-oblique'],purpose:'Use for the spatial arrangement, terrain and building placement.'},{id:'landscape',label:'Landscape view',slots:['landscape-wide','scene-references'],purpose:'Use for ground-level appearance, materials, atmosphere and surroundings.'},{id:'map',label:'Map',slots:['supporting-maps','aerial-overhead','aerial-oblique'],purpose:'Use for street routes, shoreline and landmark relationships; do not infer measured dimensions.'}];
const generationLibrary=l=>[...new Set([l.canonical_source?.id,...Object.values(l.references||{}).flat()].filter(Boolean))].map(id=>assets.get(id)).filter(a=>a&&effectiveStatus(a)!=='Obsolete');
// The chooser spans a named place and its sublocations, without promoting approvals.
const generationFamilyName=l=>norm(l.region)==='yerba buena'?'Yerba Buena':l.name.split(/\s+[—–]\s+/)[0].trim();
function generationFamily(l){const name=generationFamilyName(l);return {name,locations:(D.locations||[]).filter(x=>norm(generationFamilyName(x))===norm(name))};}
const generationLinked=(a,l)=>l.canonical_source?.id===a.id||Object.values(l.references||{}).some(ids=>ids.includes(a.id))||tagged(a,l);
function generationPickerLibrary(l){
 const family=generationFamily(l),phrase=norm(family.name),wordMatch=value=>(' '+norm(value)+' ').includes(' '+phrase+' ');
 return D.assets.filter(a=>family.locations.some(x=>generationLinked(a,x))||[a.title,...(a.tags||[]),...(a.sources||[]),a.preferred_source_path,...(a.source_provenance||[]).map(x=>x.path)].filter(Boolean).some(v=>wordMatch(String(v).replace(/[\/\\.]/g,' '))));
}
function generationPickerOrigin(a,l){const origins=generationFamily(l).locations.filter(x=>generationLinked(a,x));return origins.length?origins.map(x=>x.name).join(' · '):'Named or tagged '+generationFamilyName(l)+' reference';}
function generationPickerStatus(a,l){
 if(effectiveStatus(a)==='Obsolete')return 'Obsolete · unavailable for generation';
 if(P.isApproved(a,l))return status(a,l);
 const elsewhere=generationFamily(l).locations.filter(x=>x.id!==l.id&&P.isApproved(a,x));
 return elsewhere.length?'Needs review here · Approved for '+elsewhere.map(x=>x.name).join(' · '):'Needs review';
}
// Carry context only for exact chosen attachments; related candidates never become canon.
function generationSourceContext(l,refs){
 const limit=(text,n)=>String(text||'').length>n?String(text).slice(0,n)+'…':String(text||'');
 const sources=generationFamily(l).locations.filter(x=>refs.some(r=>{const a=assets.get(r.id);return a&&a.sha256===r.sha256&&generationLinked(a,x);}));
 return sources.slice(0,6).map(x=>{
  const scenes=Object.values(x.production?.scenes||{}).filter(scene=>scene.source_sha256===x.script_source?.sha256&&(scene.requirements||[]).some(req=>refs.some(r=>req.asset_id===r.id&&req.source_sha256===r.sha256)));
  return `Source location: ${x.name} (${x.id})\nBrief: ${limit(x.description,600)}${x.geometry_note?'\nGeometry notes: '+limit(x.geometry_note,600):''}${x.canonical_source?.basis?'\nCanonical basis: '+limit(x.canonical_source.basis,400):''}${scenes.length?'\nCurrent scene notes for these exact images (retain any stated uncertainty): '+limit(scenes.map(scene=>[scene.conditions,scene.changes,scene.decisions].filter(Boolean).join('\n')).join('\n'),1800):''}`;
 }).join('\n\n');
}
function generationRefs(l,choices){
 const available=generationLibrary(l),refs=[];
 for(const role of generationRoles){const choice=choices?.[role.id];if(!choice)continue;const a=available.find(a=>a.id===choice.id&&a.sha256===choice.sha256);if(!a)throw Error(role.label+' reference is no longer available at the selected version. Choose it again.');if(!refs.some(r=>r.id===a.id&&r.sha256===a.sha256))refs.push({id:a.id,sha256:a.sha256,role:'location'});}
 return refs;
}
const promptExcerpt=(value,max=1800)=>{const text=String(value||'').trim();return text.length>max?text.slice(0,max)+'\n[Excerpt shortened; omitted details are not established by this prompt.]':text;};
function generationSceneSelection(l,s,target){
 const scenes=l.script_sources||[],key=x=>`${x.episode}:${x.line}`;
 if(target?.sceneKey)return scenes.find(x=>key(x)===target.sceneKey)||null;
 const matching=scenes.filter(x=>{const plan=l.production?.scenes?.[key(x)];return plan?.source_sha256===l.script_source?.sha256&&(plan.requirements||[]).some(r=>r.slot_id===s.id);});
 return matching.length===1?matching[0]:scenes.length===1?scenes[0]:null;
}
function generationSceneContext(l,s,target){
 const scene=generationSceneSelection(l,s,target);
 if(!scene)return 'No single scene is selected. Create a reusable location study; do not merge different episodes, weather or story moments. For a particular scene, start from its Scene review image requirement.';
 const plan=l.production?.scenes?.[`${scene.episode}:${scene.line}`],current=!!plan&&plan.source_sha256===l.script_source?.sha256;
 const requirements=current?(plan.requirements||[]).filter(r=>target?.requirementId?r.id===target.requirementId:r.slot_id===s.id):[];
 return `Scene: Episode ${scene.episode}, line ${scene.line}\nScript source SHA-256: ${l.script_source?.sha256||'not recorded'}\nScript action excerpt (narrative evidence, not design approval):\n${promptExcerpt(scene.excerpt||scene.heading,2200)}\nBrief status: ${current?'Reviewed for the current script':'Not reviewed for the current script; treat as a provisional scene study. Do not reuse a stale brief.'}${current?`\nScene conditions: ${promptExcerpt(plan.conditions,1200)||'Not established; use the selected visual reference where compatible, without inventing a date or season.'}\nSaved scene direction: ${promptExcerpt(plan.changes,2500)||'None recorded'}\nUnresolved decisions: ${promptExcerpt(plan.decisions,1500)||'None recorded'}\nRequested scene coverage: ${requirements.map(r=>promptExcerpt(r.view,1500)).join(' | ')||'No reviewed requirement for this output view.'}`:''}`;
}
function generationComposition(s){
 if(s.id==='scene-references')return 'Compose one clear scene-setting frame: show the principal location feature, a legible approach or exit and enough usable foreground for the scripted blocking. Use foreground, middle distance and background to make spatial relationships readable. Translate character actions into clear staging space; do not depict the characters in this empty location plate. Do not force a wide shot if the requirement calls for a closer composition.';
 if(s.id==='landscape-wide')return 'Build a readable wide environment composition with usable foreground, a continuous route through the middle distance and grounded background geography. Preserve the reference’s waterline, slope and route connections. Keep scale believable; let fog obscure visibility without relocating landmarks.';
 if(s.id==='interior-floorplan')return 'Use a true top-down plan with consistent orientation, clear circulation and only evidenced walls, doors and fixed features. Do not fill unknown rooms or rear spaces; distinguish unresolved areas without inventing dimensions.';
 if(['aerial-overhead','aerial-oblique','supporting-maps'].includes(s.id))return 'Prioritize the exact established road network, intersections, shoreline, relative landmark positions and connected route. Keep one coherent orientation and believable relative scale. Separate confirmed geography from unresolved areas; no invented measured scale, compass bearing or extra streets. Do not add labels unless requested.';
 if(s.group==='Exterior')return 'Frame the requested exterior side with enough surrounding ground to understand its footprint, approach and adjacent route. Keep verticals coherent and perspective natural. Do not show a hidden side as established when the references show only the front or an interior.';
 if(s.group==='Interior')return 'Place the camera at a plausible height and make the requested viewing direction legible. Preserve floor levels, openings, structural spacing and fixed furniture. Maintain clear foreground circulation; do not invent rooms, galleries or windows outside the evidence.';
 if(s.group==='Details')return 'Make the requested detail the single clear subject. Show material grain, joints, wear and construction at a useful scale, with enough adjacent context to locate it. Keep the object’s proportions and materials tied to the source; avoid unrelated decorative additions.';
 return 'Use a single readable composition appropriate to the requested view. Preserve established proportions, spatial relationships and materials; distinguish a visual study from a measured reconstruction.';
}
function generationAutoDirection(l,s,seed='',target){
 const scene=generationSceneSelection(l,s,target),plan=scene&&l.production?.scenes?.[`${scene.episode}:${scene.line}`],current=plan?.source_sha256===l.script_source?.sha256;
 return [`Scene purpose: ${promptExcerpt(seed||l.description||'Establish the location for the requested view.',850)}`,scene?`Story moment: ${promptExcerpt(scene.heading,450)}`:'Keep this a reusable location study; avoid combining separate story moments.',current&&plan.conditions?`Conditions: ${promptExcerpt(plan.conditions,350)}`:'Lighting and weather: follow compatible selected references and the script; leave unspecified season and time unresolved.','Staging: make the approach, exit and usable action space legible. Treat named characters and action as blocking context for an empty location plate.','Continuity: preserve the selected references’ established geography, proportions and materials. Use related-location images only for the aspects they establish; do not copy an unrelated building, people or props.','Unestablished architecture and off-camera layout remain provisional. Do not turn a narrative cue (such as a bell sound) into a specific tower, façade or floor count.'].filter(Boolean).join('\n\n').slice(0,2500);
}

function creationRequest(l,s,choices={},context={}){
 const refs=generationRefs(l,choices);
 const referenceText=generationRoles.filter(role=>choices[role.id]).map(role=>{const choice=choices[role.id],i=refs.findIndex(r=>r.id===choice.id&&r.sha256===choice.sha256);return `${role.label} — attached image ${i+1}: ${assets.get(choice.id).title} (${choice.id})\nStatus: ${generationPickerStatus(assets.get(choice.id),l)}\nSource: ${generationPickerOrigin(assets.get(choice.id),l)}\n${role.purpose}`;}).join('\n\n');
 let view=s.id==='interior-floorplan'?'Create an overhead interior floorplan. Keep walls, openings, circulation and floor levels consistent. Mark unseen areas unresolved; do not invent measured dimensions.':s.id==='aerial-overhead'?'Create a directly overhead exterior aerial including the surrounding environment. Keep the footprint and orientation consistent with reviewed references.':s.id==='aerial-oblique'?'Create an orthographic / oblique exterior aerial with surrounding environment. This is a visual reference, not a measured survey.':s.group==='Exterior'?`Create a wide exterior view of the ${s.id.replace('exterior-','')} side, showing the location’s outdoor form, terrain or built structure and its immediate surroundings.`:s.group==='Interior'?`Create an empty wide interior view ${s.id==='interior-front'?'toward the front':s.id==='interior-back'?'toward the back':'of the '+s.id.replace('interior-','')+' side'}. Keep floor levels, openings, fixed furniture and architectural orientation consistent.`:s.id==='landscape-wide'?'Create a wide environment plate showing the landscape and usable foreground, preserving terrain, water, trail direction, season and existing geography. Do not invent a building to satisfy architectural coverage.':s.id==='supporting-maps'?'Create one geographic reference map using the cited source maps. Distinguish schematic alignment from measured coordinates and do not invent surveyed routes.':s.id==='scene-references'?'Create one scene-setting reference for this location, using the script evidence and saved continuity choices.':s.group==='Details'?'Create one clear furniture or architectural detail reference, using an existing reviewed detail as the subject where available. Preserve its materials, construction and proportions.':DESKLocationTemplates.resolve(l).mode==='ext'?'Create one outdoor elevation or terrain profile consistent with the reviewed location references. Show exterior form and surrounding ground.':'Create one empty architectural geometry study consistent with the reviewed location references.';
 return `Create a location reference for ${l.name}: ${s.label}.
Location ID: ${l.id}
Coverage slot ID: ${s.id}
Image format: ${context.aspect||'16:9 widescreen'}
Location template: ${DESKLocationTemplates.resolve(l).mode.toUpperCase()} (${DESKLocationTemplates.resolve(l).override?'location override':'automatic'})

Location brief: ${l.description||'No location description recorded yet.'}
Tags: ${(l.tags||[]).join(', ')}
${l.website_sources?.length?'Website context: '+l.website_sources.map(p=>p.name+' — '+(p.description||p.design_note||'')+'; '+p.page_url).join(' | '):''}
${l.script_source?'Script: '+l.script_source.title+'; exact source '+l.script_source.sha256:''}

SCENE EVIDENCE
${generationSceneContext(l,s,context.sceneTarget)}

Requested view: ${view}
One standalone image, no montage or multiple-view sheet. No people. Use clear architectural visibility appropriate to this coverage view.

COMPOSITION & STAGING
${generationComposition(s)}

VISUAL TREATMENT
Match the compatible attached references’ visual language, period, materials and level of realism. Use coherent perspective, natural material texture and plausible light direction. Maintain readable shadow detail; weather and atmosphere should support the scene without concealing every useful design feature. Do not add modern objects, decorative signage, watermarks, captions or a collage. Do not copy incidental people or unrelated props from reference images.

Reference images chosen for this generation:
${referenceText||'No saved visual references. Use the explicitly supplied initial design direction as a proposal.'}

${refs.length?'Context from the chosen source images:\n'+generationSourceContext(l,refs):''}
Related images retain their source approval status; approval elsewhere does not approve them for this location. Candidates remain proposals, not canon. Current exact approved images and saved choices take precedence over older notes; leave unresolved conflicts visible.
${l.canonical_source?.basis?'\nCanonical source basis: '+l.canonical_source.basis:''}
${l.production?.continuity?'\nShared continuity notes (may contain historical proposals; current saved decisions take precedence): '+promptExcerpt(l.production.continuity,2000):''}
${l.geometry_note?'\nGeometry notes: '+l.geometry_note.replace('Revision-02 studies are UNAPPROVED.','Revision-02 studies are proposals; use the current approval status listed above.'):''}

Use only the reference images listed above as image inputs. Each numbered attachment is provided with this request. Use the location context above and the stated purpose of each reference. Preserve the established design and continuity. Follow the requested direction for this view. Do not infer exterior architecture, environment or unseen rear layout from an interior alone. Do not invent additional floors, galleries, windows or wings. Use the current saved choices if older notes conflict.

Before rendering, check the requested viewpoint, the scene’s usable action space, the role of every attachment, existing geography and architectural limits. A related street image establishes local context, not the target building’s façade. Audible or off-screen script events do not establish a visible tower, room or building. If visual evidence conflicts, preserve explicit current direction and leave unsupported areas unresolved rather than combining incompatible designs.

Generate one image. The application will save it to this location and view as an unapproved candidate for review.`;
}
function generationRequest(l,s,{direction='',aspect='16:9 widescreen',initialDesign=false,referenceChoices={},sceneBrief='',sceneTarget=null}={}){
 const refs=generationRefs(l,referenceChoices),note=direction.trim();
 if(!refs.length&&!initialDesign)throw Error('Choose at least one reference image above. You can fill all three slots.');
 if(!refs.length&&note.length<20)throw Error('Describe the initial design in at least 20 characters before generating.');
 if(sceneTarget?.sceneKey&&!generationSceneSelection(l,s,sceneTarget))throw Error('The selected scene no longer exists. Reopen its scene review before generating.');
 const prompt=creationRequest(l,s,referenceChoices,{sceneTarget,aspect})+(!generationSceneSelection(l,s,sceneTarget)&&sceneBrief?'\n\nSupplemental scene direction:\n'+sceneBrief:'')+(note?'\n\n'+(!refs.length?'Initial design direction':'Additional direction')+':\n'+note:'');
 if(prompt.length>30000)throw Error('The combined prompt is too long. Shorten the additional direction or scene notes before generating.');
 return DESKReferenceGeneration.locationRequest(l,s.id,prompt,{prompt_version:'location-v2-scene-grounded',input_references:refs,generation_reference_roles:generationRoles.filter(role=>referenceChoices[role.id]).map(role=>({label:role.label,...referenceChoices[role.id]})),aspect,design_proposal:!refs.length&&initialDesign,design_direction:!refs.length?note:''});
}
// Keep workbench drafts when returning to the original image request.
const mapSheetDrafts=new Map();
function openMapSheet(l,mode,onBack,onUse){
 const isMap=mode==='map',slotId=isMap?'supporting-maps':'aerial-overhead',key=l.id+':'+mode;
 const sourceImages=()=>generationPickerLibrary(l);
 const activeSources=()=>sourceImages().filter(a=>effectiveStatus(a)!=='Obsolete');
 let linkingSource=false;
 const saved=mapSheetDrafts.get(key),sourceList=activeSources().filter(a=>P.isApproved(a,l));
 let chosen=new Map((saved?.references||sourceList.slice(0,3).map(a=>({id:a.id,sha256:a.sha256}))).map(r=>[r.id,r.sha256]));
 let latest=saved?.latest||null,custom=!!saved?.custom,stale=!!saved?.stale,undoPrompt=null;
 const defaults={angle:'Directly overhead',style:'Painted color',labels:isMap?'Numbered landmark bubbles':'No labels',detail:'Streets, terrain and landmarks',format:'16:9 widescreen',notes:'',prompt:''},values={...defaults,...saved};
 const select=(id,label,items,value)=>`<label for="${id}">${label}</label><select id="${id}">${options(items.map(x=>[x,x]),value)}</select>`;
 openModal((isMap?'Create map':'Fill overhead prompts')+' · '+l.name,`<section class="map-sheet"><div class="map-sheet-heading"><div><p class="eyebrow">${isMap?'MAP WORKBENCH':'OVERHEAD WORKBENCH'}</p><h2>${isMap?'Build the geography':'Prepare an overhead view'}</h2><p class="small">Choose source images, shape the prompt, then generate a candidate.</p></div><button id="mapSheetBack" type="button">Back to image request</button></div><div class="map-sheet-layout"><aside class="map-sheet-tools" aria-label="Map tools"><h3>${isMap?'Map tools':'View tools'}</h3>${select('mapAngle','Camera',['Directly overhead','Oblique bird’s-eye'],values.angle)}${select('mapStyle','Rendering',['Painted color','Colored cartographic','Ink and watercolor'],values.style)}${select('mapLabels','Labels',['Numbered landmark bubbles','Landmark names','No labels'],values.labels)}${select('mapDetail','Include',['Streets, terrain and landmarks','Streets and shoreline only','Terrain and routes'],values.detail)}${select('mapFormat','Image format',['16:9 widescreen','3:2 landscape','1:1 square'],values.format)}<label for="mapNotes">Route & framing notes</label><textarea id="mapNotes" rows="4" maxlength="2500" placeholder="Known route, landmarks to include, or framing…">${esc(values.notes)}</textarea><p class="small">Unseen geography stays unresolved. This is a visual study, not a survey.</p></aside><div class="map-sheet-main"><section class="map-sheet-sources"><div class="map-sheet-section-heading"><h3>Source images · ${esc(generationFamilyName(l))}</h3><span id="mapSourceCount" class="small" role="status"></span></div><p class="small">Choose up to six images from all related locations. Approval labels stay unchanged; candidates are not canon.</p><label for="mapSourceSearch">Search source images</label><input id="mapSourceSearch" type="search" placeholder="Image title, tag or location"><p id="mapSourceMatches" class="small"></p><p id="mapSourceMessage" class="small" role="status"></p><div id="mapSources" class="map-sheet-source-grid"></div></section><section class="map-sheet-prompt"><div class="map-sheet-section-heading"><h3>${isMap?'Map prompt':'Overhead prompt'}</h3><div><button type="button" id="mapFillPrompt">Fill Prompts</button><button type="button" id="mapUndoPrompt" hidden>Undo fill</button></div></div><label for="mapPrompt">Editable direction</label><textarea id="mapPrompt" rows="8" maxlength="12000"></textarea><p id="mapPromptNote" class="small" role="status"></p></section><section id="mapSheetResult" class="map-sheet-result" hidden aria-label="Generated map preview"></section><div id="mapSheetGeneration"></div></div></div></section>`);
 $('modal').scrollTop=0;$('modalBody').scrollTop=0;
 const refs=()=>{
  if(linkingSource)throw Error('Adding the chosen source image…');
  const available=activeSources();if(!chosen.size)throw Error('Choose at least one source image.');
  if(chosen.size>6)throw Error('Choose up to six source images.');
  return [...chosen].map(([id,sha256])=>{if(!available.some(a=>a.id===id&&a.sha256===sha256))throw Error('A chosen source changed or was set aside. Choose an active current version.');return {id,sha256,role:'location'};});
 };
 const fields=()=>({angle:$('mapAngle').value,style:$('mapStyle').value,labels:$('mapLabels').value,detail:$('mapDetail').value,format:$('mapFormat').value,notes:$('mapNotes').value,prompt:$('mapPrompt').value});
 function remember(){mapSheetDrafts.set(key,{...fields(),references:[...chosen].map(([id,sha256])=>({id,sha256})),latest,custom,stale});}
 function filledPrompt(){const v=fields();return `Create one ${isMap?'colored geographic reference map':'overhead environment reference'} of ${l.name}.\nCamera: ${v.angle}. Rendering: ${v.style}. Format: ${v.format}.\nInclude: ${v.detail}. ${v.detail==='Streets and shoreline only'?'Remove all buildings, ships and people; preserve the exact visible street network and shoreline.':v.detail==='Terrain and routes'?'Emphasize terrain, water and route connections; omit building and ship illustrations.':'Use the attached images for landmark forms, respecting the approval status listed for each source. Candidate details remain proposals, not established canon.'}\nLabels: ${v.labels}. ${v.labels==='Numbered landmark bubbles'?'Use small numbered circles near established landmarks; no place-name text.':v.labels==='No labels'?'No text, numbers or legend.':'Name only landmarks identified in the location context or source images.'}\nPreserve established street directions, intersections, coastline, terrain and relative landmark placement. Do not invent unseen streets, building footprints, additional floors or rear layouts. Show uncertain areas as unresolved rather than filling them with invented detail. No measured scale or invented compass bearing. No people. One standalone image, no montage.\n${v.notes.trim()?'Route and framing: '+v.notes.trim():'Frame the established location and its immediate surroundings.'}`;}
 function request(){
  const inputs=refs();if(stale)throw Error('Tools changed. Click Fill Prompts to update the direction, or edit the direction to confirm it.');
  const prompt=$('mapPrompt').value.trim();if(prompt.length<20)throw Error('Fill or write the image direction before generating.');
  const context=`Location: ${l.name} (${l.id})\nBrief: ${l.description||'Not recorded'}\n${l.script_source?'Script: '+l.script_source.title+'; source '+l.script_source.sha256:''}\n${l.script_sources?'Scene evidence: '+l.script_sources.map(x=>'Episode '+x.episode+', line '+x.line+': '+x.heading).join(' | '):''}\n${l.geometry_note?'Continuity notes: '+l.geometry_note:''}\n${l.canonical_source?.basis?'Canonical basis: '+l.canonical_source.basis:''}\nSelected source attachments and approval status:\n${inputs.map((r,i)=>`${i+1}. ${assets.get(r.id).title} — ${r.id} — ${generationPickerStatus(assets.get(r.id),l)}; source: ${generationPickerOrigin(assets.get(r.id),l)}`).join('\n')}\n\nContext from the chosen source images:\n${generationSourceContext(l,inputs)}\nCurrent exact approved images and saved choices take precedence over older notes.\nUse these exact attached images as visual references. Unapproved sources are design candidates, not canon. Prefer approved evidence when it conflicts with a candidate. Where references conflict or do not show a layout, leave that area unresolved.\n\n`;
  return DESKReferenceGeneration.locationRequest(l,slotId,context+prompt+'\n\nSave this as an unapproved candidate for review. Existing selections and approvals remain unchanged.',{input_references:inputs,aspect:$('mapFormat').value});
 }
 const panel=DESKGeneration.mount($('mapSheetGeneration'),null,{storageKey:'desk-map-workbench-job:'+key,request,onResult:(a,job)=>{if(!latest||(job.created_at||0)>=(latest.created_at||0)){latest={id:a.id,sha256:a.sha256,created_at:job.created_at||0};remember();drawResult();}}});
 function update(){try{request();panel.prepare({});}catch(e){panel.invalidate(e.message);}remember();}
 function drawSources(){const all=sourceImages(),query=norm($('mapSourceSearch').value),current=all.filter(a=>!query||norm([a.title,a.id,...(a.tags||[]),generationPickerOrigin(a,l)].join(' ')).includes(query)).sort((a,b)=>Number(effectiveStatus(a)==='Obsolete')-Number(effectiveStatus(b)==='Obsolete'));
 $('mapSources').innerHTML=current.map(a=>`<label class="map-sheet-source"><input type="checkbox" data-map-source="${esc(a.id)}" ${linkingSource||effectiveStatus(a)==='Obsolete'?'disabled':''} ${chosen.get(a.id)===a.sha256?'checked':''}><img src="${esc(a.thumbnail)}" alt="" loading="lazy"><span>${esc(a.title)}</span><small>${esc(generationPickerStatus(a,l))}</small><small class="map-source-origin">${esc(generationPickerOrigin(a,l))}</small></label>`).join('')||'<p class="map-sheet-empty">No matching source images. Try another search or add an image to the location library.</p>';
 $('mapSourceCount').textContent=chosen.size+' / 6 selected';$('mapSourceMatches').textContent=`${current.length} of ${all.length} images across ${generationFamilyName(l)} · Obsolete images are shown for context only.`;}

 function drawResult(){
  const host=$('mapSheetResult'),a=latest&&assets.get(latest.id);if(!a||a.sha256!==latest.sha256||effectiveStatus(a)==='Obsolete'){host.hidden=true;return;}
  host.hidden=false;host.innerHTML=`<div class="map-sheet-section-heading"><h3>${isMap?'Map preview':'Overhead preview'}</h3>${badge(a,l)}</div><div class="map-sheet-canvas"><img id="mapResultImage" src="${esc(a.asset)}" alt="${esc(a.title)}"></div><div class="map-sheet-result-tools"><label for="mapZoom">Preview zoom</label><input id="mapZoom" type="range" min="100" max="200" step="25" value="100"><button type="button" id="mapFit">Fit</button><a href="${esc(a.asset)}" target="_blank" rel="noopener">Full image</a><button type="button" id="mapUseResult" class="map-sheet-primary">${isMap?'Use map':'Use overhead view'}</button></div><p class="small">Adds this exact result to the original request’s ${isMap?'Map':'Overhead view'} slot. Approval remains unchanged. Edit the prompt to generate another version.</p><p id="mapUseStatus" role="status"></p>`;
  $('mapZoom').oninput=()=>{$('mapResultImage').style.width=$('mapZoom').value+'%';};$('mapFit').onclick=()=>{$('mapZoom').value='100';$('mapResultImage').style.width='100%';};
  $('mapUseResult').onclick=async()=>{const b=$('mapUseResult');b.disabled=true;try{await ensureCoverage(l,slotId,a);remember();onUse(a);}catch(e){if(b.isConnected){$('mapUseStatus').textContent=e.message;b.disabled=false;}}};
 }
 $('mapSourceSearch').oninput=drawSources;
 $('mapSources').onchange=async e=>{const id=e.target.dataset.mapSource;if(!id||linkingSource)return;const image=activeSources().find(a=>a.id===id);if(!image)return;
 if(!e.target.checked){chosen.delete(id);drawSources();update();return;}
 if(chosen.size>=6){e.target.checked=false;$('mapSourceMessage').textContent='Six selected — uncheck one first.';return;}
 const host=$('mapSources');chosen.set(id,image.sha256);linkingSource=true;drawSources();panel.invalidate('Adding the chosen source image…');$('mapSourceMessage').textContent='';
 try{if(!generationLibrary(l).some(a=>a.id===id))await ensureCoverage(l,slotId,image);if(!host.isConnected)return;chosen.set(id,image.sha256);}
 catch(error){chosen.delete(id);if(host.isConnected)$('mapSourceMessage').textContent=error.message;}
 finally{linkingSource=false;if(host.isConnected){drawSources();update();}}
 };

 function fill(){undoPrompt=$('mapPrompt').value;$('mapPrompt').value=filledPrompt();custom=false;stale=false;$('mapUndoPrompt').hidden=!undoPrompt;$('mapPromptNote').textContent='Filled from the tools and saved location context. Edit freely before generating.';update();}
 $('mapFillPrompt').onclick=fill;
 $('mapUndoPrompt').onclick=()=>{const previous=$('mapPrompt').value;$('mapPrompt').value=undoPrompt;undoPrompt=previous;custom=true;stale=false;$('mapPromptNote').textContent='Previous prompt restored.';update();};
 $('mapPrompt').oninput=()=>{custom=true;stale=false;$('mapPromptNote').textContent='Using your edited direction.';update();};
 for(const id of ['mapAngle','mapStyle','mapLabels','mapDetail','mapFormat','mapNotes'])$(id).addEventListener(id==='mapNotes'?'input':'change',()=>{if(custom){stale=true;$('mapPromptNote').textContent='Tools changed. Fill Prompts to apply them, or edit the direction to confirm your custom prompt.';}else $('mapPrompt').value=filledPrompt();update();});
 $('mapSheetBack').onclick=()=>{remember();onBack();};
 $('mapPrompt').value=values.prompt||filledPrompt();drawSources();drawResult();update();
}

function generationViewState(l,slotId){
 const images=[...new Set(l.references?.[slotId]||[])].map(id=>assets.get(id)).filter(a=>a&&effectiveStatus(a)!=='Obsolete'),approvedCount=images.filter(a=>P.isApproved(a,l)).length;
 const targets=P.generationTargets(l).filter(t=>t.slotId===slotId),ready=targets.filter(t=>t.ready).length,pending=targets.length-ready,briefPending=P.stats(l).pending>0;
 const coverage=approvedCount?'Approved image':images.length?'Needs review':'No image yet',scope=targets.length?(pending?`${pending} scene${pending===1?'':'s'} pending`:'Scenes ready'):briefPending?'Brief pending':'Optional';
 let detail=approvedCount?`${approvedCount} approved image${approvedCount===1?'':'s'} saved for this angle. You can reuse an existing image; generating another is optional.`:images.length?`${images.length} image${images.length===1?'':'s'} saved for this angle. Review an existing candidate before generating another.`:'No active image saved for this angle.';
 detail+=targets.length?` ${ready}/${targets.length} required scene views ready.${pending?' Choose and approve an image for each pending scene; a saved reference alone does not complete the scene.':''}`:briefPending?' Review the scene brief to confirm whether this angle is required.':' This is an optional reference angle; it is not required by a reviewed scene brief.';
 return {group:approvedCount?'approved':images.length?'review':'missing',scope,short:coverage+' · '+scope,detail,tone:pending?'pending':approvedCount?'ready':images.length?'pending':'empty'};
}
function generationViewOptions(l,views,selectedId){
 const entries=views.map(view=>({view,state:generationViewState(l,view.id)}));
 return [['missing','No image yet'],['review','Needs review'],['approved','Approved images']].map(([id,label])=>{const group=entries.filter(x=>x.state.group===id);return `<optgroup label="${label} (${group.length})">${group.length?options(group.map(({view,state})=>[view.id,view.label+' · '+state.scope]),selectedId):'<option disabled value="empty-'+id+'">None</option>'}</optgroup>`;}).join('');
}
function createInChat(sid,draft={}){
 const l=find(selected),s=slots().find(x=>x.id===sid);if(!l||!s)return;
 const inferredScene=generationSceneSelection(l,s,draft.sceneTarget);if(!draft.sceneTarget&&inferredScene)draft={...draft,sceneTarget:{sceneKey:inferredScene.episode+':'+inferredScene.line}};
 let library=generationLibrary(l);const initial=!library.length,storageKey='desk-location-generation-refs:'+l.id+':'+sid;
 let stored;try{stored=JSON.parse(DESKStorage.getItem(storageKey));}catch{}
 let choices=structuredClone(draft.referenceChoices??stored??{});if(!choices||typeof choices!=='object'||Array.isArray(choices))choices={};
 const resultKey='desk-location-latest-result:'+l.id;let result=draft.result||null;if(!result)try{result=JSON.parse(DESKStorage.getItem(resultKey));}catch{}
 const views=slots(l),available=views.some(v=>v.id===sid)?views:[s,...views];
 const automaticDirection=generationAutoDirection(l,s,draft.directionPrepared?'':draft.direction||'',draft.sceneTarget);
 const directionValue=draft.directionPrepared?(draft.direction??''):automaticDirection;
 openModal('Generate image · '+l.name,`<section class="location-generate-dialog"><div class="location-generate-view"><label for="locationGenerateView">View</label><select id="locationGenerateView">${generationViewOptions(l,available,sid)}</select><details class="location-view-help"><summary aria-label="About the output view" title="About the output view">ⓘ</summary><p>This chooses the kind of image to generate and the reference category where the new image is saved. It changes the view instructions in the prompt, so choose the view you want next. Changing it does not alter earlier images, approve anything, or assign an image to a scene. Saved images can be added to other views later. Use for needed image assigns the result to a specific scene requirement; approval remains separate.</p></details><span class="small">Saved to this location for review</span></div><p id="locationGenerateViewStatus" class="location-view-status" role="status"></p><section id="locationIterationResult" class="location-iteration-result" hidden aria-label="Latest generated image"></section><section class="location-generation-inputs"><h3>Reference images</h3><p class="small">Choose up to three images from ${esc(generationFamilyName(l))} and its related locations. Each chosen image and its source context are included when you generate.</p><div class="location-generation-ref-slots">${generationRoles.map(role=>`<section><h4>${role.label}</h4><div data-location-ref-preview="${role.id}"></div><button type="button" data-location-ref-choose="${role.id}">Choose ${role.label.toLowerCase()}</button><button type="button" class="location-ref-clear" data-location-ref-clear="${role.id}" hidden>Clear</button>${role.id==='map'?'<button type="button" class="location-ref-tool" data-location-workbench="map">＋ Create map</button>':role.id==='overhead'?'<button type="button" class="location-ref-tool" data-location-workbench="overhead">Fill Prompts</button>':''}</section>`).join('')}</div><section id="locationGenerationPicker" hidden><div class="location-reference-picker-heading"><h4 id="locationReferencePickerTitle"></h4><button type="button" id="locationReferencePickerDone">Done</button></div><label for="locationReferenceScope">Image library</label><select id="locationReferenceScope"><option value="family">All ${esc(generationFamilyName(l))} images</option><option value="current">This location only</option></select><label for="locationReferenceSearch">Search images</label><input id="locationReferenceSearch" type="search" placeholder="Image title or tag"><p id="locationPickerCount" class="small" role="status"></p><div id="locationReferenceGrid"></div><p id="locationPickerMessage" class="small" role="status"></p></section><p id="locationReferenceCount" class="small" role="status"></p></section>${initial?'<p class="location-generate-note">No images in this location’s library yet. Describe an initial design below, or add images to the library first.</p>':''}<label for="locationGenerateDirection">${initial?'Initial design direction':'Scene direction'}</label><p class="small">Auto-filled from this location and scene evidence. Edit freely; composition, reference roles and continuity checks are added to the full prompt below.</p><textarea id="locationGenerateDirection" rows="3" maxlength="2500" placeholder="${initial?'Describe the setting, architecture, terrain and materials…':'For example: a wider view, soft morning light, or snow on the ground…'}">${esc(directionValue)}</textarea><div class="location-toolbar"><button type="button" id="locationFillDirection">Refresh suggested direction</button><button type="button" id="locationUndoDirection" hidden>Undo refresh</button></div><p id="locationDirectionStatus" class="small" role="status"></p><div id="locationGenerateControls"></div><details class="location-generate-options"><summary>Image format & full prompt</summary><label for="locationGenerateFormat">Image format</label><select id="locationGenerateFormat"><option>16:9 widescreen</option><option>3:2 landscape</option><option>2:3 portrait</option><option>1:1 square</option></select><label for="locationChatText">Prepared image prompt</label><textarea id="locationChatText" rows="8" readonly></textarea><button id="locationChatCopy" type="button">Copy prompt</button><p id="locationChatStatus" role="status"></p></details></section>`);
 $('locationGenerateFormat').value=draft.aspect||'16:9 widescreen';
 function refreshViewStates(){const select=$('locationGenerateView'),note=$('locationGenerateViewStatus');if(!select||!note)return;const markup=generationViewOptions(l,available,sid);if(select.dataset.viewGroups!==markup){select.innerHTML=markup;select.dataset.viewGroups=markup;}const state=generationViewState(l,sid);note.textContent=state.detail;note.dataset.state=state.tone;}
 const request=()=>generationRequest(l,s,{direction:$('locationGenerateDirection').value,aspect:$('locationGenerateFormat').value,initialDesign:initial,referenceChoices:choices,sceneBrief:draft.sceneBrief||'',sceneTarget:draft.sceneTarget});
 const panel=DESKGeneration.mount($('locationGenerateControls'),null,{storageKey:'desk-reference-job:'+l.id+':'+sid,request,onResult:(a,job)=>{const next={asset_id:a.id,sha256:a.sha256,created_at:job.created_at||0,slot_id:sid};if(!result||next.created_at>=result.created_at){result=next;try{DESKStorage.setItem(resultKey,JSON.stringify(result));}catch{}renderResult();}}});
 if(draft.quality)$('locationGenerateControls').querySelector('[data-gen="quality"]').value=draft.quality;
 const update=()=>{refreshViewStates();try{const r=request();$('locationChatText').value=r.prompt;panel.prepare({});}catch(e){try{$('locationChatText').value=creationRequest(l,s,choices,{sceneTarget:draft.sceneTarget,aspect:$('locationGenerateFormat').value});}catch{$('locationChatText').value='Choose current reference images to prepare the prompt.';}panel.invalidate(e.message);}};
 let previousDirection=null;
 $('locationFillDirection').onclick=()=>{previousDirection=$('locationGenerateDirection').value;$('locationGenerateDirection').value=generationAutoDirection(l,s,'',draft.sceneTarget);$('locationUndoDirection').hidden=false;$('locationDirectionStatus').textContent='Suggested direction refreshed. Undo restores your previous text.';update();};
 $('locationUndoDirection').onclick=()=>{if(previousDirection===null)return;$('locationGenerateDirection').value=previousDirection;previousDirection=null;$('locationUndoDirection').hidden=true;$('locationDirectionStatus').textContent='Previous direction restored.';update();};
 const preview=()=>{library=generationLibrary(l);for(const role of generationRoles){const choice=choices[role.id],a=choice&&library.find(a=>a.id===choice.id&&a.sha256===choice.sha256);document.querySelector('[data-location-ref-preview="'+role.id+'"]').innerHTML=a?`<a href="${esc(a.asset)}" target="_blank" rel="noopener"><img src="${esc(a.thumbnail)}" alt="${esc(a.title)}"></a><p>${esc(a.title)}</p><small>${esc(status(a,l))}</small>`:`<div class="location-ref-empty">${choice?'Reference changed. Choose again.':'No image chosen'}</div>`;document.querySelector('[data-location-ref-clear="'+role.id+'"]').hidden=!choice;}try{const count=generationRefs(l,choices).length;$('locationReferenceCount').textContent=count?`${count} exact reference image${count===1?'':'s'} will be attached. Choices here do not change location selections or approvals.`:'Choose references above to guide this image.';}catch(e){$('locationReferenceCount').textContent=e.message;}update();};
 let picking='overhead';
 let pickerLibrary=[];
 const drawPicker=()=>{pickerLibrary=generationPickerLibrary(l);const role=generationRoles.find(r=>r.id===picking),preferred=new Set(generationFamily(l).locations.flatMap(source=>role.slots.flatMap(slot=>source.references?.[slot]||[]))),query=norm($('locationReferenceSearch').value),list=pickerLibrary.filter(a=>($('locationReferenceScope').value!=='current'||generationLinked(a,l))&&(!query||norm([a.title,a.id,...(a.tags||[]),generationPickerOrigin(a,l)].join(' ')).includes(query))).sort((a,b)=>Number(effectiveStatus(a)==='Obsolete')-Number(effectiveStatus(b)==='Obsolete')||Number(preferred.has(b.id))-Number(preferred.has(a.id)));
 $('locationPickerCount').textContent=`${list.length} images · ${$('locationReferenceScope').value==='current'?'All views in this location.':'All views across '+generationFamilyName(l)+'.'} Choosing a related image adds it to this location’s library without changing approvals. Obsolete images are shown for context only.`;
 $('locationReferenceGrid').innerHTML=list.map(a=>`<button type="button" data-location-ref-use="${esc(a.id)}" ${effectiveStatus(a)==='Obsolete'?'disabled':''} aria-pressed="${choices[picking]?.id===a.id&&choices[picking]?.sha256===a.sha256}"><img src="${esc(a.thumbnail)}" alt="" loading="lazy"><span>${esc(a.title)}</span><small>${esc(generationPickerStatus(a,l))}</small><small class="location-reference-origin">${esc(generationPickerOrigin(a,l))}</small></button>`).join('')||'<p>No matching images.</p>';};
 const rememberChoices=()=>{try{DESKStorage.setItem(storageKey,JSON.stringify(choices));}catch{}};
 document.querySelector('.location-generation-inputs').onclick=async e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.locationWorkbench){
 const mode=b.dataset.locationWorkbench,parentDraft={directionPrepared:true,sceneBrief:draft.sceneBrief,sceneTarget:draft.sceneTarget,result,referenceChoices:structuredClone(choices),direction:$('locationGenerateDirection').value,aspect:$('locationGenerateFormat').value,quality:$('locationGenerateControls').querySelector('[data-gen="quality"]').value},scroll=$('modal').scrollTop;
 const back=()=>{createInChat(sid,parentDraft);requestAnimationFrame(()=>{$('modal').scrollTop=scroll;document.querySelector('[data-location-workbench="'+mode+'"]').focus({preventScroll:true});});};
 openMapSheet(l,mode,back,a=>{parentDraft.referenceChoices[mode]={id:a.id,sha256:a.sha256};back();});return;
 }if(b.dataset.locationRefChoose){picking=b.dataset.locationRefChoose;$('locationReferencePickerTitle').textContent='Choose '+generationRoles.find(r=>r.id===picking).label.toLowerCase();$('locationGenerationPicker').hidden=false;$('locationReferenceSearch').value='';$('locationPickerMessage').textContent='';drawPicker();$('locationReferenceSearch').focus();}if(b.dataset.locationRefUse){const a=pickerLibrary.find(a=>a.id===b.dataset.locationRefUse);if(!a||effectiveStatus(a)==='Obsolete')return;const role=picking,picker=$('locationGenerationPicker');b.disabled=true;try{if(!generationLibrary(l).some(x=>x.id===a.id))await ensureCoverage(l,role==='map'?'supporting-maps':role==='overhead'?'aerial-overhead':'landscape-wide',a);if(!picker.isConnected)return;choices[role]={id:a.id,sha256:a.sha256};rememberChoices();picker.hidden=true;preview();document.querySelector('[data-location-ref-choose="'+role+'"]').focus({preventScroll:true});}catch(error){if(picker.isConnected){$('locationPickerMessage').textContent=error.message;b.disabled=false;}}}if(b.dataset.locationRefClear){delete choices[b.dataset.locationRefClear];rememberChoices();preview();}};
 $('locationReferencePickerDone').onclick=()=>{$('locationGenerationPicker').hidden=true;};$('locationReferenceSearch').oninput=drawPicker;$('locationReferenceScope').onchange=drawPicker;
 function renderResult(){
  refreshViewStates();
  const host=$('locationIterationResult'),a=result&&assets.get(result.asset_id);
  if(!host||!a||a.sha256!==result.sha256||effectiveStatus(a)==='Obsolete'){if(host)host.hidden=true;return;}
  library=generationLibrary(l);const targets=P.generationTargets(l),preferred=targets.findIndex(t=>t.sceneKey===draft.sceneTarget?.sceneKey&&t.requirementId===draft.sceneTarget?.requirementId),suggested=preferred>=0?preferred:targets.findIndex(t=>!t.ready);
  const reviewSlot=slots().some(v=>v.id===result.slot_id)?result.slot_id:Object.keys(l.references||{}).find(id=>(l.references[id]||[]).includes(a.id))||sid,reviewView=slots().find(v=>v.id===reviewSlot)?.label||reviewSlot;
  const assignmentSetup=P.generationAssignmentSetup(l);
  host.hidden=false;host.innerHTML=`<h3>Latest generated image</h3><div class="location-iteration-preview"><a href="${esc(a.asset)}" target="_blank" rel="noopener"><img src="${esc(a.asset)}" alt="${esc(a.title)}"></a><div><p>${esc(a.title)}</p><button type="button" id="locationResultReview" class="location-result-review" title="Review this image in ${esc(reviewView)}" aria-label="${esc(status(a,l))}: review this image in ${esc(reviewView)}">${badge(a,l)}</button><p class="small">Saved in: ${esc(reviewView)}</p><p class="small">Use this result for a scene, or keep building from it.</p></div></div><div class="location-iteration-actions"><section><h4>Use this image in a scene</h4><p class="small">Assign this saved image to a required scene view. This updates the scene checklist; it does not approve the image or change your working reference.</p>${targets.length?`<label for="locationResultTarget">Scene image slot</label><select id="locationResultTarget" aria-describedby="locationAssignmentHelp"><option value="">Choose a scene image slot</option>${targets.map((t,i)=>`<option value="${i}" ${i===suggested?'selected':''}>${esc(t.label)}</option>`).join('')}</select><button type="button" id="locationResultAssign" ${suggested<0?'disabled':''}>Assign image to scene</button><p id="locationAssignmentHelp" class="small" role="status">${suggested<0?'Choose a scene image slot to enable assignment. All listed slots already have approved images; assigning here replaces that slot’s current image.':'Assigns to the selected slot, replacing its current image if one is assigned. Image approval stays unchanged.'}</p>`:`<p class="location-generate-note">${esc(assignmentSetup.reason)}</p>${assignmentSetup.scenes.length?`<label for="locationSetupScene">Scene to set up</label><select id="locationSetupScene">${assignmentSetup.scenes.map(t=>`<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('')}</select><button type="button" id="locationResultSetup">Set up scene images</button>`:''}`}</section><section><label for="locationResultRole">Reference for the next generation</label><select id="locationResultRole">${generationRoles.map(r=>`<option value="${r.id}" ${r.id===(result.slot_id==='supporting-maps'?'map':result.slot_id?.startsWith('aerial-')?'overhead':'landscape')?'selected':''}>${r.label}</option>`).join('')}</select><button type="button" id="locationResultContinue">Use as next reference</button></section></div><p id="locationResultMessage" role="status" aria-live="polite"></p>`;
  const resultLink=$('locationGenerateControls')?.querySelector('[data-gen="result"]');
  if(resultLink){resultLink.innerHTML='<button type="button" id="locationResultReveal">View latest image</button>';$('locationResultReveal').onclick=()=>host.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
  $('locationResultReview').onclick=()=>{
   const parentDraft={directionPrepared:true,sceneBrief:draft.sceneBrief,sceneTarget:draft.sceneTarget,result,referenceChoices:structuredClone(choices),direction:$('locationGenerateDirection').value,aspect:$('locationGenerateFormat').value,quality:$('locationGenerateControls').querySelector('[data-gen="quality"]').value},scroll=$('modal').scrollTop;
   reviewImage(reviewSlot,a.id,()=>{createInChat(sid,parentDraft);requestAnimationFrame(()=>{$('modal').scrollTop=scroll;$('locationResultReview')?.focus({preventScroll:true});});});$('modal').scrollTop=0;
  };
  if($('locationResultSetup'))$('locationResultSetup').onclick=()=>{
   const scene=P.scenes(l).find(x=>x.episode+':'+x.line===$('locationSetupScene').value);if(!scene)return;
   const parentDraft={directionPrepared:true,sceneBrief:draft.sceneBrief,sceneTarget:draft.sceneTarget,result,referenceChoices:structuredClone(choices),direction:$('locationGenerateDirection').value,aspect:$('locationGenerateFormat').value,quality:$('locationGenerateControls').querySelector('[data-gen="quality"]').value},scroll=$('modal').scrollTop;
   P.editScene(l,scene,null,()=>{createInChat(sid,parentDraft);requestAnimationFrame(()=>{$('modal').scrollTop=scroll;($('locationResultTarget')||$('locationResultSetup'))?.focus({preventScroll:true});});});$('modal').scrollTop=0;
  };
  if($('locationResultTarget'))$('locationResultTarget').onchange=()=>{const empty=$('locationResultTarget').value==='';$('locationResultAssign').disabled=empty;$('locationAssignmentHelp').textContent=empty?'Choose a scene image slot to enable assignment.':'Assigns to the selected slot, replacing its current image if one is assigned. Image approval stays unchanged.';};
  if($('locationResultAssign'))$('locationResultAssign').onclick=async()=>{if($('locationResultTarget').value==='')return;const target=targets[Number($('locationResultTarget').value)],button=$('locationResultAssign');if(!target)return;button.disabled=true;$('locationResultTarget').disabled=true;try{const message=await P.assignGenerated(l.id,target,a.id,a.sha256);if(!host.isConnected)return;renderResult();$('locationResultMessage').textContent=message;}catch(error){if(host.isConnected){$('locationResultMessage').textContent=error.message;button.disabled=false;$('locationResultTarget').disabled=false;}}};
  $('locationResultContinue').onclick=()=>{const role=$('locationResultRole').value;choices[role]={id:a.id,sha256:a.sha256};rememberChoices();preview();$('locationResultMessage').textContent='This image is attached as the '+generationRoles.find(r=>r.id===role).label.toLowerCase()+'. Adjust the view or direction, then generate again. Approval unchanged.';};
 }
 $('locationGenerateView').onchange=()=>{const view=$('locationGenerateView').value;createInChat(view,{directionPrepared:true,sceneBrief:draft.sceneBrief,sceneTarget:draft.sceneTarget,result,referenceChoices:choices,direction:$('locationGenerateDirection').value,aspect:$('locationGenerateFormat').value,quality:$('locationGenerateControls').querySelector('[data-gen="quality"]').value});$('locationGenerateView').focus();};
 $('locationGenerateDirection').oninput=update;$('locationGenerateFormat').onchange=update;if(draft.referenceChoices)rememberChoices();preview();renderResult();
 $('locationChatCopy').onclick=async()=>{try{await Promise.race([navigator.clipboard.writeText($('locationChatText').value),new Promise((_,reject)=>setTimeout(()=>reject(Error('Clipboard unavailable')),1500))]);$('locationChatStatus').textContent='Prompt copied.';}catch{$('locationChatText').focus();$('locationChatText').select();$('locationChatStatus').textContent='Prompt selected. Press Command-C (or Ctrl-C) to copy.';}};
}

function drawCards(){const list=filteredLocations();$('locationCount').textContent=`${list.length} of ${(D.locations||[]).length} locations · Source badges reflect recorded links. Production progress counts reviewed scene requirements.`;$('locationCountHelp').title=$('locationCount').textContent;$('locationOrderNote').textContent=filters.view==='production'?'Choose an act or episode in the sidebar. Open a location to review its scene briefs.':filters.order==='trail'?'Numbered stops follow the Map library. Related script settings are grouped alongside them; epilogue and map collections follow the journey.':filters.order==='region'?'Grouped by region, with locations alphabetical within each region.':'All matching locations in alphabetical order.';$('locationOrderHelp').title=$('locationOrderNote').textContent;if(filters.view==='production'){$('locationCards').innerHTML=P.overview(list,filters);return;}let previous='';$('locationCards').innerHTML=list.map(l=>{const a=assets.get(l.canonical_source?.id)||imageRefs(l)[0],group=filters.order==='region'?l.region||'Other locations':filters.order==='trail'?routeGroup(l):'',heading=group&&group!==previous?`<h2 class="location-group-heading">${esc(group)}</h2>`:'';previous=group;return `${heading}<article class="location-card">${a?`<img src="${esc(a.thumbnail)}" alt="${esc(l.name)}">`:''}${P.sourceBadge(l)}<h2>${esc(l.name)}</h2><p class="small">${Number.isFinite(atlasNumber(l))?'Atlas stop '+atlasNumber(l)+' · ':''}${esc(l.region||'')} · ${esc(l.kind||'location')}</p><p>${esc(P.summary(l,filters))} · ${imageRefs(l).length} reference images</p><button data-location-open="${esc(l.id)}">Open location</button></article>`;}).join('')||'<p>No locations match these filters. Clear filters to see all locations.</p>';}

function newLocation(){openModal('Add location',`<form id="newLocationForm"><label>Name<input id="newLocationName" required maxlength="140" autocomplete="off"></label><label>Description<textarea id="newLocationDescription" rows="3" maxlength="3000"></textarea></label><label>Tags (comma separated)<input id="newLocationTags" placeholder="California, Yerba Buena, church"></label><p class="small">An unlinked reference location will be created. No production images are required until script use is established.</p><button type="submit">Create location</button><p id="locationMessage" role="status"></p></form>`);$('newLocationForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const v=await DESKReferenceLibrary.post('api/locations',{name:$('newLocationName').value,description:$('newLocationDescription').value,tags:$('newLocationTags').value.split(',').map(x=>x.trim()).filter(Boolean)});$('modal').close();show(v.locations[0].id);}catch(e){$('locationMessage').textContent=e.message;b.disabled=false;}};}
function slotView(sid){const l=find(selected),s=slots().find(s=>s.id===sid);if(!l||!s)return;openModal(s.label+' · '+l.name,`<p>Adding an image keeps it unapproved. Approving or choosing it as a working reference approves and selects it for this view.</p><div class="location-toolbar"><button data-location-add="${esc(sid)}">+ Add reference</button><button data-location-chat="${esc(sid)}">Generate image</button><label>Status<select id="locationSlotStatus"><option value="">All — including obsolete</option><option>Canonical source</option><option>Approved reference</option><option>Needs review</option><option>Selected</option><option>Unselected</option><option>Obsolete</option></select></label></div><div id="locationSlotRows" class="reference-grid"></div>`);const draw=()=>{const f=$('locationSlotStatus').value;const aa=rows(l,sid).filter(a=>!f||(f==='Selected'?l.selections?.[sid]?.id===a.id:f==='Unselected'?l.selections?.[sid]?.id!==a.id:status(a,l)===f));$('locationSlotRows').innerHTML=aa.map(a=>`<article class="reference-choice"><img src="${esc(a.thumbnail)}" alt="${esc(a.title)}"><p>${esc(a.title)}</p>${badge(a,l)}<p>${l.selections?.[sid]?.id===a.id?'Working reference chosen':'Not chosen'}</p><button data-location-review="${esc(sid)}" data-location-asset="${esc(a.id)}">Review image</button></article>`).join('')||'<p>No matching images.</p>';};$('locationSlotStatus').onchange=draw;draw();}
async function ensureCoverage(l,sid,a){
 if(!a||effectiveStatus(a)==='Obsolete')throw Error('Choose an active image; this image is set aside.');
 if(!(l.references?.[sid]||[]).includes(a.id))await DESKReferenceLibrary.post('api/location-references',{location_id:l.id,slot_id:sid,asset_ids:[a.id]});
}
function reviewImage(sid,aid,onBack=null){
 const l=find(selected),a=assets.get(aid);if(!l||!a)return;const sel=l.selections?.[sid],isApproved=approved(a,l),expectedApproval=l.approvals?.[aid]||null,needsLink=!(l.references?.[sid]||[]).includes(aid),viewName=slots().find(s=>s.id===sid)?.label||sid;
 openModal('Location reference · '+a.id,`<div class="location-toolbar location-review-actions">${onBack?'<button type="button" id="locationReviewBack">Back to generator</button>':''}<button data-location-slot="${esc(sid)}">View ${esc(viewName)} images</button>${window.DESKLocationEditing?.button(l,sid,a,'Refine image (beta)')||''}<button id="approveLocationImage" ${!isApproved&&effectiveStatus(a)==='Obsolete'?'disabled':''}>${isApproved?'Revoke approval':'Approve image'}</button>${needsLink?'<button id="addLocationCoverage" '+(effectiveStatus(a)==='Obsolete'?'disabled':'')+'>Add to this view</button>':''}<button type="button" id="locationThumbDown" aria-pressed="false">👎 Thumbs down</button><button type="button" id="locationSetObsolete">Move to obsolete</button><span id="locationReviewBadge">${badge(a,l)}</span></div><p class="small">Thumbs down records a preference without changing approval. Obsolete images are hidden from active choices everywhere and can be restored.</p><p id="locationReviewSaveStatus" class="small" role="status" aria-live="polite"></p>${needsLink?`<p class="notice">This image is not yet in the reference list for <strong>${esc(viewName)}</strong>. Approve image or Choose for this coverage slot will add it automatically. You can also add it without approving.</p>`:''}<p class="small">Approve image confirms this exact image for ${esc(l.name)} and selects it as the working reference for ${esc(viewName)}.</p><p id="locationMessage" role="status"></p><img class="fullasset" src="${esc(a.asset)}" alt="${esc(a.title)}"><h3>${esc(a.title)}</h3><details><summary>Original source notes</summary><p>${esc(a.approval||'Unapproved reference')}</p>${provenanceNotes(a)}</details><p class="small">${esc((a.tags||[]).join(' · '))}</p><div class="location-toolbar"><button data-edit-tags="${esc(a.id)}">Edit tags</button><a href="${esc(a.asset)}" target="_blank" rel="noopener">Full image</a><button id="chooseLocationImage" ${effectiveStatus(a)==='Obsolete'?'disabled':''}>${sel?.id===aid?'Clear working reference':'Choose for this coverage slot'}</button></div><p class="small">Choosing a working reference also approves it. Clearing the reference keeps its approval. Character selections and ratings are preserved.</p>`);
 if(onBack)$('locationReviewBack').onclick=onBack;
 const lock=on=>{for(const id of ['approveLocationImage','chooseLocationImage','addLocationCoverage','locationThumbDown','locationSetObsolete'])if($(id))$(id).disabled=on||(effectiveStatus(a)==='Obsolete'&&(['chooseLocationImage','addLocationCoverage'].includes(id)||(id==='approveLocationImage'&&!isApproved)));};
 const feedback=$('locationReviewSaveStatus'),thumb=$('locationThumbDown'),archive=$('locationSetObsolete');let waitingForSave=false;
 const drawReviewControls=()=>{const rejected=review.notes[aid]?.verdict==='Reject',obsolete=effectiveStatus(a)==='Obsolete';thumb.textContent=rejected?'Clear thumbs down':'👎 Thumbs down';thumb.setAttribute('aria-pressed',String(rejected));archive.textContent=obsolete?'Restore image':'Move to obsolete';$('locationReviewBadge').innerHTML=badge(a,l);};
 const saveFeedback=e=>{if(!feedback.isConnected||!waitingForSave)return;feedback.textContent=e.detail.text;if(e.detail.saved)waitingForSave=false;};
 window.addEventListener('desk-save-status',saveFeedback);
 const cleanup=()=>{window.removeEventListener('desk-save-status',saveFeedback);observer.disconnect();$('modal').removeEventListener('close',cleanup);};
 const observer=new MutationObserver(()=>{if(!feedback.isConnected)cleanup();});observer.observe($('modalBody'),{childList:true});$('modal').addEventListener('close',cleanup);
 async function changeReview(fields){
  lock(true);waitingForSave=true;
  review.notes[aid]={verdict:'Unreviewed',text:'',...review.notes[aid],...fields,updated_at:new Date().toISOString()};save();drawReviewControls();renderLocation();
  feedback.textContent='Saving image review…';
  try{if(window.DESKAutosave){await DESKAutosave.flush();if(feedback.isConnected){const state=DESKAutosave.state();if(!state.dirty&&!state.inflight&&!state.conflicted){feedback.textContent='Saved on this Mac.';waitingForSave=false;}}}else feedback.textContent='Saved in this browser. Open the live desk to save on this Mac.';}
  catch(error){if(feedback.isConnected)feedback.textContent='Save pending: '+error.message;}
  finally{if(feedback.isConnected){drawReviewControls();lock(false);}}
 }
 thumb.onclick=()=>changeReview({verdict:review.notes[aid]?.verdict==='Reject'?'Unreviewed':'Reject'});
 archive.onclick=()=>changeReview({obsolete:effectiveStatus(a)!=='Obsolete'});
 drawReviewControls();
 if($('addLocationCoverage'))$('addLocationCoverage').onclick=async()=>{lock(true);try{await ensureCoverage(l,sid,a);reviewImage(sid,aid,onBack);renderLocation();toast('Image added to '+viewName+'. Approval unchanged.');}catch(e){$('locationMessage').textContent=e.message;lock(false);}};
 $('approveLocationImage').onclick=async()=>{lock(true);try{if(!isApproved){await approveAndSelectReference(l,sid,a);featuredViews.set(l.id,sid);}else await DESKReferenceLibrary.post('api/location-approval',{location_id:l.id,slot_id:isApproved&&needsLink?(Object.keys(l.references||{}).find(slot=>l.references[slot].includes(aid))||sid):sid,asset_id:aid,source_sha256:a.sha256,approved:!isApproved,expected_approval:expectedApproval});reviewImage(sid,aid,onBack);renderLocation();toast(isApproved?'Approval revoked.':'Image approved and selected for this view.');}catch(e){$('locationMessage').textContent=e.message;lock(false);}};
 $('chooseLocationImage').onclick=async()=>{lock(true);try{if(sel?.id!==aid)await approveAndSelectReference(l,sid,a);else await DESKReferenceLibrary.post('api/location-selection',{location_id:l.id,slot_id:sid,asset_id:sel?.id===aid?null:aid,source_sha256:a.sha256,expected_selected_id:sel?.id||null});featuredViews.set(l.id,sid);reviewImage(sid,aid,onBack);renderLocation();toast(sel?.id===aid?'Working reference cleared. Approval unchanged.':'Image approved and selected for this view.');}catch(e){$('locationMessage').textContent=e.message;lock(false);}};
}
window.DESKLocations={ensureCoverage,generate:createInChat,get active(){return active},render:renderLocation,show,deactivate,tagged,status,badge,creationRequest,generationRequest,filteredLocations,routeRank,atlasNumber};
$('charactersTab').onclick=()=>{deactivate();render();window.scrollTo(0,0)};$('locationsTab').onclick=()=>show();
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.locationTab){activateLocationTab(b.dataset.locationTab);return;}if(b.dataset.locationMetric){e.preventDefault();openNavigationMetric(b,{keyboard:e.detail===0});return;}P.handle(b,find(selected));if(b.hasAttribute('data-location-membership')){filters.membership=b.dataset.locationMembership;filters.act='';filters.episode='';saveFilters();show();}if(b.dataset.locationView){filters.view=b.dataset.locationView;filters.act='';filters.episode='';saveFilters();show();}if(b.dataset.productionEpisode){filters.episode=b.dataset.productionEpisode;filters.act='';saveFilters();show();}if(b.hasAttribute('data-location-home'))show();if(b.hasAttribute('data-location-all')||b.hasAttribute('data-location-clear')){const order=filters.order,view=filters.view;filters=defaultFilters();filters.order=order;filters.view=view;saveFilters();show();}if(b.dataset.locationOpen)show(b.dataset.locationOpen,{preserveScroll:!!b.closest('#locationNav')});if(b.hasAttribute('data-location-new'))newLocation();if(b.dataset.locationFeatureChoose)chooseFeaturedImage(b.dataset.locationFeatureChoose);if(b.dataset.locationFeatureSelect)selectFeaturedImage(b);if(b.dataset.locationAdd){featuredViews.set(selected,b.dataset.locationAdd);const s=slots().find(s=>s.id===b.dataset.locationAdd);DESKReferenceLibrary.picker(null,s.label,null,{id:selected,slot:s.id});}if(b.dataset.locationChat)createInChat(b.dataset.locationChat);if(b.dataset.locationSlot)slotView(b.dataset.locationSlot);if(b.dataset.locationReview)reviewImage(b.dataset.locationReview,b.dataset.locationAsset);});
document.addEventListener('change',e=>{if(e.target.id==='locationFeaturedView'){featuredViews.set(selected,e.target.value);renderLocation();return;}if(e.target.hasAttribute('data-location-template')){const l=find(selected);if(l)DESKLocationTemplates.save(e.target,l);return;}const key=e.target.dataset?.locationFilter;if(!Object.hasOwn(filters,key))return;filters[key]=e.target.value;if(key==='act')filters.episode='';saveFilters();show();});
try{if(DESKSessionStorage.getItem('desk-desk-collection')==='locations')show(DESKSessionStorage.getItem('desk-location-id')||null);}catch{}
})();
