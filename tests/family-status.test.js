const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function setup(){
 const character={id:'a',group:'family',candidate_ids:[]},other={id:'b',group:'other',candidate_ids:[]};
 function button(group){return {dataset:{group},classes:new Set(),attributes:{},badge:null,classList:{toggle(name,on){on?this.owner.classes.add(name):this.owner.classes.delete(name);}},querySelector(){return this.badge;},append(b){this.badge=b;b.remove=()=>this.badge=null;},setAttribute(k,v){this.attributes[k]=v;}};}
 const buttons=['','family','other'].map(button);for(const b of buttons)b.classList.owner=b;
 const ctx={D:{characters:[character,other],groups:[{id:'family',label:'Family'},{id:'other',label:'Other'}],audit:{season1_entries:2}},assets:new Map(),loaded:true,approved:[],approvalSource:()=>ctx.loaded?{}:null,approvedReferences:()=>ctx.approved,effectiveStatus:a=>a.status||'Candidate',$:()=>({querySelectorAll:()=>buttons}),document:{createElement:()=>({})}};
 vm.createContext(ctx);vm.runInContext(code.slice(code.indexOf('function updateFamilyConfirmation'),code.indexOf('function updateApprovedTotal')),ctx);
 function asset(id,type,owner=character,extra={}){const a={id,type,sha256:id,...extra};ctx.assets.set(id,a);owner.candidate_ids.push(id);return a;}
 return {ctx,asset,character,other,buttons,update:()=>ctx.updateFamilyConfirmation()};
}
test('scene-only pending images are bonuses and never turn the family warning on',()=>{
 const x=setup();x.asset('portrait','Portrait / likeness');x.asset('scene','Scene reference');x.ctx.approved=[{character_id:'a',id:'portrait',source_sha256:'portrait'}];x.update();
 for(const b of x.buttons.slice(0,2)){assert.equal(b.dataset.pendingCount,'0');assert.equal(b.dataset.bonusPendingCount,'1');assert.equal(b.classes.has('needs-confirmation'),false);assert.equal(b.badge,null);assert.match(b.title,/1 optional scene image/);}
});
test('unapproved non-scene roles still require review, including old-version approvals',()=>{
 const x=setup();x.asset('portrait','Portrait / likeness');x.asset('scene','Scene reference');x.ctx.approved=[{character_id:'a',id:'portrait',source_sha256:'old'}];x.update();
 assert.equal(x.buttons[1].dataset.pendingCount,'1');assert.equal(x.buttons[1].classes.has('needs-confirmation'),true);assert.match(x.buttons[1].badge.innerHTML,/1 to review/);
});
test('character-specific and mixed roles preserve required references',()=>{
 const x=setup();x.asset('scene-used-as-portrait','Scene reference',x.character,{reference_links:[{character_id:'a',type:'Portrait / likeness'}]});
 x.asset('portrait-used-as-scene','Portrait / likeness',x.character,{reference_links:[{character_id:'a',type:'Scene reference'}]});
 x.asset('mixed','Scene reference',x.character,{reference_links:[{character_id:'a',type:'Scene reference'},{character_id:'a',type:'Full-body / costume'}]});x.update();
 assert.equal(x.buttons[1].dataset.pendingCount,'2');assert.equal(x.buttons[1].dataset.bonusPendingCount,'1');
});
test('obsolete and approved scenes are excluded; aggregate counts deduplicate shared images',()=>{
 const x=setup();x.asset('obsolete','Scene reference',x.character,{status:'Obsolete'});x.asset('approved','Scene reference');x.ctx.approved=[{character_id:'a',id:'approved',source_sha256:'approved'}];
 x.asset('shared','Scene reference');x.other.candidate_ids.push('shared');x.asset('same-bytes','Scene reference',x.character,{sha256:'shared'});x.update();
 assert.equal(x.buttons[0].dataset.bonusPendingCount,'1');assert.equal(x.buttons[1].dataset.bonusPendingCount,'1');assert.equal(x.buttons[2].dataset.bonusPendingCount,'1');
});
test('saved approvals remove the warning while bonuses remain, and unloaded state is preserved',()=>{
 const x=setup();x.asset('body','Full-body / costume');x.asset('scene','Scene reference');x.update();assert.ok(x.buttons[1].badge);
 x.ctx.approved=[{character_id:'a',id:'body',source_sha256:'body'}];x.ctx.loaded=false;x.update();assert.ok(x.buttons[1].badge);
 x.ctx.loaded=true;x.update();assert.equal(x.buttons[1].badge,null);assert.equal(x.buttons[1].dataset.bonusPendingCount,'1');
});
