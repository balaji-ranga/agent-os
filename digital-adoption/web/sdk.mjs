import { createInspector } from './dom.mjs';
import { normalizeTheme } from './theme.mjs';
import { createSessionClient } from './session-client.mjs';
import {createRecorder,replayNavigation} from './recording.mjs';
import {recordedPackage} from './learning-package.mjs';

export async function mount({ serviceUrl, installationToken, theme = {} }) {
  let appearance = normalizeTheme(theme);
  let hostAppearance=appearance;
  const service = new URL(serviceUrl);
  if (service.username || service.password || service.search || service.hash || !service.pathname.endsWith('/')) throw new Error('Service base URL must end with /');
  if (service.protocol !== 'https:' && !(service.protocol === 'http:' && ['127.0.0.1','localhost'].includes(service.hostname))) throw new Error('HTTPS required');
  let closed = false;
  const client=createSessionClient({service});
  const request=(path,data)=>client.request(path,data);
  await request('/v1/sessions', { installationToken });
  const inspector = createInspector(document);
  const recorder=createRecorder(document);
  let recordedSteps=[];
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
  // The host never sends the bearer credential to the iframe or puts it in a URL.
  const handler = async event => {
    if (closed || event.source !== frame.contentWindow || event.origin !== service.origin) return;
    const message = event.data;
    if (!message || message.channel !== 'flolah-adoption-v1' || typeof message.id !== 'string' || message.id.length > 80) return;
    let result;
    try {
      if (message.type === 'config') result = {theme:appearance,...await request('/v1/capabilities')};
      else if(message.type==='appearance'||message.type==='appearance-reset'){
        appearance=message.type==='appearance-reset'?hostAppearance:normalizeTheme({...appearance,...message.theme});applyAppearance();result={theme:appearance};
      }
      else if (message.type === 'minimize') {frame.hidden=true;launcher.hidden=false;launcher.focus();result={minimized:true};}
      else if (message.type === 'history') result = await request('/v1/history');
      else if(message.type==='clear-history'){taskGeneration++;currentSnapshot=null;result=await request('/v1/history/clear');}
      else if(message.type==='documents')result=await request('/v1/knowledge/documents');
      else if(message.type==='upload-document')result=await request('/v1/knowledge/upload',{title:message.title,filename:message.filename,mime:message.mime,content:message.content,sharedConsent:message.sharedConsent,operationId:message.operationId});
      else if(message.type==='upload-status')result=await request('/v1/knowledge/upload-status',{sourceId:message.sourceId});
      else if(message.type==='coaching-exchange'){const grant=await request('/v1/coaching/exchange',{code:message.code});result={...grant,...await request('/v1/capabilities')};}
      else if(message.type==='recipes')result=await request('/v1/recipes');
      else if(message.type==='discovery-list')result=await request('/v1/discovery/list');
      else if(message.type==='discovery-scope'){
        const access=await request('/v1/capabilities');if(!access.capabilities.coach)throw new Error('Enable coaching in settings first.');const observed=inspector.snapshot();result={origin:location.origin,paths:[...new Set([location.pathname,...observed.links.map(link=>link.path)])],blockedCount:observed.blockedCount};
      }
      else if(message.type==='discovery-start'){
        if(currentSnapshot||inspector.hasDraft())throw new Error('Stop the pending review and save or discard your current draft before discovery.');
        taskGeneration++;result=await request('/v1/discovery/start',{seed:location.pathname,paths:message.paths,maxPages:message.maxPages});
      }
      else if(['discovery-pause','discovery-resume','discovery-stop'].includes(message.type)){
        taskGeneration++;result=await request(`/v1/discovery/${message.type.slice(10)}`,{id:message.jobId});
      }
      else if(message.type==='discovery-tick'){
        if(currentSnapshot)throw new Error('A form review is pending. Pause discovery before preparing changes.');
        const generation=taskGeneration,next=await request('/v1/discovery/next',{id:message.jobId,hasUnsavedWork:inspector.hasDraft()});
        if(next.done||next.paused)result=next;
        else{
          if(generation!==taskGeneration)throw new Error('Discovery interrupted');
          if(location.pathname!==next.next.path){
            const snapshot=inspector.snapshot(),targets=snapshot.links.filter(link=>link.path===next.next.path);
            if(targets.length!==1){await request('/v1/discovery/pause',{id:message.jobId});throw new Error('Read-only navigation is missing or ambiguous. Discovery paused.');}
            await request('/v1/history');if(generation!==taskGeneration)throw new Error('Discovery interrupted');
            await inspector.navigate({ref:targets[0].ref,expectedRevision:snapshot.revision,approved:true});
          }
          let observed,previous=null,stable=0;
          for(let sample=0;sample<40;sample++){
            if(generation!==taskGeneration)throw new Error('Discovery interrupted');
            observed=inspector.snapshot();const fingerprint=JSON.stringify({path:observed.path,fields:observed.fields.map(({key,label,type,required})=>({key,label,type,required})),links:observed.links.map(link=>link.path)});
            stable=fingerprint===previous?stable+1:0;previous=fingerprint;
            if(stable>=2&&(observed.fields.length||sample>=10))break;
            await new Promise(resolve=>setTimeout(resolve,100));
          }
          if(inspector.hasDraft()){await request('/v1/discovery/pause',{id:message.jobId});throw new Error('An edited draft appeared. Discovery paused without further navigation.');}
          if(generation!==taskGeneration)throw new Error('Discovery interrupted');
          result={report:await request('/v1/discovery/observe',{id:message.jobId,snapshot:observed})};
        }
      }
      else if(message.type==='guide-next')result=await nextGuidance();
      else if(message.type==='record-package'){await request('/v1/history');result=await recordedPackage({title:message.title,steps:recordedSteps,origin:location.origin});}
      else if(message.type==='recipe-plan'){
        const generation=++taskGeneration;currentSnapshot=inspector.snapshot();result=await request('/v1/recipe/plan',{id:message.recipeId,version:message.version,parameters:message.parameters,step:message.step,mode:message.mode,snapshot:currentSnapshot});if(generation!==taskGeneration)throw new Error('Task stopped; recipe review discarded');
      }
      else if(['record-start','record-pause','record-resume','record-stop'].includes(message.type)){
        await request('/v1/history'); // Revalidate session before local recording controls.
        const operation=message.type.slice(7);const steps=recorder[operation]();if(operation==='stop')recordedSteps=steps;if(operation==='start')recordedSteps=[];result={state:recorder.state(),steps:steps||[]};
      }
      else if(message.type==='replay-navigation'){
        await request('/v1/history');
        if(message.approved!==true||!recordedSteps.length||recordedSteps.some(step=>step.action!=='navigate'))throw new Error('Only reviewed navigation-only recordings can replay here.');
        const generation=++taskGeneration,results=[];
        for(const step of recordedSteps){await request('/v1/history');results.push(await replayNavigation(document,{path:step.path,approved:true,active:()=>!closed&&generation===taskGeneration}));}
        result={results};
      }
      else if (message.type === 'message') result = await request('/v1/messages', { text: message.text });
      else if (message.type === 'ask') result = await request('/v1/ask',{text:message.text,replyTo:message.replyTo});
      else if(message.type==='cancel'){taskGeneration++;currentSnapshot=null;result={stopped:true};}
      else if (message.type === 'inspect') {result=inspector.snapshot();const access=await request('/v1/capabilities');if(access.capabilities.coach)result.learning=await request('/v1/learning/observe',{snapshot:result});}
      else if (message.type === 'plan') {
        const generation=++taskGeneration;
        currentSnapshot = inspector.snapshot();
        result = await request('/v1/plan',{ text:message.text,snapshot:currentSnapshot,replyTo:message.replyTo,mode:message.mode });
        if(generation!==taskGeneration)throw new Error('Task stopped; proposal discarded');
      }
      else if (message.type === 'approve') {
        if (!currentSnapshot) throw new Error('Inspect and review again');
        const proposal = await request('/v1/approve',{ id:message.proposalId,revision:currentSnapshot.revision,approved:true });
        const results=[];
        const generation=taskGeneration;
        const guided=proposal.actions.length>0&&proposal.actions.every(action=>action.type==='highlight');
        if(guided){
          guidedQueue={actions:proposal.actions,revision:proposal.revision,index:0,generation};result=await nextGuidance();
        }else for (const action of proposal.actions) {
          if(closed||generation!==taskGeneration)throw new Error('Task stopped; remaining actions cancelled');
          if(action.type==='navigate')results.push(await inspector.navigate({ref:action.ref,expectedRevision:proposal.revision,approved:true}));
          else if(action.type==='highlight')results.push(inspector.highlight({ref:action.ref,expectedRevision:proposal.revision}));
          else {inspector.highlight({ref:action.ref,expectedRevision:proposal.revision});results.push(inspector.fill({ ref:action.ref,value:action.value,expectedRevision:proposal.revision,approved:true }));}
        }
        currentSnapshot=null;if(!guided)result={ results,saved:false };
      }
      else throw new Error('Unsupported operation');
      frame.contentWindow.postMessage({ channel: message.channel, id: message.id, result }, service.origin);
    } catch (error) { frame.contentWindow.postMessage({ channel: message.channel, id: message.id, error: error.message }, service.origin); }
  };
  window.addEventListener('message', handler);
  document.body.append(frame,launcher);
  const timer = setInterval(async () => {
    if (closed) return;
    try { await request('/v1/renew'); }
    catch {
      closed = true;taskGeneration++;currentSnapshot=null;recorder.stop();inspector.destroy();client.stop();clearInterval(timer);
      frame.title = 'Copilot session expired; reload to reconnect';
      frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'expired'},service.origin);
    }
  }, 240_000);
  return { updateTheme: patch => {appearance=normalizeTheme({...appearance,...patch});hostAppearance=appearance;applyAppearance();}, destroy: async () => {
    closed = true;taskGeneration++;recorder.stop();inspector.destroy(); clearInterval(timer); window.removeEventListener('message', handler); frame.remove();launcher.remove();
    try { await request('/v1/terminate'); } finally { client.stop(); }
  } };
}
