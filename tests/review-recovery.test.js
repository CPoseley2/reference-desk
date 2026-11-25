const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const id = 'DESK-8174706DA1D4', hash = 'a'.repeat(64);
const asset = {id, sha256:hash, title:'Affected image', character_ids:[]};
const context = {assets:new Map([[id,asset]]), people:new Map(), D:{assets:[asset]}, canonValidate:()=>({}), knownSourceHash:(a,h)=>a.sha256===h};
vm.createContext(context);
vm.runInContext(code.slice(code.indexOf('function reviewFieldError'),code.indexOf('function effectiveStatus')),context);
const choices = extra => ({schema:'desk.character-choices',version:1,items:[{id,source_sha256:hash,updated_at:'2026-11-18T04:43:03Z',notes:'Preserved note',preference:'Reject',...extra}]});
for (const rank of [null,'',1,100000]) assert.equal(context.validateImport(choices({rank})).notes[id].rank,rank===''?null:rank);
const omitted=context.validateImport(choices({obsolete:true})).notes[id];
assert.equal(omitted.text,'Preserved note');assert.equal(omitted.verdict,'Reject');assert.equal(omitted.obsolete,true);assert.ok(!('rank' in omitted));
assert.ok(!('obsolete' in context.validateImport(choices({})).notes[id]));
for (const rank of [0,-1,1.5,100001,'2',NaN,Infinity]) assert.throws(()=>context.validateImport(choices({rank})),e=>e.name==='ReviewValidationError'&&e.assetId===id&&e.field==='rank');
assert.throws(()=>context.validateImport({...choices({}),items:[{...choices({}).items[0],source_sha256:'b'.repeat(64)}]}),/Source hash mismatch/);

// Execute the actual handoff function with a stub editor; never generate or write data.
const editCode=fs.readFileSync(path.join(root,'location-editing.js'),'utf8');
const handoff=editCode.slice(editCode.indexOf('async function openStoryboardRevision'),editCode.indexOf("window.addEventListener('hashchange',openStoryboardRevision)"));
async function revise(shot){
 const c={version:1,storyboard_id:'3b9553cc166599a7',shot_id:shot,slot_number:45,song:'Welcome Sight',title:'Test shot',prompt:'Test prompt',asset_id:id,sha256:hash,location_id:'camp',slot_id:'scene'};
 let opened=false,error='';
 const ctx={location:{hash:'#storyboard-revise='+encodeURIComponent(JSON.stringify(c))},assets:context.assets,locationFor:()=>({id:'camp',references:{scene:[id]}}),document:{getElementById:()=>({click(){}})},DESKLocations:{show(){}},open:async()=>{opened=true;},openModal:(title,body)=>{error=body;},esc:String};
 vm.createContext(ctx);vm.runInContext(handoff,ctx);await ctx.openStoryboardRevision();return {opened,error};
}

// Test the autosave UI and recovery actions without touching browser storage or live records.
async function autosave(pending=null,loadError=null){
 const nodes=new Map();
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',dataset:{},classList:{toggle(){}},children:[],setAttribute(){},querySelector(){return node(id+'-symbol');},replaceChildren(){this.children=[];},append(x){this.children.push(x);},before(){},addEventListener(){},close(){this.open=false;},value:'',validity:{badInput:false}});return nodes.get(id);};
 const saved={revision:5,csrf_token:'test',choices:choices({})};let writes=0;let modal='';let savedApprovals=null,poll;
 const cache=new Map();if(pending)cache.set('test-autosave-pending-v1',JSON.stringify({base_revision:5,sequence:1,mutation_id:'test',choices:pending}));
 const doc={getElementById:node,createElement:()=>node("created-"+nodes.size),querySelectorAll:()=>[]};
 const ctx={...context,document:doc,window:{document:doc,dispatchEvent(){},addEventListener(){}},location:{protocol:'http:',hostname:'127.0.0.1'},key:'test',DESKStorage:{getItem:k=>cache.get(k),setItem:(k,v)=>cache.set(k,v),removeItem:k=>cache.delete(k)},validateImport:context.validateImport,review:{},current:null,mergeReviewDefaults:(a,b)=>b,setSavedApprovalReview:v=>{savedApprovals=v;},approvalSource:()=>savedApprovals,render(){},openModal:(title,body)=>{modal=title+' '+body;},esc:String,imageView(){},crypto:{randomUUID:()=>String(Math.random())},CustomEvent:class{},AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{poll=fn;},fetch:async(url,options)=>{if(loadError)throw loadError;if(options.method==='POST'){writes++;saved.choices=JSON.parse(options.body).choices;}return {ok:true,json:async()=>saved};},download(){}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'autosave.js'),'utf8'),ctx);
 await new Promise(r=>setImmediate(r));return {node,ctx,cache,get writes(){return writes;},get modal(){return modal;},recover:async()=>{loadError=null;await poll();}};
}
(async()=>{
 for(const shot of ['S001','WS045','CTS-V5-001','CWR072'])assert.equal((await revise(shot)).opened,true,shot);
 for(const shot of ['../x','', 'x'.repeat(81)]){const r=await revise(shot);assert.equal(r.opened,false);assert.match(r.error,/invalid shot ID/);assert.match(r.error,/Retry opening revision/);assert.match(r.error,/Return to storyboard/);}
 const ok=await autosave();assert.equal(ok.node('saveStatus').textContent,'All changes saved on this Mac');assert.equal(ok.writes,0);
 const error=context.validateImport;let rankError;try{error(choices({rank:0}));}catch(e){rankError=e;}
 const fail=await autosave(null,rankError);assert.match(fail.node('saveStatus').textContent,/Could not load saved reviews/);assert.doesNotMatch(fail.node('saveStatus').textContent,/0 unsaved|Save failed/);
 fail.node('saveActions').children.find(b=>b.textContent==='Review issue').onclick();assert.match(fail.modal,/Affected image/);assert.match(fail.modal,/Technical details/);assert.match(fail.modal,/Inspect affected image/);
 assert.equal(fail.ctx.window.DESKAutosave.state().revision,null,'A failed load must not mark its revision as applied');await fail.recover();assert.equal(fail.node('saveStatus').textContent,'All changes saved on this Mac');assert.equal(fail.ctx.window.DESKAutosave.state().revision,5);
 const repair=await autosave(choices({rank:0}));assert.equal(repair.writes,0);repair.node('saveActions').children.find(b=>b.textContent==='Review issue').onclick();assert.match(repair.modal,/Apply rank and retry save/);
 repair.node('reviewRepairRank').value='-2';repair.node('reviewRepairApply').onclick();assert.equal(repair.writes,0);assert.match(repair.node('reviewRepairStatus').textContent,/whole number/);
 repair.node('reviewRepairRank').value='';repair.node('reviewRepairApply').onclick();await new Promise(r=>setImmediate(r));assert.equal(repair.writes,1);assert.equal(repair.ctx.review.notes[id].rank,null);assert.equal(repair.ctx.review.notes[id].text,'Preserved note');assert.equal(repair.ctx.review.notes[id].verdict,'Reject');assert.equal(repair.node('saveStatus').textContent,'All changes saved on this Mac');
 console.log('Review recovery: optional ranks, invalid ranks, handoff IDs, loading diagnostics, and user-directed rank repair passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
