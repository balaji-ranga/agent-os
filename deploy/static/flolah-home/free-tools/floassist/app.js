const $=id=>document.getElementById(id);
let config,me,current='details',polling=false,connectionState=[];
let sessionToken=sessionStorage.getItem('floassist.session')||'';
const screens=['details','verify','apps','whatsapp','ready'];
function notice(message='',error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function show(id){current=id;screens.forEach(s=>$(s).hidden=s!==id);const step=id==='apps'?2:['whatsapp','ready'].includes(id)?3:1;
  document.querySelectorAll('[data-step]').forEach(e=>{if(Number(e.dataset.step)===step)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
  $(id).querySelector('h2')?.focus();}
async function api(path,method='GET',body){
  const response=await fetch('/api/floassist'+path,{method,headers:{'Content-Type':'application/json',...(sessionToken?{'X-FloAssist-Session':sessionToken}:{})},cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'The service is unavailable. Please retry.'}));
  if(!response.ok){const error=new Error(data.error||'Please try again.');error.code=data.code;throw error;}return data;
}
async function busy(button,fn){if(button.disabled)return;const label=button.textContent;button.disabled=true;button.textContent='Please wait…';notice();try{await fn();}catch(e){notice(e.message,true);}finally{button.disabled=false;if(button.textContent==='Please wait…')button.textContent=label;}}
function saveToken(value){sessionToken=value;if(value)sessionStorage.setItem('floassist.session',value);else{sessionStorage.removeItem('floassist.session');sessionStorage.removeItem('floassist.verifying');}}
function safeUrl(raw){const url=new URL(raw,location.href);if(url.protocol!=='https:'&&url.origin!==location.origin)throw new Error('The service returned an invalid link.');return url.href;}
function chosen(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(e=>e.value);}
function preferences(){const form=$('apps').elements;return {connectors:chosen('connector'),responsibilities:chosen('responsibility'),timezone:form.timezone.value,briefing_time:form.briefing_time.value,quiet_start:form.quiet_start.value,quiet_end:form.quiet_end.value};}
function drawApps(){
  $('connectors').replaceChildren();
  for(const app of config.connectors){
    const box=document.createElement('div');box.className='app-option';
    const label=document.createElement('label');label.className='check';const check=document.createElement('input');check.type='checkbox';check.name='connector';check.dataset.adoptionId='connector_'+app.id;check.value=app.id;check.checked=me.preferences.connectors.includes(app.id);
    const text=document.createElement('span');text.textContent=app.label;label.append(check,text);box.append(label);
    const connected=connectionState.some(c=>c.id===app.id&&c.connected);
    if(connected){const badge=document.createElement('span');badge.className='connected';badge.textContent='Connected';box.append(badge);}
    else{const connect=document.createElement('button');connect.type='button';connect.className='secondary small';connect.textContent='Connect';connect.hidden=!check.checked;
      check.addEventListener('change',()=>connect.hidden=!check.checked);
      connect.onclick=()=>{const popup=window.open('about:blank','_blank');if(popup)popup.opener=null;
        busy(connect,async()=>{try{me=await api('/preferences','PUT',preferences());const out=await api('/connections/'+encodeURIComponent(app.id),'POST',{});const url=safeUrl(out.authorization_url);
          if(popup)popup.location.href=url;else{const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='Open secure app connection';$('notice').replaceChildren(link);}
          if(popup)notice('Complete the connection in the new tab, then choose Check connections.');
        }catch(e){popup?.close();throw e;}});};box.append(connect);}
    $('connectors').append(box);
  }
}
function drawSettings(){
  drawApps();$('responsibilities').replaceChildren();
  for(const r of config.responsibilities){const label=document.createElement('label');label.className='check';const input=document.createElement('input');input.type='checkbox';input.name='responsibility';input.dataset.adoptionId='responsibility_'+r.id;input.value=r.id;input.checked=me.preferences.responsibilities.includes(r.id);label.append(input,document.createTextNode(r.label));$('responsibilities').append(label);}
  for(const key of ['timezone','briefing_time','quiet_start','quiet_end'])$('apps').elements[key].value=me.preferences[key];
  $('apps').elements.preset.value='';$('financial-label').hidden=true;$('privacy').textContent=config.privacy;
  $('policy-summary').replaceChildren(...me.policy.map(p=>{const li=document.createElement('li');li.textContent=p.label+': '+p.mode.replaceAll('_',' ');return li;}));
}
async function refreshConnections(){me=await api('/preferences','PUT',preferences());connectionState=await api('/connections');drawApps();notice(connectionState.every(c=>c.connected)?'Your selected apps are connected.':'Connect the selected apps, or deselect any you want to add later.');}
function drawQr(data){
  const valid=typeof data.qr_data_url==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(data.qr_data_url);
  $('qr').hidden=data.connected||!valid;if(valid&&!data.connected)$('qr').src=data.qr_data_url;else $('qr').removeAttribute('src');
  $('qr-status').textContent=data.connected?'Linked'+(data.number?' · '+data.number:' · confirming your number…'):(data.message||'Choose Show QR code to link WhatsApp.');
  $('activate').disabled=!data.connected;
}
async function pollQr(){if(polling)return;polling=true;try{
  while(current==='whatsapp'&&!document.hidden){const q=await api('/whatsapp/wait','POST',{});if(current!=='whatsapp')break;drawQr(q);if(q.connected)break;await new Promise(r=>setTimeout(r,1500));}
}catch(e){if(current==='whatsapp')notice(e.message+' You can refresh the QR to retry.',true);}finally{polling=false;}}
async function openWhatsApp(){
  show('whatsapp');drawQr({connected:false,message:'Checking your WhatsApp connection…'});
  try{
    const existing=await api('/whatsapp');
    if(existing.connected){drawQr(existing);return;}
    drawQr({connected:false,message:'Preparing your WhatsApp QR…'});
    const q=await api('/whatsapp/start','POST',{});drawQr(q);if(!q.connected)void pollQr();
  }catch(e){drawQr({connected:false,message:'WhatsApp setup could not finish. Choose Show / refresh QR to retry.'});throw e;}
}
function ready(){show('ready');const paused=me.status!=='active';$('ready').querySelector('h2').textContent=paused?'Proactive checks are paused':'Your assistant is ready';
  $('pause').textContent=paused?'Resume checks':'Pause checks';$('ready-copy').textContent=paused?'Resume here when you want briefings and reminders again.':'Your COO is now on WhatsApp. Send a message whenever you need a hand.';
  const number=me.channel?.number;$('chat-link').hidden=!number;if(number)$('chat-link').href='https://wa.me/'+number.replace(/\D/g,'');
  if(me.management_url)$('management').href=safeUrl(me.management_url);}
$('details').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{const f=e.target.elements;const out=await api('/start','POST',{email:f.email.value,phone:f.phone.value,country:f.country.value,accept_terms:f.consent.checked,whatsapp_opt_in:f.consent.checked});saveToken(out.session_token);sessionStorage.setItem('floassist.verifying','true');$('email-hint').textContent='Enter the six-digit code sent to '+f.email.value+'.';show('verify');});};
$('verify').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{try{me=await api('/verify','POST',{code:e.target.elements.code.value,mfa_code:e.target.elements.mfa.value});sessionStorage.removeItem('floassist.verifying');drawSettings();show('apps');}catch(error){if(error.code==='mfa_required'){$('mfa-label').hidden=false;$('verify').elements.mfa.focus();}throw error;}});};
$('start-over').onclick=()=>{saveToken('');show('details');notice();};
$('apps').elements.preset.onchange=e=>$('financial-label').hidden=e.target.value!=='administrative';
$('check-connections').onclick=e=>busy(e.target,refreshConnections);
$('apps').onsubmit=e=>{e.preventDefault();busy(e.submitter,async()=>{me=await api('/preferences','PUT',preferences());const preset=e.target.elements.preset.value;
  if(preset)me=await api('/policy','PUT',{preset,financial:preset==='administrative'?e.target.elements.financial.value:'prohibited'});
  await openWhatsApp();});};
$('refresh-qr').onclick=e=>busy(e.target,openWhatsApp);
$('back-apps').onclick=()=>{show('apps');notice();};
$('activate').onclick=e=>busy(e.target,async()=>{me=await api('/activate','POST',{});notice();ready();});
$('manage').onclick=()=>{drawSettings();show('apps');notice();};
$('pause').onclick=e=>busy(e.target,async()=>{me=await api('/status','POST',{status:me.status==='active'?'paused':'active'});ready();});
$('sign-out').onclick=e=>busy(e.target,async()=>{try{await api('/logout','POST',{});}finally{saveToken('');show('details');}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current==='whatsapp')void pollQr();});
const savedTheme=localStorage.getItem('floassist.theme');document.documentElement.dataset.theme=savedTheme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
$('theme').onclick=()=>{const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=theme;localStorage.setItem('floassist.theme',theme);};
try{config=await api('/config');if(!config.enabled)throw new Error('FloAssist registration is temporarily unavailable. Please check back later.');notice();
  if(sessionToken&&sessionStorage.getItem('floassist.verifying')){$('email-hint').textContent='Enter the six-digit code from your verification email.';show('verify');}
  else if(sessionToken){try{me=await api('/me');if(['active','paused','stopped'].includes(me.status))ready();else{drawSettings();show('apps');}}catch(e){if(e.code==='session_expired'){saveToken('');show('details');}else throw e;}}
  else show('details');
}catch(e){notice(e.message,true);}
