import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createHostOutcomeSigner} from '../integrations/host-outcome-signer.mjs';
import {createHostIdentity} from '../src/host-identity.mjs';
import {openRepository} from '../src/repository.mjs';

test('host receipt signer hashes independent readback and rejects incomplete, old or foreign task bindings',async()=>{
 const keys=generateKeyPairSync('ed25519'),repository=openRepository(),clock=()=>1_000_000,owner={embeddingId:'receipt-fixture',origin:'http://127.0.0.1:4194',role:'maintainer'},host=createHostIdentity(repository,{clock});
 try{
  const policy=host.configure(owner,{required:false,issuer:owner.origin,publicKeys:[{...keys.publicKey.export({format:'jwk'}),kid:'test-key'}],roles:['receipt-reader']});
  const binding={sessionId:'session-one',proposalId:'proposal-one',path:'/customer',operationId:'operation-one'};
  let saved={...binding,subject:'host-user',tenant:'synthetic',roles:['receipt-reader'],savedAt:clock(),success:true,readBack:true,record:{company:'PRIVATE_HOST_VALUE',id:'record-one'}};
  const issue=createHostOutcomeSigner({privateKey:keys.privateKey.export({format:'pem',type:'pkcs8'}),keyId:'test-key',issuer:owner.origin,embeddingId:owner.embeddingId,policyRevision:policy.revision,roles:['receipt-reader'],clock,readSavedTask:async()=>saved});
  const receipt=await issue(binding),claims=JSON.parse(Buffer.from(receipt.split('.')[1],'base64url'));
  assert.doesNotMatch(JSON.stringify(claims),/PRIVATE_HOST_VALUE/);assert.equal(claims.recordHash.length,64);
  assert.equal(host.verifyOutcome({...owner,sessionId:binding.sessionId},owner.origin,receipt,binding).operationId,binding.operationId);
  assert.throws(()=>host.verify(owner.embeddingId,owner.origin,receipt));
  for(const patch of [{success:false},{readBack:false},{savedAt:clock()-120_000},{proposalId:'another-proposal'},{sessionId:'another-session'},{roles:['administrator']}]){saved={...saved,...patch};await assert.rejects(issue(binding),/readback/);saved={...binding,subject:'host-user',tenant:'synthetic',roles:['receipt-reader'],savedAt:clock(),success:true,readBack:true,record:{id:'record-one'}};}
  await assert.rejects(issue({...binding,recordHash:'browser-invented'}),/readback/);
 }finally{repository.close();}
});
