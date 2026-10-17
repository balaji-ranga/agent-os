import {createInspector} from './dom.mjs';

// Keep the owning chat and coaching session alive across ordinary document routes.
// Only explicitly reviewed same-origin paths may be loaded. Forms, popups and
// top-level navigation are disabled in the observation frame.
export async function observePage(document,path,paths,{active=()=>true,inspect=createInspector}={}){
 if(!active()||!Array.isArray(paths)||!paths.includes(path)||!/^\/(?!\/)[^?#\\]*$/.test(path))throw new Error('Page is outside the approved website map');
 const target=new URL(path,document.location.origin);
 if(target.origin!==document.location.origin)throw new Error('Website origin changed');
 const frame=document.createElement('iframe');frame.dataset.adoptionWidget='true';frame.dataset.adoptionObservation='true';
 frame.title='Website map observation';frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
 frame.setAttribute('sandbox','allow-same-origin allow-scripts');
 frame.style.cssText='position:fixed;left:-12000px;top:0;width:1280px;height:900px;border:0;pointer-events:none';
 let inspector;
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Page did not load; check framing restrictions or sign-in requirements')),15_000);
   frame.onload=()=>{clearTimeout(timer);resolve();};frame.onerror=()=>{clearTimeout(timer);reject(new Error('Page could not be loaded'));};
   frame.src=target.href;document.body.append(frame);
  });
  if(!active())throw new Error('Website mapping stopped');
  const child=frame.contentDocument;
  if(!child||child.location.origin!==target.origin||child.location.pathname!==path)throw new Error('Page redirected or blocked observation; inspect it manually');
  inspector=inspect(child);inspector.setReadOnlyPaths(paths);
  let previous='',stable=0,snapshot;
  for(let sample=0;sample<40;sample++){
   if(!active())throw new Error('Website mapping stopped');
   snapshot=inspector.snapshot({inventory:true});const fingerprint=JSON.stringify({path:snapshot.path,fields:snapshot.fields,links:snapshot.links},(key,value)=>key==='ref'||key==='revision'?undefined:value);
   stable=fingerprint===previous?stable+1:0;previous=fingerprint;
   if(stable>=3&&sample>=10)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  return snapshot;
 }finally{inspector?.destroy();frame.remove();}
}
