const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../storyboard-bridge.js'),'utf8');
function setup(path='/index.html'){
 const events={},messages=[];
 let release;
 const parent={postMessage:(data,origin)=>messages.push({data,origin})};
 const window={addEventListener:(name,fn)=>events[name]=fn,fetch:()=>new Promise(resolve=>release=resolve)};
 const context={window,parent,location:{pathname:path,origin:'http://127.0.0.1:8899'},document:{addEventListener:()=>{}},setInterval:()=>{},setTimeout,Date,URL,alert:()=>{}};
 vm.runInNewContext(code,context);
 return {api:window.ReferenceDeskBridge,events,messages,parent,window,release:()=>release({ok:true})};
}
(async()=>{
 let s=setup(),dirty=true,flushed=0;
 s.api.register('notes',{state:()=>({dirty}),flush:async()=>{flushed++;dirty=false;}});
 assert.equal(s.api.state().dirty,true);await s.api.flush();assert.equal(s.api.state().dirty,false);assert.equal(flushed,1);
 s.api.register('arrangement',{state:()=>({conflicted:true,dirty:true}),flush:async()=>{}});
 await assert.rejects(s.api.flush(),/Finish saving/);
 s=setup();s.api.register('timing',{state:()=>({dirty:true}),flush:async()=>{throw Error('Timing save failed');}});
 await assert.rejects(s.api.flush(),/Timing save failed/);assert.equal(s.api.state().dirty,true);
 s=setup('/viewer.html');assert.equal(s.api.state().inflight,true);s.api.ready();assert.equal(s.api.state().inflight,false);
 const request=s.window.fetch('/library-api/image-approval',{method:'POST'});assert.equal(s.api.state().inflight,true);s.release();await request;assert.equal(s.api.state().inflight,false);
 s=setup();
 const data={channel:'reference-desk-storyboard',type:'flush',id:'test'};
 await s.events.message({origin:'https://untrusted.example',source:s.parent,data});assert.equal(s.messages.length,0);
 await s.events.message({origin:'http://127.0.0.1:8876',source:{},data});assert.equal(s.messages.length,0);
 await s.events.message({origin:'http://127.0.0.1:8876',source:s.parent,data});assert.equal(s.messages.at(-1).data.type,'flushed');assert.equal(s.messages.at(-1).data.id,'test');
 s.api.register('tags',{state:()=>({dirty:true}),flush:async()=>{throw Error('Save tags');}});
 await s.events.message({origin:'http://127.0.0.1:8876',source:s.parent,data});assert.equal(s.messages.at(-1).data.error,'Save tags');
 let prevented=false;s.events.beforeunload({preventDefault:()=>prevented=true});assert.equal(prevented,true);
 console.log('Storyboard bridge: save, conflict, failure, loading, in-flight writes, origin/source validation, and unload checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
