import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionAuthority} from '../src/session-authority.mjs';
function fixture(idleMs=900_000){
  let now=1_000_000;
  const authority=new SessionAuthority({clock:()=>now,idleMs});
  const origin='https://example.test';
  const installation=authority.registerApproved({embeddingId:'expiry',origins:[origin],expiresAt:now+3_600_000});
  let auth={...authority.initialize({...installation,origin}),origin};
  return {authority,get auth(){return auth;},advance:ms=>{now+=ms;},renew:()=>{auth={...authority.renew(auth),origin};}};
}
test('background renewal and reads cannot extend idle lifetime',()=>{
  const f=fixture();
  for(let i=0;i<3;i++){f.advance(240_000);f.renew();assert.deepEqual(f.authority.history(f.auth),[]);}
  f.advance(180_000);
  assert.throws(()=>f.renew(),/denied/);
  assert.throws(()=>f.authority.history(f.auth),/denied/);
});
test('active user interactions extend idle but never absolute expiry',()=>{
  const f=fixture();
  const absolute=f.auth.sessionExpiresAt;
  for(let i=0;i<7;i++){f.advance(240_000);f.authority.appendMessage({...f.auth,text:'Synthetic activity'});f.renew();assert.equal(f.auth.sessionExpiresAt,absolute);}
  f.advance(120_000);
  assert.throws(()=>f.authority.touch(f.auth),/denied/);
  assert.throws(()=>f.renew(),/denied/);
});
test('idle expiry is enforced at its exact boundary and cannot be revived',()=>{
  const f=fixture(60_000);f.advance(60_000);
  assert.throws(()=>f.authority.appendMessage({...f.auth,text:'revive'}),/denied/);
  assert.throws(()=>f.authority.touch(f.auth),/denied/);
});
