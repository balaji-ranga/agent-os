import { normalizeTheme, themeProperties } from './theme.mjs';
import {encodeFile} from './files.mjs';
import {createScreenCapture} from './screen-capture.mjs';
let currentTheme=normalizeTheme({}),initialTheme,assistanceMode='assist';
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
document.querySelector('#coaching-form').onsubmit=async event=>{event.preventDefault();const field=document.querySelector('#coaching-code');try{const result=await call('coaching-exchange',{code:field.value});field.value='';document.querySelector('#upload-form').hidden=!result.capabilities?.upload;document.querySelector('#capture-use').disabled=!result.capabilities?.upload;document.querySelector('#coaching-status').textContent=`Coaching enabled until ${new Date(result.coachingUntil).toLocaleTimeString()}. Use Actions → Inspect current form on each workflow screen.`;}catch(error){field.value='';document.querySelector('#coaching-status').textContent=error.message;}};
document.querySelector('#assistance-mode').onchange=async event=>{assistanceMode=event.target.value;task++;document.querySelector('#review').replaceChildren();await call('cancel');settingsStatus.textContent=assistanceMode==='guide'?'Guide mode highlights fields without changing values.':'Assist mode prepares changes for your approval.';};
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
    for(const evidence of result.citations){const details=document.createElement('details'),summary=document.createElement('summary'),excerpt=document.createElement('p');summary.textContent=`${evidence.title}${evidence.locator?' · '+evidence.locator:''} · ${evidence.revision.slice(0,8)}`;excerpt.textContent=evidence.text;details.append(summary,excerpt);if(evidence.url?.startsWith('https://')){const link=document.createElement('a');link.href=evidence.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open source';details.append(link);}knowledgeLog.append(details);}
    knowledgeStatus.textContent=result.kind==='greeting'?'Ready for your knowledge question.':result.kind==='no_evidence'?'No matching evidence found. No page inspection was performed.':'Answered from this embedding’s knowledge. No page inspection was performed.';
  }
  catch(error) { knowledgeStatus.textContent = error.message; }
  finally{button.disabled=false;}
});
let task=0;
function remainingGuidance(result,generation,onComplete=()=>{}){
 const review=document.querySelector('#review');review.replaceChildren();status.textContent=`Showing ${result.label||'the selected field'}. No values changed. ${result.guideRemaining||0} more fields.`;
 if(result.guideRemaining){const next=document.createElement('button');next.textContent='Show next field';review.append(next);next.onclick=async()=>{next.disabled=true;try{if(generation!==task)return;const observed=await call('guide-next');if(generation!==task)return;remainingGuidance(observed,generation,onComplete);}catch(error){status.textContent=`Guidance paused: ${error.message}`;}};}else onComplete();
}
document.querySelector('#stop').onclick=async()=>{task++;document.querySelector('#review').replaceChildren();await call('cancel');status.textContent='Stopped. Completed changes remain; no further action will run.';};
async function prepare(text,generation,depth=0){
  const button=document.querySelector('#plan'), review=document.querySelector('#review');
  button.disabled=true; review.replaceChildren();
  try {
    if(depth>3)throw new Error('Navigation limit reached. Please inspect the page and clarify the next step.');
    status.textContent='Inspecting the current page and preparing your review…';
    const proposal=await call('plan',{ text,replyTo:depth===0?replies.guide:null,mode:assistanceMode });
    if(generation!==task)return;
    show(proposal.message,'guide','assistant',proposal.messageId);replies.guide=null;replyHints.guide.hidden=true;
    status.textContent=proposal.actions.length?'Review the proposed next step.':'More information is needed; reply with the missing details.';
    for(const action of proposal.actions){const p=document.createElement('p');p.textContent=action.type==='navigate'?`Open ${action.label} (${action.path})`:action.type==='highlight'?`Show ${action.label}`:`${action.label}: ${action.value}`;review.append(p);}
    if(proposal.actions.length){
      const warning=document.createElement('p');warning.textContent=assistanceMode==='guide'?'Guidance only. No field values will change.':'Review before filling. Some websites autosave fields. This does not click Save.';review.append(warning);
      const approve=document.createElement('button');approve.textContent=proposal.actions[0].type==='navigate'?'Approve navigation':assistanceMode==='guide'?'Show guidance':'Approve field changes';review.append(approve);
      approve.addEventListener('click',async()=>{
        approve.disabled=true;
        try {
          if(generation!==task)return;
          const result=await call('approve',{proposalId:proposal.id});if(generation!==task)return;
          review.replaceChildren();
          if(result.results.every(r=>r.highlighted)){remainingGuidance(result,generation);return;}
          if(result.results.some(r=>r.navigated&&r.verified)){status.textContent='Navigation verified. Continuing your original task…';await prepare(text,generation,depth+1);}
          else status.textContent=result.results.every(r=>r.highlighted)?'Guidance shown. No field values were changed.':result.results.every(r=>r.valueObserved)?`${result.results.length} approved field values verified in the form. Save was not clicked.`:'A field did not retain its value. Check the form; no retry was attempted.';
        }
        catch(error){status.textContent=error.message;}
      },{once:true});
    }
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
}
document.querySelector('#guide-chat').addEventListener('submit',event=>{event.preventDefault();const text=document.querySelector('#message').value;show(text,'guide','user');prepare(text,++task);});
document.querySelector('#inspect').addEventListener('click', async () => {
  try { const result = await call('inspect'); actionStatus.textContent = `${result.fields.length} visible supported fields and ${result.links?.length||0} safe navigation links found. Values were not collected. ${result.learning?'Screen map saved for coaching; compatibility is not yet validated. ':''}${result.fields.map(f=>f.label).join(', ')}`; }
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
document.querySelector('#record-export').onsubmit=async event=>{event.preventDefault();try{const pack=await call('record-package',{title:document.querySelector('#record-title').value}),url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='flolah-workflow-draft.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);actionStatus.textContent='Parameterized draft downloaded. Import it in the owner console for validation and publication.';}catch(error){actionStatus.textContent=error.message;}};
async function recipeReview(recipe,parameters,step,generation){
 const review=document.querySelector('#review');review.replaceChildren();
 try{
  const proposal=await call('recipe-plan',{recipeId:recipe.id,version:recipe.version,parameters,step,mode:assistanceMode});
  if(generation!==task)return;
  show(`${recipe.title} · version ${recipe.version}: ${proposal.message}`);
  status.textContent=proposal.complete?(assistanceMode==='guide'?'Recorded guidance finished. No fields were filled.':'Recorded draft steps verified. Saving remains a separate action.'):'Review the next recorded step.';
  for(const action of proposal.actions){const line=document.createElement('p');line.textContent=action.type==='navigate'?`Open ${action.label}`:action.type==='highlight'?`Show ${action.label}`:`${action.label}: ${action.value}`;review.append(line);}
  if(proposal.actions.length){
   const approve=document.createElement('button');approve.textContent=assistanceMode==='guide'?'Show recorded guidance':'Approve recorded step';review.append(approve);
   approve.onclick=async()=>{
    approve.disabled=true;
    try{
     const result=await call('approve',{proposalId:proposal.id});if(generation!==task)return;
     if(!result.results.every(r=>r.valueObserved||r.highlighted||r.navigated&&r.verified))throw new Error('The recorded step was not verified. Replay paused.');
     if(result.results.every(r=>r.highlighted)){remainingGuidance(result,generation,()=>recipeReview(recipe,parameters,proposal.nextStep,generation));return;}
     await recipeReview(recipe,parameters,proposal.nextStep,generation);
    }catch(error){status.textContent=error.message;}
   };
  }
 }
 catch(error){status.textContent=`Workflow paused: ${error.message}`;}
}
document.querySelector('#recipes-refresh').onclick=async()=>{try{const data=await call('recipes'),list=document.querySelector('#recipe-list');list.replaceChildren();for(const recipe of data.recipes){const item=document.createElement('li'),use=document.createElement('button');item.textContent=`${recipe.title} · ${recipe.status} · v${recipe.version} `;use.textContent=recipe.status==='published'?'Use workflow':'Preview draft';use.onclick=()=>{selectTab(document.querySelector('#tab-guide'));const generation=++task,review=document.querySelector('#review'),form=document.createElement('form');review.replaceChildren();for(const name of [...new Set(recipe.steps.filter(s=>s.action==='fill').map(s=>s.parameter))]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=name.replaceAll('_',' ');input.name=name;input.required=true;input.maxLength=8000;label.append(input);form.append(label);}const prepare=document.createElement('button');prepare.textContent='Review workflow';form.append(prepare);form.onsubmit=event=>{event.preventDefault();recipeReview(recipe,Object.fromEntries(new FormData(form)),0,generation);};review.append(form);};item.append(use);list.append(item);}actionStatus.textContent=`${data.recipes.length} permitted workflows available.`;}catch(error){actionStatus.textContent=error.message;}};
let capturedFile=null,lastUpload=null,uploadOperation=null,previewUrl,reviewBlob;
let discoveryJob=null,discoveryEpoch=0,discoveryTimer;
const discoveryStatus=document.querySelector('#discovery-status'),discoverySelect=document.querySelector('#discovery-job');
function renderDiscovery(report){
 discoveryJob=report.id;discoveryStatus.textContent=`${report.status} · ${report.discovered} screens discovered · ${report.remaining} queued · ${(report.elapsedMs/1000).toFixed(1)}s. Discovered screens are not task-tested coverage.`;
 const list=document.querySelector('#discovery-nodes');list.replaceChildren();for(const node of report.nodes){const row=document.createElement('li');row.textContent=`${node.path} · ${node.fieldCount} fields · ${node.status}`;list.append(row);}for(const blocked of report.blocked){const row=document.createElement('li');row.textContent=`${blocked.path||''}: ${blocked.reason}${blocked.count?' ('+blocked.count+' controls)':''}`;list.append(row);}
}
async function discoveryTick(epoch){
 try{const result=await call('discovery-tick',{jobId:discoveryJob});if(epoch!==discoveryEpoch)return;if(result.report)renderDiscovery(result.report);if(result.paused){discoveryStatus.textContent=`Paused: ${result.reason||result.status}`;return;}if(!result.done&&result.report?.status==='running')discoveryTimer=setTimeout(()=>discoveryTick(epoch),300);}
 catch(error){if(epoch===discoveryEpoch)discoveryStatus.textContent=`Discovery paused: ${error.message}`;}
}
document.querySelector('#discovery-preview').onclick=async()=>{try{const result=await call('discovery-scope');document.querySelector('#discovery-paths').value=result.paths.join('\n');discoveryStatus.textContent=`${result.origin}: review ${result.paths.length} declared routes. ${result.blockedCount} unknown/effectful controls will not be clicked.`;}catch(error){discoveryStatus.textContent=error.message;}};
document.querySelector('#discovery-form').onsubmit=async event=>{event.preventDefault();try{clearTimeout(discoveryTimer);const paths=document.querySelector('#discovery-paths').value.split('\n').map(s=>s.trim()).filter(Boolean),report=await call('discovery-start',{paths,maxPages:Number(document.querySelector('#discovery-pages').value)});renderDiscovery(report);const option=document.createElement('option');option.value=report.id;option.textContent=`${report.id.slice(0,8)} · ${report.status}`;discoverySelect.append(option);discoverySelect.value=report.id;discoveryTick(++discoveryEpoch);}catch(error){discoveryStatus.textContent=error.message;}};
document.querySelector('#discovery-list').onclick=async()=>{try{const result=await call('discovery-list');discoverySelect.replaceChildren();for(const job of result.jobs){const option=document.createElement('option');option.value=job.id;option.textContent=`${job.id.slice(0,8)} · ${job.status} · ${job.discovered} screens`;discoverySelect.append(option);}discoveryStatus.textContent='Choose a paused job and Resume. Only sanitized discovery metadata continues; chat history is not restored.';}catch(error){discoveryStatus.textContent=error.message;}};
for(const operation of ['pause','resume','stop'])document.querySelector(`#discovery-${operation}`).onclick=async()=>{try{discoveryEpoch++;clearTimeout(discoveryTimer);const report=await call(`discovery-${operation}`,{jobId:discoverySelect.value||discoveryJob});renderDiscovery(report);if(operation==='resume')discoveryTick(discoveryEpoch);}catch(error){discoveryStatus.textContent=error.message;}};
window.addEventListener('pagehide',()=>{discoveryEpoch++;clearTimeout(discoveryTimer);},{once:true});
const uploadForm=document.querySelector('#upload-form'),uploadStatus=document.querySelector('#upload-status'),uploadRefresh=document.querySelector('#upload-refresh');
uploadForm.onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const file=capturedFile||document.querySelector('#upload-file').files[0],title=document.querySelector('#upload-title').value;if(!file)throw new Error('Choose a file first.');const fingerprint=`${file.name}:${file.size}:${file.lastModified}:${title}`;if(uploadOperation?.fingerprint!==fingerprint)uploadOperation={fingerprint,id:crypto.randomUUID()};const data=await encodeFile(file);lastUpload=await call('upload-document',{...data,title,sharedConsent:document.querySelector('#upload-consent').checked,operationId:uploadOperation.id});uploadStatus.textContent=`Upload accepted · ${lastUpload.status}. It is searchable only when Ready.`;uploadRefresh.hidden=false;}catch(error){uploadStatus.textContent=error.message;}finally{button.disabled=false;}};
uploadRefresh.onclick=async()=>{try{const result=await call('upload-status',{sourceId:lastUpload.id});uploadStatus.textContent=`Processing: ${result.status}${result.lastError?' · '+result.lastError:''}`;}catch(error){uploadStatus.textContent=error.message;}};
document.querySelector('#upload-file').onchange=()=>{capturedFile=null;uploadOperation=null;};
const capture=createScreenCapture({onChange:({state,blob})=>{reviewBlob=blob;document.querySelector('#capture-status').textContent=`Screen capture: ${state}. Nothing is uploaded automatically.`;document.querySelector('#capture-start').disabled=['requesting','recording','paused'].includes(state);document.querySelector('#capture-pause').disabled=!['recording','paused'].includes(state);document.querySelector('#capture-pause').textContent=state==='paused'?'Resume':'Pause';document.querySelector('#capture-stop').disabled=!['recording','paused'].includes(state);document.querySelector('#capture-discard').disabled=['idle','discarded'].includes(state);document.querySelector('#capture-use').hidden=!blob;const preview=document.querySelector('#capture-preview');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}preview.hidden=!blob;if(blob){previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;}else preview.removeAttribute('src');}});
document.querySelector('#capture-start').onclick=()=>capture.start().catch(error=>{document.querySelector('#capture-status').textContent=error.message;});
document.querySelector('#capture-pause').onclick=()=>capture.state()==='paused'?capture.resume():capture.pause();document.querySelector('#capture-stop').onclick=()=>capture.stop();document.querySelector('#capture-discard').onclick=()=>{capturedFile=null;capture.discard();};
document.querySelector('#capture-use').onclick=()=>{if(!reviewBlob)return;capturedFile=new File([reviewBlob],reviewBlob.type==='video/mp4'?'screen-recording.mp4':'screen-recording.webm',{type:reviewBlob.type});document.querySelector('#upload-title').value||='Screen recording';uploadStatus.textContent='Recording selected locally. Review the sharing checkbox, then Upload for processing.';uploadForm.scrollIntoView({block:'nearest'});};
window.addEventListener('pagehide',()=>{capture.discard();if(previewUrl)URL.revokeObjectURL(previewUrl);},{once:true});
try { const config=await call('config');applyTheme(config.theme);uploadForm.hidden=!config.capabilities?.upload;uploadStatus.textContent=config.capabilities?.upload?'Up to 16 MB; PDF/DOCX/text/HTML/PNG/JPEG and silent MP4/WebM.':'Visitor uploads are disabled. The website owner can add shared sources.';document.querySelector('#capture-use').disabled=!config.capabilities?.upload;const result = await call('history'); result.messages.forEach(message => show(message.text,message.channel||'guide',message.role,message.id)); }
catch(error) { status.textContent = error.message; }
