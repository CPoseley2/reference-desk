const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../shot-flags.js'),'utf8'),context);
const start=context.window.shotFlagStart;
test('thumbnail flag uses the timed shot start, including zero',()=>{const shots=[{start:0,end:3},{start:3,end:9}];assert.equal(start(shots,0,9),0);assert.equal(start(shots,1,9),3);});
test('untimed playback uses the same evenly spaced sequence as the viewer',()=>{assert.equal(start([{}, {}, {}],1,30),10);assert.equal(start([{}],0,NaN),null);});
test('mixed timing never invents timestamps for untimed slots',()=>{assert.equal(start([{start:0,end:4},{}],1,30),null);});
