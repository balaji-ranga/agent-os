// Explicit semantic recording. Values, raw HTML and keystrokes are never captured.
import {semanticFieldKey} from './semantic.mjs';
import {activateNavigation} from './activation.mjs';
export function createRecorder(document) {
  let state='idle', steps=[],pendingNavigation=null;
  const flushNavigation=()=>{if(pendingNavigation&&state==='recording'&&steps.length<24&&document.location.pathname===pendingNavigation.path&&pendingNavigation.before!==pendingNavigation.path){steps.push({action:'navigate',path:pendingNavigation.path,activation:pendingNavigation.activation});pendingNavigation=null;}};
  const fieldId=element=>semanticFieldKey(element,element.getAttribute('aria-label')||[...(element.labels||[])].map(l=>{const copy=l.cloneNode?.(true);if(!copy)return l.textContent;for(const control of copy.querySelectorAll('input,textarea,select,button'))control.remove();return copy.textContent;}).join(' ')||element.placeholder||'');
  const handler=event=>{
    if(state!=='recording'||steps.length>=24)return;flushNavigation();if(steps.length>=24)return;
    const target=event.target;
    if(!target?.closest||target.closest('[data-adoption-widget],[data-adoption-private]'))return;
    if(event.type==='change'&&target.matches('input,textarea,select')){
      const id=fieldId(target);
      if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)||/password|token|secret|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(`${id} ${target.autocomplete}`)||['password','hidden','file'].includes(target.type))return;
      steps.push({action:'fill',path:document.location.pathname,field:id,parameter:id});
    }
    if(['click','mousedown','pointerdown'].includes(event.type)){
      const link=target.closest('a[href][data-adoption-navigation="safe"]');
      if(!link)return;
      const url=new URL(link.href);
      if(url.origin!==document.location.origin||url.search||url.hash)return;
      if(event.type==='click'){
        pendingNavigation=null;
        if(steps.at(-1)?.action==='navigate'&&steps.at(-1)?.path===url.pathname&&steps.at(-1)?.activation)return;
        steps.push({action:'navigate',path:url.pathname});
      }else{
        const pending={before:document.location.pathname,path:url.pathname,activation:event.type};pendingNavigation=pending;
        setTimeout(()=>{if(pendingNavigation===pending)flushNavigation();},0);
      }
    }
  };
  return {
    start(){if(state==='recording'||state==='paused')throw new Error('Recording already active');steps=[];pendingNavigation=null;state='recording';for(const type of ['click','change','mousedown','pointerdown'])document.addEventListener(type,handler,true);},
    pause(){if(state!=='recording')throw new Error('Recording is not active');flushNavigation();state='paused';},
    resume(){if(state!=='paused')throw new Error('Recording is not paused');state='recording';},
    stop(){flushNavigation();pendingNavigation=null;state='stopped';for(const type of ['click','change','mousedown','pointerdown'])document.removeEventListener(type,handler,true);return structuredClone(steps);},
    state(){return state;},
  };
}

export async function replayNavigation(document,{path,approved,activation='click',active=()=>true}){
  if(approved!==true||typeof path!=='string')throw new Error('Navigation review required');
  const destination=new URL(path,document.location.origin);
  if(destination.origin!==document.location.origin||destination.search||destination.hash)throw new Error('Unsupported destination');
  const matches=[...document.querySelectorAll('a[href][data-adoption-navigation="safe"]')].filter(link=>
    link.getClientRects().length>0&&link.href===destination.href&&!link.closest('[data-adoption-private],[data-adoption-widget]'));
  if(matches.length!==1)throw new Error('Recorded navigation is missing or ambiguous');
  if([...document.querySelectorAll('input,textarea,select')].some(field=>!field.closest('[data-adoption-private],[data-adoption-widget]')&&field.getClientRects().length&&field.value&&field.value!==field.defaultValue))throw new Error('Save or discard the current draft before replay.');
  if(!active())throw new Error('Replay stopped');
  activateNavigation(matches[0],activation);
  for(let attempt=0;attempt<50;attempt++){
    if(!active())throw new Error('Replay stopped');
    if(document.location.pathname===destination.pathname)return {dispatched:true,expectedPath:destination.pathname,verified:true};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Replay destination was not verified. No next step will run.');
}
