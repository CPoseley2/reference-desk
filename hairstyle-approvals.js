/* Batch approval uses the existing exact-version approval store; it never selects a hairstyle. */
function hairstyleBulkPlan(cid){
 if(!people.has(cid))throw Error('Unknown character.');
 const all=D.assets.filter(a=>a.character_ids.includes(cid)&&assetInCategory(a,cid,'Hairstyle study'));
 const rows=all.filter(a=>effectiveStatus(a)!=='Obsolete'&&review.notes[a.id]?.verdict!=='Reject').sort(rankOrder).map(a=>({id:a.id,sha256:a.sha256,title:a.title,thumbnail:a.thumbnail||a.asset,approved:isApprovedReference(a,cid),prior:JSON.parse(JSON.stringify(review.reference_approvals?.[cid]?.[a.id]||null))}));
 return {cid,rows,excluded:all.length-rows.length};
}
function hairstyleBulkCommit(plan,ids){
 if(!bulkApprovalAvailable)throw Error('Reconnect the local save service to approve images.');
 if(!people.has(plan.cid))throw Error('Unknown character.');
 const changes=[];
 // Check the entire selection before changing anything, as in the emotion batch flow.
 for(const id of new Set(ids)){
  const row=plan.rows.find(r=>r.id===id),a=assets.get(id);
  if(!row||!a||a.sha256!==row.sha256||!a.character_ids.includes(plan.cid)||!assetInCategory(a,plan.cid,'Hairstyle study')||effectiveStatus(a)==='Obsolete'||review.notes[id]?.verdict==='Reject')throw Error('An image changed. Reopen Approve all to review the latest hairstyles.');
  if(JSON.stringify(review.reference_approvals?.[plan.cid]?.[id]||null)!==JSON.stringify(row.prior))throw Error('An approval changed. Reopen Approve all before saving.');
  if(!isApprovedReference(a,plan.cid))changes.push(a);
 }
 if(!changes.length)return 0;
 const next=JSON.parse(JSON.stringify(review)),at=new Date().toISOString();
 next.reference_approvals??={};next.reference_approvals[plan.cid]??={};
 for(const a of changes)next.reference_approvals[plan.cid][a.id]={source_sha256:a.sha256,role:'hair',approved:true,updated_at:at};
 canonValidate(next);review=next;save();return changes.length;
}
function hairstyleBulkDialog(cid){
 const plan=hairstyleBulkPlan(cid),c=people.get(cid),pending=plan.rows.filter(r=>!r.approved);
 openModal('Approve all hairstyles · '+c.name,`<section class="hairstyle-bulk"><p>Review this character’s hairstyles, then approve all or uncheck any you want to leave for later.</p><p class="small">Your selected hairstyle stays the same. Already approved images are kept; ${plan.excluded} set-aside or rejected image${plan.excluded===1?' is':'s are'} excluded. This includes the complete hairstyle category, regardless of gallery filters.</p><div class="emotion-bulk-actions"><button type="button" id="hairBulkCommit">Approve all</button><button type="button" id="hairBulkToggle"${pending.length?'':' disabled'}>Clear selection</button></div><p id="hairBulkStatus" role="status" aria-live="polite"></p><div class="emotion-bulk-rows">${plan.rows.map(row=>`<article class="emotion-bulk-row"><a href="${esc(assets.get(row.id).asset)}" target="_blank" rel="noopener" aria-label="Open ${esc(row.title)} full size"><img loading="lazy" src="${esc(row.thumbnail)}" alt="${esc(row.title)}"></a><div><h3>${esc(row.title)}</h3>${row.approved?'<p>Approved reference · Keep approval</p>':`<label><span><input type="checkbox" data-hair-approve="${esc(row.id)}" checked> Include in approval</span></label>`}<p class="small">${esc(row.id)}</p></div></article>`).join('')||'<p>No eligible hairstyle images to approve.</p>'}</div></section>`);
 const host=document.querySelector('.hairstyle-bulk'),button=$('hairBulkCommit'),toggle=$('hairBulkToggle'),status=$('hairBulkStatus');let committed=false,count=0;
 const boxes=()=>[...host.querySelectorAll('[data-hair-approve]')];
 function update(){const n=boxes().filter(b=>b.checked).length;button.textContent=n?(n===pending.length?'Approve all':'Approve selected')+' · '+n:pending.length?'Select images to approve':'No approvals needed';button.disabled=!n||!bulkApprovalAvailable;toggle.textContent=n?'Clear selection':'Select all';status.textContent=!bulkApprovalAvailable?'Reconnect the local save service to enable approvals.':n?n+' hairstyle images ready to approve.':pending.length?'Choose at least one image.':plan.rows.length?'All eligible hairstyles are already approved.':'No eligible hairstyles are available.';}
 toggle.onclick=()=>{const checked=!boxes().some(b=>b.checked);boxes().forEach(b=>b.checked=checked);update();};host.addEventListener('change',update);update();
 button.onclick=async()=>{button.disabled=true;try{
  if(!committed){count=hairstyleBulkCommit(plan,boxes().filter(b=>b.checked).map(b=>b.dataset.hairApprove));committed=true;boxes().forEach(b=>b.disabled=true);toggle.disabled=true;}
  status.textContent='Saving '+count+' hairstyle approvals…';
  if(window.DESKAutosave){await DESKAutosave.flush();const state=DESKAutosave.state();if(state.dirty||state.conflicted||state.inflight){status.textContent='Approvals are pending save. Check the save status for retry or conflict details.';button.textContent='Retry save';button.disabled=false;return;}}
  status.textContent=count+' hairstyle images approved and saved'+(window.DESKAutosave?' on this Mac.':' in this browser.');button.textContent='Approved';if(current===cid)refreshView();
 }catch(error){status.textContent=error.message;button.textContent=committed?'Retry save':'Approve selected';button.disabled=false;}};
}
document.addEventListener('click',e=>{const button=e.target.closest('[data-hairstyle-bulk]');if(button)hairstyleBulkDialog(button.dataset.hairstyleBulk);});
