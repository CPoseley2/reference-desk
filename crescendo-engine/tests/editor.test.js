const assert=require('node:assert/strict'),e=require('../assets/editor.js');
const original={schema_version:'1.0',revision:0,source:{sha256:'a',samples:480000,sample_rate:48000,duration_seconds:10},timing:{fps:30000/1001,film_offset_seconds:22.123},beats:[],manual_history:[]};
let m=e.edit(original,'add',null,1.234567),id=m.beats[0].id;
assert.equal(original.beats.length,0);assert.equal(m.beats[0].status,'uncertain');assert.equal(m.beats[0].film_frame,Math.floor((1.234567+22.123)*30000/1001+.5));
m=e.edit(m,'confirm',id);assert.equal(m.beats[0].status,'confirmed');m=e.edit(m,'move',id,2);assert.equal(m.beats[0].status,'uncertain');assert.equal(m.manual_history.length,3);
const saved=JSON.parse(JSON.stringify(m));assert.deepEqual(e.validate(saved,original),m);assert.match(e.csv(m),/schema_version,source_sha256/);
assert.throws(()=>e.edit(m,'move',id,10));assert.throws(()=>e.edit(m,'add',null,NaN));assert.throws(()=>e.validate({...m,revision:-1},original));assert.throws(()=>e.validate({...m,source:{...m.source,sha256:'wrong'}},original));
m=e.edit(m,'delete',id);assert.equal(m.beats.length,0);assert.equal(m.manual_history.at(-1).before.id,id);
console.log('PASS: immutable edits, status transitions, history, JSON roundtrip, source guard, bounds, frame/offset, versioned CSV');
