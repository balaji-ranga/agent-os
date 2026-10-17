import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createAdoptionServer} from '../src/server.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {openRepository} from '../src/repository.mjs';

test('real HTTP overload returns readable 429 before conversation mutation and restores slots after completion',async()=>{
 const repository=openRepository(),authority=new SessionAuthority({repository,development:true}),origin='http://127.0.0.1:4194';let release,entered=0,enteredResolve;
 const gate=new Promise(r=>release=r),both=new Promise(r=>enteredResolve=r);
 const server=createAdoptionServer({authority,proposals:createProposalStore(repository),capacity:{modelConcurrency:2,modelPerDomain:1},planner:async()=>{if(++entered===2)enteredResolve();await gate;return {message:'Ready',actions:[]};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,input,session)=>{const response=await fetch(base+'/v1/'+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.sessionToken}:{})},body:JSON.stringify(input)});return {status:response.status,retry:response.headers.get('retry-after'),body:await response.json()};};
 const task={text:'Explain current screen',snapshot:{revision:1,path:'/',fields:[],links:[]}};let a,b;
 try{
  const sessions=[];for(let i=0;i<3;i++){const install=authority.registerApproved({embeddingId:'capacity-'+i,origins:[origin],expiresAt:Date.now()+600000});sessions.push((await post('sessions',install)).body);}
  a=post('plan',task,sessions[0]);b=post('plan',task,sessions[1]);await both;
  for(const session of [sessions[0],sessions[2]]){const response=await post('plan',task,session);assert.equal(response.status,429);assert.equal(response.retry,'2');assert.match(response.body.error,/busy/);}
  assert.equal((await post('history',{},sessions[2])).body.messages.length,0);
  release();assert.equal((await a).status,200);assert.equal((await b).status,200);assert.equal((await post('plan',task,sessions[2])).status,200);
 }finally{release();await Promise.allSettled([a,b]);server.closeAllConnections();await new Promise(r=>server.close(r));repository.close();}
});
