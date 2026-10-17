import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SessionAuthority} from '../src/session-authority.mjs';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createAdoptionServer} from '../src/server.mjs';
test('planner receives selected reply context only from its own session and channel',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository}),origin='https://customer.test';let observed;
 const installation=authority.registerApproved({embeddingId:'reply-test',origins:[origin],expiresAt:Date.now()+600_000});
 const server=createAdoptionServer({authority,proposals:createProposalStore(repository),planner:async input=>{observed=input;return {message:'Please clarify the title',actions:[]};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,input,token)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token||''}`},body:JSON.stringify(input)});
 try{
  const first=await(await post('/v1/sessions',installation)).json(),second=await(await post('/v1/sessions',installation)).json();
  const task={text:'Prepare a draft',snapshot:{revision:1,fields:[{ref:'r1f0',label:'Title',type:'text'}]}};
  const proposal=await(await post('/v1/plan',task,first.sessionToken)).json();assert.ok(proposal.messageId);
  assert.equal((await post('/v1/plan',{...task,replyTo:proposal.messageId},second.sessionToken)).status,403);
  assert.equal((await post('/v1/plan',{...task,replyTo:proposal.messageId},first.sessionToken)).status,200);
  assert.equal(observed.replyContext,'Please clarify the title');
  const wrongChannel=authority.appendAssistant({sessionToken:first.sessionToken,origin},'Knowledge only','knowledge');
  assert.equal((await post('/v1/plan',{...task,replyTo:wrongChannel.id},first.sessionToken)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
