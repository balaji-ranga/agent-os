import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
test('website lifecycle needs admin reasons, preserves knowledge and never revives revoked credentials',async()=>{
 const repository=openRepository(),owner={id:'owner',organizationId:'owner',role:'owner'},admin={id:'admin',organizationId:'admin',role:'platform_admin'};let txt='',clock=1000;
 const authority=new SessionAuthority({repository,clock:()=>clock}),control=createControlPlane(repository,authority,{dns:async()=>[[txt]],clock:()=>clock});
 try{
  const site=control.register(owner,{origin:'https://example.test',environment:'staging'});txt=site.dnsValue;await control.verify(owner,site.id);
  assert.throws(()=>control.transition(owner,site.id,'approved','test'));assert.throws(()=>control.transition(admin,site.id,'approved',''));
  control.transition(admin,site.id,'approved','Synthetic acceptance');const installation=control.activate(owner,site.id);
  clock++;assert.equal(control.transition(admin,site.id,'suspended','Synthetic suspend').indexRetained,true);
  assert.equal(control.tokens(admin,site.id)[0].status,'revoked');
  control.transition(admin,site.id,'approved','Synthetic reactivate');assert.equal(control.tokens(admin,site.id)[0].status,'revoked');
  assert.throws(()=>authority.initialize({installationToken:installation.installationToken,origin:'https://example.test'}));
  control.transition(admin,site.id,'removed','Synthetic offboard');assert.throws(()=>control.transition(admin,site.id,'approved','No resurrection'));
  const audit=control.audit(admin,site.id);assert.ok(audit.every((row,i)=>!i||audit[i-1].at>=row.at));
  assert.throws(()=>control.tokens(owner,site.id));assert.throws(()=>control.audit(owner,site.id));
 }finally{repository.close();}
});
