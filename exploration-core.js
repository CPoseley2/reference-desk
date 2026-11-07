/* Pure prompt builder. No review, ranking or selection writes. */
(function (root) {
  'use strict';
  const limboSets = [
    {id:'warm-gray',name:'Warm-gray limbo',description:'Seamless warm-gray studio floor and backdrop, soft diffuse daylight, subtle contact shadow.'},
    {id:'cream',name:'Cream limbo',description:'Seamless warm cream studio floor and backdrop, gentle natural light and soft contact shadow.'},
    {id:'dark',name:'Dark limbo',description:'Seamless charcoal studio floor and backdrop, restrained soft key and rim light, readable costume and feet.'},
    {id:'white',name:'White limbo',description:'Seamless off-white studio floor and backdrop, soft high-key light with visible fabric detail and grounded feet.'}
  ];
  const shotOptions = [
    {label:'Mid shot (waist up)',name:'mid shot',framing:'frame from the waist up, with the head and hair fully visible and room for hands or props involved in the action'},
    {label:'Close-up (head and shoulders)',name:'close-up',framing:'frame the head and shoulders; prioritize the face and expression, with only the action detail that fits naturally in this crop'},
    {label:'Extreme close-up (face detail)',name:'extreme close-up',framing:'frame a tight facial detail, such as the eyes and expression; intentional cropping of the head is expected, and the action is conveyed through gaze and expression'},
    {label:'Ground-level shot (full body)',name:'ground-level full shot',framing:'place the camera close to the ground looking upward; keep the entire head, hair, body and complete footwear visible with comfortable margin, natural proportions and no exaggerated lens distortion'}
  ];
  const cameraGroups = [
    {label:'Framing · closer shots',options:shotOptions.slice(0,3).map(x=>x.label)},
    {label:'Eye level · full body',options:['Eye level, three-quarter view','Eye level, front view','Eye level, profile','Eye level, front-left three-quarter','Eye level, front-right three-quarter','Eye level, left profile','Eye level, right profile']},
    {label:'Low & ground level · full body',options:['Slightly low angle, full body','Low angle, front view, full body','Low angle, side view, full body',shotOptions[3].label]},
    {label:'High & overhead · full body',options:['Slightly high angle, full body','High angle, front view, full body','High angle, side view, full body','Overhead, straight down, full body','Overhead, diagonal view, full body']},
    {label:'Rear views · full body',options:['Rear three-quarter, face turned into view','Rear-left three-quarter, head turned toward camera','Rear-right three-quarter, head turned toward camera']}
  ];
  const expressionCues=['Curious, engaged and natural','Calm and relaxed','Happy, with a gentle smile','Joyful and laughing','Playful and mischievous','Hopeful and quietly optimistic','Awe and wonder','Surprised and alert','Thoughtful and reflective','Focused and determined','Confident and composed','Concerned and attentive','Worried and uncertain','Afraid and tense','Sad and subdued','Grieving, holding back tears','Frustrated and impatient','Angry, with restrained intensity','Tired but resilient','Relieved and grateful'];
  const timeOptions=['Dawn','Early morning','Late morning','Midday','Afternoon','Golden hour','Sunset','Dusk / blue hour','Night','Moonlit night'];
  const weatherOptions=['Clear skies','Partly cloudy','Overcast','Light mist','Dense fog','Light rain','Heavy rain','Thunderstorm','Light snow','Heavy snow / blizzard'];
  const windOptions=['Match reference / setting','Still air','Light breeze','Gentle breeze','Moderate wind','Strong wind','Gale-force wind'];
  function windLabel(level){return windOptions[Number.isInteger(level)&&level>=-1&&level<=5?level+1:0];}
  function atmosphere(s){
    const rows=[];
    if(timeOptions.includes(s.timeOfDay))rows.push('Time of day: '+s.timeOfDay+'.');
    if(weatherOptions.includes(s.weather))rows.push('Weather: '+s.weather+'.');
    if(Number.isInteger(s.windLevel)&&s.windLevel>=0&&s.windLevel<=5)rows.push('Wind: '+windLabel(s.windLevel)+'. Show physically consistent effects on loose hair, fabric and visible surroundings, while preserving garment construction and hairstyle.');
    if(!rows.length)return '';
    return 'ATMOSPHERE DIRECTION\n'+rows.join('\n')+'\n'+(s.settingMode==='limbo'?'Keep the studio backdrop. Translate time and weather into lighting and subtle effects on the character; do not add a landscape or sky.':'These explicit choices override time, weather or wind in the location reference for this exploration only. Preserve the selected geography, architecture and spatial layout.')+' Keep unspecified conditions consistent with the selected reference or setting.';
  }
  function shotFor(camera) {
    return shotOptions.find(x=>x.label===camera)||{name:'full shot',framing:'entire head and hair through complete feet and any chosen footwear visible, with comfortable margin and room for the action'};
  }
  function approvedLocationImages(location, assetMap, isLive = a => a.status !== 'Obsolete') {
    if(!location) return [];
    const entries=[...Object.entries(location.approvals||{}).filter(([,r])=>r.approved===true).map(([id,r])=>({...r,id,statusLabel:'Approved reference'})),...(location.canonical_source?[{...location.canonical_source,statusLabel:'Canonical source'}]:[])];
    const refs=new Map();
    for(const r of entries) {
      const a=assetMap.get(r.id);
      if(!a || !isLive(a) || !r.source_sha256) continue;
      const v=a.sha256===r.source_sha256?a:(a.previous_versions||[]).find(v=>v.sha256===r.source_sha256);
      if(!v?.asset) continue;
      const key=r.id+'|'+r.source_sha256;
      if(!refs.has(key)) refs.set(key,{...a,...v,id:r.id,sha256:r.source_sha256,statusLabel:r.statusLabel});
    }
    return [...refs.values()];
  }
  function locationImages(location, assetMap, isLive = a => a.status !== 'Obsolete') {
    if(!location) return [];
    const refs=new Map(approvedLocationImages(location,assetMap,isLive).map(a=>[a.id+'|'+a.sha256,a]));
    const ids=new Set(Object.values(location.references||{}).flat());
    const names=new Set([location.id,location.name,...(location.aliases||[])].filter(Boolean).map(x=>x.toLowerCase().trim()));
    for(const a of assetMap.values()) if(a.location_ids?.includes(location.id)||(a.tags||[]).some(t=>names.has(String(t).toLowerCase().trim()))) ids.add(a.id);
    for(const id of ids) {
      const a=assetMap.get(id);
      if(!a||!isLive(a)||!a.asset||!a.sha256) continue;
      const key=a.id+'|'+a.sha256;
      if(!refs.has(key)) refs.set(key,{...a,statusLabel:'Unapproved reference'});
    }
    return [...refs.values()];
  }
  function validate(s) {
    const errors=[];
    for (const [key,label] of [['identity','likeness'],['costume','costume']]) if(!s[key]?.id || !s[key]?.sha256 || !s[key]?.asset) errors.push('Choose a usable '+label+' reference.');
    if(s.costume?.type==='Mannequin outfit study' && !s.body?.id) errors.push('Choose a full-body reference for proportions and hair alongside the clothing study.');
    if(s.hairstyle&&(!s.hairstyle.id||!s.hairstyle.sha256||!s.hairstyle.asset))errors.push('Choose a usable hairstyle reference.');
    if(!s.action?.id || !s.action?.text) errors.push('Choose an action.');
    if(!s.look?.id) errors.push('Choose a costume look.');
    if(!s.expression?.trim()) errors.push('Describe the expression.');
    if(s.settingMode==='location') {
      if(!s.location?.id) errors.push('Choose a location.');
      if(s.location?.id && !s.locationRef && !s.conceptLocation) errors.push('Choose a location image or enable a new concept for this location.');
    } else if(s.settingMode!=='limbo' || !limboSets.some(x=>x.id===s.limboId)) errors.push('Choose a location or limbo set.');
    return errors;
  }
  function ref(label,r,base) {
    return `${label}: ${r.title || r.id}\nID: ${r.id}\nExact image SHA-256: ${r.sha256}\nImage: ${new URL(r.asset,base).href}\nReference status: ${r.status || 'Needs review'}`;
  }
  function build(s) {
    const errors=validate(s); if(errors.length) throw new Error(errors.join('\n'));
    const character=s.character||{id:'character',name:'Character',shortName:'Character',continuity:'Preserve the identity and proportions of the selected references.'};
    const base=s.baseUrl||new URL('index.html',location.href).href;
    const shot=shotFor(s.camera),cropped=shotOptions.slice(0,3).some(x=>x.label===s.camera);
    const lines=[`Create ONE ${shot.name} of ${character.name} performing this action: ${s.action.text}.`,
      `Character ID: ${character.id}\nLook ID: ${s.look.id}\nExploration action: ${s.action.id} — ${s.action.text}\nAction category: ${s.action.category}\nAction library: ${s.actionLibrary || 'desk.actions v1'}\nLocal reference desk: ${base}`,
      'REFERENCE IMAGES — inspect these exact image files before generating. If an exact version is unavailable, ask for that reference rather than substituting another face or outfit.',
      ref('Identity / face',s.identity,base),ref('Chosen costume',s.costume,base)];
    if(s.body && s.body.id!==s.costume.id) lines.push(ref('Full-body proportions and hairstyle',s.body,base));
    if(s.hairstyle) lines.push(ref('Chosen hairstyle — hair arrangement only',s.hairstyle,base));
    if(s.emotion) lines.push(ref('Expression reference',s.emotion,base));
    lines.push(`IDENTITY AND COSTUME\n${character.continuity} The likeness controls facial identity. The chosen costume image controls garments, layers, colors, print scale, accessories, footwear and condition. ${s.hairstyle?'Use the full-body reference for proportions only; the chosen hairstyle study controls hair arrangement.':s.body?'Use the full-body reference for proportions and hairstyle; retain the chosen costume when its clothing differs.':'Retain the full-body costume image’s hairstyle and proportions.'} ${s.costume.type==='Mannequin outfit study'?'The clothing study is ONLY an outfit reference: put the clothes on the real, fully formed character, with the selected face and a complete body. Do not reproduce hovering clothes, mannequins, supports or detached footwear.':'Render a living character, not a mannequin.'}\nLook: ${s.look.name}\nLook context: ${s.look.scope_note || 'Creative costume exploration.'}\nCurrent chosen image details take precedence over older garment briefs. Do not add an apron, bonnet or other accessories unless shown in the chosen outfit or explicitly requested below.`);
    if(s.hairstyle)lines.push(`HAIRSTYLE\nUse the selected hairstyle study for the part, braid structure, bun or ponytail placement, volume and fastenings. ${s.hairstyle.description||''} This explicit hairstyle choice overrides the hair arrangement in the likeness, costume, body and expression images. The selected likeness still controls the face, skin tone and apparent age. Do not copy the hair study’s clothing, pose, labels or multiple-view layout. Hairstyle reference ID: ${s.hairstyle.id}. This is a styling proposal, not a claim of traditional ceremonial practice.`);
    lines.push(`ACTION AND PERFORMANCE\nDepict ${character.shortName} performing: ${s.action.text}. Capture one clear, believable instant with readable body mechanics and natural hands. Expression: ${s.expression.trim()}. ${s.emotion?'Use the chosen expression reference as facial guidance while preserving the selected identity.':'Use a natural expression consistent with the direction above.'} Include only the period-appropriate objects needed to make the chosen action legible. If the action refers to another person, keep that person outside the frame; ${character.shortName} is the only visible person. These are creative exploration options, not documented events.`);
    if(s.settingMode==='limbo') {
      const set=limboSets.find(x=>x.id===s.limboId);
      lines.push(`SETTING — ${set.name}\n${cropped?set.description.replace('readable costume and feet','readable visible costume detail').replace('grounded feet','natural shadows'):set.description}\nNo scenic landscape or architecture. Isolate ${character.shortName} and the minimum practical prop or low platform needed for the action on the studio floor. Treat any terrain in the action as a small stage element, not a scenic background. No floating figure: keep believable contact and shadows.`);
    } else {
      const l=s.location;
      lines.push(`SETTING — ${l.name}\nLocation ID: ${l.id}\nDescription: ${l.description || 'Use the chosen location image.'}\nContinuity: ${l.production?.continuity || l.geometry_note || 'Match visible geography, architecture, materials and layout in the chosen image.'}`);
      if(s.locationRef) lines.push(ref('Chosen location / viewpoint',s.locationRef,base));
      lines.push(s.conceptLocation?'Location treatment: explicitly requested new concept. Use available references as guidance; unseen details are proposed for review.':'Location treatment: match the selected reference and visible spatial relationships. Do not silently substitute another location or redesign the set.');
      lines.push('This setting choice is creative exploration, not a claim that this costume or action occurs there in the script.');
    }
    lines.push(`COMPOSITION\nOne image, one ${character.shortName}, a single ${shot.name}: ${shot.framing}.${cropped?' Keep this crop even when the action describes full-body movement; do not widen to include the whole body or feet.':''} Aspect ratio: ${s.aspect || '3:2 landscape'}. Camera: ${s.camera || 'eye level, three-quarter view'}. Photorealistic cinematic period costume detail, natural anatomy, readable facial and visible costume detail. No collage, triptych, reference-sheet labels, text or watermark.`);
    const atmosphereDirection=atmosphere(s);if(atmosphereDirection)lines.push(atmosphereDirection);
    if(s.direction?.trim()) lines.push('ADDITIONAL DIRECTION\n'+s.direction.trim());
    lines.push(`Create the image here in this conversation, then add it to the local reference desk as an unapproved Scene reference for ${character.id} and look ${s.look.id}${s.settingMode==='location'?', linked to location '+s.location.id:''}. Record the exact input image IDs and hashes and this action ID. Save the original image durably in the desk assets library, with its thumbnail and exact prompt/provenance. Register it for this character AND Look ID so it appears in Wardrobe gallery. ${s.hairstyle?'Also record hairstyle_reference_id: '+s.hairstyle.id+' and hairstyle_reference_sha256: '+s.hairstyle.sha256+' in the scene metadata and input_references. ':''}Store character_ids, look_links ({character_id, look_id}), action_id, action_library, input_references with exact hashes, and an Exploration candidate tag.${s.settingMode==='location'?' Also register the SAME asset ID in this location’s scene-references slot and location_ids so it appears in the Locations gallery; do not create a duplicate image.':' Record setting_mode: limbo and limbo_id: '+s.limboId+'; do not assign a real location.'} Verify the saved asset and both applicable gallery links after registration. This is an exploration candidate; do not replace or approve any selected likeness, costume, location reference or ranking. Preserve originals. Let me review the result.`);
    return lines.join('\n\n');
  }
  const api={cameraGroups,expressionCues,timeOptions,weatherOptions,windOptions,windLabel,atmosphere,shotOptions,shotFor,limboSets,approvedLocationImages,locationImages,validate,build};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.DESKExplorationCore=api;
})(typeof window==='undefined'?globalThis:window);
