// Explicit semantic recording. Values, raw HTML and keystrokes are never captured.
export function createRecorder(document) {
  let state='idle', steps=[];
  const fieldId=element=>element.getAttribute('data-adoption-id')||element.name||'';
  const handler=event=>{
    if(state!=='recording'||steps.length>=24)return;
    const target=event.target;
    if(!target?.closest||target.closest('[data-adoption-widget],[data-adoption-private]'))return;
    if(event.type==='change'&&target.matches('input,textarea,select')){
      const id=fieldId(target);
      if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id)||/password|token|secret|otp|cvv|credit.?card|api.?key|access.?key|private.?key/i.test(`${id} ${target.autocomplete}`)||['password','hidden','file'].includes(target.type))return;
      steps.push({action:'fill',path:document.location.pathname,field:id,parameter:id});
    }
    if(event.type==='click'){
      const link=target.closest('a[href][data-adoption-navigation="safe"]');
      if(!link)return;
      const url=new URL(link.href);
      if(url.origin!==document.location.origin||url.search||url.hash)return;
      steps.push({action:'navigate',path:url.pathname});
    }
  };
  return {
    start(){if(state==='recording'||state==='paused')throw new Error('Recording already active');steps=[];state='recording';document.addEventListener('click',handler,true);document.addEventListener('change',handler,true);},
    pause(){if(state!=='recording')throw new Error('Recording is not active');state='paused';},
    resume(){if(state!=='paused')throw new Error('Recording is not paused');state='recording';},
    stop(){state='stopped';document.removeEventListener('click',handler,true);document.removeEventListener('change',handler,true);return structuredClone(steps);},
    state(){return state;},
  };
}

export async function replayNavigation(document,{path,approved,active=()=>true}){
  if(approved!==true||typeof path!=='string')throw new Error('Navigation review required');
  const destination=new URL(path,document.location.origin);
  if(destination.origin!==document.location.origin||destination.search||destination.hash)throw new Error('Unsupported destination');
  const matches=[...document.querySelectorAll('a[href][data-adoption-navigation="safe"]')].filter(link=>
    link.getClientRects().length>0&&link.href===destination.href&&!link.closest('[data-adoption-private],[data-adoption-widget]'));
  if(matches.length!==1)throw new Error('Recorded navigation is missing or ambiguous');
  if([...document.querySelectorAll('input,textarea,select')].some(field=>!field.closest('[data-adoption-private],[data-adoption-widget]')&&field.getClientRects().length&&field.value&&field.value!==field.defaultValue))throw new Error('Save or discard the current draft before replay.');
  if(!active())throw new Error('Replay stopped');
  matches[0].click();
  for(let attempt=0;attempt<50;attempt++){
    if(!active())throw new Error('Replay stopped');
    if(document.location.pathname===destination.pathname)return {dispatched:true,expectedPath:destination.pathname,verified:true};
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('Replay destination was not verified. No next step will run.');
}
