import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createOwnerIdentity} from '../src/owner-identity.mjs';
test('independent owners require one-use email proof and expiring scoped sessions',async()=>{
 const repository=openRepository();let now=1000,mail;
 const auth=createOwnerIdentity(repository,{clock:()=>now,send:async value=>{mail=value;}});
 try{
  const challenge=await auth.start('owner@example.com'),code=mail.text.match(/code is (\d{6})/)[1];
  assert.throws(()=>auth.authenticate(''));
  assert.throws(()=>auth.confirm(challenge.email,'foreign',code));
  const {cookie}=auth.confirm(challenge.email,challenge.challenge,code);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  const actor=auth.authenticate(cookie);assert.equal(actor.role,'owner');assert.equal(actor.id,actor.organizationId);
  assert.throws(()=>auth.confirm(challenge.email,challenge.challenge,code));
  const second=await auth.start('other@example.com');const secondCode=mail.text.match(/code is (\d{6})/)[1];
  const other=auth.authenticate(auth.confirm(second.email,second.challenge,secondCode).cookie);assert.notEqual(other.id,actor.id);
  now+=30*60_000;assert.throws(()=>auth.authenticate(cookie));
  now+=60_000;const retry=await auth.start('owner@example.com'),retryCode=mail.text.match(/code is (\d{6})/)[1];
  const renewed=auth.confirm(retry.email,retry.challenge,retryCode).cookie;
  assert.equal(auth.authenticate(renewed).id,actor.id);auth.logout(renewed);assert.throws(()=>auth.authenticate(renewed));
 }finally{repository.close();}
});

test('failed owner proof attempts commit their count and cannot bypass five-attempt lockout',async()=>{
 const repository=openRepository();let now=1000,mail;const auth=createOwnerIdentity(repository,{clock:()=>now,send:async value=>mail=value});
 try{const challenge=await auth.start('attempts@example.invalid'),code=mail.text.match(/code is (\d{6})/)[1];for(let i=0;i<5;i++)assert.throws(()=>auth.confirm(challenge.email,challenge.challenge,'000000'));assert.equal(repository.map('owner_challenges').values()[0].attempts,5);assert.throws(()=>auth.confirm(challenge.email,challenge.challenge,code));now+=60001;const retry=await auth.start(challenge.email),freshCode=mail.text.match(/code is (\d{6})/)[1];assert.equal(auth.authenticate(auth.confirm(retry.email,retry.challenge,freshCode).cookie).role,'owner');}finally{repository.close();}
});

test('a delayed failed email cannot delete a newer owner proof challenge',async()=>{
 const repository=openRepository();let now=1000,rejectFirst,calls=0,mail;const auth=createOwnerIdentity(repository,{clock:()=>now,send:async message=>{if(++calls===1)await new Promise((_,reject)=>rejectFirst=reject);else mail=message;}});
 try{const first=auth.start('delivery@example.invalid'),failed=assert.rejects(first,/transport failed/);now+=60001;const second=await auth.start('delivery@example.invalid'),code=mail.text.match(/code is (\d{6})/)[1];rejectFirst(new Error('transport failed'));await failed;assert.equal(auth.authenticate(auth.confirm(second.email,second.challenge,code).cookie).role,'owner');}finally{repository.close();}
});
