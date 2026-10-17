import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {generateKeyPairSync} from 'node:crypto';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createHostIdentity} from '../src/host-identity.mjs';
import {createHostOutcomeSigner} from '../integrations/host-outcome-signer.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createAdoptionServer} from '../src/server.mjs';

test('real repository HTTP learning binds consumed fill and Save to one signed readback and rejects another session',async()=>{
 const repository=openRepository(),origin='https://fixture.test',embeddingId='receipt-http',hostIdentity=createHostIdentity(repository),keys=generateKeyPairSync('ed25519'),owner={embeddingId,origin,role:'maintainer',audienceIds:['public']};
 const policy=hostIdentity.configure(owner,{required:false,issuer:origin,publicKeys:[{...keys.publicKey.export({format:'jwk'}),kid:'fixture'}],roles:['participant']}),authority=new SessionAuthority({repository,hostIdentity}),installation=authority.registerApproved({embeddingId,origins:[origin],expiresAt:Date.now()+600000}),learning=createLearningRuntime(repository,createLearningStore(repository));learning.settings(owner,{enabled:true});
 const server=createAdoptionServer({authority,hostIdentity,learning,proposals:createProposalStore(repository),planner:async()=>({message:'Review',actions:[{type:'fill',ref:'r1f0',value:'PRIVATE_VALUE_NOT_SHARED'}]})});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const post=async(path,input,s)=>{const r=await fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(s?{Authorization:'Bearer '+s.sessionToken}:{})},body:JSON.stringify(input)});return {status:r.status,body:await r.json()};};
 try{
  const a=(await post('/v1/sessions',installation)).body,b=(await post('/v1/sessions',installation)).body;
  const snapshot={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'company_name',label:'Company name',type:'text'}]},fill=await post('/v1/plan',{text:'Prepare the customer draft',snapshot},a);assert.equal(fill.status,200);assert.equal((await post('/v1/approve',{id:fill.body.id,revision:1,approved:true},a)).status,200);
  const current={revision:2,path:'/customer',fields:[{ref:'r2f0',key:'company_name',label:'Company name',type:'text'}],submissions:[{ref:'r2s0',label:'Save'}]},save=await post('/v1/save/plan',{snapshot:current,ref:'r2s0'},a);assert.equal(save.status,200);assert.equal((await post('/v1/approve',{id:save.body.id,revision:2,approved:true},a)).status,200);
  const binding={sessionId:a.sessionId,proposalId:save.body.id,path:'/customer',operationId:'operation-one'},issue=createHostOutcomeSigner({privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),keyId:'fixture',issuer:origin,embeddingId,policyRevision:policy.revision,roles:['participant'],readSavedTask:async()=>({...binding,success:true,readBack:true,savedAt:Date.now(),subject:'host-user',tenant:'test',roles:['participant'],record:{company:'PRIVATE_VALUE_NOT_SHARED'}})}),receipt=await issue(binding),input={proposalId:save.body.id,snapshot:current,receipt,consent:true};
  assert.equal((await post('/v1/learning/complete',input,b)).status,403);
  const result=await post('/v1/learning/complete',input,a);assert.equal(result.status,200);assert.equal(result.body.created,true);assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE_VALUE_NOT_SHARED/);assert.equal(result.body.recipe.steps[0].field,'company_name');assert.equal((await post('/v1/learning/complete',input,a)).body.recipe.id,result.body.recipe.id);assert.equal(repository.map('verified_candidates').values().length,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));repository.close();}
});

