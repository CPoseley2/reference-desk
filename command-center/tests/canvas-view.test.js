const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
 const nodes=new Map();
 class Node {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.style={};this.events={};this.classList={add(){}};this.textContent='';}
  set id(value){this._id=value;nodes.set(value,this);} get id(){return this._id;}
  append(...children){for(const c of children){if(c.parent)c.parent.children=c.parent.children.filter(x=>x!==c);c.parent=this;this.children.push(c);}}
  before(n){this.parent.append(n);}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){if(k==='style')this.style={};else delete this.attrs[k];}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  async fire(k,e={}){for(const fn of this.events[k]||[])await fn(e);}
  click(){return this.fire('click');}
  focus(){this.focused=true;}
  getBoundingClientRect(){return {left:parseFloat(this.style.left)||0,top:parseFloat(this.style.top)||0,width:480,height:310};}
 }
 const document=new Node('document');document.createElement=t=>new Node(t);document.getElementById=id=>nodes.get(id);document.querySelector=()=>null;document.activeElement=new Node('button');
 const root=new Node('root');for(const id of ['screen','counter','shot-title','player','prev','next']){const n=new Node('div');n.id=id;root.append(n);}
 const player=nodes.get('player');player.paused=true;player.currentTime=35;player.play=async()=>{player.paused=false;await document.fire('play');};player.pause=()=>{player.paused=true;};
 nodes.get('counter').textContent='13 / 72 · WS013';
 const window=new Node('window');window.describeControlPurpose=()=>{};
 const context={document,window,innerWidth:1100,innerHeight:800,ResizeObserver:class{observe(){}},V:{shots:[{id:'WS001'},{id:'WS002'}]}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../canvas-view.js'),'utf8'),context);
 const stage=nodes.get('canvas-stage'),find=label=>{const walk=n=>n.attrs['aria-label']===label?n:n.children.map(walk).find(Boolean);return walk(stage);};
 return {nodes,stage,find,document,window,player};
}
test('floating and docking keep the original canvas, audio and playback position',async()=>{
 const x=setup(),screen=x.nodes.get('screen'),home=x.stage.parent;
 await x.find('Floating canvas — move and resize the playback image').click();
 assert.equal(x.stage.dataset.mode,'floating');assert.equal(x.stage.parent,home);assert.equal(screen.parent,x.stage);
 await x.find('Play').click();assert.equal(x.player.paused,false);assert.equal(x.player.currentTime,35);
 await x.find('Return canvas to page').click();assert.equal(x.stage.dataset.mode,'docked');assert.equal(x.player.paused,false);assert.equal(screen.parent,x.stage);assert.equal(x.document.activeElement.focused,true);
});
test('denied fullscreen uses the expanded canvas and Escape docks it without stopping audio',async()=>{
 const x=setup();x.stage.requestFullscreen=async()=>{throw Error('Denied in web view');};
 await x.find('Full-screen canvas').click();assert.equal(x.stage.dataset.mode,'fullscreen');
 await x.document.fire('keydown',{key:'Escape',preventDefault(){}});assert.equal(x.stage.dataset.mode,'docked');assert.equal(x.player.currentTime,35);
});
test('leaving native fullscreen for floating exits the browser fullscreen first',async()=>{
 const x=setup();x.stage.requestFullscreen=async()=>{x.document.fullscreenElement=x.stage;};
 let exited=0;x.document.exitFullscreen=async()=>{exited++;x.document.fullscreenElement=null;await x.document.fire('fullscreenchange');};
 await x.find('Full-screen canvas').click();assert.equal(x.document.fullscreenElement,x.stage);
 await x.find('Floating canvas — move and resize the playback image').click();assert.equal(exited,1);assert.equal(x.stage.dataset.mode,'floating');
});
test('floating position stays inside the window and shot labels follow the live viewer',async()=>{
 const x=setup();await x.find('Floating canvas — move and resize the playback image').click();
 const move=x.find('Move floating canvas — drag, or use the arrow keys');
 for(let i=0;i<60;i++)await move.fire('keydown',{key:'ArrowLeft',preventDefault(){}});
 assert.equal(x.stage.style.left,'8px');
 x.nodes.get('counter').textContent='14 / 72 · WS014';x.nodes.get('shot-title').scrollTop=80;
 await x.window.fire('owl-shot-change');assert.equal(x.stage.children.find(n=>n.className==='canvas-transport').children.at(-1).textContent,'14 / 72 · WS014');assert.equal(x.nodes.get('shot-title').scrollTop,0);
});
