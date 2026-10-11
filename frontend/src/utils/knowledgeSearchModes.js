// Reuse both existing owner-authorized APIs. Auto searches both collections;
// it does not join unrelated records or manufacture cross-index relationships.
export async function searchKnowledgeMode(api,{mode='auto',query,summarize=true,liveValues=false}){
  if(!['auto','documents','connected'].includes(mode))throw new Error('Choose a supported search mode');
  const requests=[];
  if(mode!=='documents')requests.push(['connected',()=>api.knowledgeConnectedSearch({query,summarize,live_values:liveValues,paginate:true})]);
  if(mode!=='connected')requests.push(['documents',()=>api.masterDataRag({query,summarize,top_k:20})]);
  const results=await Promise.allSettled(requests.map(([,run])=>run()));
  const output={mode,errors:[]};
  results.forEach((result,i)=>{
    const kind=requests[i][0];
    if(result.status==='fulfilled')output[kind]=result.value;
    else output.errors.push(`${kind}: ${result.reason?.message||'Search unavailable'}`);
  });
  if(output.errors.length===requests.length)throw new Error(output.errors.join('; '));
  return output;
}
