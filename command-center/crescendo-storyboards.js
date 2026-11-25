/* Read-only findings: existing images, notes, and edit timing are never changed. */
(() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clock = seconds => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4,'0')}`;
  const labels = {ready:'Crescendo analyzed',queued:'Crescendo queued',pending:'Crescendo pending',analyzing:'Crescendo analyzing…',failed:'Crescendo analysis failed',interrupted:'Crescendo interrupted',missing:'Recording needed',unavailable:'Analysis unavailable'};
  let data, loading=false, timer, offline=false;
  const safeURL = value => {
    const url=new URL(value,location.href);
    return ['http://127.0.0.1:8876',location.origin].includes(url.origin) ? url.href : '#';
  };
  const link = (href,title) => `<a href="${escape(safeURL(href))}" target="_blank" rel="noopener">${escape(title)}</a>`;
  function panel(record,expanded=false) {
    const r=record,s=r.summary,ready=r.status==='ready'&&!!s;
    const name=escape(r.title),links=r.links||{};
    return `<section class="crescendo-result" data-crescendo-film="${r.id}" aria-label="Crescendo analysis for ${name}">
      <p class="crescendo-state ${ready?'complete':''}" role="status">${ready?'✓ ':''}${labels[r.status]||escape(r.status)}</p>
      ${ready?`<p class="crescendo-metrics">${clock(s.duration_seconds)} · ${s.swells} builds · ${s.impacts} strong hits · ${s.breaks} quiet breaks</p>
      <div class="crescendo-actions">${link(links.dashboard,'Listen & explore →')}</div>
      ${r.favorites_error?`<p class="crescendo-notice">${escape(r.favorites_error)}</p>`:''}
      ${(r.favorite_moments||[]).length?`<div class="crescendo-favorites"><strong>★ Favorite moments</strong><ol class="crescendo-cues">${r.favorite_moments.map(c=>`<li><button type="button" data-crescendo-cue="${Math.max(0,(c.start_seconds??c.seconds)-2)}" aria-label="Play favorite ${escape({swell:'build',impact:'strong hit',break:'quiet break'}[c.kind]||'moment')} at ${clock(c.seconds)}">▶ ${c.kind==='swell'?clock(c.start_seconds)+' → ':''}${clock(c.seconds)} · ${escape({swell:'Build',impact:'Strong hit',break:'Quiet break'}[c.kind]||'Moment')}</button></li>`).join('')}</ol><small>Saved for planning · song time. Manage stars in Crescendo.</small></div>`:''}
      <details class="crescendo-analysis-details" ${expanded?'open':''}><summary>Analysis details</summary>
      <p class="crescendo-notice">Suggested moments · not yet reviewed by ear${r.confirmed_beats?` · ${r.confirmed_beats} beats confirmed in saved review`:''}.</p>
      <p>Estimated tempo ${s.tempo_min_bpm==null?'unresolved':`${s.tempo_min_bpm.toFixed(1)}–${s.tempo_max_bpm.toFixed(1)} BPM`}. Half/double-time ambiguity may remain.</p>
      <details><summary>Recording &amp; timing</summary><p class="crescendo-source"><strong>Recording:</strong> ${escape(r.source_path.split('/').pop())}<br>${escape(r.selection_basis)}</p>
      <p>${escape(r.timing_basis)}</p></details>
      ${r.cut_suggestions_stale?'<p class="crescendo-notice">Saved beat review available. Original cut suggestions need regeneration after edits.</p>':''}
      <p>Play a suggested moment:</p>
      <ol class="crescendo-cues">${(r.top_cues||[]).map(c=>`<li><button type="button" data-crescendo-cue="${Math.max(0,(c.start_seconds??c.seconds)-2)}" title="Audition cue lead-in">▶ ${clock(c.seconds)} ${escape({swell:'Build',impact:'Strong hit',break:'Quiet break'}[c.kind]||'Moment')}</button><details><summary>Why this moment?</summary><small>${escape(c.evidence)}</small><small>${escape(c.suggestion)}</small></details></li>`).join('')||'<li>No strong dynamics candidates detected.</li>'}</ol>
      <details><summary>Downloads &amp; saved beat map</summary><div class="crescendo-actions">${link(links.current_map||links.beat_map,'Current beat map JSON')}${link(links.cues_csv,'Dynamics CSV')}${link(links.beats_csv,'Automatic beats CSV')}${link(links.record,'Source & findings JSON')}</div></details>
      <details><summary>Recording provenance</summary><p class="path">${escape(r.source_path)}</p><p class="path">SHA-256 ${escape(r.original_sha256)}</p><p>${escape(r.selection_evidence)}</p>${r.decode?`<p>${escape(r.decode.method)}</p>`:''}</details>
      </details><audio controls preload="none" hidden aria-label="Audition ${name} analysis" src="${escape(safeURL(links.dashboard.replace('index.html','audio-preview.wav')))}"></audio>`:`<p>${escape(r.error||'The original recording is saved. Crescendo is measuring its beats and dynamics.')}</p>`}
    </section>`;
  }
  let sheet, sheetTrigger;
  function openSheet(id,trigger) {
    const record=data?.records.find(r=>r.id===id);if(!record)return;
    if(!sheet){
      sheet=document.createElement('dialog');sheet.id='crescendo-sheet';sheet.setAttribute('aria-labelledby','crescendo-sheet-title');
      sheet.innerHTML='<div class="crescendo-sheet-heading"><h2 id="crescendo-sheet-title"></h2><button type="button" class="catalog-action" aria-label="Close Crescendo analysis" title="Close Crescendo analysis"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div id="crescendo-sheet-content"></div>';
      document.body.append(sheet);
      sheet.querySelector('button').onclick=()=>sheet.close();
      sheet.addEventListener('close',()=>{sheet.querySelectorAll('audio').forEach(audio=>audio.pause());sheetTrigger?.focus({preventScroll:true})});
    }
    sheetTrigger=trigger;
    sheet.querySelector('h2').textContent='Crescendo · '+record.title;
    sheet.querySelector('#crescendo-sheet-content').innerHTML=panel(record,true);
    sheet.showModal();sheet.scrollTop=0;
  }
  function mountCard(card,record) {
    let button=card.querySelector('[data-crescendo-open]');
    if(!button){button=document.createElement('button');button.type='button';button.className='catalog-action crescendo-sheet-toggle';button.dataset.crescendoOpen=record.id;button.setAttribute('aria-haspopup','dialog');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4"/></svg>';(card.querySelector('.actions')||card).append(button)}
    const status=labels[record.status]||record.status;
    button.title=status+' · Open analysis';button.setAttribute('aria-label','Crescendo analysis for '+record.title+' · '+status);button.classList.toggle('complete',record.status==='ready');
  }
  function render() {
    if(!data || !data.records?.length)return;
    let summary=document.getElementById('crescendo-coverage');
    if(!summary && document.getElementById('acts')) {
      summary=document.createElement('section');summary.id='crescendo-coverage';summary.className='crescendo-coverage';
      document.getElementById('acts').before(summary);
    }
    if(summary) {
      const ready=data.records.filter(r=>r.status==='ready').length;
      summary.innerHTML=`<div><strong>Crescendo · Acts I–V</strong><p>${ready} / ${data.records.length} songs analyzed${offline?' · saved snapshot':''}. Open the waveform icon on any song to listen &amp; explore.</p></div><div class="crescendo-actions"><button id="crescendo-refresh" type="button">Refresh analysis status</button>${link('http://127.0.0.1:8876/libraries/'+data.library_id+'/crescendo.html','Browse songs →')}</div>`;
      document.getElementById('crescendo-refresh').onclick=load;
      for(const act of document.querySelectorAll('[data-act]')) {
        const rows=data.records.filter(r=>r.act===Number(act.dataset.act));if(!rows.length)continue;
        let badge=act.querySelector('.crescendo-act-count');if(!badge){badge=document.createElement('small');badge.className='crescendo-act-count';act.querySelector('summary').append(badge)}
        badge.textContent=`Crescendo: ${rows.filter(r=>r.status==='ready').length}/${rows.length} analyzed`;
      }
    }
    for(const r of data.records) {
      const card=document.querySelector(`[data-film="${r.id}"]`);
      if(card)mountCard(card,r);
    }
    const brief=document.getElementById('brief-body'),briefRecord=brief&&data.records.find(r=>r.id===brief.dataset.crescendoFilm);
    if(briefRecord)mount(brief,briefRecord,false);
    const eid=new URLSearchParams(location.search).get('id');
    const record=eid&&data.records.find(r=>r.entry_id===eid);
    if(record) {
      let host=document.getElementById('crescendo-viewer');
      if(!host){host=document.createElement('div');host.id='crescendo-viewer';document.querySelector('header').append(host)}
      mount(host,record,true);
    }
  }
  function mount(host,record,expanded) {
    const old=host.querySelector(':scope > .crescendo-result');
    const signature=JSON.stringify([record.status,record.summary,record.saved_review_revision,record.favorites_revision,record.favorite_moments,record.favorites_error,record.error]);
    if(old?.dataset.signature===signature)return;
    // Never replace a playing or expanded interactive findings panel during background polling.
    if(old?.querySelector('audio')&&!old.querySelector('audio').paused)return;
    const open=old?.querySelector('.crescendo-analysis-details')?.open;
    const wrapper=document.createElement('div');wrapper.innerHTML=panel(record,open??false);const fresh=wrapper.firstElementChild;fresh.dataset.signature=signature;
    if(old)old.replaceWith(fresh);else host.append(fresh);
  }
  async function load() {
    if(loading)return;loading=true;clearTimeout(timer);
    try {
      const response=await fetch('/library-api/crescendo',{cache:'no-store'});
      if(!response.ok)throw Error('Live analysis unavailable');
      data=await response.json();offline=false;render();
    } catch(error) {
      try {const response=await fetch('crescendo-analysis.json',{cache:'no-store'});if(!response.ok)throw error;data=await response.json();offline=true;render()}
      catch {const host=document.getElementById('crescendo-coverage');if(host)host.textContent='Crescendo status unavailable. Reconnect Reference Desk and reload.';}
    } finally {loading=false;timer=setTimeout(load,data?.records.some(r=>['queued','analyzing','pending'].includes(r.status))?7000:30000)}
  }
  document.addEventListener('click',async event=>{
    const trigger=event.target.closest('[data-crescendo-open]');if(trigger){openSheet(trigger.dataset.crescendoOpen,trigger);return;}
    const button=event.target.closest('[data-crescendo-cue]');if(!button)return;
    const audio=button.closest('.crescendo-result').querySelector('audio');audio.hidden=false;
    document.querySelectorAll('audio').forEach(other=>{if(other!==audio)other.pause()});
    const seek=()=>{audio.currentTime=Math.min(Number(button.dataset.crescendoCue),audio.duration||Infinity)};
    try {
      // WebKit cannot reliably seek a preload=none resource before metadata arrives.
      if(audio.readyState===0) {
        audio.addEventListener('loadedmetadata',seek,{once:true});
        audio.load();
      } else seek();
      await audio.play();
    } catch {button.title='Open Crescendo to audition this recording.'}
  });
  window.addEventListener('focus',load);window.addEventListener('owl-shot-change',render);window.addEventListener('owl-film-brief-opened',()=>{render();load()});load();
})();
