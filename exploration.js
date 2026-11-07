/* Character exploration drafts are browser-local and never mutate canon. */
(()=>{
'use strict';
const Core=window.DESKExplorationCore, sharedBank=window.DESKExplorationActions;
const profiles={};
function profileFor(c){
 if(!c)return null;
 return profiles[c.id]||{id:c.id,name:c.name,shortName:c.name,defaultLook:c.looks?.find(l=>l.active_story!==false)?.id,draftKey:'desk-character-exploration-v1:'+c.id,downloadPrefix:c.id+'-exploration-',continuity:`Preserve ${c.name}’s selected identity, apparent age, hair and body proportions from the chosen references. Follow the documented character and look context; do not substitute another character or invent a different age. Choose actions appropriate to the character and keep the selected outfit intact.`};
}
function bankFor(cid){return sharedBank;}
const $e=id=>document.getElementById('explore-'+id);
const keyOf=r=>r.id+'|'+r.sha256;
const options=(rows,value)=>rows.map(([id,label])=>`<option value="${esc(id)}"${id===value?' selected':''}>${esc(label)}</option>`).join('');
const live=a=>a && effectiveStatus(a)!=='Obsolete';
const isBody=a=>a.type==='Full-body / costume';
const isClothing=a=>isBody(a)||a.type==='Mannequin outfit study';
const drafts=new Map();
function loadDraft(key){try{return JSON.parse(DESKStorage.getItem(key)||'{}')||{};}catch{return {};}}
function saveDraft(key,d){drafts.set(key,d);try{DESKStorage.setItem(key,JSON.stringify(d));}catch{}}
function exact(a,hash){if(!a)return null;const v=!hash||hash===a.sha256?a:(a.previous_versions||[]).find(x=>x.sha256===hash);return v?.asset?{...a,...v,id:a.id,sha256:hash||a.sha256}:null;}
function selectedRef(r){const a=r&&assets.get(r.id);return live(a)?exact(a,r.source_sha256):null;}
function reference(a,cid){return a?{id:a.id,title:a.title,sha256:a.sha256,asset:a.asset,type:a.type,status:referenceStatus(assets.get(a.id),cid,a.sha256),description:a.hairstyle_description||''}:null;}
function open(initialLook,characterId=current){
 const profile=profileFor(people.get(characterId));if(!profile)return;
 const cid=profile.id, draftKey=profile.draftKey, bank=bankFor(cid), total=bank.actions.length.toLocaleString();
 const c=people.get(cid);if(!c)return;
 const saved=drafts.get(draftKey)||loadDraft(draftKey);
 const ref=a=>reference(a,cid);
 const looks=(c.looks||[]).filter(l=>l.active_story!==false);
 const d={lookId:initialLook||saved.lookId||profile.defaultLook,settingMode:'limbo',limboId:'warm-gray',expression:'Curious, engaged and natural',aspect:'3:2 landscape',camera:'Eye level, three-quarter view',direction:'',timeOfDay:'',weather:'',windLevel:-1,...saved};
 if(!Number.isInteger(d.windLevel)||d.windLevel< -1||d.windLevel>5)d.windLevel=-1;
 if(initialLook)d.lookId=initialLook;if(!looks.some(l=>l.id===d.lookId))d.lookId=looks[0]?.id;
 let costumeRows=[],bodyRows=[],emotionRows=[],locationRows=[],generated=false;
 const hairRows=D.assets.filter(a=>live(a)&&a.type==='Hairstyle study'&&a.character_ids?.includes(cid)).sort((a,b)=>(a.hairstyle_number||999)-(b.hairstyle_number||999));
 openModal('Explore '+profile.shortName,`<section class="exploration"><div class="explore-intro"><p class="eyebrow">REFERENCE DESK · CHARACTER EXPLORATION</p><h2>One costume. ${total} possibilities.</h2><p>Choose an outfit, an action and a setting. Create a prompt, then generate the image here or copy it into chat.</p></div>
 <form id="explore-form">
 <div class="explore-columns"><section class="explore-step"><h3><span>1</span> Choose a costume</h3><label for="explore-look">Costume look</label><select id="explore-look">${options(looks.map(l=>[l.id,lookDisplayName(l)]),d.lookId)}</select><label for="explore-costume">Costume image</label><select id="explore-costume"></select><div id="explore-costume-preview" class="explore-preview"></div><details class="explore-continuity" open><summary>Face, hair & proportions</summary><div id="explore-identity-preview" class="explore-mini"></div><label for="explore-body">Full-body / hairstyle reference</label><select id="explore-body"></select><div id="explore-body-preview" class="explore-mini"></div>${hairRows.length?`<label for="explore-hair">Hairstyle</label><select id="explore-hair"></select><div id="explore-hair-preview" class="explore-mini"></div><p class="small">Choose a hairstyle independently of the outfit. The selected likeness keeps the face consistent.</p>`:''}<p class="small">The outfit supplies clothing. The likeness supplies the face. A full-body reference keeps proportions and hairstyle consistent.</p></details></section>
 <section class="explore-step"><h3><span>2</span> Choose an action</h3><label for="explore-query">Search ${total} actions</label><input id="explore-query" type="search" placeholder="Try flowers, skip, water, ribbon…" value="${esc(d.query||'')}"><input type="hidden" id="explore-category" value="${esc(d.category||'')}"><input type="hidden" id="explore-pose" value="${esc(d.pose||'')}"><input type="hidden" id="explore-action" value="${esc(d.actionId||'')}"><div class="explore-browse-heading"><strong>Poses & movement</strong><button type="button" id="explore-all-actions">All actions</button></div><div id="explore-poses" class="explore-category-grid" role="group" aria-label="Pose categories"></div><details class="explore-everyday"${d.category?' open':''}><summary>Everyday action categories</summary><div id="explore-categories" class="explore-category-grid" role="group" aria-label="Action categories"></div></details><div id="explore-action-picked" class="explore-picked" role="status"></div><p id="explore-count" class="small" aria-live="polite"></p><div id="explore-action-results" class="explore-action-results" role="group" aria-label="Action choices"></div><div class="explore-pagination"><button type="button" id="explore-prev" aria-label="Previous action results">←</button><span id="explore-page" class="small"></span><button type="button" id="explore-next" aria-label="Next action results">→</button></div><button type="button" id="explore-surprise" class="explore-secondary">Surprise me within these results</button></section></div>
 <section class="explore-step explore-setting"><h3><span>3</span> Place the shot</h3><div class="explore-pair"><label>Where is the shot?<select id="explore-setting-choice"></select></label><label>Image format<select id="explore-aspect">${options(['3:2 landscape','2:3 portrait','16:9 widescreen','1:1 square'].map(x=>[x,x]),d.aspect)}</select></label></div><p class="small">Choose from all script locations and the website Places / Map library. Images do not need prior approval for this exploration.</p><div id="explore-limbo-fields"><p id="explore-limbo-note" class="small"></p></div><div id="explore-location-fields" hidden><p id="explore-location-note" class="small"></p><div id="explore-view-choice"><label for="explore-location-ref">Reference view</label><select id="explore-location-ref"></select></div><div id="explore-location-preview" class="explore-mini"></div><div id="explore-location-gallery" class="explore-location-gallery" role="group" aria-label="Location reference images"></div><details id="explore-location-sources"><summary>Script & website sources</summary><div id="explore-location-evidence"></div></details><details><summary>Location direction</summary><label class="explore-check"><input id="explore-concept" type="checkbox"${d.conceptLocation?' checked':''}> Explore a new interpretation of this location</label></details></div></section>
 <details class="explore-direction" open><summary>Performance & direction</summary>
 <div class="explore-pair"><div><label for="explore-expression">Expression</label><select id="explore-expression">${options([...Core.expressionCues.map(x=>[x,x]),['__custom__','Custom emotional cue…']],Core.expressionCues.includes(d.expression)?d.expression:'__custom__')}</select><div id="explore-custom-expression-field"${Core.expressionCues.includes(d.expression)?' hidden':''}><label for="explore-custom-expression">Custom emotional cue</label><input id="explore-custom-expression" maxlength="500" value="${esc(d.customExpression||(!Core.expressionCues.includes(d.expression)?d.expression:''))}" placeholder="Describe the expression…"></div></div>
 <div><label for="explore-camera">Camera</label><select id="explore-camera">${Core.cameraGroups.map(g=>`<optgroup label="${esc(g.label)}">${options(g.options.map(x=>[x,x]),d.camera)}</optgroup>`).join('')}</select></div></div>
 <label for="explore-emotion">Expression reference</label><select id="explore-emotion"></select>
 <div class="explore-pair"><div><label for="explore-time">Time of day</label><select id="explore-time">${options([['','Match reference / setting'],...Core.timeOptions.map(x=>[x,x])],d.timeOfDay)}</select></div><div><label for="explore-weather">Weather</label><select id="explore-weather">${options([['','Match reference / setting'],...Core.weatherOptions.map(x=>[x,x])],d.weather)}</select></div></div>
 <div class="explore-wind"><label for="explore-wind">Wind <output id="explore-wind-value" for="explore-wind">${esc(Core.windLabel(d.windLevel))}</output></label><input id="explore-wind" type="range" min="-1" max="5" step="1" value="${d.windLevel}" aria-valuetext="${esc(Core.windLabel(d.windLevel))}"><div class="explore-wind-scale" aria-hidden="true"><span>Match reference</span><span>Still → Gale-force</span></div></div>
 <p class="small">Defaults follow your reference. In a studio setting, these choices guide lighting and effects on the character.</p>
 <label for="explore-direction">Other direction (optional)</label><textarea id="explore-direction" rows="2" maxlength="3000" placeholder="A specific prop, a small story beat, or other details…">${esc(d.direction)}</textarea></details>
 <div class="explore-create"><button type="submit" id="explore-create">Create prompt</button><p id="explore-status" role="status">Choices here are for this prompt only. Reference selections and approvals stay as they are.</p></div><details id="explore-error-details" hidden><summary>Technical error details</summary><pre id="explore-error-text"></pre></details></form>
 <section id="explore-output" hidden><h3>Your image request</h3><p>Review or edit the prompt, then generate below. You can also copy it into chat.</p><label class="save-sr-only" for="explore-prompt">Generated exploration prompt</label><textarea id="explore-prompt" rows="14" spellcheck="false"></textarea><div class="explore-output-actions"><button id="explore-copy">Copy prompt</button><button id="explore-download">Download .txt</button><span id="explore-copy-status" role="status"></span></div></section><div id="explore-generation-host"></div></section>`);
 $('modal').classList.add('exploration-modal');
 $('modal').addEventListener('close',()=>$('modal').classList.remove('exploration-modal'),{once:true});
 const getLook=()=>looks.find(l=>l.id===$e('look').value);
 const generation=window.DESKGeneration?.mount($e('generation-host'),cid,{getBlockers:()=>Core.validate(modelForPrompt())});
 function choose(rows,k){return rows.find(a=>keyOf(a)===k)||null;}
 function preview(a,id,mini=false){$e(id).innerHTML=a?`<img src="${esc(a.asset)}" alt="${esc(a.title)}"${mini?' loading="lazy"':''}><div><strong>${esc(a.title)}</strong><p class="small">${esc(a.id)} · ${esc(a.statusLabel||referenceStatus(assets.get(a.id),cid,a.sha256))}</p><a href="${esc(a.asset)}" target="_blank" rel="noopener">View full reference</a></div>`:'<p class="small">No reference chosen.</p>';}
 function getIdentity(){return selectedRef(canonCurrent(cid).likeness);}
 function identityPreview(){const a=getIdentity();preview(a,'identity-preview',true);if(!a)$e('identity-preview').innerHTML=`<p class="notice">Choose a likeness in ${esc(profile.shortName)}’s reference desk before creating a prompt.</p>`;}
 function rowsForLook(l,predicate){
   if(!l)return [];
   const ids=new Set([...(l.full_body?.confirmed_ids||[]),...(l.full_body?.candidate_ids||[]),...(l.full_body?.unresolved_stage_candidate_ids||[]),...(l.mannequin?.confirmed_ids||[]),...(l.mannequin?.candidate_ids||[])]);
   const selected=Object.values(canonCurrent(cid)).filter(r=>r.look_id===l.id).map(selectedRef).filter(a=>a&&predicate(a));
   const rest=D.assets.filter(a=>live(a)&&a.character_ids?.includes(cid)&&predicate(a)&&(ids.has(a.id)||(a.look_ids||[]).includes(l.id)||a.look_id===l.id||(a.look_links||[]).some(x=>x.character_id===cid&&x.look_id===l.id))).slice().reverse();
   return [...new Map([...selected,...rest].map(a=>[keyOf(a),a])).values()];
 }
 function refOptions(rows,desired,none){
   const currentRefs=Object.values(canonCurrent(cid));
   return options([...(none?[['',none]]:[]),...rows.map(a=>[keyOf(a),`${currentRefs.some(r=>r.id===a.id&&r.source_sha256===a.sha256)?'Selected · ':''}${a.title} · ${a.id}${a.sha256!==assets.get(a.id)?.sha256?' · saved version':''}`])],desired);
 }
 function costumeChanged(resetBody=false){
   const a=choose(costumeRows,$e('costume').value);preview(a,'costume-preview');
   bodyRows=rowsForLook(getLook(),isBody);
   const want=isBody(a||{})?keyOf(a):(!resetBody?d.bodyKey:null);
   $e('body').innerHTML=refOptions(bodyRows,want,'Choose full-body continuity…');
   if(!$e('body').value&&bodyRows.length)$e('body').value=keyOf(bodyRows[0]);
   $e('body').disabled=isBody(a||{});preview(choose(bodyRows,$e('body').value),'body-preview',true);
 }
 function renderCostumes(reset=false){
   costumeRows=rowsForLook(getLook(),isClothing);
   const refs=canonCurrent(cid),preferred=selectedRef(refs[canonKey('wardrobe',getLook()?.id)])||selectedRef(refs[canonKey('body',getLook()?.id)]);
   $e('costume').innerHTML=refOptions(costumeRows,!reset&&d.costumeKey?d.costumeKey:preferred?keyOf(preferred):null, costumeRows.length?null:'No costume images for this look');
   if(!$e('costume').value&&costumeRows.length)$e('costume').value=keyOf(costumeRows[0]);
   costumeChanged(reset);identityPreview();
 }
 function renderHair(){
   if(!$e('hair'))return;
   const selected=selectedRef(canonCurrent(cid).hair);
   const want=Object.hasOwn(d,'hairKey')?d.hairKey:selected?keyOf(selected):'';
   // Keep pinned older versions available alongside current hairstyle candidates.
   if(selected&&!hairRows.some(a=>keyOf(a)===keyOf(selected)))hairRows.unshift(selected);
   $e('hair').innerHTML=options([['','Keep costume / body hairstyle'],...hairRows.map(a=>[keyOf(a),(a.hairstyle_name||a.title)+' · '+(a.hairstyle_group||'Style')])],want);
   preview(choose(hairRows,$e('hair').value),'hair-preview',true);
 }
 function renderEmotions(){
   const refs=canonCurrent(cid),selected=Object.values(refs).filter(r=>canonRoleFamily(r.role)==='emotion').map(selectedRef).filter(Boolean);
   emotionRows=[...new Map([...selected,...D.assets.filter(a=>live(a)&&a.character_ids?.includes(cid)&&['Emotion map','Individual emotion'].includes(a.type))].map(a=>[keyOf(a),a])).values()];
   const want=Object.hasOwn(d,'emotionKey')?d.emotionKey:selected[0]?keyOf(selected[0]):'';
   $e('emotion').innerHTML=refOptions(emotionRows,want,'Use expression direction only');
 }
 let filteredActions=[],actionPage=0;const pageSize=8;
 const poseGroups=sharedBank.pose_groups||[];
 const poseMatches=(a,pose)=>a.pose===pose||(!a.pose&&({Kneeling:/^kneel|\bkneeling\b/i,Bending:/^bend|\bbending\b/i,Reaching:/^(reach|stretch)/i,Swimming:/^(swim|float|tread water)/i,Jumping:/^(jump|hop|leap|skip)/i,Dancing:/^(dance|spin|twirl)/i,Climbing:/^(climb)/i,Sitting:/^(sit|rest seated)/i,Crouching:/^(crouch|squat)/i,'Balance & stretch':/^(balance|stretch)/i}[pose]?.test(a.text)));
 function actionPicked(){
   const action=bank.actions.find(a=>a.id===$e('action').value);
   $e('action-picked').innerHTML=action?`<span class="explore-selected-label">Selected action · ${esc(action.id)}</span><strong>${esc(action.text)}</strong>`:'<span class="explore-selected-label">Choose an action</span><span>Pick a category, then a pose or activity below.</span>';
   $e('action-results').querySelectorAll('[data-explore-pick]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.explorePick===$e('action').value));
 }
 function renderActions(reset=true){
   if(reset)actionPage=0;
   const q=$e('query').value.toLowerCase().trim(),cat=$e('category').value,pose=$e('pose').value,source=$e('source')?.value||'';
   const pool=bank.actions.filter(a=>q.split(/\s+/).every(word=>(a.id+' '+a.text+' '+a.category+' '+(a.pose||'')).toLowerCase().includes(word)));
   $e('poses').innerHTML=poseGroups.map(name=>{const n=pool.filter(a=>poseMatches(a,name)).length;return `<button type="button" data-explore-pose="${esc(name)}" aria-pressed="${pose===name}"${n?'':' disabled'}><span>${esc(name)}</span><small>${n}</small></button>`;}).join('');
   $e('categories').innerHTML=bank.categories.map(name=>{const n=pool.filter(a=>a.category===name).length;return `<button type="button" data-explore-category="${esc(name)}" aria-pressed="${cat===name}"${n?'':' disabled'}><span>${esc(name)}</span><small>${n}</small></button>`;}).join('');
   $e('all-actions').setAttribute('aria-pressed',!cat&&!pose);
   filteredActions=pool.filter(a=>(!cat||a.category===cat)&&(!pose||poseMatches(a,pose)));
   const pages=Math.max(1,Math.ceil(filteredActions.length/pageSize));actionPage=Math.min(actionPage,pages-1);
   const start=actionPage*pageSize,visible=filteredActions.slice(start,start+pageSize);
   $e('action-results').innerHTML=visible.length?visible.map(a=>`<button type="button" class="explore-action-choice" data-explore-pick="${esc(a.id)}" aria-pressed="${a.id===$e('action').value}"><span>${esc(a.text)}</span><small>${esc(a.id)} · ${esc(a.pose||a.category)}</small></button>`).join(''):'<p class="explore-empty">No actions match this search in this category. Try All actions or a shorter search.</p>';
   $e('count').textContent=filteredActions.length.toLocaleString()+' actions'+(pose?' · '+pose:cat?' · '+cat:' · all categories');
   $e('page').textContent=visible.length?`${start+1}–${start+visible.length} of ${filteredActions.length}`:'No results';
   $e('prev').disabled=actionPage===0;$e('next').disabled=actionPage>=pages-1;$e('surprise').disabled=!filteredActions.length;actionPicked();
 }
 const locationImageRows=l=>Core.locationImages(l,assets,live);
 function chosenSetting(){const value=$e('setting-choice').value;return {mode:value.startsWith('location:')?'location':'limbo',id:value.slice(value.indexOf(':')+1)};}
 function locations(){
   const all=(D.locations||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
   const groups=[['Script & website',l=>l.script_sources?.length&&l.website_sources?.length],['Script locations',l=>l.script_sources?.length&&!l.website_sources?.length],['Website · Places / Map library',l=>!l.script_sources?.length&&l.website_sources?.length],['Other locations / reference library',l=>!l.script_sources?.length&&!l.website_sources?.length]];
   const want=d.settingMode==='location'?'location:'+d.locationId:'limbo:'+d.limboId;
   $e('setting-choice').innerHTML=options([['','Choose a setting…']],want)+'<optgroup label="Studio / limbo">'+options(Core.limboSets.map(l=>['limbo:'+l.id,l.name]),want)+'</optgroup>'+groups.map(([label,test])=>{
     const rows=all.filter(test);return rows.length?'<optgroup label="'+esc(label)+'">'+options(rows.map(l=>{const n=locationImageRows(l).length;return ['location:'+l.id,l.name+' · '+n+' image'+(n===1?'':'s')];}),want)+'</optgroup>':'';
   }).join('');
 }
 function locationPreview(){
   const selected=$e('location-ref').value;
   preview(choose(locationRows,selected),'location-preview',true);
   if(!locationRows.length)$e('location-preview').innerHTML='<p class="explore-empty">No usable reference image is attached to this location yet. Add or generate one in Locations, then reopen this request.</p>';
   $e('location-gallery').innerHTML=locationRows.map(a=>`<button type="button" class="explore-location-image" data-location-image="${esc(keyOf(a))}" aria-pressed="${keyOf(a)===selected}"><img src="${esc(a.asset)}" alt="${esc(a.title)}" loading="lazy"><strong>${esc(a.title)}</strong><small>${esc(a.statusLabel)}</small></button>`).join('');
 }
 function locationChanged(){
   const choice=chosenSetting(),l=choice.mode==='location'?(D.locations||[]).find(l=>l.id===choice.id):null;$e('location-note').textContent=l?.description||'';
   locationRows=locationImageRows(l);
   const desired=l?.id===d.locationId?d.locationRefKey:'';
   $e('location-ref').innerHTML=options(locationRows.length?locationRows.map(a=>[keyOf(a),a.title+' · '+a.statusLabel]):[['','No reference images attached']],desired);
   if(!choose(locationRows,$e('location-ref').value)&&locationRows.length)$e('location-ref').value=keyOf(locationRows[0]);
   $e('location-ref').disabled=!locationRows.length;
   $e('view-choice').hidden=locationRows.length<2;
   locationPreview();
   const scripts=(l?.script_sources||[]).map(r=>`<p><strong>Script · Episode ${esc(r.episode??'—')}</strong> · Line ${esc(r.line??'—')}<br>${esc(r.heading||r.excerpt||'')}</p>`);
   const sites=(l?.website_sources||[]).map(r=>`<p><strong>Website · ${esc(r.collection||'Places / Map library')}</strong><br>${esc(r.name||'')} — ${esc(r.description||r.caption||'')}</p>`);
   $e('location-evidence').innerHTML=[...scripts,...sites].join('')||'<p>No script or website source notes attached.</p>';
 }
 function setting(){const choice=chosenSetting(),on=choice.mode==='location';$e('location-fields').hidden=!on;$e('limbo-fields').hidden=on;$e('limbo-note').textContent=Core.limboSets.find(x=>x.id===choice.id)?.description||'';locationChanged();}
 function readDraft(){const choice=chosenSetting();return {actionSource:$e('source')?.value||'',lookId:$e('look').value,costumeKey:$e('costume').value,bodyKey:$e('body').value,hairKey:$e('hair')?.value||'',emotionKey:$e('emotion').value,query:$e('query').value,category:$e('category').value,pose:$e('pose').value,actionId:$e('action').value,settingMode:choice.mode,limboId:choice.mode==='limbo'?choice.id:d.limboId,locationId:choice.mode==='location'?choice.id:d.locationId,locationRefKey:choice.mode==='location'?$e('location-ref').value:d.locationRefKey,conceptLocation:$e('concept').checked,expression:$e('expression').value==='__custom__'?$e('custom-expression').value:$e('expression').value,customExpression:$e('custom-expression').value,timeOfDay:$e('time').value,weather:$e('weather').value,windLevel:Number($e('wind').value),aspect:$e('aspect').value,camera:$e('camera').value,direction:$e('direction').value};}
 function modelForPrompt(){
   const choice=chosenSetting(),l=choice.mode==='location'?(D.locations||[]).find(l=>l.id===choice.id):null,lr=choose(locationImageRows(l),$e('location-ref').value);
   return {...readDraft(),character:profile,actionLibrary:bank.schema+' v'+bank.version,baseUrl:new URL('index.html',location.href).href,look:getLook(),identity:ref(getIdentity()),costume:ref(choose(costumeRows,$e('costume').value)),body:ref(choose(bodyRows,$e('body').value)),hairstyle:ref(choose(hairRows,$e('hair')?.value)),emotion:ref(choose(emotionRows,$e('emotion').value)),action:bank.actions.find(a=>a.id===$e('action').value),location:l,locationRef:lr?{...ref(lr),status:lr.statusLabel}:null};
 }
 function invalidate(){if(!$e('error-details').hidden){$e('error-details').hidden=true;$e('error-details').open=false;}$e('status').textContent='Choices changed. Click Create prompt to update your request.';generation?.invalidate();Object.assign(d,readDraft());saveDraft(draftKey,d);if(generated){$e('copy').disabled=true;$e('download').disabled=true;$e('status').textContent='Choices changed. Click Create prompt to update your request.';$e('copy-status').textContent='Previous prompt — regenerate before copying.';}}
 $e('look').onchange=()=>{d.bodyKey='';renderCostumes(true);invalidate();};
 $e('costume').onchange=()=>{costumeChanged(true);invalidate();};
 if($e('hair'))$e('hair').onchange=()=>{preview(choose(hairRows,$e('hair').value),'hair-preview',true);invalidate();};
 $e('body').onchange=()=>{preview(choose(bodyRows,$e('body').value),'body-preview',true);invalidate();};
 $e('query').oninput=()=>{renderActions();invalidate();};
 if($e('source'))$e('source').onchange=()=>{$e('category').value='';$e('pose').value='';renderActions();invalidate();};
 $e('poses').onclick=e=>{const b=e.target.closest('[data-explore-pose]');if(!b)return;$e('pose').value=b.dataset.explorePose;$e('category').value='';renderActions();invalidate();$e('poses').querySelector(`[data-explore-pose="${CSS.escape(b.dataset.explorePose)}"]`)?.focus({preventScroll:true});};
 $e('categories').onclick=e=>{const b=e.target.closest('[data-explore-category]');if(!b)return;$e('category').value=b.dataset.exploreCategory;$e('pose').value='';renderActions();invalidate();$e('categories').querySelector(`[data-explore-category="${CSS.escape(b.dataset.exploreCategory)}"]`)?.focus({preventScroll:true});};
 $e('all-actions').onclick=()=>{$e('category').value='';$e('pose').value='';renderActions();invalidate();};
 $e('action-results').onclick=e=>{const b=e.target.closest('[data-explore-pick]');if(!b)return;$e('action').value=b.dataset.explorePick;actionPicked();invalidate();};
 $e('prev').onclick=()=>{actionPage--;renderActions(false);};$e('next').onclick=()=>{actionPage++;renderActions(false);};
 $e('surprise').onclick=()=>{if(filteredActions.length){const n=crypto.getRandomValues(new Uint32Array(1))[0]%filteredActions.length;$e('action').value=filteredActions[n].id;actionPage=Math.floor(n/pageSize);renderActions(false);invalidate();}};
  $e('location-ref').onchange=()=>{locationPreview();invalidate();};
 $e('location-gallery').onclick=e=>{const b=e.target.closest('[data-location-image]');if(!b)return;$e('location-ref').value=b.dataset.locationImage;locationPreview();invalidate();$e('location-gallery').querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});};
 $e('setting-choice').onchange=()=>{setting();invalidate();};
 for(const id of ['concept','aspect','camera','emotion','time','weather'])$e(id).onchange=invalidate;
 for(const id of ['custom-expression','direction'])$e(id).oninput=invalidate;
 $e('expression').onchange=()=>{$e('custom-expression-field').hidden=$e('expression').value!=='__custom__';invalidate();};
 $e('wind').oninput=()=>{const label=Core.windLabel(Number($e('wind').value));$e('wind-value').textContent=label;$e('wind').setAttribute('aria-valuetext',label);invalidate();};
 $e('form').onsubmit=event=>{event.preventDefault();
   $e('error-details').hidden=true;$e('error-details').open=false;$e('error-text').textContent='';
   try{
     saveDraft(draftKey,readDraft());
     const model=modelForPrompt(),issues=Core.validate(model);
     if(model.settingMode==='location'&&!model.locationRef)issues.push('Choose a reference image for this location. If none are attached, add or generate one in Locations first.');
     if(issues.length)throw Object.assign(new Error([...new Set(issues)].join('\n')),{promptValidation:true});
     identityPreview();$e('prompt').value=Core.build(model);generation?.prepare(model);$e('output').hidden=false;generated=true;$e('copy').disabled=false;$e('download').disabled=false;$e('copy-status').textContent='Ready to copy into chat.';$e('status').textContent='Prompt ready. Review it, then generate below or copy into chat.';$e('output').scrollIntoView({block:'start',behavior:'smooth'});
   }catch(e){
     const message=e.promptValidation?'Cannot create the prompt yet:\n'+e.message:'The site could not build this prompt because of an internal error. No image request was sent. Refresh the page, reopen this character, and try Create prompt again. If it happens again, share the technical details below.';
     generation?.invalidate(message);generated=false;$e('copy').disabled=true;$e('download').disabled=true;$e('output').hidden=true;$e('status').textContent=message;
     if(!e.promptValidation){$e('error-text').textContent=(e.name||'Error')+': '+(e.message||String(e));$e('error-details').hidden=false;console.error('DESK exploration prompt creation failed',e);}
     $e('status').scrollIntoView({block:'center'});
   }
 };
 $e('copy').onclick=async()=>{try{await Promise.race([navigator.clipboard.writeText($e('prompt').value),new Promise((_,reject)=>setTimeout(()=>reject(Error('Clipboard unavailable')),1500))]);$e('copy-status').textContent='Copied. Paste into this chat and send to create the image.';}catch{$e('prompt').focus();$e('prompt').select();$e('copy-status').textContent='Prompt selected. Press Command-C or Ctrl-C, then paste into chat.';}};
 $e('download').onclick=()=>{const blob=new Blob([$e('prompt').value],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=profile.downloadPrefix+($e('action').value||'prompt')+'.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 renderCostumes();renderHair();renderEmotions();renderActions();locations();setting();generation?.invalidate('Click Create prompt above after choosing the required references and action.');
}
function entry(c){const profile=profileFor(c);if(!profile)return '';const total=bankFor(c.id).actions.length.toLocaleString();return `<section class="explore-entry"><div><p class="eyebrow">${esc(profile.shortName.toUpperCase())} · EXPLORATION</p><h2>Put the costume into motion.</h2><p>${total} actions · your locations · limbo sets</p></div><button data-explore-character="${esc(c.id)}">Create a scene prompt</button></section>`;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-explore-character]');if(b)open(b.dataset.exploreLook,b.dataset.exploreCharacter||current);});
window.DESKExploration={open,entry};
const requested=new URLSearchParams(location.search).get('explore');
if(people.has(requested)){
 let attempts=0;
 const launch=()=>{if(!window.DESKAutosave?.state().revision&&attempts++<30){setTimeout(launch,200);return;}detail(requested);open(undefined,requested);};
 setTimeout(launch,0);
}
})();
