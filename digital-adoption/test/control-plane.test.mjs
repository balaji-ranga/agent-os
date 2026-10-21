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

test('installation lifetime is explicit, bounded and preserves the website origin and ownership',async()=>{
 const repository=openRepository(),now=Date.now();let dns='';
 try{
  const authority=new SessionAuthority({repository,clock:()=>now}),plane=createControlPlane(repository,authority,{clock:()=>now,dns:async()=>[[dns]]});
  const owner={id:'owner',organizationId:'org',role:'owner'},admin={...owner,id:'admin',role:'platform_admin'};
  const site=plane.register(owner,{origin:'https://customer.example',environment:'staging'});dns=site.dnsValue;await plane.verify(owner,site.id);plane.approve(admin,site.id);
  for(const lifetimeDays of [0,-1,366,1.5,'7',null])assert.throws(()=>plane.activate(owner,site.id,{lifetimeDays}));
  assert.throws(()=>plane.activate({...owner,organizationId:'foreign'},site.id,{lifetimeDays:7}));
  const issued=plane.activate(owner,site.id,{lifetimeDays:7});assert.equal(issued.expiresAt,now+7*86400000);
  const stored=plane.tokens(admin,site.id).find(row=>row.id===issued.installationId);assert.equal(stored.expiresAt,issued.expiresAt);
  assert.ok(authority.initialize({...issued,origin:'https://customer.example'}).sessionId);
  assert.throws(()=>authority.initialize({...issued,origin:'https://other.example'}));
  assert.equal(plane.activate(owner,site.id).expiresAt,now+365*86400000);
 }finally{repository.close();}
});
