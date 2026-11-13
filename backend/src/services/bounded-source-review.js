/** Generic read-only map/reduce review. Provider cursors stay outside LLM control. */
export function validateSourceDigest(batch,result){
 if(!Array.isArray(result)||result.length!==batch.length)throw Error('review_digest_incomplete');
 for(let i=0;i<batch.length;i++){
  const source=batch[i],item=result[i];
  if(item?.source_id!==source.source_id||typeof item.summary!=='string'||!item.summary.trim()||item.summary.length>1200||!Array.isArray(item.evidence)||(!item.evidence.length&&item.grounding!=='source_reference')||item.evidence.length>8||item.evidence.some(q=>typeof q!=='string'||!q.trim()||q.length>500||!source.content.includes(q)))throw Error('review_digest_ungrounded');
 }
 return result;
}
export async function boundedSourceReview({request,read,digest,reduce,clock=Date.now,deadline=clock()+180000,maxSources=100,maxPages=200,maxCharacters=300000,batchCharacters=24000}){
 const seen=new Set(),inventory=new Set(),expectedParts=new Map(),digestedParts=new Map(),findings=[],failures=[];let pages=0,characters=0,window,more=true,batch=[],batchSize=0,modelCalls=0;
 const guard=()=>{if(clock()>=deadline)throw Error('review_time_limit');if(pages>=maxPages)throw Error('review_page_limit');};
 const fetchPage=async input=>{guard();pages++;return read(input);};
 const flush=async()=>{
  if(!batch.length)return;guard();if(modelCalls>=16)throw Error('review_model_call_limit');modelCalls++;
  const result=await digest(batch,{timeoutMs:Math.max(1,Math.min(30000,deadline-clock()))});
  validateSourceDigest(batch,result);
  findings.push(...result.map((item,i)=>({...item,part:batch[i].part,parts:batch[i].parts})));
  for(const source of batch)digestedParts.set(source.source_id,(digestedParts.get(source.source_id)||0)+1);
  batch=[];batchSize=0;
 };
 try{
 let discovery=await fetchPage(request);window=discovery.effective_window;
  if(!discovery.discovery_only)throw Error('review_requires_discovery');
  while(true){
   more=!!discovery.more_candidates;
   for(const source of discovery.source_candidates||[])inventory.add(source.source_id);
   for(const source of discovery.source_candidates||[]){
    if(seen.has(source.source_id))continue;if(seen.size>=maxSources)throw Error('review_source_limit');seen.add(source.source_id);
    let page=await fetchPage({app_id:source.app_id,source_id:source.source_id}),content='';
    while(true){
     if(!page.content_verified||typeof page.content!=='string')throw Error('review_source_unverified');
     characters+=page.content.length;if(characters>maxCharacters)throw Error('review_character_limit');content+=page.content;
     if(page.coverage_complete)break;if(!page.next_request)throw Error('review_provider_incomplete');page=await fetchPage(page.next_request);
    }
    const parts=Math.max(1,Math.ceil(content.length/batchCharacters));expectedParts.set(source.source_id,parts);
    for(let part=0;part<parts;part++){
     const segment=content.slice(part*batchCharacters,(part+1)*batchCharacters);
     if(batchSize+segment.length>batchCharacters||batch.length>=6)await flush();
     batch.push({...source,content:segment,part:part+1,parts});batchSize+=segment.length;
    }
   }
   more=!!discovery.more_candidates;
   if(!more)break;
   if(!discovery.next_request)throw Error('review_discovery_incomplete');
   discovery=await fetchPage(discovery.next_request);
   if(!discovery.discovery_only)throw Error('review_invalid_discovery_page');
  }
  await flush();
 }catch(error){failures.push(String(error.message||error));}
 let summary;
 if(reduce&&findings.length&&!failures.length)try{guard();summary=await reduce(findings,{timeoutMs:Math.max(1,Math.min(30000,deadline-clock()))});if(typeof summary!=='string'||!summary.trim()||summary.length>7000)throw Error('review_summary_invalid');}catch(e){failures.push(String(e.message||e));}
 const reviewed=[...expectedParts].filter(([id,count])=>digestedParts.get(id)===count).length;
 return {effective_window:window,review_complete:!more&&!failures.length,discovered:inventory.size,reviewed,unreviewed:inventory.size-reviewed,discovery_complete:!more,pages,source_characters:characters,digest_calls:modelCalls,...(summary?{summary,reviewed_source_ids:[...seen]}:{findings}),failures,
  guidance:'These are source-backed bounded batch digests, not raw mail. Cite source IDs and distinguish historical notices from current obligations. Only review_complete=true permits a whole-period summary. Any failure means partial coverage; do not claim all mail was reviewed. Original sources remain available through the authorized source reader.'};
}
