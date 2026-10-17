import test from 'node:test';
import assert from 'node:assert/strict';
import {SessionAuthority} from '../src/session-authority.mjs';
test('lost initialization response retry is scoped, stable and cannot revive revoked credentials',()=>{
 let now=1000;
 const authority=new SessionAuthority({clock:()=>now});
 const first=authority.registerApproved({embeddingId:'alpha',origins:['https://alpha.test','https://other.test'],expiresAt:999999});
 const input={...first,origin:'https://alpha.test',initializationKey:'a'.repeat(64)};
 const a=authority.initialize(input);
 assert.deepEqual(authority.initialize(input),a);
 const b=authority.initialize({...input,initializationKey:'b'.repeat(64)});
 assert.notEqual(a.sessionId,b.sessionId);
 const other=authority.initialize({...input,origin:'https://other.test'});
 assert.notEqual(a.sessionId,other.sessionId);
 authority.renew({...a,origin:input.origin});
 assert.throws(()=>authority.initialize(input),/denied/);
 now=400000;assert.throws(()=>authority.initialize({...input,initializationKey:'b'.repeat(64)}),/denied/);
 assert.throws(()=>authority.initialize({...input,initializationKey:'guessable'}),/denied/);
});
