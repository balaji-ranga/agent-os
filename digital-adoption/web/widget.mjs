import { normalizeTheme, themeProperties } from './theme.mjs';
let currentTheme=normalizeTheme({}),initialTheme;
function applyTheme(value) {
  const theme = normalizeTheme(value);
  currentTheme=theme;initialTheme||=theme;
  for (const [key,color] of Object.entries(themeProperties(theme))) document.documentElement.style.setProperty(key,color);
  document.querySelector('h1').textContent=theme.title;
}
applyTheme({});
// The SDK supplies only the public parent origin, never credentials. Validate
// both the exact origin and parent WindowProxy for every message.
const pending = new Map();
const configuredParent = new URLSearchParams(location.hash.slice(1)).get('parentOrigin');
const parentOrigin = configuredParent && new URL(configuredParent).origin === configuredParent ? configuredParent : null;
function call(type, extra = {}) {
  if (!parentOrigin) return Promise.reject(new Error('Host origin unavailable'));
  return new Promise((resolve,reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Host did not respond')); }, 60_000);
    pending.set(id, { resolve, reject, timeout });
    parent.postMessage({ channel: 'flolah-adoption-v1', id, type, ...extra }, parentOrigin);
  });
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'flolah-adoption-v1') return;
  if(event.data.type === 'theme') {try{applyTheme(event.data.theme);}catch{}return;}
  if(event.data.type === 'expired') {
    for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Session expired'));}pending.clear();
    document.querySelector('#review').replaceChildren();
    document.querySelectorAll('button,textarea').forEach(e=>{e.disabled=true;});
    document.querySelector('#status').textContent='Your session expired. Reload the host page to start a new empty conversation.';
    return;
  }
  const item = pending.get(event.data.id); if (!item) return;
  pending.delete(event.data.id); clearTimeout(item.timeout);
  event.data.error ? item.reject(new Error(event.data.error)) : item.resolve(event.data.result);
});
const status = document.querySelector('#status'), log = document.querySelector('#log'),knowledgeLog=document.querySelector('#knowledge-log'),knowledgeStatus=document.querySelector('#knowledge-status'),actionStatus=document.querySelector('#action-status');
const tabs=[...document.querySelectorAll('[role="tab"]')];
function selectTab(tab){for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;}}
for(const [index,tab] of tabs.entries()){
 tab.onclick=()=>selectTab(tab);
 tab.onkeydown=event=>{let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();selectTab(tabs[next]);tabs[next].focus();};
}
document.querySelector('#minimize').onclick=()=>call('minimize').catch(error=>{status.textContent=error.message;});
const settings=document.querySelector('#settings'),appearance=document.querySelector('#appearance'),settingsStatus=document.querySelector('#settings-status');
function loadAppearance(){for(const key of ['primary','background','foreground','fontSize','radius'])appearance.elements.namedItem(key).value=currentTheme[key];}
document.querySelector('#settings-open').onclick=()=>{loadAppearance();settings.showModal();};
document.querySelector('#settings-close').onclick=()=>settings.close();
appearance.onsubmit=async event=>{event.preventDefault();try{const data=new FormData(appearance),patch={};for(const key of ['primary','background','foreground'])patch[key]=data.get(key);for(const key of ['fontSize','radius'])patch[key]=Number(data.get(key));const result=await call('appearance',{theme:patch});applyTheme(result.theme);settingsStatus.textContent='Appearance updated for this session.';}catch(error){settingsStatus.textContent=error.message;}};
document.querySelector('#theme-reset').onclick=async()=>{try{const result=await call('appearance-reset');applyTheme(result.theme);loadAppearance();settingsStatus.textContent='Website theme restored.';}catch(error){settingsStatus.textContent=error.message;}};
const replies={guide:null,knowledge:null};
const clearChat=document.createElement('button');clearChat.type='button';clearChat.textContent='Clear this conversation';settings.append(clearChat);
clearChat.onclick=async()=>{if(!confirm('Clear both chat tabs in this session? Shared website knowledge and website fields will not be deleted.'))return;try{task++;await call('clear-history');log.replaceChildren();knowledgeLog.replaceChildren();document.querySelector('#review').replaceChildren();for(const channel of ['guide','knowledge']){replies[channel]=null;replyHints[channel].hidden=true;}settingsStatus.textContent='Conversation cleared. Shared knowledge is unchanged.';}catch(error){settingsStatus.textContent=error.message;}};
const replyHints={};
for(const [channel,form] of [['guide','#guide-chat'],['knowledge','#chat']]){
 const hint=document.createElement('button');hint.type='button';hint.hidden=true;hint.setAttribute('aria-label','Cancel reply');hint.onclick=()=>{replies[channel]=null;hint.hidden=true;};document.querySelector(form).prepend(hint);replyHints[channel]=hint;
}
function show(text,channel='guide',role='assistant',id=null) {
 const p=document.createElement('p');p.textContent=text;p.dataset.role=role;
 if(id){const reply=document.createElement('button');reply.type='button';reply.textContent='↩';reply.setAttribute('aria-label',`Reply to ${role} message`);reply.style.cssText='padding:2px 6px;margin-left:6px;font-size:12px';reply.onclick=()=>{replies[channel]=id;replyHints[channel].textContent=`Replying: ${text.slice(0,60)} · ×`;replyHints[channel].hidden=false;document.querySelector(channel==='knowledge'?'#knowledge-message':'#message').focus();};p.append(reply);}
 (channel==='knowledge'?knowledgeLog:log).append(p);if(!p.closest('[hidden]'))p.scrollIntoView({block:'nearest'});
}
document.querySelector('#chat').addEventListener('submit', async event => {
  event.preventDefault(); const field = document.querySelector('#knowledge-message');
  const button=event.submitter;button.disabled=true;
  try {
    show(field.value,'knowledge','user');knowledgeStatus.textContent='Searching this website’s approved knowledge…';
    const result = await call('ask', { text: field.value,replyTo:replies.knowledge }); show(result.message,'knowledge','assistant',result.messageId); field.value = '';replies.knowledge=null;replyHints.knowledge.hidden=true;
    for(const evidence of result.citations){const details=document.createElement('details'),summary=document.createElement('summary'),excerpt=document.createElement('p');summary.textContent=evidence.title;excerpt.textContent=evidence.text;details.append(summary,excerpt);knowledgeLog.append(details);}
    knowledgeStatus.textContent=result.kind==='greeting'?'Ready for your knowledge question.':result.kind==='no_evidence'?'No matching evidence found. No page inspection was performed.':'Answered from this embedding’s knowledge. No page inspection was performed.';
  }
  catch(error) { knowledgeStatus.textContent = error.message; }
  finally{button.disabled=false;}
});
let task=0;
document.querySelector('#stop').onclick=async()=>{task++;document.querySelector('#review').replaceChildren();await call('cancel');status.textContent='Stopped. Completed changes remain; no further action will run.';};
async function prepare(text,generation,depth=0){
  const button=document.querySelector('#plan'), review=document.querySelector('#review');
  button.disabled=true; review.replaceChildren();
  try {
    if(depth>3)throw new Error('Navigation limit reached. Please inspect the page and clarify the next step.');
    status.textContent='Inspecting the current page and preparing your review…';
    const proposal=await call('plan',{ text,replyTo:depth===0?replies.guide:null });
    if(generation!==task)return;
    show(proposal.message,'guide','assistant',proposal.messageId);replies.guide=null;replyHints.guide.hidden=true;
    status.textContent=proposal.actions.length?'Review the proposed next step.':'More information is needed; reply with the missing details.';
    for(const action of proposal.actions){const p=document.createElement('p');p.textContent=action.type==='navigate'?`Open ${action.label} (${action.path})`:`${action.label}: ${action.value}`;review.append(p);}
    if(proposal.actions.length){
      const warning=document.createElement('p');warning.textContent='Review before filling. Some websites autosave fields. This does not click Save.';review.append(warning);
      const approve=document.createElement('button');approve.textContent=proposal.actions[0].type==='navigate'?'Approve navigation':'Approve field changes';review.append(approve);
      approve.addEventListener('click',async()=>{
        approve.disabled=true;
        try {
          if(generation!==task)return;
          const result=await call('approve',{proposalId:proposal.id});if(generation!==task)return;
          review.replaceChildren();
          if(result.results.some(r=>r.navigated&&r.verified)){status.textContent='Navigation verified. Continuing your original task…';await prepare(text,generation,depth+1);}
          else status.textContent=result.results.every(r=>r.valueObserved)?`${result.results.length} approved field values verified in the form. Save was not clicked.`:'A field did not retain its value. Check the form; no retry was attempted.';
        }
        catch(error){status.textContent=error.message;}
      },{once:true});
    }
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}
document.querySelector('#guide-chat').addEventListener('submit',event=>{event.preventDefault();const text=document.querySelector('#message').value;show(text,'guide','user');prepare(text,++task);});
document.querySelector('#inspect').addEventListener('click', async () => {
  try { const result = await call('inspect'); actionStatus.textContent = `${result.fields.length} visible supported fields and ${result.links?.length||0} safe navigation links found. Values were not collected. ${result.fields.map(f=>f.label).join(', ')}`; }
  catch(error) { actionStatus.textContent = error.message; }
});
document.querySelector('#documents').onclick=async()=>{try{const result=await call('documents'),list=document.querySelector('#document-list');list.replaceChildren();for(const source of result.sources){const item=document.createElement('li');item.textContent=`${source.title} · ${source.status}`;list.append(item);}actionStatus.textContent=`${result.sources.length} authorized ready sources shown (up to 100).`;}catch(error){actionStatus.textContent=error.message;}};
let recordingState='idle';
const replayButton=document.querySelector('#replay-navigation');
replayButton.onclick=async()=>{replayButton.disabled=true;try{actionStatus.textContent='Replaying reviewed navigation…';const result=await call('replay-navigation',{approved:true});actionStatus.textContent=`${result.results.length} recorded navigation steps reached their verified destinations.`;}catch(error){actionStatus.textContent=error.message;}finally{replayButton.disabled=false;}};
async function record(operation){
 try{
  const result=await call(`record-${operation}`);recordingState=result.state;
  document.querySelector('#record-start').disabled=['recording','paused'].includes(recordingState);
  document.querySelector('#record-pause').disabled=!['recording','paused'].includes(recordingState);
  document.querySelector('#record-pause').textContent=recordingState==='paused'?'Resume recording':'Pause recording';
  document.querySelector('#record-stop').disabled=!['recording','paused'].includes(recordingState);
  actionStatus.textContent=`Action recording: ${recordingState}. No entered values captured.`;
  replayButton.hidden=operation!=='stop'||!result.steps.length||result.steps.some(step=>step.action!=='navigate');
  if(operation==='stop')document.querySelector('#record-review').textContent=result.steps.map((s,i)=>`${i+1}. ${s.action} ${s.path}${s.parameter?' · parameter '+s.parameter:''}`).join('\n')||'No supported actions recorded.';
 }catch(error){actionStatus.textContent=error.message;}
}
document.querySelector('#record-start').onclick=()=>record('start');document.querySelector('#record-pause').onclick=()=>record(recordingState==='paused'?'resume':'pause');document.querySelector('#record-stop').onclick=()=>record('stop');
try { const config=await call('config');applyTheme(config.theme);const result = await call('history'); result.messages.forEach(message => show(message.text,message.channel||'guide',message.role,message.id)); }
catch(error) { status.textContent = error.message; }
