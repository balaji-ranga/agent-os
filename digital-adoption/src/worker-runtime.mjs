import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {createDocumentExtractor} from './document-extractor.mjs';
import {createIngestionWorker} from './ingestion-worker.mjs';

const config=JSON.parse(readFileSync('/config/worker.json','utf8'));
const worker=createIngestionWorker({...config,extract:createDocumentExtractor({python:'/opt/adoption-python/bin/python'})});
let stopped=false,failures=0;
process.on('SIGTERM',()=>{stopped=true;worker.stop();});
process.on('SIGINT',()=>{stopped=true;worker.stop();});
console.log('Document worker started; credentials and website content are not logged');
while(!stopped){
 try{const busy=await worker.once();failures=0;if(!busy)await delay(1000+Math.random()*500);}
 catch{failures++;await delay(Math.min(30_000,1000*2**Math.min(failures,5))+Math.random()*500);}
}
