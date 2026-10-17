import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {setTimeout as wait} from 'node:timers/promises';
const config=JSON.parse(readFileSync(process.env.ADOPTION_DEMO_CONFIG||'/data/demo-public.json','utf8'));
const root=process.env.ADOPTION_FIXTURES||'/data/acceptance-fixtures',tag=process.env.ADOPTION_RUN||`Run${Date.now()}`;
const origin='http://127.0.0.1:4194',records=[],sessions=[];
async function post(path,input,session,expected=200){
 const response=await fetch(new URL(path,config.serviceUrl),{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session.sessionToken}`}:{})},body:JSON.stringify(input),signal:AbortSignal.timeout(60_000)});
 assert.equal(response.status,expected,`${path} expected ${expected}, received ${response.status}`);return response.json();
}
try{
 const a=await post('v1/sessions',config.embeddings[0]),b=await post('v1/sessions',config.embeddings[0]),c=await post('v1/sessions',config.embeddings[1]);sessions.push(a,b,c);
 const fixtures=[['TXT','cedar.txt','text/plain'],['HTML','cedar.html','text/html'],['PDF','cedar.pdf','application/pdf'],['DOCX','cedar.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['PNG','cedar.png','image/png'],['SCAN','cedar-scanned.pdf','application/pdf'],['VIDEO','cedar.mp4','video/mp4']];
 for(const [i,[kind,filename,mime]] of fixtures.entries()){
  if(i===5){console.log('Five-upload budget reached; waiting for the declared rate window.');await wait(61_000);}
  const title=`Cedar${kind}${tag}`;const started=Date.now();
  const input={title,filename,mime,content:readFileSync(join(root,filename)).toString('base64'),sharedConsent:true,operationId:`${tag}-${kind}`};
  const upload=await post('v1/knowledge/upload',input,a);
  let status;
  for(let attempt=0;attempt<90;attempt++){status=await post('v1/knowledge/upload-status',{sourceId:upload.id},a);if(status.status==='ready'||status.status==='failed')break;await wait(1000);}
  assert.equal(status.status,'ready',`${kind}: ${JSON.stringify(status)}`);
  const found=await post('v1/knowledge/search',{text:title},b),evidence=found.evidence.find(e=>e.sourceId===upload.id);
  assert.ok(evidence,`${kind} searchable from independent same-embedding session`);assert.match(evidence.text,/forty two hours/i);assert.ok(evidence.locator,`${kind} source/page/time citation`);
  assert.equal((await post('v1/knowledge/search',{text:title,embeddingId:config.embeddings[0].embeddingId},c)).evidence.length,0);
  records.push({kind,title,sourceId:upload.id,status:'passed',locator:evidence.locator,elapsedMs:Date.now()-started});
  console.log(`${kind}: uploaded, processed, cited in session B and excluded from embedding C.`);
 }
 const answer=await post('v1/ask',{text:`According to ${records.at(-1).title}, what is the Cedar support window?`},b);
 assert.match(answer.message,/forty.?two|42/i);assert.ok(answer.citations.some(c=>c.locator));
 await post('v1/history/clear',{},a);
 assert.ok((await post('v1/knowledge/search',{text:records[0].title},b)).evidence.length);
 const result={build:process.env.ADOPTION_BUILD||'unknown',kind:'live-api-and-real-extraction',records,answer:answer.message,citations:answer.citations.map(c=>({title:c.title,locator:c.locator,revision:c.revision})),sharedAfterChatClear:true,fullPhaseCertification:false};
 writeFileSync(process.env.ADOPTION_RESULT||'/data/document-acceptance-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{for(const session of sessions)try{await post('v1/terminate',{},session);}catch{}}
