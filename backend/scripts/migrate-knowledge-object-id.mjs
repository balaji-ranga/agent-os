// Add a searchable identifier to existing snapshots without re-fetching sources
// or recomputing embeddings. Idempotent, throttled, content-preserving migration.
import {opensearchRequest as request} from '../src/services/opensearch/client.js';
const indexes=await request('GET','/_cat/indices/aos-knowledge-*?format=json&h=index');
for(const row of indexes){
 const index=row.index;
 if(!/^aos-knowledge-[a-f0-9]{24}$/.test(index))throw new Error('Unexpected Knowledge index name');
 await request('PUT',`/${index}/_mapping`,{properties:{object_id:{type:'keyword'}}});
 const query={bool:{filter:[{terms:{kind:['entity','chunk']}}],must_not:[{exists:{field:'object_id'}}]}};
 const count=await request('POST',`/${index}/_count`,{query});
 if(!count.count)continue;
 const started=await request('POST',`/${index}/_update_by_query?conflicts=proceed&wait_for_completion=false&scroll_size=100&requests_per_second=2&refresh=true`,{query});
 if(!started.task)throw new Error('Migration task ID missing');
 let finished=false;
 for(let poll=0;poll<600;poll++){
   const task=await request('GET',`/_tasks/${encodeURIComponent(started.task)}`);
   if(task.completed){if(task.error||task.response?.failures?.length)throw new Error('Knowledge identifier migration failed');finished=true;break;}
   await new Promise(resolve=>setTimeout(resolve,1000));
 }
 if(!finished)throw new Error('Migration still running; defer release and rerun after completion');
 const remaining=await request('POST',`/${index}/_count`,{query});
 if(remaining.count)throw new Error('Unmigrated identifiers remain; rerun before release');
 console.log(JSON.stringify({migration:'knowledge-object-id',index,updated:count.count}));
}
console.log('Knowledge object identifiers searchable; indexed content and embeddings preserved.');
