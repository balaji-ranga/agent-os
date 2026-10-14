// Exact window/origin binding; never send messages to a wildcard origin.
let frame=null;
export function embeddedFailureMessage(reason){
  return ({
    review_required:'Review these details again before applying. The previous review was used or cancelled; no fields were changed.',
    review_expired:'This review expired. Select Review setup again, then approve the refreshed details. No fields were changed.',
    screen_changed:'The embedded screen changed. Return to the intended form and review again. No fields were changed.',
    fields_changed:'The form changed or a proposed value is no longer valid. Review setup again to preserve current edits. No fields were changed.',
  })[reason]||'Open the requested field first; hidden or ambiguous controls cannot be guided.';
}
export function registerCopilotEmbed(element,origin){
  const binding={element,origin};frame=binding;
  return()=>{if(frame===binding)frame=null;};
}
export function requestCopilotEmbed(command,field,details={}){
  const bound=frame;
  if(!bound?.element?.isConnected)return Promise.reject(new Error('Open CRM or ERP first.'));
  const request=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=()=>{clearTimeout(timer);window.removeEventListener('message',listener);};
    const listener=e=>{
      if(e.origin!==bound.origin||e.source!==bound.element.contentWindow||e.data?.type!=='flolah-copilot-guide-result'||e.data.request!==request)return;
      finish();if(frame!==bound)return reject(new Error('The embedded workspace changed.'));
      e.data.ok?resolve(e.data):reject(new Error(Array.isArray(e.data.applied)&&e.data.applied.length?'Some reviewed fields were entered before the form changed. Inspect the record and request a fresh review for remaining fields; do not repeat creation.':embeddedFailureMessage(e.data.reason)));
    };
    const timer=setTimeout(()=>{finish();reject(new Error(['fill','open_form'].includes(command)?'The embedded action did not confirm in time. Inspect the screen before retrying; it may have saved. Do not repeat creation.':'This embedded screen has not connected to guided assistance yet. No values were entered.'));},5000);
    window.addEventListener('message',listener);
    bound.element.contentWindow.postMessage({type:'flolah-copilot-guide',request,command,field,...details},bound.origin);
  });
}
