/* Character creation updates the catalog without reloading pending review edits. */
(()=>{
 const button=document.getElementById('addCharacter');
 button.addEventListener('click',()=>{
  openModal('Add character',`<form id="addCharacterForm" class="character-create-form">
   <label for="characterName">Character name <input id="characterName" name="name" required maxlength="140" autocomplete="off" autofocus></label>
   <label for="characterGroup">Family / group <input id="characterGroup" name="group" list="characterGroupOptions" required maxlength="100" value="${esc(D.groups.find(g=>g.id===$('group').value)?.label||'Characters')}"></label>
   <datalist id="characterGroupOptions">${D.groups.map(g=>`<option value="${esc(g.label)}"></option>`).join('')}</datalist>
   <p class="small">Choose an existing group or enter a new one.</p>
   <label for="characterAge"><span>Age <small>(optional)</small></span><input id="characterAge" name="age" type="number" min="0" step="1" inputmode="numeric"></label>
   <label for="characterDescription"><span>Description <small>(optional)</small></span><textarea id="characterDescription" name="description" rows="3" maxlength="3000"></textarea></label>
   <p id="characterCreateStatus" role="status" aria-live="polite"></p>
   <div class="character-create-actions"><button type="button" id="cancelAddCharacter">Cancel</button><button type="submit" id="saveNewCharacter">Add character</button></div>
  </form>`);
  const form=$('addCharacterForm'),status=$('characterCreateStatus'),submit=$('saveNewCharacter');
  let busy=false,requestId=crypto.randomUUID(),lastPayload=null;
  $('cancelAddCharacter').onclick=()=>{$('modalClose').click();};
  form.onsubmit=async event=>{
   event.preventDefault();if(busy||!form.reportValidity())return;
   const payload={name:$('characterName').value.trim(),group:$('characterGroup').value.trim(),age:$('characterAge').value===''?null:Number($('characterAge').value),description:$('characterDescription').value.trim()};
   if(!payload.name||!payload.group){status.textContent='Enter a character name and a family or group.';return;}
   const fingerprint=JSON.stringify(payload);if(lastPayload!==null&&fingerprint!==lastPayload)requestId=crypto.randomUUID();lastPayload=fingerprint;
   busy=true;submit.disabled=true;status.textContent='Adding character…';
   try{
    const result=await DESKReferenceLibrary.post('api/characters',{...payload,request_id:requestId});
    if(!form.isConnected)return;
    for(const id of ['search','group','type','status'])$(id).value='';$('scope').value='Project roster';
    $('modal').close();detail(result.characters[0].id);window.scrollTo(0,0);toast('Character added.');
   }catch(error){if(form.isConnected)status.textContent=error.message;}
   finally{busy=false;submit.disabled=false;}
  };
  $('characterName').focus();
 });
})();
