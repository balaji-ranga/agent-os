import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createAdoptionServer} from '../src/server.mjs';
test('ambiguous reviewed workflows block planning; disabling one permits a fresh scoped proposal',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository}),learning=createLearningRuntime(repository,createLearningStore(repository)),origin='https://fixture.test',owner={embeddingId:'intent-site',audienceId:'public',audienceIds:['public'],role:'maintainer'},snapshot={revision:1,path:'/search',fields:[{ref:'r1f0',key:'query',label:'Search query',type:'text'}],links:[]};let calls=0;
 const installation=authority.registerApproved({embeddingId:owner.embeddingId,origins:[origin],expiresAt:Date.now()+600000}),session=authority.initialize({...installation,origin});
 const drafts=['Search filters A','Search filters B'].map(title=>learning.create(owner,{title,metadata:{purpose:'Review search filters',use_when:'Set search query and transport',expected_outcome:'Requested filters are visible without submission'},steps:[{action:'fill',path:'/search',field:'query',parameter:'query'}]}));learning.observe(owner,snapshot);for(const draft of drafts){learning.validate(owner,{id:draft.id,version:1});learning.publish(owner,{id:draft.id,version:1,reviewed:true});}
 const server=createAdoptionServer({authority,learning,proposals:createProposalStore(repository),planner:async()=>{calls++;return {message:'Review',actions:[{type:'fill',ref:'r1f0',value:'new-query'}]};}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const plan=async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/plan`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${session.sessionToken}`,'Content-Type':'application/json'},body:JSON.stringify({text:'Set search query and transport',snapshot})});assert.equal(response.status,200);return response.json();};
 try{const paused=await plan();assert.deepEqual(paused.actions,[]);assert.match(paused.message,/More than one reviewed workflow/);assert.equal(calls,0);learning.disable(owner,{id:drafts[1].id,version:2});assert.equal((await plan()).actions.length,1);assert.equal(calls,1);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
