/* Read-only views over durable image, outfit and location links. */
(()=>{
'use strict';
const states=new Map();
const state=key=>{if(!states.has(key))states.set(key,{view:'outfits',look:'',place:'',kind:'',status:'active',query:'',limit:72});return states.get(key);};
const ideation=a=>!!(a.action_id||a.action_poses?.length||(a.generated_candidate&&a.type==='Scene reference')||/exploration|ideation/i.test([a.reference_subtype,...(a.tags||[])].join(' ')));
function lookIds(a,c){
 const ids=new Set((a.look_links||[]).filter(x=>x.character_id===c.id).map(x=>x.look_id));
 const belongs=(a.character_ids||[]).includes(c.id)||(a.reference_links||[]).some(x=>x.character_id===c.id);
 if(belongs)for(const id of [a.look_id,...(a.look_ids||[])].filter(Boolean))if(c.looks.some(l=>l.id===id))ids.add(id);
 for(const l of c.looks||[]){const linked=[...(l.generated_candidate_ids||[]),...(l.supporting_reference_ids||[]),...['full_body','mannequin'].flatMap(k=>[...(l[k]?.confirmed_ids||[]),...(l[k]?.candidate_ids||[]),...(l[k]?.obsolete_ids||[]),...(l[k]?.unresolved_stage_candidate_ids||[])])];if(linked.includes(a.id))ids.add(l.id);}
 for(const r of Object.values(canonCurrent(c.id)))if(r.id===a.id&&r.look_id)ids.add(r.look_id);
 return [...ids];
}
let locationIndex=new Map();
function refreshIndex(){locationIndex=new Map();for(const l of D.locations||[]){const ids=[...Object.values(l.references||{}).flat(),l.canonical_source?.id,...Object.values(l.selections||{}).map(r=>r.id),...Object.keys(l.approvals||{})].filter(Boolean);for(const id of ids){if(!locationIndex.has(id))locationIndex.set(id,new Set());locationIndex.get(id).add(l.id);}}}
function locationIds(a){return [...new Set([a.location_id,...(a.location_ids||[]),...(locationIndex.get(a.id)||[])].filter(Boolean))];}
refreshIndex();
function characterImages(c){return D.assets.filter(a=>{
 const linked=lookIds(a,c).length>0,belongs=(a.character_ids||[]).includes(c.id)||(a.reference_links||[]).some(r=>r.character_id===c.id);
 return linked||(belongs&&(['Full-body / costume','Mannequin outfit study','Scene reference'].includes(a.type)||ideation(a)));
});}
function locationImages(l){return D.assets.filter(a=>locationIds(a).includes(l.id));}
const option=(id,label,value)=>`<option value="${esc(id)}"${id===value?' selected':''}>${esc(label)}</option>`;
function card(a,c,l){
 const badge=l?DESKLocations.badge(a,l):referenceBadge(a,c.id);
 const places=locationIds(a).map(id=>(D.locations||[]).find(l=>l.id===id)?.name).filter(Boolean);
 return `<article class="saved-image-card"><button class="saved-image-preview" data-image="${esc(a.id)}"${l?` data-review-location="${esc(l.id)}"`:c?` data-selection-character="${esc(c.id)}"`:''} aria-label="Review ${esc(a.title)}"><img src="${esc(a.thumbnail||a.asset)}" alt="${esc(a.title)}" loading="lazy"></button><div><p class="saved-image-kind">${ideation(a)?'Ideation':esc(a.type)}</p><h4>${esc(a.title)}</h4>${badge}${a.action_poses?.length?`<p>${esc(a.action_poses.join(' · '))}</p>`:''}<p class="small">${esc(places.join(' · ')||'No location linked')}</p><div class="saved-image-links"><button data-image="${esc(a.id)}"${l?` data-review-location="${esc(l.id)}"`:c?` data-selection-character="${esc(c.id)}"`:''}>Review image</button><a href="${esc(a.asset)}" target="_blank" rel="noopener">Full image ↗</a>${a.original_prompt_text_file?`<a href="${esc(a.original_prompt_text_file)}" target="_blank" rel="noopener">Saved prompt</a>`:''}</div></div></article>`;
}
function filtered(list,s,c,l){return list.filter(a=>{
 const obsolete=effectiveStatus(a)==='Obsolete';
 const approved=l?['Approved reference','Canonical source'].includes(DESKLocations.status(a,l)):isApprovedReference(a,c.id,a.sha256);
 return (!s.kind||(s.kind==='ideas'?ideation(a):!ideation(a)))&&(s.status==='all'||s.status==='obsolete'?s.status==='all'||obsolete:s.status==='active'?!obsolete:s.status==='approved'?!obsolete&&approved:!obsolete&&!approved)&&(!s.query||[a.id,a.title,...(a.tags||[]),...(a.action_poses||[])].join(' ').toLowerCase().includes(s.query.toLowerCase()));
});}
function controls(s,c,l){const places=c?new Set(characterImages(c).flatMap(locationIds)):new Set();return `<div class="saved-gallery-filters">${c?`<label>${s.view==='places'?'Location':'Outfit'}<select data-gallery-filter="${s.view==='places'?'place':'look'}">${option('','All '+(s.view==='places'?'locations':'outfits'),s.view==='places'?s.place:s.look)}${s.view==='places'?(D.locations||[]).filter(l=>places.has(l.id)).sort((a,b)=>a.name.localeCompare(b.name)).map(l=>option(l.id,l.name,s.place)).join(''):(c.looks||[]).map(l=>option(l.id,lookDisplayName(l),s.look)).join('')}${option('unlinked',s.view==='places'?'No location linked':'No outfit linked',s.view==='places'?s.place:s.look)}</select></label>`:''}<label>Show<select data-gallery-filter="kind">${[['','All images'],['ideas','Ideations'],['refs','Reference images']].map(([id,label])=>option(id,label,s.kind)).join('')}</select></label><label>Status<select data-gallery-filter="status">${[['active','Active images'],['all','Including set aside'],['approved','Approved'],['pending','Needs review'],['obsolete','Set aside']].map(([id,label])=>option(id,label,s.status)).join('')}</select></label><label>Search images<input data-gallery-filter="query" type="search" value="${esc(s.query)}" placeholder="Title, action or tag"></label></div>`;}
function results(s,c,l){
 let list=filtered(c?characterImages(c):locationImages(l),s,c,l);
 const byPlace=c&&s.view==='places',selected=byPlace?s.place:s.look;
 if(c&&selected)list=list.filter(a=>{const ids=byPlace?locationIds(a):lookIds(a,c);return selected==='unlinked'?!ids.length:ids.includes(selected);});
 const visible=list.slice(0,s.limit),groups=new Map();
 for(const a of visible){const ids=c?(byPlace?locationIds(a):lookIds(a,c)):['location'];for(const id of ids.length?ids:['unlinked']){if(c&&selected&&selected!==id)continue;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(a);}}
 const label=id=>!c?l.name:id==='unlinked'?(byPlace?'No location linked':'No outfit linked'):byPlace?(D.locations||[]).find(l=>l.id===id)?.name||id:lookDisplayName(c.looks.find(l=>l.id===id)||{name:id});
 return `<p class="saved-gallery-count" role="status">${list.length} saved image${list.length===1?'':'s'}${list.length>s.limit?` · Showing ${visible.length}`:''}</p>${[...groups].map(([id,aa])=>`<section class="saved-gallery-group"><div class="saved-gallery-heading"><h3>${esc(label(id))}</h3>${c&&byPlace&&id!=='unlinked'?`<button data-location-open="${esc(id)}">Open location</button>`:''}${c&&!byPlace&&id!=='unlinked'?`<button data-explore-character="${esc(c.id)}" data-explore-look="${esc(id)}">Create a scene prompt</button>`:''}</div><div class="saved-image-grid">${aa.map(a=>card(a,c,l)).join('')}</div></section>`).join('')||'<div class="saved-gallery-empty">No saved images match this view. Images linked to an outfit or location appear here after they are added to the desk.</div>'}${list.length>s.limit?'<button data-gallery-more>Show more images</button>':''}`;
}
function panel(s,c,l){return `<p class="small">Saved references and ideations${c?' for '+esc(c.name):' for this location'}. Each image keeps its own approval status.</p>${controls(s,c,l)}<div data-gallery-results>${results(s,c,l)}</div>`;}
function wardrobe(c){refreshIndex();const s=state(c.id);return `<div class="saved-galleries" data-gallery-character="${esc(c.id)}"><div class="saved-gallery-tabs" role="tablist" aria-label="Wardrobe views">${[['outfits','Outfits'],['gallery','Wardrobe gallery'],['places','Locations']].map(([id,label])=>`<button type="button" role="tab" data-gallery-tab="${id}" aria-selected="${s.view===id}" aria-controls="${id==='outfits'?'wardrobe-outfits-':'wardrobe-gallery-'}${esc(c.id)}">${label}</button>`).join('')}</div><div id="wardrobe-gallery-${esc(c.id)}" role="tabpanel" aria-label="${s.view==='places'?'Locations':'Wardrobe gallery'}"${s.view==='outfits'?' hidden':''}>${s.view==='outfits'?'':panel(s,c)}</div></div>`;}
function location(l){refreshIndex();const s=state('location:'+l.id);return `<section class="saved-galleries location-saved-gallery" data-gallery-location="${esc(l.id)}"><h2>Ideations & images</h2><div>${panel(s,null,l)}</div></section>`;}
function context(root){const c=people.get(root.dataset.galleryCharacter),l=(D.locations||[]).find(l=>l.id===root.dataset.galleryLocation);return {c,l,s:state(c?.id||'location:'+l.id)};}
function switchView(root,view){refreshIndex();const {c,s}=context(root);s.view=view;s.limit=72;root.querySelectorAll('[data-gallery-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.galleryTab===view)));const p=document.getElementById('wardrobe-gallery-'+c.id);p.hidden=view==='outfits';p.setAttribute('aria-label',view==='places'?'Locations':'Wardrobe gallery');p.innerHTML=view==='outfits'?'':panel(s,c);const body=root.closest('.wardrobe-body');for(const child of body.children)if(child!==root)child.hidden=view!=='outfits';}
document.addEventListener('click',e=>{
 const button=e.target.closest('button');if(!button)return;
 if(button.dataset.openWardrobeGallery){const c=people.get(button.dataset.galleryCharacter),root=document.querySelector(`[data-gallery-character="${c.id}"]`);state(c.id).look=button.dataset.openWardrobeGallery;state(c.id).kind='';state(c.id).query='';state(c.id).status='active';switchView(root,'gallery');root.closest('.wardrobe-disclosure').open=true;root.scrollIntoView({block:'start'});return;}
 const root=button.closest('.saved-galleries');if(!root)return;
 if(button.dataset.galleryTab)switchView(root,button.dataset.galleryTab);
 if(button.hasAttribute('data-gallery-more')){const {c,l,s}=context(root);s.limit+=72;root.querySelector('[data-gallery-results]').innerHTML=results(s,c,l);}
});
function filter(e){const key=e.target.dataset.galleryFilter;if(!key)return;if((key==='query')!==(e.type==='input'))return;const root=e.target.closest('.saved-galleries'),{c,l,s}=context(root);s[key]=e.target.value;s.limit=72;root.querySelector('[data-gallery-results]').innerHTML=results(s,c,l);}
document.addEventListener('change',filter);document.addEventListener('input',filter);
window.DESKImageGalleries={wardrobe,location,state,lookIds,locationIds,characterImages,locationImages,ideation};
})();
