import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {SessionAuthority} from '../src/session-authority.mjs';
import {openRepository} from '../src/repository.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createAdoptionServer} from '../src/server.mjs';
test('HTTP action boundary rejects foreign approvals and revocation during planning',async()=>{
 const repository=openRepository();const authority=new SessionAuthority({repository});
 const origin='https://customer.test';const installation=authority.registerApproved({embeddingId:'one',origins:[origin],expiresAt:Date.now()+600_000});
 let release,entered,hold=false;
 const planner=async()=>{if(hold){entered();await new Promise(resolve=>{release=resolve;});}return {message:'Review synthetic value',actions:[{type:'fill',ref:'r1f0',value:'Synthetic'}]};};
 const server=createAdoptionServer({authority,proposals:createProposalStore(repository),planner});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=(path,data={},token)=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});
 const task={text:'Set name to Synthetic',snapshot:{revision:1,fields:[{ref:'r1f0',label:'Name',type:'text'}]}};
 try{
  const a=await(await post('/v1/sessions',installation)).json(),b=await(await post('/v1/sessions',installation)).json();
  const proposal=await(await post('/v1/plan',task,a.sessionToken)).json();
  const approval={id:proposal.id,revision:1,approved:true};
  assert.equal((await post('/v1/approve',approval,b.sessionToken)).status,403);
  assert.equal((await post('/v1/approve',approval,a.sessionToken)).status,200);
  assert.equal((await post('/v1/approve',approval,a.sessionToken)).status,403);
  hold=true;const started=new Promise(resolve=>{entered=resolve;});
  const delayed=post('/v1/plan',task,a.sessionToken);await started;
  authority.revokeInstallation(installation.installationId);release();
  const denied=await delayed;assert.equal(denied.status,403);assert.equal(JSON.stringify(await denied.json()).includes('Synthetic'),false);
  assert.equal((await post('/v1/renew',{},a.sessionToken)).status,403);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});
