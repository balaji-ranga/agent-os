import {erpGet} from './erpnext-erp.js';
import {assertKnowledgeSourceAccess,businessRecord} from './knowledge-source-adapters.js';

// Read-only, owner-bound lookups. Never derive a provider URL or credential from
// retrieved text. Unsupported providers stay explicitly identified as snapshots.
export async function refreshKnowledgeValues(owner,records,sources,{read=erpGet,assertAccess=assertKnowledgeSourceAccess,timeoutMs=8000}={}) {
  const deadline=Date.now()+timeoutMs,output=[],checks=[];
  let requested=0;
  for(const record of records){
    const source=sources.find(s=>s.id===record.source);
    const prefix='Sales Invoice/';
    if(source?.kind!=='erp'||!String(record.object_id).startsWith(prefix)){
      output.push({...record,value_origin:'indexed_snapshot'});continue;
    }
    if(++requested>5||Date.now()>=deadline){checks.push({entity:record.entity,status:'budget_exhausted'});continue;}
    let timer;
    try{
      await assertAccess(owner,source);
      const result=await Promise.race([read(owner,'Sales Invoice',record.object_id.slice(prefix.length)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Live lookup timeout')),Math.max(1,deadline-Date.now()));})]);
      if(result?.mode!=='live'||!result.data)throw new Error('Live document unavailable');
      await assertAccess(owner,source);
      const fresh=businessRecord('Sales Invoice',result.data,'erp');
      if(fresh.object_id!==record.object_id)throw new Error('Live identity mismatch');
      // Indexed relationships must not connect a reassigned invoice to its old customer/project.
      if(['customer','project'].some(key=>(fresh.fields[key]??null)!==(record.fields?.[key]??null))){checks.push({entity:record.entity,status:'relationship_changed_resync_required'});continue;}
      const checkedAt=new Date().toISOString();
      output.push({...record,text:fresh.text,fields:fresh.fields,modified_at:fresh.modified_at,value_origin:'live',live_checked_at:checkedAt});
      checks.push({entity:record.entity,status:'verified',checked_at:checkedAt,operation:'erp.get Sales Invoice'});
    }catch{checks.push({entity:record.entity,status:'unavailable_or_not_authorized'});}
    finally{clearTimeout(timer);}
  }
  return {records:output,checks};
}
