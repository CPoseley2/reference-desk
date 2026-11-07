/* Create outfit slots in the shared catalogue without changing reference choices. */
(()=>{
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-create-costume]');if(!button)return;
  const cid=button.dataset.createCostume,c=people.get(cid);if(!c)return;
  const requestId=crypto.randomUUID();
  openModal('Create custom costume · '+c.name,`<form id="customCostumeForm" class="custom-costume-form"><p>Create an outfit alongside the existing wardrobe stages for <strong>${esc(c.name)}</strong>.</p><label>Costume name<input name="name" required maxlength="100" placeholder="e.g. Sunday best" autocomplete="off"></label><label>Garments &amp; accessories<textarea name="garments" rows="3" maxlength="4000" placeholder="Optional — describe the outfit, materials, colors and accessories"></textarea></label><label>Condition<textarea name="condition" rows="2" maxlength="2000" placeholder="Optional — freshly laundered, lightly dusty, worn cuffs…"></textarea></label><p class="small">After saving, choose or upload a reference, or generate one using a selected likeness and costume seed.</p><div class="custom-costume-actions"><button type="submit" class="primary">Create costume</button><button type="button" data-costume-cancel>Cancel</button></div><p data-costume-status role="status" aria-live="polite"></p></form>`);
  const form=$('customCostumeForm'),status=form.querySelector('[data-costume-status]'),submit=form.querySelector('[type=submit]');let saving=false;
  form.querySelector('[data-costume-cancel]').onclick=()=>$('modal').close();
  form.onsubmit=async event=>{
   event.preventDefault();if(saving||!form.reportValidity())return;
   saving=true;submit.disabled=true;status.textContent='Saving costume…';
   const payload={character_id:cid,request_id:requestId,...Object.fromEntries(new FormData(form))};
   try{
    const result=await DESKReferenceLibrary.post('api/looks',payload);
    if(form.isConnected){$('modal').close();detail(cid);const wardrobe=document.querySelector('#costumes-'+CSS.escape(cid)+' .wardrobe-disclosure');if(wardrobe)wardrobe.open=true;const card=document.getElementById('look-'+result.look_id);if(card){card.open=true;card.scrollIntoView({block:'center'});}}
    toast('Custom costume saved. Ready to add a reference.');
   }catch(error){status.textContent=error.message;submit.disabled=false;saving=false;}
  };
  form.elements.name.focus();
 });
})();
