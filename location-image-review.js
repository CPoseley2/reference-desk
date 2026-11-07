/* Location approval inside the shared image review. Notes and character approvals stay separate. */
(()=>{
'use strict';
function controls(a,l){
 return `<section class="location-image-approval" aria-label="Location image approval"><p>For <strong>${esc(l.name)}</strong></p><div class="location-image-approval-actions"><button type="button" id="galleryApproveLocationImage">Approve image</button>${window.DESKLocationEditing?.button(l,Object.keys(l.references||{}).find(s=>l.references[s].includes(a.id))||'scene-references',a,'Refine image (beta)')||''}<span id="galleryLocationApprovalBadge">${DESKLocations.badge(a,l)}</span></div><p class="small">Approve this exact image for this location. Scene assignments and working references stay as chosen.</p><p id="galleryLocationApprovalStatus" class="small" role="status" aria-live="polite"></p></section>`;
}
function bind(a,l){
 const button=$('galleryApproveLocationImage'),badge=$('galleryLocationApprovalBadge'),message=$('galleryLocationApprovalStatus');
 if(!button)return;
 const sourceHash=a.sha256;
 let busy=false,approved=false,expected=null;
 function draw(){
  approved=l.approvals?.[a.id]?.approved===true&&l.approvals[a.id].source_sha256===sourceHash;
  expected=l.approvals?.[a.id]?JSON.parse(JSON.stringify(l.approvals[a.id])):null;
  const canonical=l.canonical_source?.id===a.id&&l.canonical_source.source_sha256===sourceHash;
  button.textContent=approved?'Revoke approval':canonical?'Canonical source':'Approve image';
  button.disabled=busy||(!approved&&(canonical||effectiveStatus(a)==='Obsolete'));
  badge.innerHTML=DESKLocations.badge(a,l);
 }
 draw();
 button.onclick=async()=>{
  if(busy||button.disabled)return;
  busy=true;button.disabled=true;message.textContent=approved?'Revoking approval…':'Saving approval…';
  const approving=!approved;
  try{
   if(assets.get(a.id)?.sha256!==sourceHash)throw Error('Image version changed. Reopen it before approving.');
   const slot=Object.keys(l.references||{}).find(s=>l.references[s].includes(a.id))||(a.type==='Supporting prop / map'?'supporting-maps':'scene-references');
   if(approving)await DESKLocations.ensureCoverage(l,slot,a);
   await DESKReferenceLibrary.post('api/location-approval',{location_id:l.id,slot_id:slot,asset_id:a.id,source_sha256:sourceHash,approved:approving,expected_approval:expected});
   // Refresh the underlying gallery without replacing the open form or its notes.
   if(window.DESKLocations?.active)DESKLocations.render();
   if(button.isConnected){busy=false;draw();message.textContent=approving?'Approved for '+l.name+'.':'Approval revoked for '+l.name+'.';}
  }catch(error){
   if(button.isConnected){message.textContent=error.message;busy=false;button.disabled=false;}
  }
 };
}
window.DESKLocationImageReview={controls,bind};
})();
