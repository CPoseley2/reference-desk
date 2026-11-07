/* Script-derived location templates. Overrides change planning views, never saved imagery. */
(()=>{
const interiorSlot=s=>s.id.startsWith('interior-')||s.id==='furniture-details';
function headingTypes(heading){
 const prefix=String(heading||'').trim().replace(/^\./,'').match(/^(INT\.?|EXT\.?)(?:\s*[/&-]\s*(INT\.?|EXT\.?))?(?=\s|$)/i);
 return prefix?[...new Set(prefix.slice(1).filter(Boolean).map(s=>s.toUpperCase().startsWith('INT')?'int':'ext'))]:[];
}
function sceneEvidence(l,s){
 const own=headingTypes(s.heading);if(own.length)return {types:own,scene:s,inherited:false};
 const hash=l.script_source?.sha256;if(!hash)return {types:[],scene:s,inherited:false};
 const preceding=(D.locations||[]).filter(x=>x.script_source?.sha256===hash).flatMap(x=>x.script_sources||[])
  .filter(x=>x.episode===s.episode&&x.line<s.line&&headingTypes(x.heading).length).sort((a,b)=>b.line-a.line)[0];
 return preceding?{types:headingTypes(preceding.heading),scene:preceding,inherited:true}:{types:[],scene:s,inherited:false};
}
function resolve(l){
 const evidence=(l.script_sources||[]).map(s=>sceneEvidence(l,s)),types=new Set(evidence.flatMap(e=>e.types));
 const inferred=types.has('int')?'int':types.has('ext')?'ext':null,override=l.production?.template||null;
 return {mode:override||inferred||'ext',inferred,override,mixed:types.size>1,evidence};
}
const sceneMode=(l,s)=>l.production?.template||(sceneEvidence(l,s).types.includes('int')?'int':sceneEvidence(l,s).types.includes('ext')?'ext':resolve(l).mode);
function slots(l){
 const all=D.location_slots||[];if(!l)return all.map(s=>({...s,required:false}));
 // Map collections retain their own catalog categories.
 if(l.kind==='atlas')return all.filter(s=>l.coverage_slot_ids?.includes(s.id)||s.id==='supporting-maps').map(s=>({...s,required:false}));
 const mode=resolve(l).mode;
 // Templates suggest empty views; they must never hide saved location imagery.
 const populated=s=>!!l.references?.[s.id]?.length||!!l.selections?.[s.id];
 return all.filter(s=>populated(s)||((mode==='int'||!interiorSlot(s))&&(s.id!=='landscape-wide'||l.kind==='landscape')))
  .map(s=>({...s,required:false,label:s.id==='geometry-studies'&&mode==='ext'?'Outdoor elevations / geometry studies':s.label}))
  .sort((a,b)=>l.kind==='landscape'?(a.id==='landscape-wide'?-1:b.id==='landscape-wide'?1:0):0);
}
function control(l){
 if(l.kind==='atlas')return '';
 const t=resolve(l),label=t.mode==='int'?'INT · Interior + exterior':'EXT · Exterior',auto=t.inferred?`From script · ${t.inferred.toUpperCase()}${t.mixed?' (INT + EXT)':''}`:'Automatic · EXT starting template';
 const basis=t.override?'Saved location override':t.inferred?(t.mixed?'Script includes INT and EXT scenes':'Inherited from script'):'Choose a template · script classification pending';
 const notes=t.mode==='int'?'Exterior views, aerials, elevations, interior floorplans, interior views and furniture details.':'Exterior views, aerials, outdoor elevations and scene references.';
 const excluded=new Set((D.location_slots||[]).filter(interiorSlot).map(s=>s.id));
 const existing=t.mode==='ext'?Object.values(l.production?.scenes||{}).flatMap(s=>s.requirements||[]).filter(r=>excluded.has(r.slot_id)).length:0;
 return `<section class="location-template" aria-label="Location template"><div class="location-template-top"><div><span class="location-template-label">Location template</span><strong>${label}</strong></div><label>Use template<select id="locationTemplate" data-location-template>${[['auto',auto],['ext','EXT · Exterior'],['int','INT · Interior + exterior']].map(([v,n])=>`<option value="${v}" ${(t.override||'auto')===v?'selected':''}>${esc(n)}</option>`).join('')}</select></label></div><p class="small">${esc(basis)} · ${notes} Choose the views needed for each scene.</p><details class="location-template-evidence"><summary>Template source</summary>${t.evidence.length?t.evidence.map(e=>`<p>Episode ${esc(e.scene.episode)} · line ${esc(e.scene.line)}${e.inherited?' · enclosing scene':''}: ${esc(e.scene.heading)}${e.types.length?'':' · choose EXT or INT above'}</p>`).join(''):'<p>Select EXT or INT to guide this reference library.</p>'}</details>${existing?`<p class="small">${existing} saved interior image requirement${existing===1?'':'s'} retained. Review the scene briefs to align them with EXT.</p>`:''}<p id="locationTemplateStatus" class="small" role="status" aria-live="polite"></p></section>`;
}
async function save(select,l){
 const before=l.production?.template||null,value=select.value==='auto'?null:select.value,status=document.getElementById('locationTemplateStatus');
 select.disabled=true;status.textContent='Saving template…';
 try{await DESKReferenceLibrary.post('api/location-production',{location_id:l.id,scope:'template',expected:before,template:value});if(document.getElementById('locationTemplate')===select){DESKLocations.render();document.getElementById('locationTemplateStatus').textContent='Template saved.';}}
 catch(error){if(document.getElementById('locationTemplate')===select){select.value=before||'auto';select.disabled=false;status.textContent=error.message;}}
}
window.DESKLocationTemplates={headingTypes,sceneEvidence,resolve,sceneMode,slots,control,save,interiorSlot};
})();
