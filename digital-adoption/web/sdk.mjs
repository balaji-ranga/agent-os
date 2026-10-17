import { createInspector } from './dom.mjs';
import { normalizeTheme } from './theme.mjs';
import { createSessionClient } from './session-client.mjs';
import {createRecorder,replayNavigation} from './recording.mjs';

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
  const frame = document.createElement('iframe');
  frame.dataset.adoptionWidget = 'true'; frame.title = 'Flolah Digital Adoption Copilot';
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
      if (message.type === 'config') result = {theme:appearance};
      else if(message.type==='appearance'||message.type==='appearance-reset'){
        appearance=message.type==='appearance-reset'?hostAppearance:normalizeTheme({...appearance,...message.theme});applyAppearance();result={theme:appearance};
      }
      else if (message.type === 'minimize') {frame.hidden=true;launcher.hidden=false;launcher.focus();result={minimized:true};}
      else if (message.type === 'history') result = await request('/v1/history');
      else if(message.type==='clear-history'){taskGeneration++;currentSnapshot=null;result=await request('/v1/history/clear');}
      else if(message.type==='documents')result=await request('/v1/knowledge/documents');
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
      else if (message.type === 'inspect') result = inspector.snapshot();
      else if (message.type === 'plan') {
        const generation=++taskGeneration;
        currentSnapshot = inspector.snapshot();
        result = await request('/v1/plan',{ text:message.text,snapshot:currentSnapshot,replyTo:message.replyTo });
        if(generation!==taskGeneration)throw new Error('Task stopped; proposal discarded');
      }
      else if (message.type === 'approve') {
        if (!currentSnapshot) throw new Error('Inspect and review again');
        const proposal = await request('/v1/approve',{ id:message.proposalId,revision:currentSnapshot.revision,approved:true });
        const results=[];
        const generation=taskGeneration;
        for (const action of proposal.actions) {
          if(closed||generation!==taskGeneration)throw new Error('Task stopped; remaining actions cancelled');
          if(action.type==='navigate')results.push(await inspector.navigate({ref:action.ref,expectedRevision:proposal.revision,approved:true}));
          else results.push(inspector.fill({ ref:action.ref,value:action.value,expectedRevision:proposal.revision,approved:true }));
        }
        currentSnapshot=null; result={ results,saved:false };
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
      closed = true;currentSnapshot=null;recorder.stop();client.stop();clearInterval(timer);
      frame.title = 'Copilot session expired; reload to reconnect';
      frame.contentWindow?.postMessage({channel:'flolah-adoption-v1',type:'expired'},service.origin);
    }
  }, 240_000);
  return { updateTheme: patch => {appearance=normalizeTheme({...appearance,...patch});hostAppearance=appearance;applyAppearance();}, destroy: async () => {
    closed = true;recorder.stop(); clearInterval(timer); window.removeEventListener('message', handler); frame.remove();launcher.remove();
    try { await request('/v1/terminate'); } finally { client.stop(); }
  } };
}
