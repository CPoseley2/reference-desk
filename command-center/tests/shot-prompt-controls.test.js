const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../shot-prompt-controls.js');
const base='Camera angle: high angle.\nShot size: wide.\nMovement: Drift right; keep the sailor axis.\n\nWide high in rigging. Camera angle: this is narrative text.\nKeep costume, lens and seam unchanged.\n';
test('viewpoint-only application preserves framing, movement and every narrative byte',()=>{
 const wording=P.viewpointGroups.find(g=>g.label==='Low & ground level').options[0][1];
 const result=P.applyDirection(base,base,{viewpoint:wording});
 assert.equal(result.text,'Camera angle: '+wording+base.slice(base.indexOf('\n')));
 assert.equal(result.error,undefined);
 assert.ok(!/full body|footwear|feet/i.test(wording));
});
test('applies independently edited framing and movement atomically',()=>{
 const result=P.applyDirection(base,base,{framing:'Frame the face and shoulders.',movement:'Hold still.\nLet action cross the frame.'});
 assert.equal(result.text,base.replace('Shot size: wide.','Shot size: Frame the face and shoulders.').replace('Movement: Drift right; keep the sailor axis.','Movement: Hold still. Let action cross the frame.'));
});
test('preserves direct edits elsewhere but refuses stale edits to the same line',()=>{
 const live=base.replace('costume','uniform');
 assert.ok(P.applyDirection(live,base,{framing:'Close-up.'}).text.includes('uniform'));
 const edited=base.replace('Shot size: wide.','Shot size: tight.');
 const result=P.applyDirection(edited,base,{viewpoint:'Eye level.',framing:'Close-up.'});
 assert.match(result.error,/changed/);assert.equal(result.text,edited);
});
test('rejects duplicate target headers, including aliases, without partial changes',()=>{
 const live=base+'Framing: another crop.\n';
 const result=P.applyDirection(live,live,{viewpoint:'Profile.',framing:'Close-up.'});
 assert.match(result.error,/duplicate/);assert.equal(result.text,live);
});
test('inserts missing headers once and preserves CRLF and narrative',()=>{
 const text='Unmodified action.\r\nSecond line.\r\n';
 const result=P.applyDirection(text,text,{viewpoint:'Overhead.',framing:'Wide.'});
 assert.equal(result.text,'Camera angle: Overhead.\r\nShot size: Wide.\r\n'+text);
 assert.deepEqual(P.readDirection(result.text),{viewpoint:'Overhead.',framing:'Wide.',movement:''});
 assert.equal(P.applyDirection(result.text,result.text,{viewpoint:'Profile.'}).text,'Camera angle: Profile.\r\nShot size: Wide.\r\n'+text);
});
test('supports labeled legacy/custom wording without touching unlabeled shot text',()=>{
 const text='Viewpoint: custom angle.\nFraming: custom crop.\nCamera movement: custom motion.\n\nDo not edit this.';
 assert.deepEqual(P.readDirection(text),{viewpoint:'custom angle.',framing:'custom crop.',movement:'custom motion.'});
 assert.equal(P.applyDirection(text,text,{viewpoint:'Eye level.'}).text,text.replace('Viewpoint: custom angle.','Camera angle: Eye level.'));
 assert.equal(P.applyDirection(base,base,{}).text,base);
});
test('rejects empty replacements and oversize prompts',()=>{
 assert.ok(P.applyDirection(base,base,{movement:'  '}).error);
 const text='x'.repeat(30000);const result=P.applyDirection(text,text,{viewpoint:'Eye level.'});
 assert.ok(result.error);assert.equal(result.text,text);
});
test('preset coverage retains Desk families and over-the-shoulder without coupling crop',()=>{
 const viewpoints=P.viewpointGroups.flatMap(g=>g.options);
 assert.ok(viewpoints.some(([label])=>label==='Over the shoulder'));
 assert.equal(viewpoints.length,21);
 assert.ok(viewpoints.every(([,text])=>!/full body|footwear|waist|knees/i.test(text)));
 assert.equal(P.framingGroups[0].options.length,3);
});
test('all viewpoint presets preserve varied shots’ framing, movement and narrative',()=>{
 const config={shots:['wide','medium','close-up'].map((size,i)=>({id:'S'+i,default:{video_prompt:'Camera angle: eye level.\nShot size: '+size+'.\nMovement: Hold steady.\n\nA figure crosses the room. Keep lighting consistent.'}}))};
 for(const shot of config.shots)for(const [,wording]of P.viewpointGroups.flatMap(g=>g.options)){
  const text=shot.default.video_prompt,result=P.applyDirection(text,text,{viewpoint:wording});
  assert.equal(result.error,undefined,shot.id);
  assert.equal(result.text.slice(result.text.indexOf('\n')),text.slice(text.indexOf('\n')),shot.id);
 }
});
