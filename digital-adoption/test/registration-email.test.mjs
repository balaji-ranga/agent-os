import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createRegistrationEmail} from '../src/registration-email.mjs';
test('email code expiry, attempts, recipient ownership and failed-delivery revocation',async()=>{
 const repository=openRepository();let now=1000,fail=false,approved=false;const sent=[],revoked=[];
 const actor={id:'owner'},foreign={id:'foreign'};
 const control={list:a=>a.id==='owner'?[{id:'site',origin:'https://example.test',environment:'staging'}]:[],scope:a=>{if(a.id!=='owner'||!approved)throw new Error('Denied');return {embeddingId:'site'};},activate:()=>({installationId:'installation',installationToken:'dac_install_'+'x'.repeat(43)}),cancelDelivery:(_a,_id,token)=>revoked.push(token)};
 const service=createRegistrationEmail(repository,{control,search:{provision:async()=>{}},serviceUrl:'https://platform.test/adoption/',clock:()=>now,send:async message=>{if(fail)throw new Error('SMTP failed');sent.push(message);}});
 try{
  await assert.rejects(()=>service.start(foreign,'site','test@example.test'));
  await service.start(actor,'site','test@example.test');
  const code=sent[0].text.match(/\b\d{6}\b/)[0];assert.ok(!JSON.stringify(repository.map('registration_email').get('site')).includes(code));
  await assert.rejects(()=>service.start(actor,'site','other@example.test'));
  assert.throws(()=>service.confirm(actor,'site','wrong'));
  service.confirm(actor,'site',code);assert.throws(()=>service.confirm(actor,'site',code));
  await assert.rejects(()=>service.deliver(actor,'site'));approved=true;
  const delivery=await service.deliver(actor,'site');assert.equal(delivery.sent,true);assert.equal(sent[1].to,'test@example.test');assert.match(sent[1].text,/installationToken/);
  await assert.rejects(()=>service.deliver(actor,'site'));now+=61_000;fail=true;
  await assert.rejects(()=>service.deliver(actor,'site'));assert.deepEqual(revoked,['installation']);
  fail=false;now+=61_000;await service.start(actor,'site','test@example.test');const expiring=sent.at(-1).text.match(/\b\d{6}\b/)[0];now+=600_000;assert.throws(()=>service.confirm(actor,'site',expiring));
  now+=61_000;await service.start(actor,'site','test@example.test');for(let i=0;i<5;i++)assert.throws(()=>service.confirm(actor,'site','wrong'));assert.throws(()=>service.confirm(actor,'site',sent.at(-1).text.match(/\b\d{6}\b/)[0]));
 }finally{repository.close();}
});
