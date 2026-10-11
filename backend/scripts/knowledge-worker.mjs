import { knowledgeStore } from '../src/services/knowledge-store.js';
import { runKnowledgeJob, cleanupKnowledgeSources } from '../src/services/knowledge-runtime.js';
import { knowledgeAdviceStore, runKnowledgeAdviceBatch } from '../src/services/knowledge-mapping-advice.js';

if(process.env.KNOWLEDGE_SYNC_ENABLED!=='1')throw new Error('Set KNOWLEDGE_SYNC_ENABLED=1 to run this worker');
let stopped=false;
process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
const store=knowledgeStore();
store.workerHeartbeat();
const healthTimer=setInterval(()=>store.workerHeartbeat(),15000);
healthTimer.unref();
while(!stopped) {
  if(store.globallyPaused()){await new Promise(resolve=>setTimeout(resolve,3000));continue;}
  await cleanupKnowledgeSources({store});
  const job=store.claim();
  if(job){
    const result=await runKnowledgeJob(job,{store});
    console.log(JSON.stringify({job:job.id,...result}));
    if(result.status==='completed'&&store.get(job.owner,job.source_id)?.intelligent_mapping){
      try{knowledgeAdviceStore().queue(job.owner,job.source_id,result.revision);}catch(error){console.warn('[knowledge] advice scheduling deferred',error.message);}
    }
  } else {
    await runKnowledgeAdviceBatch({store});
    await new Promise(resolve=>setTimeout(resolve,3000));
  }
}
clearInterval(healthTimer);
