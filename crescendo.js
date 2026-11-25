(()=>{
 const $=id=>document.getElementById(id),context=window.DESK_CONTEXT;
 let token=null,busy=false,timer=null,available=false,jobs=[],act='all',storyboardRecords=new Map();
 const openActs=new Set(),viewKey='crescendo-view:'+location.pathname;
 try{const saved=JSON.parse(localStorage.getItem(viewKey)||'{}');if(['all','other','1','2','3','4','5'].includes(saved.act))act=saved.act;if(Array.isArray(saved.openActs))saved.openActs.forEach(key=>openActs.add(String(key)));}catch{}
 const saveView=()=>{try{localStorage.setItem(viewKey,JSON.stringify({act,openActs:[...openActs]}));}catch{}};
 function updateGroupActions(){
  const groups=[...$('jobs').querySelectorAll('.act-group')];
  $('groupActions').hidden=act!=='all'||!groups.length;
  $('expandAll').disabled=groups.every(g=>g.open);$('collapseAll').disabled=groups.every(g=>!g.open);
 }
 function toggleGroups(open){
  for(const group of $('jobs').querySelectorAll('.act-group')){group.open=open;if(group.dataset.search!=='true'){if(open)openActs.add(group.dataset.act);else openActs.delete(group.dataset.act);}}
  saveView();updateGroupActions();
 }
 $('libraryName').textContent=context?.name||'Your library';
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const actOf=job=>String(storyboardRecords.get(job.id)?.act||'')||job.title.match(/^Act ([1-5])\s*[·:–-]/i)?.[1]||'other';
 const titleOf=job=>storyboardRecords.get(job.id)?.title||job.title.replace(/^Act [1-5]\s*[·:–-]\s*/i,'');
 let previewJob=null,playRequest=0;
 const previewAudio=$('previewAudio');
 const duration=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
 function storyboardConnection(job){
  const record=storyboardRecords.get(job.id);if(!record||!/^a[1-5]-\d{2}$/.test(record.id))return null;
  const entry=/^[a-f0-9]{16}$/.test(record.entry_id||'')?record.entry_id:null;
  const params=new URLSearchParams({film:record.id});if(entry)params.set('entry',entry);
  const label=entry?'Open storyboard':'Open storyboard brief';
  const status=entry?(record.selection_basis.startsWith('Existing Reference Desk')?'Linked recording':'Storyboard recording'):'Candidate recording';
  return {url:'storyboard.html?'+params,label,status,basis:record.selection_basis||'',candidate:!entry};
 }
 function syncPreview(){
  const playing=!!previewJob&&!previewAudio.paused&&!previewAudio.ended;
  $('previewStatus').textContent=playing?'Now playing':'Preview paused';
  for(const button of $('jobs').querySelectorAll('[data-preview]')){
   const active=playing&&button.dataset.preview===previewJob?.id;
   button.textContent=active?'Ⅱ':'▶';button.setAttribute('aria-label',(active?'Pause ':'Preview ')+button.dataset.title);button.setAttribute('aria-pressed',String(active));
   button.closest('.song').classList.toggle('is-playing',active);
  }
 }
 async function preview(job){
  const request=++playRequest;
  if(previewJob?.id===job.id&&!previewAudio.paused){previewAudio.pause();return;}
  $('previewError').hidden=true;
  if(previewJob?.id!==job.id){previewAudio.pause();previewJob=job;previewAudio.src=`crescendo/${job.id}/audio-preview.wav`;}
  $('previewTitle').textContent=titleOf(job);$('previewAnalysis').href=`crescendo/${job.id}/index.html`;
  $('previewPlayer').hidden=false;document.body.classList.add('has-preview');
  try{await previewAudio.play();}catch(error){if(request===playRequest&&error.name!=='AbortError'){$('previewError').textContent='Could not play this recording. Try Play again or open its analysis.';$('previewError').hidden=false;}}
  syncPreview();
 }
 for(const event of ['play','pause','ended'])previewAudio.addEventListener(event,syncPreview);
 previewAudio.addEventListener('error',()=>{if(previewJob){$('previewError').textContent='This recording is unavailable. Try opening its analysis.';$('previewError').hidden=false;}});
 $('closePreview').onclick=()=>{++playRequest;previewAudio.pause();previewJob=null;previewAudio.removeAttribute('src');previewAudio.load();$('previewPlayer').hidden=true;document.body.classList.remove('has-preview');syncPreview();};
 $('jobs').addEventListener('click',event=>{const button=event.target.closest('[data-preview]');if(button){const job=jobs.find(j=>j.id===button.dataset.preview);if(job)preview(job);}});
 function render(){
  for(const group of $('jobs').querySelectorAll('.act-group')){
   if(group.dataset.search==='true')continue;
   if(group.open)openActs.add(group.dataset.act);else openActs.delete(group.dataset.act);
  }
  saveView();
  const query=$('songSearch').value.trim().toLocaleLowerCase();
  const filtered=jobs.filter(j=>(act==='all'||actOf(j)===act)&&(storyboardRecords.get(j.id)?.title||j.title).toLocaleLowerCase().includes(query)).sort((a,b)=>actOf(a).localeCompare(actOf(b))||(storyboardRecords.get(a.id)?.id||a.title).localeCompare(storyboardRecords.get(b.id)?.id||b.title));
  $('songCount').textContent=jobs.length?`(${jobs.length})`:'';
  const options=[['all','All recordings'],...[1,2,3,4,5].filter(n=>jobs.some(j=>actOf(j)===String(n))).map(n=>[String(n),'Act '+n]),...(jobs.some(j=>actOf(j)==='other')?[['other','Other recordings']]:[])];
  $('actFilters').replaceChildren(...options.map(([value,label])=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-pressed',String(act===value));b.onclick=()=>{act=value;render()};return b}));
  const recordingRow=job=>{const connection=storyboardConnection(job);return `<article class="song">${job.status==='ready'?`<button class="preview-button" type="button" data-preview="${escape(job.id)}" data-title="${escape(titleOf(job))}" aria-label="Preview ${escape(titleOf(job))}" aria-pressed="false">▶</button>`:'<span class="preview-placeholder" aria-hidden="true"></span>'}<div class="song-info"><h3>${escape(titleOf(job))}</h3><p>${act!=='all'&&actOf(job)!=='other'?'Act '+actOf(job)+' · ':''}${job.status==='ready'?duration(job.duration)+' · Analyzed':escape({queued:'Waiting to analyze…',analyzing:'Finding moments…',failed:'Could not analyze',interrupted:'Analysis interrupted'}[job.status]||job.status)}${connection?` <span class="recording-source ${connection.candidate?'candidate':'linked'}" title="${escape(connection.basis)}">${escape(connection.status)}</span>`:''}</p>${job.error?`<p class="error">${escape(job.error)}</p>`:''}</div><div class="recording-actions">${job.status==='ready'?`<a class="open" href="crescendo/${job.id}/index.html" aria-label="Open analysis for ${escape(titleOf(job))}">Analysis →</a>`:''}${connection?`<a class="storyboard-link" href="${escape(connection.url)}" aria-label="${connection.label} for ${escape(titleOf(job))}">${connection.label} →</a>`:''}</div></article>`;};
  if(act==='all'){
   const groups=new Map();
   for(const job of filtered){const key=actOf(job);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(job);}
   $('jobs').replaceChildren(...Array.from(groups,([key,recordings])=>{
    const group=document.createElement('details');group.className='act-group';group.dataset.act=key;group.dataset.search=String(!!query);group.open=!!query||openActs.has(key);
    const summary=document.createElement('summary'),title=document.createElement('span'),count=document.createElement('span');
    title.textContent=key==='other'?'Other recordings':'Act '+key;count.className='act-count';const seconds=recordings.reduce((total,r)=>total+(Number(r.duration)||0),0);count.textContent=recordings.length+' '+(recordings.length===1?'recording':'recordings')+(seconds?' · '+Math.round(seconds/60)+' min':'');summary.append(title,count);
    const list=document.createElement('div');list.className='act-recordings';list.innerHTML=recordings.map(recordingRow).join('');group.append(summary,list);
    let previousOpen=group.open;group.ontoggle=()=>{if(!group.isConnected)return;if(previousOpen!==group.open&&group.dataset.search!=='true'){if(group.open)openActs.add(key);else openActs.delete(key);saveView();}previousOpen=group.open;updateGroupActions();};return group;
   }));
  }else $('jobs').innerHTML=filtered.map(recordingRow).join('');
  updateGroupActions();syncPreview();
  $('empty').hidden=!!jobs.length;$('noMatches').hidden=!jobs.length||!!filtered.length;
  $('resultCount').textContent=jobs.length?`${filtered.length} ${filtered.every(j=>j.status==='ready')?'analyzed ':''}${filtered.length===1?'recording':'recordings'}`:'';
 }
 async function load(){
  clearTimeout(timer);
  try{
   const [response,catalog]=await Promise.all([fetch('api/crescendo',{cache:'no-store'}),fetch('crescendo-analysis.json',{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)]),data=await response.json();
   if(Array.isArray(catalog?.records))storyboardRecords=new Map(catalog.records.map(r=>[r.job_id,r]));
   if(!response.ok)throw Error(data.error||'Crescendo could not connect.');
   token=data.csrf_token;available=data.available;$('setup').hidden=available;$('analyze').disabled=busy||!available;
   jobs=data.jobs;render();$('loadStatus').textContent='';
   if(!jobs.length)$('importPanel').open=true;
   if(jobs.some(j=>['queued','analyzing'].includes(j.status)))timer=setTimeout(load,2500);
  }catch(error){$('loadStatus').textContent=error.message+' Use Refresh to reconnect.';}
 }
 $('expandAll').onclick=()=>toggleGroups(true);$('collapseAll').onclick=()=>toggleGroups(false);
 $('refresh').onclick=load;$('songSearch').oninput=render;
 $('newSong').onclick=()=>{$('importPanel').open=!$('importPanel').open;if($('importPanel').open)$('audioFile').focus()};
 $('importPanel').ontoggle=()=>{$('newSong').setAttribute('aria-expanded',String($('importPanel').open))};
 $('audioFile').onchange=()=>{const file=$('audioFile').files[0];if(file)$('songTitle').value=file.name.replace(/\.[^.]+$/,'');};
 $('analyzeForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;const file=$('audioFile').files[0];if(!file)return;
  if(!file.size||file.size>256*1024*1024){$('uploadStatus').textContent='Choose a nonempty audio file up to 256 MB.';return;}
  busy=true;$('analyze').disabled=true;$('uploadStatus').textContent='Adding your recording…';
  try{
   await load();
   const params=new URLSearchParams({filename:file.name,title:$('songTitle').value.trim(),fps:$('fps').value,offset:$('offset').value});
   const response=await fetch('api/crescendo?'+params,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-DESK-CSRF':token},body:file});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Import failed.');
   $('uploadStatus').textContent='Song added. It will be ready to listen to shortly.';$('audioFile').value='';act='all';$('songSearch').value='';await load();
  }catch(error){$('uploadStatus').textContent=error.message;}
  finally{busy=false;$('analyze').disabled=!available;}
 };
 window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
 document.addEventListener('click',event=>{if(busy&&event.target.closest('a')){event.preventDefault();$('uploadStatus').textContent='Wait for the recording to finish importing before leaving.';}});
 window.DESKAutosave={flush:async()=>{},state:()=>({dirty:busy,inflight:busy,conflicted:false})};
 window.addEventListener('focus',()=>{if(!busy)load()});load();
})();
