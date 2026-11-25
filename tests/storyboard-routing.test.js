const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../storyboard.js'), 'utf8');
async function route(search) {
  const nodes = Object.fromEntries(['commandCenter','status','error','reconnect','openSeparately'].map(id => [id, {addEventListener(){}, contentWindow:{postMessage(){}}}]));
  const context = {document:{getElementById:id=>nodes[id],querySelectorAll:()=>[]},window:{addEventListener(){}},location:{search},URLSearchParams,fetch:async()=>({ok:true,json:async()=>({online:true})}),setInterval(){},setTimeout,clearTimeout,Date};
  vm.runInNewContext(code, context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.openSeparately.href, nodes.commandCenter.src, 'separate window keeps the same destination');
  return nodes.commandCenter.src;
}
(async()=>{
 const root='http://127.0.0.1:8899';
 assert.equal(await route(''),root+'/index.html');
 assert.equal(await route('?film=a1-01&entry=aaaaaaaaaaaaaaaa'),root+'/viewer.html?id=aaaaaaaaaaaaaaaa');
 assert.equal(await route('?film=a5-01'),root+'/index.html?film=a5-01');
 assert.equal(await route('?film=a3-06&entry=https://example.com'),root+'/index.html?film=a3-06');
 assert.equal(await route('?film=../../other&entry=../../other'),root+'/index.html');
 assert.equal(await route('?film=a1-01%26entry=bad'),root+'/index.html');
 console.log('Storyboard routing: linked version, candidate brief, reprise, default, separate window, and invalid destinations passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
