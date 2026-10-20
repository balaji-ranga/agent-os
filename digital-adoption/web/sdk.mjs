import {newlyAvailableFields} from './dependent-controls.mjs';
import {createTaskController} from './task-controller.mjs';
import {createVisitorAnalytics} from './visitor-analytics.mjs';
import {observePage} from './page-observer.mjs';
import { createInspector } from './dom.mjs';
import { normalizeTheme } from './theme.mjs';
import { createSessionClient } from './session-client.mjs';
import {createRecorder,replayNavigation} from './recording.mjs';
import {recordedPackage} from './learning-package.mjs';
import {createTaskClient} from './task-client.mjs';

export async function mount(options) {
  const {serviceUrl,installationToken,theme={},getHostIdentity,getVerifiedOutcome,bindVerifiedSave,getActionOutcome}=options;
  const layout=options.layout||'floating',dockTarget=options.dockTarget;
  if(!['floating','docked'].includes(layout)||layout==='docked'&&(!(dockTarget instanceof HTMLElement)||!dockTarget.isConnected||dockTarget.ownerDocument!==document))throw new Error('Docked layout requires an explicit connected host container');
  let expanded=false;
  if(window.frameElement?.dataset.adoptionObservation==='true')return {updateTheme(){},async destroy(){}};
  let appearance = normalizeTheme(theme);
  let hostAppearance=appearance;
  const service = new URL(serviceUrl);
  if (service.username || service.password || service.search || service.hash || !service.pathname.endsWith('/')) throw new Error('Service base URL must end with /');
  if (service.protocol !== 'https:' && !(service.protocol === 'http:' && ['127.0.0.1','localhost'].includes(service.hostname))) throw new Error('HTTPS required');
  let closed = false;
  const client=createSessionClient({service});
  const request=(path,data)=>client.request(path,data);
  if(getHostIdentity!==undefined&&typeof getHostIdentity!=='function')throw new Error('Host identity must be a backend token callback');
  if(getVerifiedOutcome!==undefined&&typeof getVerifiedOutcome!=='function')throw new Error('Verified outcome must be a backend receipt callback');
  if(bindVerifiedSave!==undefined&&typeof bindVerifiedSave!=='function')throw new Error('Save binding must be a backend callback');
  const readHostIdentity=async()=>{if(!getHostIdentity)return undefined;const identity=await getHostIdentity();if(typeof identity!=='string'||!identity)throw new Error('Host sign-in is required. Start a new copilot session after signing in.');return identity;};
  const bootstrapButton=document.createElement('button');bootstrapButton.dataset.adoptionWidget='true';bootstrapButton.type='button';bootstrapButton.textContent='Connecting copilot…';bootstrapButton.setAttribute('aria-label','Copilot connection status');bootstrapButton.disabled=true;bootstrapButton.style.cssText='position:fixed;bottom:20px;right:20px;z-index:2147483646;padding:12px;border-radius:12px';if(options.externalConnectionStatus!==true)document.body.append(bootstrapButton);
  let bootstrap;
  try{bootstrap=await request('/v1/sessions',{installationToken,identityToken:await readHostIdentity()});bootstrapButton.remove();}
  catch(error){client.stop();bootstrapButton.disabled=false;bootstrapButton.textContent='Reconnect copilot';bootstrapButton.title=error.message;bootstrapButton.onclick=async()=>{bootstrapButton.disabled=true;try{await mount({...options,externalConnectionStatus:true});bootstrapButton.remove();}catch(error){bootstrapButton.disabled=false;bootstrapButton.title=error.message;}};throw error;}
  const visitorAnalytics=createVisitorAnalytics({document,setConsent:value=>client.setAnalyticsConsent(value),request:(path,data)=>client.background(path,data)});
  const inspector = createInspector(document);
  const peerSnapshot=task=>{const observer=createInspector(document);try{return observer.snapshot({task,inventory:true});}finally{observer.destroy();}};
  let actionStorage;try{actionStorage=window.sessionStorage;}catch{}
  if(getActionOutcome!==undefined&&typeof getActionOutcome!=='function')throw new Error('Action outcome must be a host receipt callback');
  const verifyAction=getActionOutcome?async action=>{const receipt=await getActionOutcome({sessionId:bootstrap.sessionId,actionId:action.actionId,proposalId:action.actionId.split(':')[0],path:location.pathname});return request('/v1/actions/verify',{actionId:action.actionId,fence:action.fence,receipt});}:undefined;
  const execution=createTaskController({inspector,request,storage:actionStorage,onState:state=>frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'execution-state',state},service.origin)});
  const recorder=createRecorder(document);
  let recordedSteps=[];
  let recordingId,recordingTitle;
  let currentSnapshot = null,currentTaskText='',lastOutcome,currentGoalProposal=false,incomingPeerRequest;
  const hostContext=()=>{const visible=e=>!e.closest('[data-adoption-widget],[data-adoption-private]')&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden',modal=[...document.querySelectorAll('[role=dialog][aria-modal=true],dialog[open]')].find(visible),root=modal||document.querySelector('main')||document,heading=[...root.querySelectorAll('h1,[role=heading][aria-level="1"]')].find(visible)||[...root.querySelectorAll('h2,[role=heading]')].find(visible);return {title:(heading?.textContent.trim()||[...document.forms].find(visible)?.getAttribute('aria-label')||document.title||location.pathname).slice(0,120),path:location.pathname,origin:location.origin};};
  let historyKey;const historyStorageKey=`flolah-copilot-history:${service.href}`;
  try{historyKey=localStorage.getItem(historyStorageKey);}catch{}
  if(!/^[a-f0-9]{64}$/.test(historyKey||'')){historyKey=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');try{localStorage.setItem(historyStorageKey,historyKey);}catch{}}
  let taskGeneration=0;
  let guidedQueue=null;
  async function nextGuidance(){
    if(!guidedQueue||guidedQueue.generation!==taskGeneration||guidedQueue.index>=guidedQueue.actions.length)throw new Error('Inspect and prepare new guidance');
    await request('/v1/history');
    const action=guidedQueue.actions[guidedQueue.index],result=inspector.highlight({ref:action.ref,expectedRevision:guidedQueue.revision});guidedQueue.index++;
    return {results:[result],guideRemaining:guidedQueue.actions.length-guidedQueue.index,label:action.label,saved:false};
  }
  const frame = document.createElement('iframe');
  frame.dataset.adoptionWidget = 'true'; frame.title = 'Flolah Digital Adoption Copilot';
  frame.allow='display-capture';
  const widgetUrl = new URL('widget.html', service);
  widgetUrl.hash = new URLSearchParams({ parentOrigin: location.origin }).toString();
  frame.src = widgetUrl.href;
  frame.style.cssText = 'box-sizing:border-box;position:fixed;right:20px;bottom:20px;width:360px;height:500px;max-width:calc(100vw - 40px);max-height:80vh;border:1px solid #ccd2df;border-radius:16px;z-index:2147483646;background:white';
  const launcher = document.createElement('button');
  launcher.dataset.adoptionWidget = 'true'; launcher.type = 'button'; launcher.textContent = 'Help';
  launcher.setAttribute('aria-label','Open help chat'); launcher.hidden = true;
  launcher.style.cssText='position:fixed;z-index:2147483646;padding:12px 18px;cursor:pointer';
  const applyAppearance = () => {
    for (const element of [frame,launcher]) {
      for (const side of ['top','bottom','left','right']) element.style[side] = appearance.position.split('-').includes(side) ? `${appearance.offset}px` : 'auto';
      element.style.borderRadius=`${appearance.radius}px`;
      element.style.border=`1px solid ${appearance.border}`;
    }
    frame.style.width=`${appearance.width}px`; frame.style.height=`${appearance.height}px`;
    frame.style.maxWidth=`calc(100vw - ${appearance.offset * 2}px)`;
    frame.style.maxHeight=`calc(100dvh - ${appearance.offset * 2}px)`;
    frame.style.background=appearance.background;
    if(layout==='docked'){
      frame.style.position='sticky';frame.style.top=`${appearance.offset}px`;frame.style.bottom='auto';frame.style.left='auto';frame.style.right='auto';frame.style.width='100%';frame.style.maxWidth='100%';frame.style.zIndex='1';
    }else if(expanded){frame.style.width='520px';frame.style.height=`calc(100dvh - ${appearance.offset*2}px)`;}
    launcher.style.background=appearance.primary; launcher.style.color=appearance.onPrimary;
    frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'theme',theme:appearance},service.origin);
  };
  launcher.onclick=async()=>{if(closed){launcher.disabled=true;launcher.textContent='Reconnecting copilot…';try{await mount({...options,externalConnectionStatus:true});frame.remove();launcher.remove();window.removeEventListener('message',handler);window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);}catch(error){launcher.disabled=false;launcher.textContent='Reconnect copilot';launcher.title=error.message;}return;}frame.hidden=false;launcher.hidden=true;frame.focus();frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'presentation-visible'},service.origin);visitorAnalytics.event('copilot_open');};
  applyAppearance();
  const resumeKey=`flolah-copilot-pair:${service.origin}:${installationToken.slice(-16)}`;
  let durableResume=false;
  const resumeStore={read(){try{return sessionStorage.getItem(resumeKey)||localStorage.getItem(resumeKey);}catch{return null;}},write(value){try{sessionStorage.setItem(resumeKey,value);if(durableResume)localStorage.setItem(resumeKey,value);}catch{}},clear(){try{sessionStorage.removeItem(resumeKey);localStorage.removeItem(resumeKey);}catch{}},persist(value){durableResume=value;try{if(value){const proof=sessionStorage.getItem(resumeKey);if(proof)localStorage.setItem(resumeKey,proof);}else localStorage.removeItem(resumeKey);}catch{}}};
  const privateClient=createTaskClient({request,service,resumeStore,inspectPeer:peerSnapshot,inspect:task=>inspector.snapshot({task}),hostIdentity:getHostIdentity?async()=>{try{return await request('/v1/renew',{identityToken:await readHostIdentity()});}catch(error){try{await request('/v1/terminate');}finally{expireSession();}throw error;}}:null,onEvent:event=>{
    if(event.type==='peer-result'&&event.status==='failed'&&event.requestId===incomingPeerRequest){execution.stop();taskGeneration++;currentSnapshot=null;currentGoalProposal=false;incomingPeerRequest=null;}
    if(['task-ended','task-interrupted'].includes(event.type)){inspector.clearRecent();currentGoalProposal=false;lastOutcome=undefined;taskGeneration++;currentSnapshot=null;currentTaskText='';}
    if(event.type==='workflow-started'){currentGoalProposal=false;taskGeneration++;currentSnapshot=null;}
    if(event.type==='workflow-proposal'){inspector.rememberReview(event.proposal.actions,event.proposal.revision);currentSnapshot=event.snapshot;event={...event,proposal:{...event.proposal,localReview:inspector.reviewValues(event.proposal.actions,event.proposal.revision)}};}
    frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'private-event',event},service.origin);
  },execute:async (proposal,context={})=>(await execution.execute(proposal,{onProgress:context.onProgress,verifyOutcome:verifyAction,settle:()=>inspector.settle({task:context.task,active:()=>!closed&&(context.active?.()??true)}),active:()=>!closed&&(context.active?.()??true)})).results});
  // The host never sends the bearer credential to the iframe or puts it in a URL.
  const handler = async event => {
    if (closed || event.source !== frame.contentWindow || event.origin !== service.origin) return;
    const message = event.data;
    if (!message || message.channel !== 'flolah-adoption-v1' || typeof message.id !== 'string' || message.id.length > 80) return;
    let result,proposalGeneration;
    try {
      if(execution.busy&&['task-peer-request','goal-peer-send','conversation-archive','conversation-resume','goal-create','goal-next','goal-observe','goal-clarify','plan','recipe-plan','save-review','approve','revise','inspect','discovery-start','record-start','replay-navigation'].includes(message.type))throw Object.assign(new Error('A task is already applying or verifying changes. Stop it or wait for its result.'),{code:'TASK_BUSY'});
      // Unblock the queue before the owner's fresh capability check. Waiting
      // for that check first would itself queue Pause behind the stalled read.
      if(['discovery-pause','discovery-stop'].includes(message.type))client.interruptRead();
      const ownerOperation=/^(?:discovery-|record-|replay-navigation$|inspect$|recipes$|recipe-plan$|documents$)/.test(message.type);
      if(ownerOperation&&!(await request('/v1/capabilities')).capabilities.coach)throw new Error('Actions requires owner coaching access. Enable a short-lived coaching code in settings.');
      if(/^(task|pair)-/.test(message.type)){const extra=message.type==='task-peer-request'&&message.mode==='goal'?inspector.shareContext({includeValues:message.includeValues===true}):message.type==='task-peer-answer'&&message.goalId?{snapshot:peerSnapshot('Current supported forms and navigation')}:{};result=await privateClient.call(message.type,{...message,...extra});if(message.type==='task-remove'){currentSnapshot=null;taskGeneration++;frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'private-event',event:{type:'goal-context-changed'}},service.origin);}}
      else if(message.type==='access'){try{result=await request('/v1/capabilities');}finally{if(!result?.capabilities?.coach&&['recording','paused'].includes(recorder.state())){recorder.stop();recordedSteps=[];recordingId=null;recordingTitle=null;}}}
      else if (message.type === 'config') result = {theme:appearance,presentation:{layout,expanded},hostContext:hostContext(),canVerifyOutcome:typeof getVerifiedOutcome==='function',...await request('/v1/capabilities')};
      else if(message.type==='presentation'){expanded=message.expanded===true;applyAppearance();result={layout,expanded};}
      else if(message.type==='appearance'||message.type==='appearance-reset'){
        appearance=message.type==='appearance-reset'?hostAppearance:normalizeTheme({...appearance,...message.theme});applyAppearance();result={theme:appearance};
      }
      else if (message.type === 'minimize') {visitorAnalytics.event('copilot_close');frame.hidden=true;launcher.hidden=false;launcher.focus();result={minimized:true};}
      else if (message.type === 'history') result = await request('/v1/history');
      else if(message.type.startsWith('conversation-')){
        const operation=message.type.slice(13);if(!['list','archive','resume','delete'].includes(operation))throw new Error('Unknown conversation operation');
        const previousSummary=inspector.recentSummary(),previousOutcome=lastOutcome;let archiveMessages=message.messages;if(['archive','resume'].includes(operation)&&Array.isArray(archiveMessages)&&archiveMessages.length<200&&(previousSummary.labels.length||previousOutcome)){archiveMessages=[...archiveMessages,{id:`historical-${message.operationId}`,role:'assistant',channel:'guide',text:`Earlier browser report: ${previousSummary.phase==='applied'?'field changes were locally observed':'a field review was prepared'}${previousSummary.path?' on '+previousSummary.path:''}${previousSummary.labels.length?': '+previousSummary.labels.join(', '):''}. ${previousOutcome?.outcome==='host_reported_saved'?'The host reported a Save; independent business verification is separate.':'Saving and business completion are separate from field changes.'} These are historical observations. Inspect the current page before continuing; do not replay earlier actions automatically.`}];}
        if(['archive','resume'].includes(operation)){execution.stop();taskGeneration++;currentSnapshot=null;currentTaskText='';currentGoalProposal=false;guidedQueue=null;lastOutcome=undefined;inspector.clearRecent();client.interruptRead();}
        const latest=['archive','resume'].includes(operation)?await request('/v1/history'):null;
        result=await request('/v1/conversations/'+operation,{historyKey,id:message.conversationId,operationId:message.operationId,messages:archiveMessages,offset:message.offset||0,limit:10,...(latest?{expectedVersion:latest.conversationVersion}:{})});
      }
      else if(message.type==='clear-history'){inspector.clearRecent();lastOutcome=undefined;taskGeneration++;currentSnapshot=null;currentTaskText='';if(privateClient.taskId)await privateClient.call('task-end');result=await request('/v1/history/clear');}
      else if(message.type==='documents')result=await request('/v1/knowledge/documents');
      else if(message.type==='upload-document')throw new Error('Shared knowledge uploads require authenticated owner or Flolah website management. Use Task files for private transaction documents.');
      else if(message.type==='upload-status')result=await request('/v1/knowledge/upload-status',{sourceId:message.sourceId});
      else if(message.type==='coaching-exchange'){const grant=await request('/v1/coaching/exchange',{code:message.code});result={...grant,...await request('/v1/capabilities')};}
      else if(message.type==='recipes')result=await request('/v1/recipes');
      else if(message.type==='discovery-list')result=await request('/v1/discovery/list');
      else if(message.type==='discovery-report')result=await request('/v1/discovery/status',{id:message.jobId});
      else if(message.type==='discovery-scope'){
        const access=await request('/v1/capabilities');if(!access.capabilities.coach)throw new Error('Enable coaching in settings first.');const observed=inspector.snapshot();result={origin:location.origin,paths:[...new Set([location.pathname,...(observed.navigationCandidates||observed.links.map(link=>link.path))])],blockedCount:observed.blockedCount};
      }
      else if(message.type==='discovery-extend')result=await request('/v1/discovery/extend',{id:message.jobId,paths:message.paths});
      else if(message.type==='discovery-start'){
        if(currentSnapshot||inspector.hasDraft())throw new Error('Stop the pending review and save or discard your current draft before discovery.');
        taskGeneration++;result=await request('/v1/discovery/start',{seed:location.pathname,paths:message.paths,maxPages:message.maxPages});inspector.setReadOnlyPaths(message.paths);
      }
      else if(['discovery-pause','discovery-resume','discovery-stop'].includes(message.type)){
        taskGeneration++;result=await request(`/v1/discovery/${message.type.slice(10)}`,{id:message.jobId});if(message.type==='discovery-resume')inspector.setReadOnlyPaths(result.approvedPaths);
      }
      else if(message.type==='discovery-tick'){
        if(currentSnapshot)throw new Error('A form review is pending. Pause discovery before preparing changes.');
        const generation=taskGeneration,next=await request('/v1/discovery/next',{id:message.jobId,hasUnsavedWork:inspector.hasDraft()});
        if(next.done||next.paused)result=next;
        else{
          if(generation!==taskGeneration)throw new Error('Discovery interrupted');
          const status=await request('/v1/discovery/status',{id:message.jobId});
          let observed;try{observed=await observePage(document,next.next.path,status.approvedPaths,{active:()=>!closed&&generation===taskGeneration});}catch(error){if(closed||generation!==taskGeneration)throw error;result={report:await request('/v1/discovery/block',{id:message.jobId})};}
          if(inspector.hasDraft()){await request('/v1/discovery/pause',{id:message.jobId});throw new Error('An edited draft appeared; mapping paused');}
          if(generation!==taskGeneration)throw new Error('Discovery interrupted');
          if(observed)result={report:await request('/v1/discovery/observe',{id:message.jobId,snapshot:observed})};
        }
      }
      else if(message.type==='guide-next')result=await nextGuidance();
      else if(message.type==='record-package'){await request('/v1/history');result=await recordedPackage({title:message.title,steps:recordedSteps,origin:location.origin});}
      else if(message.type==='record-draft'){
        const access=await request('/v1/capabilities');if(!access.capabilities.coach)throw new Error('Enable coaching before saving a shared teaching draft.');
        const snapshot=inspector.snapshot();await request('/v1/learning/observe',{snapshot});
        const pack=await recordedPackage({title:recordingTitle||message.title,steps:recordedSteps,origin:location.origin});
        result=await request('/v1/learning/draft',{package:pack,operationId:recordingId||message.operationId});
      }
      else if(message.type==='recipe-test-start'){result=await request('/v1/recipe/test/start',{id:message.recipeId,version:message.version});}
      else if(message.type==='recipe-test-finish'){result=await request('/v1/recipe/test/finish',{id:message.recipeId,testRunId:message.testRunId,snapshot:inspector.snapshot()});}
      else if(message.type==='recipe-plan'){
        const generation=proposalGeneration=++taskGeneration;currentSnapshot=inspector.snapshot();result=await request('/v1/recipe/plan',{id:message.recipeId,version:message.version,parameters:message.parameters,step:message.step,mode:message.mode,testRunId:message.testRunId,snapshot:currentSnapshot});if(generation!==taskGeneration)throw new Error('Task stopped; recipe review discarded');if(!result.actions?.length)currentSnapshot=null;
      }
      else if(['record-start','record-pause','record-resume','record-stop'].includes(message.type)){
        await request('/v1/history'); // Revalidate session before local recording controls.
        const operation=message.type.slice(7);
        if(operation==='start'&&message.title!==undefined&&(typeof message.title!=='string'||message.title.length>120))throw new Error('Use a workflow name of up to 120 characters');
        const steps=recorder[operation]();if(operation==='stop')recordedSteps=steps;if(operation==='start'){recordedSteps=[];recordingId=crypto.randomUUID();recordingTitle=message.title?.trim()||`Teaching session ${new Date().toISOString()}`;}
        result={state:recorder.state(),steps:steps||[],title:recordingTitle};
        const access=await request('/v1/capabilities');
        if(access.capabilities.coach&&['start','stop'].includes(operation)){
          try{await request('/v1/learning/observe',{snapshot:inspector.snapshot()});}catch(error){result.mapError=error.message;}
        }
        if(operation==='stop'&&recordedSteps.length){
          try{const pack=await recordedPackage({title:recordingTitle,steps:recordedSteps,origin:location.origin});result.savedDraft=await request('/v1/learning/draft',{package:pack,operationId:recordingId});}
          catch(error){result.persistenceError=error.message;}
        }
      }
      else if(message.type==='replay-navigation'){
        await request('/v1/history');
        if(message.approved!==true||!recordedSteps.length||recordedSteps.some(step=>step.action!=='navigate'))throw new Error('Only reviewed navigation-only recordings can replay here.');
        const generation=++taskGeneration,results=[];
        for(const step of recordedSteps){await request('/v1/history');results.push(await replayNavigation(document,{path:step.path,activation:step.activation,approved:true,active:()=>!closed&&generation===taskGeneration}));}
        result={results};
      }
      else if (message.type === 'message') result = await request('/v1/messages', { text: message.text });
      else if (message.type === 'ask') result = privateClient.taskId?await privateClient.call('task-summary',{text:message.text}):await request('/v1/ask',{text:message.text,replyTo:message.replyTo});
      else if(message.type==='revise'){
        if(!currentSnapshot)throw new Error('The review expired. Prepare it again.');
        const generation=taskGeneration,reviewLabels=currentSnapshot.fields.map(f=>f.label).join(' ');currentSnapshot=inspector.snapshot({task:reviewLabels});
        result=privateClient.taskId?await privateClient.call('task-revise',{id:message.proposalId,snapshot:currentSnapshot,edits:message.edits}):await request('/v1/revise',{id:message.proposalId,snapshot:currentSnapshot,edits:message.edits});
        if(generation!==taskGeneration)throw new Error('Review stopped; edited proposal discarded');
      }
      else if(message.type==='reject'){inspector.discardReview();taskGeneration++;currentSnapshot=null;client.interruptRead();result=privateClient.taskId&&!currentGoalProposal?await privateClient.call('task-reject',{id:message.proposalId}):await request('/v1/reject',{id:message.proposalId});}
      else if(message.type==='reconnect'){await controller.destroy();result=await mount(options);return;}
      else if(message.type==='cancel'){currentGoalProposal=false;execution.stop();taskGeneration++;currentSnapshot=null;currentTaskText='';client.interruptRead();result={stopped:true};}
      else if (message.type === 'inspect') {result=inspector.snapshot({inventory:true});const access=await request('/v1/capabilities');if(access.capabilities.coach)result.learning=await request('/v1/learning/observe',{snapshot:result});}
      else if(message.type.startsWith('goal-')){
        const operation=message.type.slice(5);if(['create','next','clarify','peer-send','peer-check'].includes(operation)&&!privateClient.instanceId)await privateClient.call('pair-status');const goalInput={instanceId:privateClient.instanceId,peerRequestId:message.peerRequestId,shareConsent:message.shareConsent,id:message.goalId,version:message.version,action:message.action,text:message.text,answer:message.answer,edits:message.edits};if(['control','create','clarify'].includes(operation)){taskGeneration++;currentSnapshot=null;client.interruptRead();execution.stop();}
        if(operation==='create')incomingPeerRequest=message.peerRequestId;
        const generation=proposalGeneration=taskGeneration;
        if(operation==='peer-send'){const packet=inspector.shareContext({includeValues:message.includeValues===true});result=await request('/v1/goals/peer-send',{...goalInput,...packet,...privateClient.taskScope});if(result.peerRequest)privateClient.adoptTask(result.peerRequest.taskId);}
        else if(['create','next','observe','revise','clarify'].includes(operation)){const observed=inspector.snapshot({task:message.text||currentTaskText});if(lastOutcome)observed.lastOutcome=lastOutcome;currentSnapshot=observed;result=await request('/v1/goals/'+operation,{...goalInput,snapshot:observed,...(['create','clarify'].includes(operation)?{privateTask:privateClient.taskScope}: {})});}
        else result=await request('/v1/goals/'+operation,goalInput);
        if(generation!==taskGeneration)throw Object.assign(new Error('Goal request stopped; response discarded'),{code:'TASK_CANCELLED'});
        if(result.proposal){currentGoalProposal=true;currentTaskText=result.goal.steps[result.goal.current].remainingInstruction||result.goal.steps[result.goal.current].instruction;result.proposal={...result.proposal,localReview:inspector.reviewValues(result.proposal.actions,result.proposal.revision)};}
        else {currentSnapshot=null;currentGoalProposal=false;}
      }
      else if (message.type === 'plan') {
        const generation=proposalGeneration=++taskGeneration;
        const continuingGoal=currentTaskText===message.text;currentGoalProposal=false;currentTaskText=message.text;const snapshot=inspector.snapshot({task:message.text});if(lastOutcome)snapshot.lastOutcome={...lastOutcome,...(!continuingGoal?{lookupOnly:false}:{})};currentSnapshot=snapshot;
        result = await privateClient.plan({text:message.text,snapshot,mode:message.mode,replyTo:message.replyTo})||await request('/v1/plan',{ text:message.text,snapshot,replyTo:message.replyTo,mode:message.mode });
        if(generation!==taskGeneration)throw new Error('Task stopped; proposal discarded');
        if(!result.actions?.length)currentSnapshot=null;
        if(snapshot.coverage.manualNotice)result={...result,manualNotice:snapshot.coverage.manualNotice};
      }
      else if(message.type==='save-review'){
        currentGoalProposal=false;
        if(message.mode==='guide')throw new Error('Guide mode does not submit forms. Use the host Save control yourself.');
        const generation=proposalGeneration=++taskGeneration;currentSnapshot=inspector.snapshot();
        if(currentSnapshot.submissions.length!==1)throw new Error('Choose Save on the host page: no unique supported native submit control is visible.');
        result=privateClient.taskId?await privateClient.call('task-save-review',{snapshot:currentSnapshot,ref:currentSnapshot.submissions[0].ref}):await request('/v1/save/plan',{snapshot:currentSnapshot,ref:currentSnapshot.submissions[0].ref});
        if(generation!==taskGeneration)throw new Error('Save review stopped');
      }
      else if (message.type === 'approve') {
        if (!currentSnapshot) throw new Error('Inspect and review again');
        if(getHostIdentity)await request('/v1/renew',{identityToken:await readHostIdentity()});
        const generation=taskGeneration,reviewedSnapshot=currentSnapshot,reviewedRevision=currentSnapshot.revision;
        const proposal = privateClient.taskId&&!currentGoalProposal?await privateClient.call('task-approve',{id:message.proposalId,revision:reviewedRevision,approved:true}):await request('/v1/approve',{ id:message.proposalId,revision:reviewedRevision,approved:true });
        if(closed||generation!==taskGeneration)throw new Error('Task stopped or superseded; approved actions discarded');
        const results=[];
        const guided=proposal.actions.length>0&&proposal.actions.every(action=>action.type==='highlight');
        if(guided){
          guidedQueue={actions:proposal.actions,revision:proposal.revision,index:0,generation};result=await nextGuidance();
        }else {
          const applied=await execution.execute(proposal,{verifyOutcome:verifyAction,settle:()=>inspector.settle({task:proposal.binding?'':currentTaskText,active:()=>!closed&&generation===taskGeneration}),active:()=>!closed&&generation===taskGeneration,beforeAction:async action=>{
            if(getHostIdentity)await request('/v1/renew',{identityToken:await readHostIdentity()});
            await request('/v1/history');
            if(action.type==='submit'&&message.learningConsent===true&&bindVerifiedSave){await bindVerifiedSave({sessionId:bootstrap.sessionId,proposalId:message.proposalId,path:currentSnapshot.path});await request('/v1/history');}
          }});results.push(...applied.results);if(proposal.binding?.testRunId)await request('/v1/recipe/test/observe',{proposalId:message.proposalId});
        }
        if(closed||generation!==taskGeneration)throw new Error('Task superseded after dispatch. Completed host changes remain; no further actions will run.');
        if(!guided)lastOutcome={path:reviewedSnapshot.path,actionTypes:proposal.actions.map(a=>a.type),outcome:results.at(-1)?.outcome||'prepared',...(results.some(r=>r.observeAgain)?{lookupOnly:true}:{}),applied:results.filter(r=>r.valueObserved||r.navigated&&r.verified).length};
        let followup=[];if(!guided&&proposal.actions.every(a=>a.type==='fill')){followup=newlyAvailableFields(reviewedSnapshot,inspector.snapshot({task:currentTaskText}),currentTaskText).map(f=>f.label);}
        currentSnapshot=null;if(!guided)result={followup,observeAgain:results.some(r=>r.observeAgain),results,outcome:results.at(-1)?.outcome||'prepared',saved:false };
        if(!privateClient.taskId&&!guided&&proposal.actions[0]?.type==='submit'&&results[0]?.hostReported==='success'&&message.learningConsent===true){
          try{
            if(!getVerifiedOutcome)throw new Error('This website has no verified saved-record integration');
            const access=await request('/v1/capabilities');if(!access.learningEnabled)throw new Error('Shared learning is disabled');
            const snapshot=inspector.snapshot();
            const receipt=await getVerifiedOutcome({sessionId:bootstrap.sessionId,proposalId:message.proposalId,path:snapshot.path});
            if(closed||generation!==taskGeneration)throw new Error('Task stopped; no learning was saved');
            result.learning=await request('/v1/learning/complete',{proposalId:message.proposalId,snapshot,receipt,consent:true});
          }catch(error){result.learning={created:false,reason:error.message};}
        }
      }
      else throw new Error('Unsupported operation');
      if(result?.actions)inspector.rememberReview(result.actions,result.revision);if(result?.proposal?.actions)inspector.rememberReview(result.proposal.actions,result.proposal.revision);
      if(['plan','recipe-plan','revise'].includes(message.type)&&result?.actions)result={...result,hostContext:hostContext(),localReview:inspector.reviewValues(result.actions,result.revision)};
      if(result&&typeof result==='object'&&!Array.isArray(result))result={...result,hostContext:hostContext()};
      if(!closed)frame.contentWindow?.postMessage({ channel: message.channel, id: message.id, result }, service.origin);
    } catch (error) { if(message.type==='approve')lastOutcome={path:currentSnapshot?.path||location.pathname,actionTypes:[],outcome:error.outcome==='unknown'?'unknown':'rejected',applied:error.results?.filter(r=>r.valueObserved).length||0};if(error.name==='AbortError'&&error.code!=='TASK_CANCELLED')error=Object.assign(new Error('The task was interrupted. Check the website outcome before trying again.'),{code:'TASK_INTERRUPTED',outcome:error.outcome,results:error.results});if(error.code==='SESSION_ACCESS_DENIED')expireSession();if(proposalGeneration===taskGeneration)currentSnapshot=null;if(!closed)frame.contentWindow?.postMessage({ channel: message.channel, id: message.id, error: error.message,code:error.code,outcome:error.outcome,applied: error.results?.filter(r=>r.valueObserved).length||0 }, service.origin); }
  };
  window.addEventListener('message', handler);
  (layout==='docked'?dockTarget:document.body).append(frame);document.body.append(launcher);
  frame.addEventListener('load',()=>privateClient.resume().then(out=>{if(out)frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'private-event',event:{type:'pairing-restored',status:out}},service.origin);}).catch(error=>frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'private-event',event:{type:'pairing-offline',reason:error.message}},service.origin)));
  const expireSession=()=>{
    if(!closed){closed=true;visitorAnalytics.destroy();privateClient.close();execution.stop();taskGeneration++;currentSnapshot=null;currentTaskText='';guidedQueue=null;client.interruptRead();recorder.stop();inspector.destroy();client.stop();clearInterval(timer);}
    frame.title='Copilot session expired; reconnect to restore the saved group';launcher.textContent='Reconnect copilot';launcher.setAttribute('aria-label','Reconnect copilot');launcher.hidden=false;
    frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'expired'},service.origin);
  };
  const timer = setInterval(async () => {
    if (closed) return;
    try { await request('/v1/renew',{identityToken:await readHostIdentity()}); }
    catch {
      expireSession();
    }
  }, 240_000);
  // A cached document must not revive an old approval, recording or identity.
  // Server access still expires independently; no unload request is assumed to
  // have arrived. A restored page explicitly requires a fresh host reload.
  const pageHide=()=>expireSession(),pageShow=event=>{if(event.persisted)expireSession();};
  window.addEventListener('pagehide',pageHide);window.addEventListener('pageshow',pageShow);
  const controller={ updateTheme: patch => {appearance=normalizeTheme({...appearance,...patch});hostAppearance=appearance;applyAppearance();}, destroy: async () => {
    const wasClosed=closed;closed = true;visitorAnalytics.destroy();privateClient.close();execution.stop();taskGeneration++;client.interruptRead();recorder.stop();inspector.destroy(); clearInterval(timer); window.removeEventListener('message', handler); frame.remove();launcher.remove();
    window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);
    try { if(!wasClosed)await request('/v1/terminate'); } finally { client.stop(); }
  } };return controller;
}
