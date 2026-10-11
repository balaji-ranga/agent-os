import {validateSource} from './knowledge-contract.js';
import {sourceRecords,assertKnowledgeSourceAccess,knowledgeConnectionRef} from './knowledge-source-adapters.js';
import {recordSelected,projectKnowledgeRecord,selectionSchema} from './knowledge-selection.js';
import {recordPreview} from './knowledge-record-page.js';

export async function previewKnowledgeSelection(owner,input,deps={}){
  const source=validateSource(input),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(new Error('Preview time limit reached; narrow the provider scope')),15000);
  const samples=[],fields=new Set(selectionSchema(source.kind).fields);let checked=0,matched=0,truncated=false;
  try{
    source.connection_ref=await(deps.connectionRef||knowledgeConnectionRef)(owner,source.kind);
    await(deps.assertAccess||assertKnowledgeSourceAccess)(owner,source);
    for await(const record of (deps.records||sourceRecords)(owner,source,{signal:controller.signal})){
      controller.signal.throwIfAborted();checked++;
      const walk=(value,path,depth=0)=>{if(depth>5)return;for(const [k,v] of Object.entries(value||{})){if(!/^[a-zA-Z0-9_]+$/.test(k)||['__proto__','constructor','prototype'].includes(k))continue;const p=`${path}.${k}`;if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,p,depth+1);else if(fields.size<200)fields.add(p);}};
      walk(record.fields,'fields');
      if(recordSelected(record,source.selection)){matched++;if(samples.length<10){const r=projectKnowledgeRecord(record,source.selection);samples.push({object_id:r.object_id,title:r.title,preview:recordPreview(r)});}}
      if(checked>=100){truncated=true;break;}
    }
    await(deps.assertAccess||assertKnowledgeSourceAccess)(owner,source);
    return {checked,matched,samples,fields:[...fields],truncated,note:'Read-only sample of at most 100 normalized records; not a total count. Rules apply after fetching. No index or source records changed.'};
  }finally{clearTimeout(timeout);}
}
