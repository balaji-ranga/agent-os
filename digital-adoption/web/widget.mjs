import { normalizeTheme, themeProperties } from './theme.mjs';
import {encodeFile} from './files.mjs';
import {createScreenCapture} from './screen-capture.mjs';
import {mountTaskPanel} from './task-panel.mjs';
import {createActionFeedback} from './action-feedback.mjs';
let currentTheme=normalizeTheme({}),initialTheme,assistanceMode='assist',sessionExpired=false;
function applyTheme(value) {
  const theme = normalizeTheme(value);
  currentTheme=theme;initialTheme||=theme;
  for (const [key,color] of Object.entries(themeProperties(theme))) document.documentElement.style.setProperty(key,color);
  document.querySelector('h1').textContent=theme.title;
}
applyTheme({});
const actionFeedback=createActionFeedback(document,{expired:()=>sessionExpired});
// The SDK supplies only the public parent origin, never credentials. Validate
// both the exact origin and parent WindowProxy for every message.
const pending = new Map();
const configuredParent = new URLSearchParams(location.hash.slice(1)).get('parentOrigin');
const parentOrigin = configuredParent && new URL(configuredParent).origin === configuredParent ? configuredParent : null;
function call(type, extra = {}) {
  if (!parentOrigin) return Promise.reject(new Error('Host origin unavailable'));
  return actionFeedback.track(new Promise((resolve,reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Host did not respond')); }, 60_000);
    pending.set(id, { resolve, reject, timeout });
    parent.postMessage({ channel: 'flolah-adoption-v1', id, type, ...extra }, parentOrigin);
  }));
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== 'flolah-adoption-v1') return;
  if(event.data.type==='private-event'){taskPanel.event(event.data.event);return;}
  if(event.data.type === 'theme') {try{applyTheme(event.data.theme);}catch{}return;}
  if(event.data.type === 'expired') {
    sessionExpired=true;document.querySelector('#inspection-result').replaceChildren();document.querySelector('#inspection-result').hidden=true;document.querySelector('#inspection-status').textContent='';
    capture.discard();
    for(const item of pending.values()){clearTimeout(item.timeout);item.reject(new Error('Session expired'));}pending.clear();
    document.querySelector('#review').replaceChildren();
    document.querySelector('#log').replaceChildren();document.querySelector('#knowledge-log').replaceChildren();
    document.querySelectorAll('input,textarea').forEach(field=>{field.value='';if(field.type==='checkbox')field.checked=false;field.disabled=true;});
    document.querySelectorAll('button,textarea').forEach(e=>{e.disabled=true;});
    document.querySelector('#status').textContent='Your session expired. Reload the host page to start a new empty conversation.';
    return;
  }
  const item = pending.get(event.data.id); if (!item) return;
  pending.delete(event.data.id); clearTimeout(item.timeout);
  event.data.error ? item.reject(new Error(event.data.error)) : item.resolve(event.data.result);
});
function showError(error){
 const banner=document.querySelector('#error-banner');document.querySelector('#error-message').textContent=error.message||String(error);banner.hidden=false;
 actionFeedback.report(error.message||String(error),true);banner.scrollIntoView({block:'nearest'});
}
document.querySelector('#error-dismiss').onclick=()=>{document.querySelector('#error-banner').hidden=true;};
const reviewObserver=new MutationObserver(()=>{const review=document.querySelector('#review');if(review.childElementCount){review.scrollIntoView({block:'nearest'});review.focus({preventScroll:true});}});
reviewObserver.observe(document.querySelector('#review'),{childList:true});
function coachingAvailability(config){
 const enabled=config.capabilities?.coach===true,canUpload=config.capabilities?.upload===true;
 document.querySelector('#knowledge-upload').hidden=!canUpload;document.querySelector('#upload-form').hidden=!canUpload;document.querySelector('#open-upload').disabled=!canUpload;document.querySelector('#capture-use').disabled=!canUpload;
 const actionsTab=document.querySelector('#tab-actions');actionsTab.hidden=!enabled;
 if(!enabled&&actionsTab.getAttribute('aria-selected')==='true')selectTab(document.querySelector('#tab-guide'));
 document.querySelector('#map-access').textContent=enabled?'Owner coaching enabled. Choose public read-only pages to map.':'Website mapping and page inspection require owner coaching access.';
 document.querySelector('#map-enable-coaching').hidden=enabled;
 for(const id of ['discovery-preview','discovery-paths','discovery-pages'])document.getElementById(id).disabled=!enabled;
 document.querySelector('#discovery-form button').disabled=!enabled;document.querySelector('#discovery-list').disabled=!enabled;if(!enabled||!lastMapReport)for(const id of ['discovery-pause','discovery-resume','discovery-stop','discovery-extend'])document.getElementById(id).disabled=true;else renderDiscovery(lastMapReport);
}
document.querySelector('#map-enable-coaching').onclick=()=>{document.querySelector('#settings-open').click();document.querySelector('#coaching-form').closest('details').open=true;document.querySelector('#coaching-code').focus();};
const status = document.querySelector('#status'), log = document.querySelector('#log'),knowledgeLog=document.querySelector('#knowledge-log'),knowledgeStatus=document.querySelector('#knowledge-status'),actionStatus=document.querySelector('#action-status');
const tabs=[...document.querySelectorAll('[role="tab"]')];
function selectTab(tab){if(tab.hidden)return;for(const item of tabs){const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=!selected;}}
for(const [index,tab] of tabs.entries()){
 tab.onclick=()=>selectTab(tab);
 tab.onkeydown=event=>{const visibleTabs=tabs.filter(item=>!item.hidden),current=visibleTabs.indexOf(tab);let next;if(event.key==='ArrowRight')next=(current+1)%visibleTabs.length;else if(event.key==='ArrowLeft')next=(current+visibleTabs.length-1)%visibleTabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=visibleTabs.length-1;else return;event.preventDefault();selectTab(visibleTabs[next]);visibleTabs[next].focus();};
}
document.querySelector('#minimize').onclick=()=>call('minimize').catch(error=>{showError(error);});
const settings=document.querySelector('#settings'),appearance=document.querySelector('#appearance'),settingsStatus=document.querySelector('#settings-status');
function loadAppearance(){for(const key of ['primary','background','foreground','fontSize','radius'])appearance.elements.namedItem(key).value=currentTheme[key];}
document.querySelector('#settings-open').onclick=()=>{loadAppearance();settings.showModal();};
document.querySelector('#settings-close').onclick=()=>settings.close();
appearance.onsubmit=async event=>{event.preventDefault();try{const data=new FormData(appearance),patch={};for(const key of ['primary','background','foreground'])patch[key]=data.get(key);for(const key of ['fontSize','radius'])patch[key]=Number(data.get(key));const result=await call('appearance',{theme:patch});applyTheme(result.theme);settingsStatus.textContent='Appearance updated for this session.';}catch(error){showError(error);}};
document.querySelector('#theme-reset').onclick=async()=>{try{const result=await call('appearance-reset');applyTheme(result.theme);loadAppearance();settingsStatus.textContent='Website theme restored.';}catch(error){showError(error);}};
document.querySelector('#coaching-form').onsubmit=async event=>{event.preventDefault();const field=document.querySelector('#coaching-code');try{const result=await call('coaching-exchange',{code:field.value});field.value='';document.querySelector('#upload-form').hidden=!result.capabilities?.upload;document.querySelector('#capture-use').disabled=!result.capabilities?.upload;coachingAvailability(result);document.querySelector('#coaching-status').textContent=`Coaching enabled until ${new Date(result.coachingUntil).toLocaleTimeString()}. Use Actions → Current page → Inspect form and page on each workflow screen.`;}catch(error){field.value='';document.querySelector('#coaching-status').textContent=error.message;}};
document.querySelector('#assistance-mode').onchange=async event=>{assistanceMode=event.target.value;task++;document.querySelector('#stop').hidden=true;document.querySelector('#save-review').hidden=true;document.querySelector('#review').replaceChildren();await call('cancel');settingsStatus.textContent=assistanceMode==='guide'?'Guide mode highlights fields without changing values.':'Assist mode prepares changes for your approval.';};
const replies={guide:null,knowledge:null};
document.querySelector('#save-review').onclick=async()=>{
 const generation=++task,review=document.querySelector('#review');review.replaceChildren();
 try{
  const proposal=await call('save-review',{mode:assistanceMode});if(generation!==task)return;
  const warning=document.createElement('p');warning.textContent=proposal.message;review.append(warning);
  let learningConsent; if(verifiedLearningAvailable){const label=document.createElement('label');learningConsent=document.createElement('input');learningConsent.type='checkbox';label.append(learningConsent,document.createTextNode(' After a verified save, share the workflow structure for owner review. Field values and chat are excluded.'));review.append(label);}
  const confirm=document.createElement('button');confirm.textContent=`Confirm ${proposal.actions[0].label} now`;review.append(confirm);
  const reject=document.createElement('button');reject.textContent='Cancel save';reject.onclick=async()=>{try{await call('reject',{proposalId:proposal.id});task++;review.replaceChildren();status.textContent='Save cancelled.';}catch(error){showError(error);}};review.append(reject);
  confirm.onclick=async()=>{confirm.disabled=true;try{if(generation!==task)return;const result=await call('approve',{proposalId:proposal.id,learningConsent:learningConsent?.checked===true});if(generation!==task)return;review.replaceChildren();const outcome=result.results[0];status.textContent=outcome.hostReported==='success'?`Host reported success: ${outcome.message} Verify the saved record; no retry was attempted.`:outcome.hostReported==='failure'?`Host reported a failure: ${outcome.message}`:outcome.reason||'Submission outcome is unverified. Inspect the host before retrying.';if(result.learning)status.textContent+=result.learning.created?' A parameterized draft was saved for owner review.':` No workflow was learned: ${result.learning.reason||'learning disabled'}.`;}catch(error){if(generation===task)showError(error);}};
 }catch(error){showError(error);}
};
const clearChat=document.createElement('button');clearChat.type='button';clearChat.textContent='Clear this conversation';settings.append(clearChat);
clearChat.onclick=async()=>{if(!confirm('Clear both chat tabs in this session? Shared website knowledge and website fields will not be deleted.'))return;try{task++;await call('clear-history');log.replaceChildren();knowledgeLog.replaceChildren();document.querySelector('#review').replaceChildren();for(const channel of ['guide','knowledge']){replies[channel]=null;replyHints[channel].hidden=true;}settingsStatus.textContent='Conversation cleared. Shared knowledge is unchanged.';}catch(error){showError(error);}};
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
  const button=event.submitter||document.querySelector('#chat button[type=submit]');if(button.disabled)return;button.disabled=true;
  try {
    show(field.value,'knowledge','user');knowledgeStatus.textContent='Searching this website’s approved knowledge…';
    const result = await call('ask', { text: field.value,replyTo:replies.knowledge }); show(result.message,'knowledge','assistant',result.messageId); field.value = '';replies.knowledge=null;replyHints.knowledge.hidden=true;
    for(const evidence of result.citations||[]){const details=document.createElement('details'),summary=document.createElement('summary'),excerpt=document.createElement('p');summary.textContent=`${evidence.title}${evidence.locator?' · '+evidence.locator:''} · ${evidence.revision?.slice(0,8)||'private task'}`;excerpt.textContent=evidence.text;details.append(summary,excerpt);if(evidence.url?.startsWith('https://')){const link=document.createElement('a');link.href=evidence.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open source';details.append(link);}knowledgeLog.append(details);}
    knowledgeStatus.textContent=result.privateTaskId?'Answered from your private task files. End task deletes this context.':result.kind==='greeting'?'Ready for your knowledge question.':result.kind==='no_evidence'?'No matching evidence found. No page inspection was performed.':'Answered from this embedding’s knowledge. No page inspection was performed.';
  }
  catch(error) { showError(error); }
  finally{button.disabled=false;}
});
let task=0;
let verifiedLearningAvailable=false;
function remainingGuidance(result,generation,onComplete=()=>{}){
 const review=document.querySelector('#review');review.replaceChildren();status.textContent=`Showing ${result.label||'the selected field'}. No values changed. ${result.guideRemaining||0} more fields.`;
 if(result.guideRemaining){const next=document.createElement('button');next.textContent='Show next field';review.append(next);next.onclick=async()=>{next.disabled=true;try{if(generation!==task)return;const observed=await call('guide-next');if(generation!==task)return;remainingGuidance(observed,generation,onComplete);}catch(error){status.textContent=`Guidance paused: ${error.message}`;}};}else onComplete();
}
document.querySelector('#stop').onclick=async()=>{task++;document.querySelector('#plan').disabled=false;document.querySelector('#stop').hidden=true;document.querySelector('#save-review').hidden=true;document.querySelector('#review').replaceChildren();await call('cancel');status.textContent='Stopped. Completed changes remain; no further action will run.';};
async function prepare(text,generation,depth=0){
  const button=document.querySelector('#plan'), review=document.querySelector('#review');
  document.querySelector('#stop').hidden=false;document.querySelector('#save-review').hidden=true;
  button.disabled=true; review.replaceChildren();
  try {
    if(depth>3)throw new Error('Navigation limit reached. Please inspect the page and clarify the next step.');
    status.textContent='Inspecting the current page and preparing your review…';
    const proposal=await call('plan',{ text,replyTo:depth===0?replies.guide:null,mode:assistanceMode });
    if(generation!==task)return;
    show(proposal.message,'guide','assistant',proposal.messageId);replies.guide=null;replyHints.guide.hidden=true;
    status.textContent=proposal.actions.length?'Review the proposed next step.':'';
    if(proposal.manualNotice){const note=document.createElement('p');note.textContent=proposal.manualNotice;review.append(note);}
    if(proposal.evidence?.length){const source=document.createElement('p');source.textContent='Private sources: '+proposal.evidence.map(e=>e.filename+' · '+e.locator).join('; ');review.append(source);}
    for(const action of proposal.actions){const p=document.createElement('p');p.textContent=action.type==='navigate'?`Open ${action.label} (${action.path})`:action.type==='highlight'?`Show ${action.label}`:`${action.label}: ${action.value}`;review.append(p);}
    if(proposal.actions.length){
      const warning=document.createElement('p');warning.textContent=assistanceMode==='guide'?'Guidance only. No field values will change.':'Review before filling. Some websites autosave fields. This does not click Save.';review.append(warning);
      const approve=document.createElement('button');approve.textContent=proposal.actions[0].type==='navigate'?'Approve navigation':assistanceMode==='guide'?'Show guidance':'Approve field changes';review.append(approve);
      const reject=document.createElement('button');reject.type='button';reject.textContent='Reject changes';reject.onclick=async()=>{try{await call('reject',{proposalId:proposal.id});task++;review.replaceChildren();document.querySelector('#stop').hidden=true;status.textContent='Changes rejected. Nothing was applied.';}catch(error){showError(error);}};review.append(reject);
      approve.addEventListener('click',async()=>{
        approve.disabled=true;document.querySelector('#stop').hidden=false;
        try {
          if(generation!==task)return;
          const result=await call('approve',{proposalId:proposal.id});if(generation!==task)return;
          review.replaceChildren();
          if(result.results.every(r=>r.highlighted)){remainingGuidance(result,generation);return;}
          if(result.results.some(r=>r.navigated&&r.verified)){status.textContent='Navigation verified. Continuing your original task…';await prepare(text,generation,depth+1);}
          else {document.querySelector('#save-review').hidden=assistanceMode==='guide'||!result.results.every(r=>r.valueObserved);status.textContent=result.results.every(r=>r.highlighted)?'Guidance shown. No field values were changed.':result.results.every(r=>r.valueObserved)?`${result.results.length} approved field values verified in the form. Save was not clicked.`:'A field did not retain its value. Check the form; no retry was attempted.';}
        }
        catch(error){if(generation===task)showError(error);}finally{if(generation===task)document.querySelector('#stop').hidden=true;}
      },{once:true});
    }
  }catch(error){if(generation===task)showError(error);}finally{if(generation===task){button.disabled=false;document.querySelector('#stop').hidden=true;}}
}
document.querySelector('#guide-chat').addEventListener('submit',async event=>{event.preventDefault();if(document.querySelector('#plan').disabled)return;const text=document.querySelector('#message').value;show(text,'guide','user');document.querySelector('#message').value='';try{if(await taskPanel.sendIfMention(text))return;}catch(error){showError(error);return;}if(/^(?:please\s+)?(?:save|submit)(?:\s+(?:this|the)\s+(?:form|record|draft))?[.!]?$/i.test(text.trim())){document.querySelector('#save-review').onclick();}else prepare(text,++task);});
document.querySelector('#inspect').addEventListener('click', async () => {
  const button=document.querySelector('#inspect'),progress=document.querySelector('#inspection-status'),output=document.querySelector('#inspection-result');
  button.disabled=true;button.textContent='Inspecting…';progress.textContent='Inspecting this page and saving its screen map…';output.replaceChildren();output.hidden=true;
  try {
    const result=await call('inspect');if(sessionExpired)return;
    const inventory=result.inventory||result,fields=inventory.fields||[],forms=inventory.forms||[],links=inventory.links||[];
    const text=(tag,value)=>{const item=document.createElement(tag);item.textContent=value;output.append(item);return item;};
    text('h2',`Page: ${result.path}`);
    text('p',`${forms.length} forms · ${fields.length} fields in loaded page structure · ${links.length} same-website navigation links. ${result.fields.length} fields currently support reviewed filling; ${result.links.length} navigation links currently support reviewed execution.`);
    text('p',result.learning?'This page was saved in this website’s screen map. It is observed, not task-tested.':'This page was inspected; no shared screen map was saved.');
    const list=(heading,items,empty)=>{text('h2',heading);if(!items.length){text('p',empty);return;}const ul=text('ul','');for(const value of items){const li=document.createElement('li');li.textContent=value;ul.append(li);}};
    list('Forms',forms.map(form=>`${form.label||form.key} · ${form.fields?.length||0} named fields`),'No forms found in the loaded page.');
    list('Fields',fields.map(field=>`${field.label||field.key||'Unlabelled field'} · ${field.type}${field.required?' · required':''}${field.form?' · form '+field.form:''}${field.visible===false?' · hidden in page':''}${field.editable===false?' · requires manual handling':''}`),'No inspectable fields found. Open the form on the website, then inspect again.');
    list('Navigation',links.map(link=>`${link.label||link.path} → ${link.path}${link.visible===false?' · hidden in page':''}`),'No same-website navigation links found.');
    if(result.coverage?.manualNotice)text('p',result.coverage.manualNotice);
    text('p',`Field values were excluded. ${inventory.truncated?'The inventory reached its limits. ':''}Only this loaded page was inspected. Use Website map to discover other approved pages. Unloaded states and inaccessible frames require separate inspection.`);
    progress.textContent='Inspection complete. No fields were changed and no forms were submitted.';output.hidden=false;output.scrollIntoView({block:'start'});output.focus({preventScroll:true});
  }catch(error){progress.textContent='Inspection failed. No page changes were made. Try again after resolving the error below.';showError(error);progress.scrollIntoView({block:'nearest'});}
  finally{button.disabled=sessionExpired;button.textContent='Inspect form and page';}
});
document.querySelector('#documents').onclick=async()=>{try{const result=await call('documents'),list=document.querySelector('#document-list');list.replaceChildren();for(const source of result.sources){const item=document.createElement('li');item.textContent=`${source.title} · ${source.status}`;list.append(item);}actionStatus.textContent=`${result.sources.length} authorized ready sources shown (up to 100).`;}catch(error){showError(error);}};
let recordingState='idle';
let teachingAttempt;
document.querySelector('#record-save-draft').onclick=async()=>{
 const button=document.querySelector('#record-save-draft');button.disabled=true;let saved=false;
 try{const title=document.querySelector('#record-title').value;if(!title.trim())throw new Error('Name this teaching workflow first.');if(teachingAttempt?.title!==title)teachingAttempt={title,id:crypto.randomUUID()};const result=await call('record-draft',{title,operationId:teachingAttempt.id});saved=true;document.querySelector('#record-title').value=result.title;actionStatus.textContent=`Teaching draft saved · version ${result.version}. Validate current screen mappings and review publication in the owner console.`;recordStatus.textContent=actionStatus.textContent;}
 catch(error){recordStatus.textContent='Teaching draft save was not confirmed. Retry when access and service are available.';showError(error);}
 finally{button.disabled=saved||sessionExpired;}
};
const replayButton=document.querySelector('#replay-navigation');
const recordStatus=document.querySelector('#record-status');
replayButton.onclick=async()=>{replayButton.disabled=true;try{actionStatus.textContent='Replaying reviewed navigation…';const result=await call('replay-navigation',{approved:true});actionStatus.textContent=`${result.results.length} recorded navigation steps reached their verified destinations.`;}catch(error){showError(error);}finally{replayButton.disabled=false;}};
async function record(operation){
 for(const id of ['record-start','record-pause','record-stop'])document.getElementById(id).disabled=true;
 actionStatus.textContent=`${operation==='start'?'Starting':operation==='stop'?'Finishing':'Updating'} recording… wait for confirmation before continuing.`;
 recordStatus.textContent=actionStatus.textContent;
 try{
  const result=await call(`record-${operation}`,{title:document.querySelector('#record-title').value});recordingState=result.state;
  if(operation==='start'){teachingAttempt=null;document.querySelector('#record-save-draft').disabled=false;}
  document.querySelector('#record-start').disabled=['recording','paused'].includes(recordingState);
  document.querySelector('#record-pause').disabled=!['recording','paused'].includes(recordingState);
  document.querySelector('#record-pause').textContent=recordingState==='paused'?'Resume recording':'Pause recording';
  document.querySelector('#record-stop').disabled=!['recording','paused'].includes(recordingState);
  actionStatus.textContent=`Action recording: ${recordingState}. No entered values captured.`;
  if(result.title){document.querySelector('#record-title').value=result.title;document.querySelector('#record-title').readOnly=['recording','paused'].includes(recordingState);}
  if(result.savedDraft){document.querySelector('#record-save-draft').disabled=true;actionStatus.textContent+=` Teaching draft saved on this website as “${result.savedDraft.title}”. It is available to owner planning across sessions; visitors require validated publication.`;}
  if(result.persistenceError){actionStatus.textContent+=' Teaching draft was not saved. Use Save teaching draft to retry.';showError(new Error(result.persistenceError));}
  if(result.mapError)showError(new Error(`Screen map was not saved: ${result.mapError}`));
  recordStatus.textContent=actionStatus.textContent;
  replayButton.hidden=operation!=='stop'||!result.steps.length||result.steps.some(step=>step.action!=='navigate');
  if(operation==='stop')document.querySelector('#record-review').textContent=result.steps.map((s,i)=>`${i+1}. ${s.action} ${s.path}${s.parameter?' · parameter '+s.parameter:''}${s.activation?' · '+s.activation+' profile':''}`).join('\n')||'No supported actions recorded.';
 }catch(error){showError(error);document.querySelector('#record-start').disabled=['recording','paused'].includes(recordingState);document.querySelector('#record-pause').disabled=!['recording','paused'].includes(recordingState);document.querySelector('#record-stop').disabled=!['recording','paused'].includes(recordingState);}
}
document.querySelector('#record-start').onclick=()=>record('start');document.querySelector('#record-pause').onclick=()=>record(recordingState==='paused'?'resume':'pause');document.querySelector('#record-stop').onclick=()=>record('stop');
document.querySelector('#record-export').onsubmit=async event=>{event.preventDefault();try{const pack=await call('record-package',{title:document.querySelector('#record-title').value}),url=URL.createObjectURL(new Blob([JSON.stringify(pack,null,2)],{type:'application/json'})),anchor=document.createElement('a');anchor.href=url;anchor.download='flolah-workflow-draft.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);actionStatus.textContent='Parameterized draft downloaded. Import it in the owner console for validation and publication.';}catch(error){showError(error);}};
async function recipeReview(recipe,parameters,step,generation){
 const review=document.querySelector('#review');review.replaceChildren();
 try{
  const proposal=await call('recipe-plan',{recipeId:recipe.id,version:recipe.version,parameters,step,mode:assistanceMode});
  if(generation!==task)return;
  show(`${recipe.title} · version ${recipe.version}: ${proposal.message}`);
  status.textContent=proposal.complete?(assistanceMode==='guide'?'Recorded guidance finished. No fields were filled.':'Recorded draft steps verified. Saving remains a separate action.'):'Review the next recorded step.';
  for(const action of proposal.actions){const line=document.createElement('p');line.textContent=action.type==='navigate'?`Open ${action.label}${action.activation?` · ${action.activation} profile`:``}`:action.type==='highlight'?`Show ${action.label}`:`${action.label}: ${action.value}`;review.append(line);}
  if(proposal.actions.length){
   const approve=document.createElement('button');approve.textContent=assistanceMode==='guide'?'Show recorded guidance':'Approve recorded step';review.append(approve);
   const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel workflow';cancel.onclick=async()=>{try{await call('reject',{proposalId:proposal.id});task++;review.replaceChildren();status.textContent='Recorded workflow cancelled.';}catch(error){showError(error);}};review.append(cancel);
   approve.onclick=async()=>{
    approve.disabled=true;
    try{
     const result=await call('approve',{proposalId:proposal.id});if(generation!==task)return;
     if(!result.results.every(r=>r.valueObserved||r.highlighted||r.navigated&&r.verified))throw new Error('The recorded step was not verified. Replay paused.');
     if(result.results.every(r=>r.highlighted)){remainingGuidance(result,generation,()=>recipeReview(recipe,parameters,proposal.nextStep,generation));return;}
     await recipeReview(recipe,parameters,proposal.nextStep,generation);
    }catch(error){showError(error);}
   };
  }
 }
 catch(error){status.textContent=`Workflow paused: ${error.message}`;}
}
document.querySelector('#recipes-refresh').onclick=async()=>{try{const data=await call('recipes'),list=document.querySelector('#recipe-list');list.replaceChildren();for(const recipe of data.recipes){const item=document.createElement('li'),use=document.createElement('button');item.textContent=`${recipe.title} · ${recipe.status} · v${recipe.version} `;use.textContent=recipe.status==='published'?'Use workflow':'Preview draft';use.onclick=()=>{selectTab(document.querySelector('#tab-guide'));const generation=++task,review=document.querySelector('#review'),form=document.createElement('form');review.replaceChildren();for(const name of [...new Set(recipe.steps.filter(s=>s.action==='fill').map(s=>s.parameter))]){const label=document.createElement('label'),input=document.createElement('input');label.textContent=name.replaceAll('_',' ');input.name=name;input.required=true;input.maxLength=8000;label.append(input);form.append(label);}const prepare=document.createElement('button');prepare.textContent='Review workflow';form.append(prepare);form.onsubmit=event=>{event.preventDefault();recipeReview(recipe,Object.fromEntries(new FormData(form)),0,generation);};review.append(form);};item.append(use);list.append(item);}actionStatus.textContent=`${data.recipes.length} permitted workflows available.`;}catch(error){showError(error);}};
let capturedFile=null,lastUpload=null,uploadOperation=null,previewUrl,reviewBlob;
let discoveryJob=null,discoveryEpoch=0,discoveryTimer,lastMapReport;
const discoveryStatus=document.querySelector('#discovery-status'),discoverySelect=document.querySelector('#discovery-job');
function renderDiscovery(report){
 lastMapReport=report;document.querySelector('#discovery-export').disabled=false;document.querySelector('#discovery-pause').disabled=report.status!=='running';document.querySelector('#discovery-resume').disabled=report.status!=='paused';document.querySelector('#discovery-stop').disabled=!['running','paused'].includes(report.status);document.querySelector('#discovery-extend').disabled=report.status!=='paused';discoveryJob=report.id;discoveryStatus.textContent=`${report.status} · ${report.discovered} screens discovered · ${report.unobservedPaths?.length||0} approved pages not observed · ${report.remaining} queued · ${(report.elapsedMs/1000).toFixed(1)}s. DOM inventory includes hidden native forms without opening them (up to 500 fields and 100 navigation links per page). Execution still requires visible supported controls and fresh review. Unloaded states, private controls, embedded content and excluded routes need further inspection. This is not task-tested coverage.`;
 const list=document.querySelector('#discovery-nodes');list.replaceChildren();for(const node of report.nodes){const row=document.createElement('li');row.textContent=`${node.path} · ${node.inventory?.forms.length??node.formCount??0} DOM forms · ${node.inventory?.fields.length??node.fieldCount} DOM fields (${node.fieldCount} available now) · ${node.inventory?.links.length??node.navigationCount??0} navigation links${node.inventory?.truncated?' · inventory limit reached':''} · ${node.status}`;const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=row.textContent;details.append(summary);for(const field of node.inventory?.fields||node.fields||[]){const line=document.createElement('p');line.textContent=`${field.form||'Ungrouped'} · ${field.label||field.key} · ${field.type}${field.required?' · required':''}${field.visible===false?' · hidden; manual reveal required':''}${field.editable===false?' · read-only or disabled':''}`;details.append(line);}for(const link of node.inventory?.links||node.navigation||[]){const line=document.createElement('p');line.textContent=`${link.label} → ${link.path}`;details.append(line);}row.replaceChildren(details);list.append(row);}for(const blocked of report.blocked){const row=document.createElement('li');row.textContent=`${blocked.path||''}: ${blocked.reason}${blocked.count?' ('+blocked.count+' controls)':''}`;list.append(row);}
}
async function discoveryTick(epoch){
 try{const result=await call('discovery-tick',{jobId:discoveryJob});if(epoch!==discoveryEpoch)return;if(result.report)renderDiscovery(result.report);if(result.paused){discoveryStatus.textContent=`Paused: ${result.reason||result.status}`;return;}if(!result.done&&result.report?.status==='running')discoveryTimer=setTimeout(()=>discoveryTick(epoch),300);}
 catch(error){if(epoch===discoveryEpoch)discoveryStatus.textContent=`Discovery paused: ${error.message}`;}
}
document.querySelector('#discovery-preview').onclick=async()=>{try{const result=await call('discovery-scope');document.querySelector('#discovery-paths').value=result.paths.join('\n');discoveryStatus.textContent=`${result.origin}: review ${result.paths.length} candidate routes. Approve only known read-only destinations. ${result.blockedCount} unknown/effectful controls will not be clicked.`;}catch(error){showError(error);}};
document.querySelector('#discovery-form').onsubmit=async event=>{event.preventDefault();try{clearTimeout(discoveryTimer);const paths=document.querySelector('#discovery-paths').value.split('\n').map(s=>s.trim()).filter(Boolean),report=await call('discovery-start',{paths,maxPages:Number(document.querySelector('#discovery-pages').value)});renderDiscovery(report);const option=document.createElement('option');option.value=report.id;option.textContent=`${report.id.slice(0,8)} · ${report.status}`;discoverySelect.append(option);discoverySelect.value=report.id;discoveryTick(++discoveryEpoch);}catch(error){discoveryStatus.textContent=`Could not start mapping: ${error.message}`;showError(error);}};
document.querySelector('#discovery-list').onclick=async()=>{try{const result=await call('discovery-list');discoverySelect.replaceChildren();for(const job of result.jobs){const option=document.createElement('option');option.value=job.id;option.textContent=`${job.id.slice(0,8)} · ${job.status} · ${job.discovered} screens`;discoverySelect.append(option);}if(result.jobs.length)renderDiscovery(result.jobs[0]);discoveryStatus.textContent='Choose a paused job and Resume. Only sanitized discovery metadata continues; chat history is not restored.';}catch(error){showError(error);}};
for(const operation of ['pause','resume','stop'])document.querySelector(`#discovery-${operation}`).onclick=async()=>{try{discoveryEpoch++;clearTimeout(discoveryTimer);const report=await call(`discovery-${operation}`,{jobId:discoverySelect.value||discoveryJob});renderDiscovery(report);if(operation==='resume')discoveryTick(discoveryEpoch);}catch(error){showError(error);}};
window.addEventListener('pagehide',()=>{discoveryEpoch++;clearTimeout(discoveryTimer);},{once:true});
const uploadForm=document.querySelector('#upload-form'),uploadStatus=document.querySelector('#upload-status'),uploadRefresh=document.querySelector('#upload-refresh');
function openUpload(){selectTab(document.querySelector('#tab-knowledge'));document.querySelector('#knowledge-upload').open=true;uploadForm.scrollIntoView({block:'nearest'});}
document.querySelector('#open-upload').onclick=openUpload;
uploadForm.onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const file=capturedFile||document.querySelector('#upload-file').files[0],title=document.querySelector('#upload-title').value;if(!file)throw new Error('Choose a file first.');const fingerprint=`${file.name}:${file.size}:${file.lastModified}:${title}`;if(uploadOperation?.fingerprint!==fingerprint)uploadOperation={fingerprint,id:crypto.randomUUID()};const data=await encodeFile(file);lastUpload=await call('upload-document',{...data,title,sharedConsent:document.querySelector('#upload-consent').checked,operationId:uploadOperation.id});uploadStatus.textContent=`Upload accepted · ${lastUpload.status}. It is searchable only when Ready.`;uploadRefresh.hidden=false;}catch(error){showError(error);}finally{button.disabled=false;}};
uploadRefresh.onclick=async()=>{try{const result=await call('upload-status',{sourceId:lastUpload.id});uploadStatus.textContent=`Processing: ${result.status}${result.lastError?' · '+result.lastError:''}`;}catch(error){showError(error);}};
document.querySelector('#upload-file').onchange=()=>{capturedFile=null;uploadOperation=null;};
const capture=createScreenCapture({onChange:({state,blob})=>{reviewBlob=blob;document.querySelector('#capture-status').textContent=`Screen capture: ${state}. Nothing is uploaded automatically.`;document.querySelector('#capture-start').disabled=['requesting','recording','paused'].includes(state);document.querySelector('#capture-pause').disabled=!['recording','paused'].includes(state);document.querySelector('#capture-pause').textContent=state==='paused'?'Resume':'Pause';document.querySelector('#capture-stop').disabled=!['recording','paused'].includes(state);document.querySelector('#capture-discard').disabled=['idle','discarded'].includes(state);document.querySelector('#capture-use').hidden=!blob;const preview=document.querySelector('#capture-preview');if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}preview.hidden=!blob;if(blob){previewUrl=URL.createObjectURL(blob);preview.src=previewUrl;}else preview.removeAttribute('src');}});
document.querySelector('#capture-start').onclick=()=>capture.start({audio:document.querySelector('#capture-audio').checked}).catch(error=>{document.querySelector('#capture-status').textContent=error.message;});
document.querySelector('#capture-pause').onclick=()=>capture.state()==='paused'?capture.resume():capture.pause();document.querySelector('#capture-stop').onclick=()=>capture.stop();document.querySelector('#capture-discard').onclick=()=>{capturedFile=null;capture.discard();};
document.querySelector('#capture-use').onclick=()=>{if(!reviewBlob)return;capturedFile=new File([reviewBlob],reviewBlob.type==='video/mp4'?'screen-recording.mp4':'screen-recording.webm',{type:reviewBlob.type});document.querySelector('#upload-title').value||='Screen recording';uploadStatus.textContent='Recording selected locally. Review the sharing checkbox, then Upload for processing.';openUpload();};
window.addEventListener('pagehide',()=>{capture.discard();if(previewUrl)URL.revokeObjectURL(previewUrl);},{once:true});
const taskPanel=mountTaskPanel({call,showError,show,isExpired:()=>sessionExpired,clearPrivate(){task++;log.replaceChildren();knowledgeLog.replaceChildren();document.querySelector('#knowledge-message').value='';knowledgeStatus.textContent='';document.querySelector('#review').replaceChildren();document.querySelector('#message').value='';document.querySelector('#save-review').hidden=true;for(const key of ['guide','knowledge']){replies[key]=null;replyHints[key].hidden=true;}}});
try { const config=await call('config');taskPanel.configure(config);applyTheme(config.theme);coachingAvailability(config);verifiedLearningAvailable=config.learningEnabled===true&&config.canVerifyOutcome===true;uploadForm.hidden=!config.capabilities?.upload;uploadStatus.textContent=config.capabilities?.upload?'Up to 16 MB; PDF/DOCX/text/HTML/PNG/JPEG and MP4/WebM (English audio transcription).':'Visitor uploads are disabled. The website owner can add shared sources.';document.querySelector('#capture-use').disabled=!config.capabilities?.upload;const result = await call('history'); result.messages.forEach(message => show(message.text,message.channel||'guide',message.role,message.id)); }
catch(error) { showError(error); }

document.querySelector('#discovery-extend').onclick=async()=>{try{const paths=document.querySelector('#discovery-paths').value.split('\n').map(s=>s.trim()).filter(Boolean);renderDiscovery(await call('discovery-extend',{jobId:discoverySelect.value||discoveryJob,paths}));}catch(error){showError(error);}};
document.querySelector('#discovery-export').onclick=()=>{if(!lastMapReport)return;const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(lastMapReport,null,2)],{type:'application/json'}));link.href=url;link.download='website-map.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

const accessTimer=setInterval(async()=>{try{coachingAvailability(await call('access'));}catch{coachingAvailability({});}},30000);
window.addEventListener('pagehide',()=>clearInterval(accessTimer),{once:true});

discoverySelect.onchange=async()=>{try{renderDiscovery(await call('discovery-report',{jobId:discoverySelect.value}));}catch(error){showError(error);}};
