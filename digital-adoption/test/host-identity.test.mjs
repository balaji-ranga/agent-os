import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {openRepository} from '../src/repository.mjs';
import {createHostIdentity} from '../src/host-identity.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createCoachingGrants} from '../src/coaching-grants.mjs';
import {createSourceMap} from '../src/source-map.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
function setup(){
 let now=1_000_000;const repository=openRepository(),clock=()=>now,hostIdentity=createHostIdentity(repository,{clock}),authority=new SessionAuthority({repository,clock,hostIdentity});
 const owner={embeddingId:'private-host',audienceId:'public',role:'maintainer',origin:'https://any-domain.example.test'},keys=generateKeyPairSync('ed25519');
 const policy=hostIdentity.configure(owner,{required:true,issuer:owner.origin,publicKeys:[{...keys.publicKey.export({format:'jwk'}),kid:'active'}],roles:['reader','manager']});
 const token=(patch={},key=keys.privateKey)=>{const header=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWT',kid:'active'})).toString('base64url'),body=Buffer.from(JSON.stringify({iss:owner.origin,aud:owner.embeddingId,origin:owner.origin,sub:'user',tenant:'tenant-A',roles:['manager'],iat:Math.floor(now/1000),exp:Math.floor(now/1000)+300,policyRevision:policy.revision,...patch})).toString('base64url');return header+'.'+body+'.'+sign(null,Buffer.from(header+'.'+body),key).toString('base64url');};
 const installation=authority.registerApproved({embeddingId:owner.embeddingId,origins:[owner.origin],expiresAt:now+3_600_000});return {repository,hostIdentity,authority,owner,token,installation,clock,advance:ms=>now+=ms};
}
test('private bootstrap rejects missing/forged/foreign/expired identity and never accepts caller-supplied roles',()=>{
 const s=setup();try{
  const input={...s.installation,origin:s.owner.origin};assert.throws(()=>s.authority.initialize(input));
  for(const patch of [{aud:'foreign'},{origin:'https://foreign.example.test'},{iss:'https://foreign.example.test'},{roles:['administrator']},{tenant:'../other'},{exp:999},{exp:2000},{policyRevision:0}])assert.throws(()=>s.authority.initialize({...input,identityToken:s.token(patch)}));
  const other=generateKeyPairSync('ed25519');assert.throws(()=>s.authority.initialize({...input,identityToken:s.token({},other.privateKey)}));
  const session=s.authority.initialize({...input,identityToken:s.token(),roles:['administrator']}),scope=s.authority.context({sessionToken:session.sessionToken,origin:s.owner.origin});assert.equal(scope.capabilities.coach,false);assert.notDeepEqual(scope.audienceIds,['public']);assert.doesNotMatch(JSON.stringify(scope),/privateKey|identityToken|tenant-A/);
 }finally{s.repository.close();}
});

test('saved-record receipts cannot authenticate sessions and bind learning to the exact session and Save',()=>{
 const s=setup();try{
  const session=s.authority.initialize({...s.installation,origin:s.owner.origin,identityToken:s.token()}),scope=s.authority.context({sessionToken:session.sessionToken,origin:s.owner.origin});
  const claims={purpose:'adoption_outcome',sessionId:scope.sessionId,proposalId:'save-review',path:'/public-form',success:true,evidenceKind:'saved-record-readback',operationId:'operation-one',recordHash:'a'.repeat(64)};
  const receipt=s.token(claims);
  assert.throws(()=>s.authority.initialize({...s.installation,origin:s.owner.origin,identityToken:receipt}));
  const expected={proposalId:claims.proposalId,path:claims.path};
  assert.equal(s.hostIdentity.verifyOutcome(scope,s.owner.origin,receipt,expected).operationId,'operation-one');
  for(const patch of [{sessionId:'another-session'},{proposalId:'other-save'},{path:'/other'},{success:false},{evidenceKind:'clicked-save'},{recordHash:'not-a-hash'},{sub:'another-user'}])assert.throws(()=>s.hostIdentity.verifyOutcome(scope,s.owner.origin,s.token({...claims,...patch}),expected));
  assert.throws(()=>s.hostIdentity.verifyOutcome(scope,s.owner.origin,s.token(),expected));
  const store=createLearningStore(s.repository),learning=createLearningRuntime(s.repository,store),owner={...scope,role:'maintainer'};
  const input={title:'Generic workflow',steps:[{action:'fill',path:'/public-form',field:'name',parameter:'name'}],consent:true,evidence:s.hostIdentity.verifyOutcome(scope,s.owner.origin,receipt,expected)};
  assert.equal(learning.candidate(scope,input).created,false);learning.settings(owner,{enabled:true});assert.equal(learning.candidate(scope,{...input,consent:false}).created,false);
  const first=learning.candidate(scope,input);assert.equal(first.created,true);assert.equal(first.recipe.status,'draft');assert.deepEqual(learning.candidate(scope,input),first);assert.deepEqual(learning.list(scope),[]);
  assert.throws(()=>learning.candidate(scope,{...input,title:'Changed operation'}));
  assert.doesNotMatch(JSON.stringify(first),/recordHash|identityToken|sessionToken|tenant-A/);
 }finally{s.repository.close();}
});
test('identity renewal preserves only the same principal/role session; role changes, revoke, expiry and policy changes fail closed',()=>{
 const s=setup();try{
  const input={...s.installation,origin:s.owner.origin},first=s.authority.initialize({...input,identityToken:s.token(),initializationKey:'a'.repeat(64)}),auth={sessionToken:first.sessionToken,origin:s.owner.origin};s.authority.appendMessage({...auth,text:'Session-only draft'});
  assert.throws(()=>s.authority.initialize({...input,identityToken:s.token({roles:['reader']}),initializationKey:'a'.repeat(64)}));
  s.advance(240_000);const renewed=s.authority.renew({...auth,identityToken:s.token()});assert.equal(renewed.sessionId,first.sessionId);auth.sessionToken=renewed.sessionToken;assert.equal(s.authority.history(auth).length,1);
  assert.throws(()=>s.authority.renew({...auth,identityToken:s.token({roles:['reader']})}));
  const reader=s.authority.initialize({...input,identityToken:s.token({roles:['reader']})});assert.deepEqual(s.authority.history({sessionToken:reader.sessionToken,origin:s.owner.origin}),[]);
  s.hostIdentity.revoke(s.owner,{tenant:'tenant-A',subject:'user'});assert.throws(()=>s.authority.context(auth));assert.throws(()=>s.authority.history({sessionToken:reader.sessionToken,origin:s.owner.origin}));
  s.advance(1000);const fresh=s.authority.initialize({...input,identityToken:s.token()});s.advance(300_000);assert.throws(()=>s.authority.context({sessionToken:fresh.sessionToken,origin:s.owner.origin}));
 }finally{s.repository.close();}
});
test('two signed roles and tenants cannot retrieve privileged maps or redeem another audience coaching grant',()=>{
 const s=setup();try{
  const input={...s.installation,origin:s.owner.origin},contexts=[{}, {roles:['reader']},{tenant:'tenant-B'}].map(patch=>{const session=s.authority.initialize({...input,identityToken:s.token(patch)});return {session,scope:s.authority.context({sessionToken:session.sessionToken,origin:s.owner.origin})};});
  const manager={...s.owner,audienceId:contexts[0].scope.audienceId,audienceIds:contexts[0].scope.audienceIds},map=createSourceMap(s.repository),grants=createCoachingGrants(s.repository,{clock:s.clock});map.refresh(manager,{schema:1,origin:s.owner.origin,reviewed:true,screens:[{path:'/manager-only',title:'Management',forms:[],fields:[]}]});
  assert.equal(map.summary(contexts[0].scope).counts.screens,1);assert.equal(map.summary(contexts[1].scope).counts.screens,0);assert.equal(map.summary(contexts[2].scope).counts.screens,0);
  const grant=grants.issue(manager);assert.throws(()=>grants.exchange(contexts[1].scope,s.owner.origin,grant.code));assert.throws(()=>grants.exchange(contexts[2].scope,s.owner.origin,grant.code));assert.equal(grants.exchange(contexts[0].scope,s.owner.origin,grant.code).audienceId,manager.audienceId);
 }finally{s.repository.close();}
});
