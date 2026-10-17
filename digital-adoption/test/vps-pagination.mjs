import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(process.env.ADOPTION_DEMO_CONFIG||'.local/demo-public.json','utf8')),origin='http://127.0.0.1:4194';
async function post(path,input,session){const response=await fetch(new URL(path,config.serviceUrl),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(input)});assert.equal(response.status,200,path);return response.json();}
const session=await post('v1/sessions',config.embeddings[0]);
try{
 const first=await post('v1/knowledge/search',{text:'Cedar',size:2},session);assert.equal(first.evidence.length,2,'Run the retained document acceptance fixture first');assert.match(first.next,/^r1_/);
 const second=await post('v1/knowledge/search',{text:'Cedar',size:2,after:first.next},session);assert.ok(second.evidence.length);assert.equal(second.evidence.some(e=>first.evidence.some(p=>p.chunkId===e.chunkId)),false);
 console.log(JSON.stringify({kind:'live-api',rankedPagination:true,firstCount:first.evidence.length,nextCount:second.evidence.length,overlap:false,fullPhaseCertification:false}));
}finally{await post('v1/terminate',{},session);}
