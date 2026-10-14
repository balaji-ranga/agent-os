// Execute navigation only. Filling, creation, sending and calling remain reviewed.
// Dependencies keep the bounded journey testable without a browser or provider.
export async function continueCopilotNavigation({session,catalog,navigate,inspect,propose,onProgress=()=>{},isCurrent=()=>true,maxHops=3}){
  const visited=new Set();let current=session,currentCatalog=catalog;
  for(let hop=0;hop<maxHops;hop++){
    if(!isCurrent())throw new Error('The assistance context changed. Navigation stopped.');
    const actions=current.proposal?.actions||[];
    if(actions.length!==1||!['navigate','embed_navigate'].includes(actions[0].type))return {session:current,catalog:currentCatalog};
    const action=actions[0],screen=currentCatalog.screens.find(s=>s.id===action.screen);
    if(!screen)throw new Error('Your access to the destination changed.');
    const key=JSON.stringify(action);
    if(visited.has(key))return {session:current,catalog:currentCatalog,stopped:true};
    visited.add(key);onProgress(`Opening ${screen.label||screen.id}…`);
    await navigate(action,screen);
    const observed=await inspect(action,screen);
    if(!isCurrent())throw new Error('The assistance context changed. Navigation stopped.');
    currentCatalog=observed.catalog;
    current=await propose(current,observed);
  }
  return {session:current,catalog:currentCatalog,stopped:current.proposal?.actions?.some(a=>['navigate','embed_navigate'].includes(a.type))||false};
}
// Only retry read-only inspection: never replay navigation, creation or filling.
// Elapsed time (not attempt count) accommodates iframe registration and reloads.
export async function waitForCopilotReady({inspect,accept=value=>!!value,isCurrent=()=>true,timeoutMs=30000,intervalMs=500,now=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMessage='The screen is still loading. Your request is retained; no fields were changed.'}){
  const deadline=now()+timeoutMs;
  while(now()<deadline){
    if(!isCurrent())throw new Error('The assistance context changed. Loading wait stopped.');
    let observed;
    try{observed=await inspect();}catch{/* A frame can disconnect while reloading. Retry inspection only. */}
    if(!isCurrent())throw new Error('The assistance context changed. Loading wait stopped.');
    if(now()<deadline&&accept(observed))return observed;
    const remaining=deadline-now();
    if(remaining>0)await sleep(Math.min(intervalMs,remaining));
  }
  throw new Error(timeoutMessage);
}

export function hasCopilotEmbedControls(metadata){
  return !!metadata?.path&&['fields','navigation','forms'].some(key=>Array.isArray(metadata[key])&&metadata[key].length>0);
}

