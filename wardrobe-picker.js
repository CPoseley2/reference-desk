/* Outfit selection: preview first, then explicitly approve or use an exact image. */
function characterTagged(a,c){
 const norm=x=>String(x).normalize('NFKC').toLowerCase().replace(/[“”‘’"']/g,'').replace(/[-_\s]+/g,' ').trim();
 const names=new Set([c.id,c.name,...(c.aliases||[])].map(norm));
 return (a.character_ids||[]).includes(c.id)||(a.tags||[]).some(t=>names.has(norm(t)));
}
function wardrobeAssociated(a,c,l){return [...(l.full_body?.candidate_ids||[]),...(l.full_body?.confirmed_ids||[]),...(l.mannequin?.candidate_ids||[]),...(l.mannequin?.confirmed_ids||[]),...(l.supporting_reference_ids||[])].includes(a.id)||a.look_id===l.id||(a.look_ids||[]).includes(l.id)||(a.look_links||[]).some(x=>x.character_id===c.id&&x.look_id===l.id);}
function wardrobeRole(a){return canonAllowed(a,'wardrobe')?'wardrobe':canonAllowed(a,'body')?'body':null;}
function wardrobeImageKey(a){return a.id+'|'+a.sha256;}
function wardrobeDecision(a,cid,lid){
 const role=wardrobeRole(a),r=role?canonCurrent(cid)[canonKey(role,lid)]:null,saved=approvalSource(),savedRef=role&&saved?canonCurrent(cid,saved)[canonKey(role,lid)]:null;
 const matches=x=>x?.id===a.id&&x.source_sha256===a.sha256;
 const selected=matches(r),approved=isApprovedReference(assets.get(a.id),cid,a.sha256),explicit=review.reference_approvals?.[cid]?.[a.id];
 return {role,selected,approved,obsolete:effectiveStatus(assets.get(a.id))==='Obsolete',pending:(selected&&!matches(savedRef))||(selected&&effectiveStatus(assets.get(a.id))!=='Obsolete'&&!approved)||(!approved&&explicit?.approved===true&&explicit.source_sha256===a.sha256)};
}
function wardrobeApproveExact(cid,id,hash,commit=true){
 const a=assets.get(id),role=a&&canonCategoryRole(a.type);
 if(!bulkApprovalAvailable)throw Error('Approval service is unavailable. Reconnect the local reference desk.');
 if(!a?.character_ids?.includes(cid)||!knownSourceHash(a,hash)||!canonAllowed(a,role))throw Error('This image must be linked to the character before approval.');
 if(effectiveStatus(a)==='Obsolete')throw Error('Restore the image in Review image before approving it.');
 if(isApprovedReference(a,cid,hash))return false;
 review.reference_approvals??={};review.reference_approvals[cid]??={};
 review.reference_approvals[cid][id]={source_sha256:hash,role,approved:true,updated_at:new Date().toISOString()};
 if(commit)save();return true;
}
let wardrobeCleanup=null;
function wardrobeChoose(cid,lid){
 if(wardrobeCleanup)wardrobeCleanup();
 const getCharacter=()=>people.get(cid),getLook=()=>getCharacter()?.looks.find(x=>x.id===lid&&x.active_story!==false);
 if(!getLook())return;
 const c=getCharacter(),l=getLook(),refs=canonCurrent(cid),initial=refs[canonKey('wardrobe',lid)]||refs[canonKey('body',lid)];
 let kind=initial?.role==='body'?'body':initial?'wardrobe':'all',focusKey=initial?initial.id+'|'+initial.source_sha256:'',limit=24,busy=false,rows=[];
 openModal('Outfit references · '+lookDisplayName(l),`<section id="wardrobeDesk" class="wardrobe-desk">
 <div class="wardrobe-heading"><div><p class="eyebrow">${esc(c.name)} · ${esc(lookDisplayName(l))}</p><p class="wardrobe-intro">Choose an image below to use for this outfit.</p></div><details class="wardrobe-add-menu"><summary>Add or create</summary><div><button data-add-reference="Full-body / costume" data-add-character="${esc(cid)}" data-add-look="${esc(lid)}">Upload character outfit</button><button data-add-reference="Mannequin outfit study" data-add-character="${esc(cid)}" data-add-look="${esc(lid)}">Upload clothing study</button><button data-look-chat data-look-character="${esc(cid)}" data-look-id="${esc(lid)}">Create in chat</button></div></details></div>
 <div id="wardrobeCurrent" class="wardrobe-current" aria-label="Current references for this look"></div>
 <details class="wardrobe-browser-controls"><summary>Find another image <span id="wardrobeFilterSummary"></span></summary><div class="wardrobe-tabs" role="group" aria-label="Image category"><button data-wardrobe-kind="wardrobe">Clothing studies</button><button data-wardrobe-kind="body">Character outfits</button><button data-wardrobe-kind="all">All tagged images</button></div>
 <div class="wardrobe-filters"><label class="wardrobe-search" for="wardrobeQuery">Search images<input id="wardrobeQuery" type="search" placeholder="Title, image ID or tag…"></label><label for="wardrobeScope">Show<select id="wardrobeScope"><option value="look">This look</option><option value="all" selected>All of this character</option></select></label><label for="wardrobeStatus">Status<select id="wardrobeStatus"><option value="active">Active + current selections</option><option value="pending">Needs approval</option><option value="approved">Approved</option><option value="selected">Selected for this look</option><option value="obsolete">Set aside</option></select></label></div></details>
 <p id="wardrobeMessage" class="wardrobe-message" role="status" aria-live="polite"></p>
 <div class="wardrobe-workspace"><section class="wardrobe-gallery"><p id="wardrobeCount" class="small" aria-live="polite"></p><div id="wardrobeGrid" class="wardrobe-grid"></div><button id="wardrobeMore" hidden>Show more images</button></section><section id="wardrobePreview" class="wardrobe-preview" aria-label="Image preview and decisions"></section></div></section>`);
 const root=$('wardrobeDesk'),modal=$('modal');modal.classList.add('wardrobe-dialog');
 const titleFor=a=>a.title.replace(new RegExp('^'+c.name+'\\s*[—–-]\\s*'),'').replace(/\s+reference$/,'');
 function allImages(){
   const cc=getCharacter(),ll=getLook(),all=D.assets.filter(a=>characterTagged(a,cc));
   const variants=[];
   for(const r of Object.values(canonCurrent(cid))){const a=assets.get(r.id);if(r.look_id!==lid||!a||r.source_sha256===a.sha256)continue;const im=canonImage(r);if(im?.asset)variants.push({...a,...im,id:a.id,sha256:r.source_sha256,title:a.title+' · saved version'});}
   return [...new Map([...variants,...all].map(a=>[wardrobeImageKey(a),a])).values()].map(a=>({a,decision:wardrobeDecision(a,cid,lid),associated:wardrobeAssociated(a,cc,ll)}));
 }
 function currentCards(){
   const chosen=canonCurrent(cid);
   $('wardrobeCurrent').innerHTML=['wardrobe','body'].map(role=>{const r=chosen[canonKey(role,lid)],a=r&&assets.get(r.id),im=a&&canonImage(r),name=role==='wardrobe'?'Clothing reference':'Character in outfit';return `<button type="button" class="wardrobe-current-card${a&&effectiveStatus(a)==='Obsolete'?' is-obsolete':''}" data-wardrobe-current="${role}"${im?` data-wardrobe-key="${esc(r.id+'|'+r.source_sha256)}"`:''}>${im?`<img src="${esc(im.asset)}" alt="">`:'<span class="wardrobe-empty-slot" aria-hidden="true">＋</span>'}<span><strong>${name}</strong><small>${im?`${wardrobeDecision({...a,sha256:r.source_sha256},cid,lid).pending?'Saving choice…':effectiveStatus(a)==='Obsolete'?'Set aside · click to restore':'Selected for '+esc(lookDisplayName(getLook()))}`:'No reference chosen'}</small></span><span aria-hidden="true">→</span></button>`;}).join('');
 }
 function preview(){
   const item=allImages().find(x=>wardrobeImageKey(x.a)===focusKey),a=item?.a;
   if(!a){$('wardrobePreview').innerHTML='<div class="wardrobe-empty-preview"><h3>Choose an image to preview</h3><p>Change the filters to see more options.</p></div>';return;}
   const s=wardrobeDecision(a,cid,lid),lookName=lookDisplayName(getLook()),roleName=s.role==='wardrobe'?'clothing reference':'character outfit',label=s.obsolete?'Set aside':s.pending?'Saving…':s.selected?'Approved & selected':s.approved?'Approved':'Needs approval';
   const selectText=s.pending?'Saving choice…':s.selected?'Selected for '+lookName:s.approved?'Use for '+lookName:'Approve & use for '+lookName;
   $('wardrobePreview').innerHTML=`<div class="wardrobe-preview-top"><span class="wardrobe-status ${!s.obsolete&&s.approved?'is-approved':''}">${esc(label)}</span><a href="${esc(a.asset)}" target="_blank" rel="noopener">Open full size ↗</a></div><div class="wardrobe-decision-actions">${s.role?`<button class="wardrobe-use" ${s.obsolete?'data-wardrobe-restore':'data-wardrobe-use'}${(!s.obsolete&&s.selected)||s.pending||busy||!bulkApprovalAvailable?' disabled':''}>${esc(s.obsolete?'Restore & use for '+lookName:selectText)}</button>`:'<p class="small">Supporting image. Choose a clothing study or character outfit to use for this look.</p>'}</div><img class="wardrobe-large-image" src="${esc(a.asset)}" alt="${esc(a.title)}"><div class="wardrobe-preview-copy"><h3>${esc(titleFor(a))}</h3>
   ${s.obsolete?'<p class="wardrobe-decision-note">This image was set aside. Restore it to make it available again and use it for this outfit.</p>':''}

   <details class="wardrobe-more-options"><summary>More options</summary><div class="wardrobe-secondary-actions">${!s.approved&&!s.obsolete?`<button data-wardrobe-approve${s.pending||busy||!bulkApprovalAvailable?' disabled':''}>Approve image only</button>`:''}${!item.associated?`<button data-wardrobe-add${busy?' disabled':''}>Add to this look</button>`:''}<button data-image="${esc(a.id)}" data-selection-character="${esc(cid)}" data-selection-role="${s.role||''}" data-selection-look="${esc(lid)}">Review image & notes</button></div><p class="small">Approval alone keeps your current selection. Using an image approves it and selects it for this look.</p><p class="small">${esc(a.type)} · <code>${esc(a.id)}</code></p><p class="small">Exact version: <code>${esc(a.sha256)}</code></p></details>
   ${!bulkApprovalAvailable?'<p class="small">Reconnect the local save service to enable approvals.</p>':''}</div>`;

 }
 function render(){
   if(!root.isConnected)return;
   const q=$('wardrobeQuery').value.trim().toLowerCase(),scope=$('wardrobeScope').value,status=$('wardrobeStatus').value;
   rows=allImages().filter(({a,decision:s,associated})=>(kind==='all'||s.role===kind)&&(scope==='all'||associated)&&(status==='obsolete'?s.obsolete:status==='active'?(!s.obsolete||s.selected):status==='selected'?s.selected:!s.obsolete&&(status==='pending'&&!s.approved||status==='approved'&&s.approved))&&(!q||[a.id,a.title,...(a.tags||[])].join(' ').toLowerCase().includes(q))).sort((x,y)=>Number(y.decision.selected)-Number(x.decision.selected)||Number(y.associated)-Number(x.associated)||(rankValue(x.a,cid)??Infinity)-(rankValue(y.a,cid)??Infinity)||x.a.id.localeCompare(y.a.id));
   if(!allImages().some(x=>wardrobeImageKey(x.a)===focusKey))focusKey=rows[0]?wardrobeImageKey(rows[0].a):'';
   currentCards();for(const b of root.querySelectorAll('[data-wardrobe-kind]'))b.setAttribute('aria-pressed',String(b.dataset.wardrobeKind===kind));
   $('wardrobeFilterSummary').textContent=(kind==='all'?'All categories':kind==='body'?'Character outfits':'Clothing studies')+' · '+(scope==='all'?'This character':'This look');
   $('wardrobeCount').textContent=rows.length+' image'+(rows.length===1?'':'s')+' · click an image to preview';
   $('wardrobeGrid').innerHTML=rows.slice(0,limit).map(({a,decision:s})=>`<article class="wardrobe-card${s.selected?' is-selected':''}"><button class="wardrobe-card-preview" data-wardrobe-preview="${esc(wardrobeImageKey(a))}" aria-pressed="${wardrobeImageKey(a)===focusKey}" aria-label="Preview ${esc(a.title)}"><img src="${esc(a.sha256===assets.get(a.id).sha256?a.thumbnail:a.asset)}" alt="" loading="lazy"><span class="wardrobe-card-title">${esc(titleFor(a))}</span></button><div class="wardrobe-card-state"><span class="wardrobe-status ${!s.obsolete&&s.approved?'is-approved':''}">${s.obsolete?'Set aside':s.pending?'Saving…':s.selected?'✓ Selected':s.approved?'Approved':'Needs approval'}</span></div></article>`).join('')||'<div class="wardrobe-no-results"><h3>No matching images</h3><p>Browse all of this character’s images.</p><button data-wardrobe-reset>Show all available images</button></div>';
   $('wardrobeMore').hidden=limit>=rows.length;$('wardrobeMore').textContent=`Show more (${Math.min(limit,rows.length)} of ${rows.length})`;preview();
 }
 function message(text){$('wardrobeMessage').textContent=text;}
 for(const id of ['wardrobeScope','wardrobeStatus'])$(id).onchange=()=>{focusKey='';limit=24;render();};$('wardrobeQuery').oninput=()=>{focusKey='';limit=24;render();};$('wardrobeMore').onclick=()=>{limit+=24;render();};
 root.onclick=async e=>{
   const b=e.target.closest('button');if(!b||busy)return;
   if(b.dataset.wardrobeKind){kind=b.dataset.wardrobeKind;focusKey='';limit=24;render();return;}
   if(b.hasAttribute('data-wardrobe-current')){kind=b.dataset.wardrobeCurrent;focusKey=b.dataset.wardrobeKey||'';$('wardrobeScope').value='all';$('wardrobeStatus').value='active';$('wardrobeQuery').value='';limit=24;render();return;}
   if(b.dataset.wardrobePreview){focusKey=b.dataset.wardrobePreview;render();return;}
   if(b.hasAttribute('data-wardrobe-reset')){$('wardrobeScope').value='all';$('wardrobeStatus').value='active';$('wardrobeQuery').value='';kind='all';focusKey='';render();return;}
   const action=b.hasAttribute('data-wardrobe-restore')?'restore':b.hasAttribute('data-wardrobe-use')?'use':b.hasAttribute('data-wardrobe-approve')?'approve':b.hasAttribute('data-wardrobe-add')?'add':null;if(!action)return;
   const item=allImages().find(x=>wardrobeImageKey(x.a)===focusKey);if(!item)return;const a=item.a,s=wardrobeDecision(a,cid,lid);
   busy=true;render();message('Saving…');
   try{
     if((action==='use'||action==='restore')&&(!s.role||(s.obsolete&&action!=='restore')))throw Error('Choose an active clothing or character outfit image.');
     if(action!=='add'&&(!bulkApprovalAvailable||(s.obsolete&&action!=='restore')))throw Error('Approval is unavailable for this image.');
     if(!a.character_ids.includes(cid)||!wardrobeAssociated(a,getCharacter(),getLook()))await DESKReferenceLibrary.post('api/references',{character_id:cid,type:a.type,look_id:lid,asset_ids:[a.id],tags:[]});
     if(action==='use'||action==='restore'){
       // Existing canon selection is an approval of the exact selected version.
       // Use its single durable autosave path, keeping role and look fixed here.
       canonSelect(cid,a.id,s.role,lid,action==='restore',a.sha256);
       message('Saving this '+(s.role==='wardrobe'?'clothing reference':'character outfit')+' for '+lookDisplayName(getLook())+'…');
     }else if(action==='approve'){wardrobeApproveExact(cid,a.id,a.sha256);message('Saving image approval. Your chosen reference stays the same.');}
     else message('Added to this look. Approval and selection are unchanged.');
   }catch(error){message('Could not save: '+error.message);}finally{busy=false;render();}
 };
 function saved(){if(!root.isConnected)return;render();const a=allImages().find(x=>wardrobeImageKey(x.a)===focusKey)?.a;if(a&&!wardrobeDecision(a,cid,lid).pending&&$('wardrobeMessage').textContent.startsWith('Saving'))message('Saved. '+(wardrobeDecision(a,cid,lid).selected?'This is the selected reference for '+lookDisplayName(getLook())+'.':'Image approved; reference selection unchanged.'));}
 window.addEventListener('desk-approval-saved',saved);
 const observer=new MutationObserver(()=>{if(!root.isConnected)cleanup();});observer.observe($('modalBody'),{childList:true});
 function cleanup(){window.removeEventListener('desk-approval-saved',saved);observer.disconnect();modal.classList.remove('wardrobe-dialog');modal.removeEventListener('close',cleanup);if(wardrobeCleanup===cleanup)wardrobeCleanup=null;}
 wardrobeCleanup=cleanup;modal.addEventListener('close',cleanup);render();
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-wardrobe-browse]');if(b)wardrobeChoose(b.dataset.wardrobeCharacter,b.dataset.wardrobeBrowse);});
