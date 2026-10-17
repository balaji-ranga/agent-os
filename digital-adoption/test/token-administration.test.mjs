import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {SessionAuthority} from '../src/session-authority.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
test('F11 domain layer: rotation overlap, scoped revocation and audit reasons',async()=>{
 const repository=openRepository();let now=1_000_000,proof;
 try{
  const authority=new SessionAuthority({repository,clock:()=>now});
  const plane=createControlPlane(repository,authority,{clock:()=>now,dns:async()=>[[proof]]});
  const owner={id:'owner',organizationId:'one',role:'owner'},admin={...owner,id:'admin',role:'platform_admin'};
  const origin='https://customer.example';const site=plane.register(owner,{origin,environment:'staging'});
  proof=site.dnsValue;await plane.verify(owner,site.id);plane.approve(admin,site.id);
  const first=plane.activate(owner,site.id),a={...authority.initialize({...first,origin}),origin};
  assert.throws(()=>plane.rotate(owner,site.id,first.installationId,{reason:'test'}));
  assert.throws(()=>plane.rotate({...owner,organizationId:'other'},site.id,first.installationId,{reason:'test'}));
  assert.throws(()=>plane.rotate(admin,site.id,'foreign-installation',{reason:'test'}));
  const next=plane.rotate(admin,site.id,first.installationId,{overlapMs:60_000,reason:'Scheduled replacement'});
  const b={...authority.initialize({...next,origin}),origin};
  assert.deepEqual(authority.history(a),[]);assert.deepEqual(authority.history(b),[]);
  now+=60_000;assert.throws(()=>authority.history(a));assert.throws(()=>authority.initialize({...first,origin}));
  assert.deepEqual(authority.history(b),[]);
  plane.revokeSession(admin,site.id,b.sessionId,'End test session');assert.throws(()=>authority.renew(b));
  const c={...authority.initialize({...next,origin}),origin};
  plane.revokeToken(admin,site.id,next.installationId,'Revoke installation');assert.throws(()=>authority.history(c));
  assert.throws(()=>plane.rotate(admin,site.id,next.installationId,{reason:'Cannot revive'}));
  const audit=repository.map('management_audit').values();
  assert.ok(audit.some(e=>e.action==='rotate_installation'&&e.reason==='Scheduled replacement'));
  assert.equal(JSON.stringify(audit).includes(next.installationToken),false);
 }finally{repository.close();}
});
