import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createKnowledgeAnswer} from '../src/knowledge-answer.mjs';
test('Ask uses fresh page evidence with scoped reply history and cannot accept invented page citations',async()=>{
 const origin='https://equipment.test',authority=new SessionAuthority();let seen,forge=false,calls=0;
 const installation=authority.registerApproved({embeddingId:'equipment',origins:[origin],expiresAt:Date.now()+600000});
 const answer=createKnowledgeAnswer({gatewayUrl:'https://model.invalid/complete',serviceToken:'x'.repeat(32),fetchImpl:async(_,options)=>{
  calls++;seen=JSON.parse(JSON.parse(options.body).messages.at(-1).content);const source=seen.evidence[0];return new Response(JSON.stringify({content:JSON.stringify({evidenceStatus:'supported',message:'107 assets are registered.',citations:[{chunkId:forge?'current-page-999':source.chunkId,quote:'107 registered assets'}]})}));
 }});
 const server=createAdoptionServer({authority,knowledge:{retrieve:async()=>({evidence:[]})},answer});server.listen(0,'127.0.0.1');await once(server,'listening');
 const post=(path,body,token,source=origin)=>fetch(`http://127.0.0.1:${server.address().port}`+path,{method:'POST',headers:{Origin:source,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 try{
  const a=await(await post('/v1/sessions',installation)).json(),b=await(await post('/v1/sessions',installation)).json();
  const input={text:'What is the register size?',snapshot:{revision:1,path:'/equipment',fields:[],pageContext:{text:'107 registered assets',headings:[],headingCount:0,truncated:false}}};
  const response=await post('/v1/ask',input,a.sessionToken),first=await response.json();assert.equal(response.status,200,JSON.stringify(first));assert.equal(first.pageObserved,true);assert.equal(seen.observed.path,'/equipment');
  assert.equal((await post('/v1/ask',{...input,replyTo:first.messageId},b.sessionToken)).status,403);
  assert.equal((await post('/v1/ask',{...input,replyTo:first.messageId},a.sessionToken)).status,200);assert.equal(seen.replyingTo,first.message);
  assert.equal((await post('/v1/ask',input,a.sessionToken,'https://other.test')).status,403);
  const before=calls;assert.equal((await post('/v1/ask',{...input,snapshot:{...input.snapshot,pageContext:{...input.snapshot.pageContext,structure:[{role:'input',label:'x',region:'x',disabled:'false'}]}}},a.sessionToken)).status,403);assert.equal(calls,before);
  forge=true;const forged=await post('/v1/ask',input,a.sessionToken);assert.equal(forged.status,502);assert.ok(!(await forged.json()).message);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
