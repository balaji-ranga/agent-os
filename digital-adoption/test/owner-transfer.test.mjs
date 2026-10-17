import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {createOwnerIdentity} from '../src/owner-identity.mjs';
test('audited owner transfer requires verified recipient, admin, reason and unchanged ownership',async()=>{
 const repository=openRepository(),old={id:'old',organizationId:'old',role:'owner'},admin={id:'admin',organizationId:'admin',role:'platform_admin'};let mail,txt;
 const identity=createOwnerIdentity(repository,{send:async value=>{mail=value;}}),authority=new SessionAuthority({repository}),control=createControlPlane(repository,authority,{dns:async()=>[[txt]]});
 try{
  const site=control.register(old,{origin:'https://example.test',environment:'staging'});txt=site.dnsValue;await control.verify(old,site.id);control.transition(admin,site.id,'approved','test');
  const input={email:'new@example.com',reason:'Approved ownership transfer',expectedOwnerId:old.id};
  assert.throws(()=>control.transfer(admin,site.id,input));
  const challenge=await identity.start(input.email);const cookie=identity.confirm(input.email,challenge.challenge,mail.text.match(/code is (\d{6})/)[1]).cookie,newOwner=identity.authenticate(cookie);
  assert.throws(()=>control.transfer(old,site.id,input));assert.throws(()=>control.transfer(admin,site.id,{...input,reason:''}));assert.throws(()=>control.transfer(admin,site.id,{...input,expectedOwnerId:'stale'}));
  const before=control.list(admin)[0];assert.equal(control.transfer(admin,site.id,input).indexRetained,true);
  assert.equal(control.list(old).length,0);assert.throws(()=>control.scope(old,site.id));
  const after=control.list(newOwner)[0];assert.equal(after.id,before.id);assert.equal(after.status,before.status);assert.deepEqual(after.installations,before.installations);
  assert.equal(control.scope(newOwner,site.id).embeddingId,site.id);
  assert.ok(control.audit(admin,site.id).some(row=>row.action==='transfer_owner'&&row.previousOwnerId===old.id&&row.newOwnerId===newOwner.id));
  assert.throws(()=>control.transfer(admin,site.id,input));
 }finally{repository.close();}
});
