import {observePage} from './page-observer.mjs';
import { createInspector } from './dom.mjs';
import { normalizeTheme } from './theme.mjs';
import { createSessionClient } from './session-client.mjs';
import {createRecorder,replayNavigation} from './recording.mjs';
import {recordedPackage} from './learning-package.mjs';
import {createTaskClient} from './task-client.mjs';

export async function mount({ serviceUrl, installationToken, theme = {},getHostIdentity,getVerifiedOutcome,bindVerifiedSave }) {
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
  const bootstrap=await request('/v1/sessions', { installationToken,identityToken:await readHostIdentity() });
  const inspector = createInspector(document);
  const recorder=createRecorder(document);
  let recordedSteps=[];
  let recordingId,recordingTitle;
  let currentSnapshot = null;
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
  frame.style.cssText = 'position:fixed;right:20px;bottom:20px;width:360px;height:500px;max-width:calc(100vw - 40px);max-height:80vh;border:1px solid #ccd2df;border-radius:16px;z-index:2147483646;background:white';
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
    launcher.style.background=appearance.primary; launcher.style.color=appearance.onPrimary;
    frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'theme',theme:appearance},service.origin);
  };
  launcher.onclick=()=>{frame.hidden=false;launcher.hidden=true;frame.focus();};
  applyAppearance();
  const privateClient=createTaskClient({request,service,inspect:()=>inspector.snapshot(),hostIdentity:getHostIdentity?async()=>{try{return await request('/v1/renew',{identityToken:await readHostIdentity()});}catch(error){try{await request('/v1/terminate');}finally{expireSession();}throw error;}}:null,onEvent:event=>{
    if(event.type==='task-ended'){taskGeneration++;currentSnapshot=null;}
    if(event.type==='workflow-proposal')currentSnapshot=event.snapshot;
    frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'private-event',event},service.origin);
  },execute:async proposal=>{const results=[];for(const action of proposal.actions){if(closed)throw new Error('Session ended');if(action.type==='fill')results.push(inspector.fill({ref:action.ref,value:action.value,expectedRevision:proposal.revision,approved:true}));else if(action.type==='navigate')results.push(await inspector.navigate({ref:action.ref,expectedRevision:proposal.revision,approved:true}));else if(action.type==='submit')results.push(await inspector.submit({ref:action.ref,expectedRevision:proposal.revision,approved:true,active:()=>!closed}));else throw new Error('Unsupported workflow effect');}return results;}});
  // The host never sends the bearer credential to the iframe or puts it in a URL.
  const handler = async event => {
    if (closed || event.source !== frame.contentWindow || event.origin !== service.origin) return;
    const message = event.data;
    if (!message || message.channel !== 'flolah-adoption-v1' || typeof message.id !== 'string' || message.id.length > 80) return;
    let result,proposalGeneration;
    try {
      // Unblock the queue before the owner's fresh capability check. Waiting
      // for that check first would itself queue Pause behind the stalled read.
      if(['discovery-pause','discovery-stop'].includes(message.type))client.interruptRead();
      const ownerOperation=/^(?:discovery-|record-|replay-navigation$|inspect$|recipes$|recipe-plan$|documents$)/.test(message.type);
      if(ownerOperation&&!(await request('/v1/capabilities')).capabilities.coach)throw new Error('Actions requires owner coaching access. Enable a short-lived coaching code in settings.');
      if(/^(task|pair)-/.test(message.type)){result=await privateClient.call(message.type,message);}
      else if(message.type==='access')result=await request('/v1/capabilities');
      else if (message.type === 'config') result = {theme:appearance,canVerifyOutcome:typeof getVerifiedOutcome==='function',...await request('/v1/capabilities')};
      else if(message.type==='appearance'||message.type==='appearance-reset'){
        appearance=message.type==='appearance-reset'?hostAppearance:normalizeTheme({...appearance,...message.theme});applyAppearance();result={theme:appearance};
      }
      else if (message.type === 'minimize') {frame.hidden=true;launcher.hidden=false;launcher.focus();result={minimized:true};}
      else if (message.type === 'history') result = await request('/v1/history');
      else if(message.type==='clear-history'){taskGeneration++;currentSnapshot=null;if(privateClient.taskId)await privateClient.call('task-end');result=await request('/v1/history/clear');}
      else if(message.type==='documents')result=await request('/v1/knowledge/documents');
      else if(message.type==='upload-document'){if(!(await request('/v1/capabilities')).capabilities.upload)throw new Error('Uploads are disabled for this website.');result=await request('/v1/knowledge/upload',{title:message.title,filename:message.filename,mime:message.mime,content:message.content,sharedConsent:message.sharedConsent,operationId:message.operationId});}
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
      else if(message.type==='recipe-plan'){
        const generation=proposalGeneration=++taskGeneration;currentSnapshot=inspector.snapshot();result=await request('/v1/recipe/plan',{id:message.recipeId,version:message.version,parameters:message.parameters,step:message.step,mode:message.mode,snapshot:currentSnapshot});if(generation!==taskGeneration)throw new Error('Task stopped; recipe review discarded');if(!result.actions?.length)currentSnapshot=null;
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
      else if(message.type==='cancel'){taskGeneration++;currentSnapshot=null;client.interruptRead();result={stopped:true};}
      else if (message.type === 'inspect') {result=inspector.snapshot({inventory:true});const access=await request('/v1/capabilities');if(access.capabilities.coach)result.learning=await request('/v1/learning/observe',{snapshot:result});}
      else if (message.type === 'plan') {
        const generation=proposalGeneration=++taskGeneration;
        const snapshot=inspector.snapshot();currentSnapshot=snapshot;
        result = await privateClient.plan({text:message.text,snapshot,mode:message.mode})||await request('/v1/plan',{ text:message.text,snapshot,replyTo:message.replyTo,mode:message.mode });
        if(generation!==taskGeneration)throw new Error('Task stopped; proposal discarded');
        if(!result.actions?.length)currentSnapshot=null;
        if(snapshot.coverage.manualNotice)result={...result,manualNotice:snapshot.coverage.manualNotice};
      }
      else if(message.type==='save-review'){
        if(message.mode==='guide')throw new Error('Guide mode does not submit forms. Use the host Save control yourself.');
        const generation=proposalGeneration=++taskGeneration;currentSnapshot=inspector.snapshot();
        if(currentSnapshot.submissions.length!==1)throw new Error('Choose Save on the host page: no unique supported native submit control is visible.');
        result=privateClient.taskId?await privateClient.call('task-save-review',{snapshot:currentSnapshot,ref:currentSnapshot.submissions[0].ref}):await request('/v1/save/plan',{snapshot:currentSnapshot,ref:currentSnapshot.submissions[0].ref});
        if(generation!==taskGeneration)throw new Error('Save review stopped');
      }
      else if (message.type === 'approve') {
        if (!currentSnapshot) throw new Error('Inspect and review again');
        if(getHostIdentity)await request('/v1/renew',{identityToken:await readHostIdentity()});
        const generation=taskGeneration,reviewedRevision=currentSnapshot.revision;
        const proposal = privateClient.taskId?await privateClient.call('task-approve',{id:message.proposalId,revision:reviewedRevision,approved:true}):await request('/v1/approve',{ id:message.proposalId,revision:reviewedRevision,approved:true });
        if(closed||generation!==taskGeneration)throw new Error('Task stopped or superseded; approved actions discarded');
        const results=[];
        const guided=proposal.actions.length>0&&proposal.actions.every(action=>action.type==='highlight');
        if(guided){
          guidedQueue={actions:proposal.actions,revision:proposal.revision,index:0,generation};result=await nextGuidance();
        }else for (const action of proposal.actions) {
          if(closed||generation!==taskGeneration)throw new Error('Task stopped; remaining actions cancelled');
          if(action.type==='submit'){
            if(message.learningConsent===true&&bindVerifiedSave){
              await bindVerifiedSave({sessionId:bootstrap.sessionId,proposalId:message.proposalId,path:currentSnapshot.path});
              if(closed||generation!==taskGeneration)throw new Error('Save stopped before dispatch');
              if(getHostIdentity)await request('/v1/renew',{identityToken:await readHostIdentity()});
              await request('/v1/history'); // Recheck access after the host binding.
            }
            results.push(await inspector.submit({ref:action.ref,expectedRevision:proposal.revision,approved:true,active:()=>!closed&&generation===taskGeneration}));
          }
          else if(action.type==='navigate')results.push(await inspector.navigate({ref:action.ref,expectedRevision:proposal.revision,activation:action.activation,approved:true}));
          else if(action.type==='highlight')results.push(inspector.highlight({ref:action.ref,expectedRevision:proposal.revision}));
          else {inspector.highlight({ref:action.ref,expectedRevision:proposal.revision});results.push(inspector.fill({ ref:action.ref,value:action.value,expectedRevision:proposal.revision,approved:true }));}
        }
        if(closed||generation!==taskGeneration)throw new Error('Task superseded after dispatch. Completed host changes remain; no further actions will run.');
        currentSnapshot=null;if(!guided)result={ results,saved:false };
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
      if(!closed)frame.contentWindow?.postMessage({ channel: message.channel, id: message.id, result }, service.origin);
    } catch (error) { if(proposalGeneration===taskGeneration)currentSnapshot=null;if(!closed)frame.contentWindow?.postMessage({ channel: message.channel, id: message.id, error: error.message }, service.origin); }
  };
  window.addEventListener('message', handler);
  document.body.append(frame,launcher);
  const expireSession=()=>{
    if(!closed){closed=true;privateClient.close();taskGeneration++;currentSnapshot=null;guidedQueue=null;client.interruptRead();recorder.stop();inspector.destroy();client.stop();clearInterval(timer);}
    frame.title='Copilot session expired; reload to reconnect';
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
  return { updateTheme: patch => {appearance=normalizeTheme({...appearance,...patch});hostAppearance=appearance;applyAppearance();}, destroy: async () => {
    const wasClosed=closed;closed = true;privateClient.close();taskGeneration++;client.interruptRead();recorder.stop();inspector.destroy(); clearInterval(timer); window.removeEventListener('message', handler); frame.remove();launcher.remove();
    window.removeEventListener('pagehide',pageHide);window.removeEventListener('pageshow',pageShow);
    try { if(!wasClosed)await request('/v1/terminate'); } finally { client.stop(); }
  } };
}
