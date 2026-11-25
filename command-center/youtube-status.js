/* Public video availability is separate from local film export and approval. */
(()=>{
 const summary=document.createElement('div');summary.id='youtube-status-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
 document.getElementById('stamp')?.after(summary);
 const message=document.createElement('span');summary.append(message);
 for(const [color,label] of [['green','Published'],['orange','No public match']]){
  const legend=document.createElement('span');legend.className='youtube-legend';const dot=document.createElement('span');dot.className='youtube-light youtube-legend-'+color;dot.setAttribute('aria-hidden','true');legend.append(dot,document.createTextNode(label));summary.append(legend);
 }
 function unknown(text){
  message.textContent=text;
  for(const badge of document.querySelectorAll('.youtube-publication')){badge.dataset.state='unavailable';badge.title=text;badge.setAttribute('aria-label',text);badge.removeAttribute('href');}
 }
 function render(data){
  let published=0;
  for(const card of document.querySelectorAll('[data-film]')){
   let badge=card.querySelector('.youtube-publication');
   if(!badge){badge=document.createElement('a');badge.className='youtube-publication';badge.target='_blank';badge.rel='noopener';const dot=document.createElement('span');dot.className='youtube-light';dot.setAttribute('aria-hidden','true');badge.append(dot,document.createTextNode('YT'));card.querySelector('h2')?.append(badge);}
   const item=data.films?.[card.dataset.film]||{state:'unavailable',matches:[]};const name=card.querySelector('h2')?.childNodes[0]?.textContent||'Song';
   const checked=data.checked_at?new Date(data.checked_at).toLocaleString(undefined,{timeZone:'America/Los_Angeles',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'';
   const matches=item.matches||[];
   badge.dataset.state=item.state;
   let text;
   if(item.state==='published'){
    published++;badge.href=matches[0].url;
    text=`${name}: published on ${data.channel}. ${matches.length} matching public upload${matches.length===1?'':'s'}.\n${matches.slice(0,4).map(v=>v.title).join('\n')}\nChecked ${checked}. Opens the newest matching upload.`;
   }else{
    badge.href=data.channel_url;
    text=item.state==='not_found'?`${name}: no matching public video found on ${data.channel}. Checked ${checked}. Opens the channel.`:item.state==='checking'?`${name}: checking YouTube…`:`${name}: YouTube status unavailable. ${data.error||'Refresh to check again.'}`;
    if(matches.length&&item.state!=='not_found')text+=` Last successful match: ${matches[0].title}${checked?' ('+checked+')':''}.`;
   }
   badge.title=text;badge.setAttribute('aria-label',text);
  }
  if(data.refreshing)message.textContent='YouTube · Checking public videos…';
  else if(data.fresh){const time=new Date(data.checked_at).toLocaleTimeString(undefined,{timeZone:'America/Los_Angeles',hour:'numeric',minute:'2-digit',timeZoneName:'short'});message.textContent=`YouTube · ${published} of ${Object.keys(data.films).length} songs published · ${data.video_count} videos checked at ${time}`;}
  else message.textContent='YouTube · '+(data.error||'Status unavailable. Refresh to check again.');
 }
 async function request(url,body,token){
  const response=await fetch(url,body?{method:'POST',headers:{'Content-Type':'application/json','X-OWL-CSRF':token},body:JSON.stringify(body)}:{cache:'no-store'});
  if(!response.ok)throw Error('YouTube status service unavailable.');return response.json();
 }
 async function check(){

  if(location.protocol==='file:'){unknown('YouTube · Open the local Command Center app to check publication.');return;}
  try{
   const response=await fetch('/library-api/youtube-status',{cache:'no-store'});if(!response.ok){summary.remove();return;}const initial=await response.json();render(initial);
   let data=await request('/library-api/youtube-status/refresh',{},initial.csrf_token);render(data);
   const deadline=Date.now()+110000;
   while(data.refreshing&&Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1500));
    data=await request('/library-api/youtube-status');render(data);
   }
   if(data.refreshing)unknown('YouTube · Check is taking longer than expected. Refresh to retry.');
  }catch(error){unknown('YouTube · '+error.message+' Refresh to retry.');}
 }
 check();
})();
