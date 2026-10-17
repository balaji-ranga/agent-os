import {readFile} from 'node:fs/promises';
import {createIngestionWorker} from '../../src/ingestion-worker.mjs';
const [coordinatorUrl,token,workerId,mode]=process.argv.slice(2);
const worker=createIngestionWorker({coordinatorUrl,token,workerId,development:true,extract:async({path})=>{
 process.send({extracting:true});
 if(mode==='hold')await new Promise(()=>{});
 return {sections:[{locator:'Document',text:await readFile(path,'utf8')}]};
}});
process.send({ready:true});
process.on('message',async m=>{if(m.run){try{process.send({done:true,result:await worker.once()});}catch{process.send({done:true,result:false});}}});
process.on('SIGTERM',()=>{worker.stop();process.exit(0);});
