import { knowledgeStore } from '../src/services/knowledge-store.js';
import { runKnowledgeJob } from '../src/services/knowledge-runtime.js';

if(process.env.KNOWLEDGE_SYNC_ENABLED!=='1')throw new Error('Set KNOWLEDGE_SYNC_ENABLED=1 to run this worker');
let stopped=false;
process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});
const store=knowledgeStore();
while(!stopped) {
  const job=store.claim();
  if(job)console.log(JSON.stringify({job:job.id,...await runKnowledgeJob(job,{store})}));
  else await new Promise(resolve=>setTimeout(resolve,3000));
}
