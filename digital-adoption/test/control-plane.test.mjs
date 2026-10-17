import test from 'node:test';
import assert from 'node:assert/strict';
import { openRepository } from '../src/repository.mjs';
import { SessionAuthority } from '../src/session-authority.mjs';
import { createControlPlane } from '../src/control-plane.mjs';

test('domain proof and platform approval are both required; suspension revokes sessions',async()=>{
 const repository=openRepository();let dnsValue='incorrect';
 try{
  const authority=new SessionAuthority({repository});
  const plane=createControlPlane(repository,authority,{dns:async()=>[[dnsValue]]});
  const owner={id:'owner',organizationId:'org',role:'owner'},admin={...owner,id:'admin',role:'platform_admin'};
  const registration=plane.register(owner,{origin:'https://customer.example',environment:'staging'});
  assert.throws(()=>plane.activate(owner,registration.id));
  await assert.rejects(()=>plane.verify(owner,registration.id));
  dnsValue=registration.dnsValue;await plane.verify(owner,registration.id);
  assert.throws(()=>plane.approve(owner,registration.id));
  assert.throws(()=>plane.scope({...owner,organizationId:'other'},registration.id));
  // Platform administrators approve registrations across companies; owners cannot.
  plane.approve({...admin,organizationId:'platform'},registration.id);
  const installation=plane.activate(owner,registration.id);
  const session={...authority.initialize({...installation,origin:'https://customer.example'}),origin:'https://customer.example'};
  assert.deepEqual(authority.history(session),[]);
  plane.suspend(admin,registration.id);
  assert.throws(()=>authority.history(session));
  assert.throws(()=>plane.activate(owner,registration.id));
  assert.equal(JSON.stringify(plane.list(owner)).includes(registration.dnsValue),false);
 }finally{repository.close();}
});
