// Exact window/origin binding; never send messages to a wildcard origin.
let frame=null;
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
      e.data.ok?resolve(e.data):reject(new Error('Open the requested field first; hidden or ambiguous controls cannot be guided.'));
    };
    const timer=setTimeout(()=>{finish();reject(new Error('This embedded screen has not connected to guided assistance yet. No changes were made.'));},5000);
    window.addEventListener('message',listener);
    bound.element.contentWindow.postMessage({type:'flolah-copilot-guide',request,command,field,...details},bound.origin);
  });
}
