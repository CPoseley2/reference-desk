(async()=>{
 const report={harness:'Real browser DOM events against an isolated Exiled dashboard copy',export_adapter:'Intercept download text locally; exercise real JSON/CSV export buttons and real file-input import handler. No actual download in this harness.',tests:[],failures:[],bindings:{}};
 const out=document.createElement('pre');out.id='qa-report';out.style='white-space:pre-wrap;background:#071b12;color:#bcf9cb;padding:24px;margin:20px;font:14px monospace';document.querySelector('main').prepend(out);
 const probe=document.createElement('button');probe.id='qa-input-probe';probe.textContent='Input delivery probe';probe.setAttribute('aria-label','Input delivery probe');out.before(probe);
 const probeStatus=document.createElement('p');probeStatus.id='qa-probe-status';probeStatus.textContent='Trusted click count: 0';probe.after(probeStatus);let trusted=0;probe.onclick=e=>{if(e.isTrusted)trusted++;probeStatus.textContent='Trusted click count: '+trusted+'; last isTrusted='+e.isTrusted};
 const ui=id=>document.getElementById(id),tick=()=>new Promise(r=>setTimeout(r,10));
 const count=()=>Number(ui('counts').textContent.split(' / ')[0]);
 const test=(name,condition,detail)=>{report.tests.push({name,passed:!!condition,detail});if(!condition)report.failures.push(name)};
 let exported=[];download=(text,name,type)=>exported.push({text,name,type});
 try{
  for(const id of ['add','move','remove','undo','reset','json','csv'])report.bindings[id]={disabled:ui(id).disabled,onclick_type:typeof ui(id).onclick};
  const baseline=count();
  ui('add').click();test('add beat',count()===baseline+1,{count:count(),message:ui('message').textContent});
  test('new marker selected',ui('selection').value.startsWith('manual-'),ui('selection').value);
  const manualId=ui('selection').value;
  ui('markerTime').value='12.75';ui('move').click();test('move marker',ui('markerTime').value==='12.750000',ui('markerInfo').textContent);
  ui('remove').click();test('delete marker',count()===baseline,count());
  ui('undo').click();test('undo delete',count()===baseline+1,count());
  ui('json').click();let saved=exported.at(-1),parsed=JSON.parse(saved.text);test('JSON export contains moved marker',parsed.beats.some(b=>b.id===manualId&&b.seconds===12.75&&b.status==='uncertain'),saved.name);
  ui('csv').click();test('CSV export metadata and marker',exported.at(-1).text.startsWith('schema_version,source_sha256')&&exported.at(-1).text.includes(manualId),exported.at(-1).name);
  ui('reset').click();test('reset restores baseline',count()===baseline&&ui('selection').value==='',{count:count(),message:ui('message').textContent});test('reset undo available',!ui('undo').disabled,ui('undo').disabled);
  ui('undo').click();ui('json').click();test('undo reset restores exact saved map',exported.at(-1).text===saved.text,{count:count()});
  for(let i=0;i<3;i++){ui('reset').click();ui('add').click();ui('reset').click();test('repeated reset cycle '+(i+1),count()===baseline,count());}
  const dt=new DataTransfer();dt.items.add(new File([saved.text],'saved-beat-map.json',{type:'application/json'}));ui('import').files=dt.files;ui('import').dispatchEvent(new Event('change',{bubbles:true}));await tick();await tick();
  test('file input import restores saved count',count()===baseline+1,{count:count(),message:ui('message').textContent});ui('json').click();test('export/import roundtrip exact',exported.at(-1).text===saved.text,exported.at(-1).name);
  ui('reset').click();ui('undo').click();ui('json').click();test('reset undo after import preserves map',exported.at(-1).text===saved.text,ui('message').textContent);
  if(ui('cueSelect')&&ui('cueSelect').options.length){
   ui('reset').click();ui('cueSelect').selectedIndex=ui('cueSelect').options.length-1;ui('cueSelect').dispatchEvent(new Event('change',{bubbles:true}));
   test('cue selection updates evidence',ui('cueEvidence').textContent.length>20,ui('cueEvidence').textContent);
   ui('cueFocus').click();test('cue focus zooms timeline',!ui('zoomLabel').textContent.startsWith('249.'),ui('zoomLabel').textContent);
   test('cue focus seeks with lead in',Number(ui('seek').value)>0,ui('seek').value);
   ui('showCuts').click();test('cut lane reveal toggles',ui('showCuts').getAttribute('aria-pressed')==='true');
   ui('showCuts').click();test('cut lane hide toggles',ui('showCuts').getAttribute('aria-pressed')==='false');
   ui('json').click();test('dynamics survive editor export',JSON.parse(exported.at(-1).text).dynamics.curve.length>0);
   ui('fit').click();test('fit restores whole-song timeline',ui('zoomLabel').textContent.startsWith('249.'),ui('zoomLabel').textContent);
  }
  report.source_sha256=parsed.source.sha256;report.source_duration=parsed.source.duration_seconds;report.film_offset=parsed.timing.film_offset_seconds;report.result=report.failures.length?'FAIL':'PASS';
 }catch(error){report.result='ERROR';report.error=error.stack||String(error)}
 out.textContent=JSON.stringify(report,null,2);document.title='DOM test '+report.result+' · Exiled beat map';
})();
