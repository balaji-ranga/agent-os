import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openRepository} from '../src/repository.mjs';
import {createUploadAdmission} from '../src/upload-admission.mjs';
const scope={embeddingId:'site-a',sessionId:'visitor-a'},ownerId='owner-a';
test('upload cooldown and cumulative limits survive restart and a fresh session cannot reset them',()=>{
 const directory=mkdtempSync(join(tmpdir(),'upload-admission-')),path=join(directory,'state.sqlite');let repo=openRepository(path),now=100000;
 try{
  let guard=createUploadAdmission({repository:repo,clock:()=>now,limits:{websiteFiles:1}}),permit=guard.admit(scope,{ownerId,network:'192.0.2.123'});guard.charge(scope,{ownerId,taskId:'task',operationId:'one',bytes:100},permit);assert.throws(()=>guard.charge(scope,{ownerId,taskId:'task',operationId:'one',bytes:100},permit),e=>e.publicCode==='OPERATION_CONFLICT');guard.release(permit);
  assert.throws(()=>guard.admit(scope,{ownerId}),e=>e.publicCode==='UPLOAD_COOLDOWN'&&e.retryAfter===5);repo.close();repo=openRepository(path);guard=createUploadAdmission({repository:repo,clock:()=>now,limits:{websiteFiles:1}});assert.throws(()=>guard.admit(scope,{ownerId}),e=>e.publicCode==='UPLOAD_COOLDOWN');
  now+=5000;const other={...scope,sessionId:'new-session'},next=guard.admit(other,{ownerId});assert.throws(()=>guard.charge(other,{ownerId,taskId:'new-task',operationId:'two',bytes:100},next),e=>e.publicCode==='UPLOAD_BUDGET_EXCEEDED');guard.release(next);
  const persisted=JSON.stringify(repo.map('upload_windows').values());assert.equal(persisted.includes('192.0.2.123'),false);assert.equal(persisted.includes('visitor-a'),false);
  now+=86400000;guard.maintain();permit=guard.admit(scope,{ownerId});guard.charge(scope,{ownerId,taskId:'after-window',operationId:'three',bytes:100},permit);guard.release(permit);
 }finally{repo.close();rmSync(directory,{recursive:true,force:true});}
});
test('shared SQLite leases enforce concurrency across API handles and recover abandoned uploads',()=>{
 const directory=mkdtempSync(join(tmpdir(),'upload-leases-')),path=join(directory,'state.sqlite'),a=openRepository(path),b=openRepository(path);let now=100000;
 try{const first=createUploadAdmission({repository:a,clock:()=>now}),second=createUploadAdmission({repository:b,clock:()=>now}),p=first.admit(scope,{ownerId}),q=second.admit({...scope,sessionId:'visitor-b'},{ownerId});assert.throws(()=>first.admit({...scope,sessionId:'visitor-c'},{ownerId}),e=>e.publicCode==='UPLOAD_BUSY');first.release(p);const r=second.admit({...scope,sessionId:'visitor-c'},{ownerId});assert.throws(()=>first.validate({...r},scope));second.release(r);now=q.expiresAt+1;first.maintain();assert.doesNotThrow(()=>first.admit({...scope,sessionId:'visitor-d'},{ownerId}));
 }finally{a.close();b.close();rmSync(directory,{recursive:true,force:true});}
});
test('network and owner limits prevent identity rotation; byte/configuration limits fail closed',()=>{
 const guard=createUploadAdmission({limits:{cooldownMs:0,networkRequests:1,ownerFiles:1,sessionBytes:10}});
 const permit=guard.admit(scope,{ownerId,network:'same-network'});guard.charge(scope,{ownerId,taskId:'task',operationId:'first',bytes:10},permit);guard.release(permit);
 assert.throws(()=>guard.admit({...scope,embeddingId:'site-b',sessionId:'new'},{ownerId:'other-owner',network:'same-network'}),e=>e.publicCode==='UPLOAD_RATE_LIMIT');
 const next={...scope,sessionId:'different-session'},p=guard.admit(next,{ownerId,network:'other-network'});assert.throws(()=>guard.charge(next,{ownerId,taskId:'new-task',operationId:'next',bytes:1},p),e=>e.publicCode==='UPLOAD_BUDGET_EXCEEDED');guard.release(p);
 for(const limits of [{globalRequests:NaN},{concurrentUploads:0},{unknown:1},{retentionWindowMs:1000},{readTimeoutMs:60001}])assert.throws(()=>createUploadAdmission({limits}));
});
test('persistent admission ledger enforces its bounded bucket count',()=>{
 const directory=mkdtempSync(join(tmpdir(),'upload-buckets-')),repo=openRepository(join(directory,'state.sqlite'));
 try{const guard=createUploadAdmission({repository:repo,limits:{maxBuckets:13,cooldownMs:0}}),permit=guard.admit(scope,{ownerId});guard.release(permit);assert.throws(()=>guard.admit({...scope,sessionId:'rotated'},{ownerId}),e=>e.publicCode==='UPLOAD_BUSY');assert.ok(repo.map('upload_windows').counts({})<=13);}
 finally{repo.close();rmSync(directory,{recursive:true,force:true});}
});
