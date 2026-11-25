/* Shared pure editing rules; also exercised from Node without a browser. */
const BeatEditor = (() => {
  const clone=x=>JSON.parse(JSON.stringify(x));
  const frame=(t,fps)=>Math.floor(t*fps+.5);
  function coords(t,map){return {seconds:t,song_frame:frame(t,map.timing.fps),film_seconds:t+map.timing.film_offset_seconds,film_frame:frame(t+map.timing.film_offset_seconds,map.timing.fps)}}
  function validTime(t,m){if(!Number.isFinite(t)||t<0||t>=m.source.duration_seconds)throw Error('Marker must be within the source audio.');}
  function edit(map,action,id,t){
    const m=clone(map); let b=m.beats.find(x=>x.id===id);const before=b?clone(b):null;
    if(['add','move'].includes(action))validTime(t,m);
    if(action==='add'){b={id:'manual-'+Date.now()+'-'+Math.random().toString(16).slice(2,7),confidence:null,status:'uncertain',provenance:'manual placement; not yet confirmed',original_seconds:null,manual_override:true,downbeat:null,bar:null,...coords(t,m)};m.beats.push(b)}
    else {if(!b)throw Error('Select a beat first.');if(action==='delete')m.beats=m.beats.filter(x=>x.id!==id);
      if(action==='move')Object.assign(b,coords(t,m),{manual_override:true,status:'uncertain',confidence:null,provenance:'manual timing correction; awaiting audition'});
      if(action==='confirm')Object.assign(b,{status:'confirmed',manual_override:true,provenance:'manually confirmed by reviewer; algorithm confidence retained'});
    }
    m.beats.sort((a,b)=>a.seconds-b.seconds);m.revision++;m.manual_history.push({action,id:b.id,before,after:action==='delete'?null:clone(b),at:new Date().toISOString()});return m;
  }
  function validate(m,original){
    if(m.schema_version!=='1.0'||m.source?.sha256!==original.source.sha256||m.source?.samples!==original.source.samples||m.source?.sample_rate!==original.source.sample_rate||m.source?.duration_seconds!==original.source.duration_seconds)throw Error('Map version or source does not match this recording.');
    if(m.timing.fps!==original.timing.fps||m.timing.film_offset_seconds!==original.timing.film_offset_seconds)throw Error('FPS/offset do not match this dashboard.');
    if(!Array.isArray(m.beats)||!Array.isArray(m.manual_history)||!Number.isInteger(m.revision)||m.revision<0)throw Error('Invalid map or revision.');
    const ids=new Set();let last=-1;for(const b of m.beats){validTime(b.seconds,m);if(typeof b.id!=='string'||!b.id||ids.has(b.id))throw Error('Missing/duplicate beat ID.');ids.add(b.id);if(b.seconds<last)throw Error('Beat order must be chronological.');last=b.seconds;if(!['confirmed','uncertain'].includes(b.status)||typeof b.provenance!=='string'||!b.provenance||typeof b.manual_override!=='boolean'||(b.confidence!==null&&(!Number.isFinite(b.confidence)||b.confidence<0||b.confidence>1)))throw Error('Invalid beat metadata.');Object.assign(b,coords(b.seconds,m));}return m;
  }
  const fields=['id','seconds','song_frame','film_seconds','film_frame','confidence','status','provenance','manual_override','original_seconds','downbeat','bar'];
  const csv=m=>{const meta={schema_version:m.schema_version,source_sha256:m.source.sha256,source_samples:m.source.samples,sample_rate:m.source.sample_rate,duration_seconds:m.source.duration_seconds,fps:m.timing.fps,film_offset_seconds:m.timing.film_offset_seconds};const keys=[...Object.keys(meta),...fields];return [keys.join(','),...m.beats.map(b=>keys.map(k=>'"'+String(({...meta,...b})[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n')};
  return {clone,frame,coords,edit,validate,csv};
})();
if(typeof module!=='undefined')module.exports=BeatEditor;
