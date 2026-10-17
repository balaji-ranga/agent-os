import {setTimeout as delay} from 'node:timers/promises';
import {createIngestionWorker} from '../../src/ingestion-worker.mjs';
import {createDocumentExtractor} from '../../src/document-extractor.mjs';
const worker=createIngestionWorker({coordinatorUrl:process.env.ADOPTION_TEST_COORDINATOR,token:process.env.ADOPTION_TEST_WORKER_TOKEN,development:true,extract:createDocumentExtractor({python:'/opt/adoption-python/bin/python'})});
let stopped=false;process.on('SIGTERM',()=>{stopped=true;worker.stop();});
while(!stopped){try{if(!await worker.once())await delay(50);}catch{await delay(100);}}
