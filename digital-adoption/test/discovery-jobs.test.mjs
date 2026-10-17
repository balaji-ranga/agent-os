import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {createDiscoveryJobs} from '../src/discovery-jobs.mjs';
const actor={embeddingId:'A',audienceIds:['public'],origin:'https://example.com',sessionId:'one',capabilities:{coach:true}};
const screen={revision:1,path:'/customer',fields:[{ref:'r1f0',key:'company',label:'Company',type:'text',value:'PRIVATE_VALUE_CANARY'}],links:[{ref:'r1n0',label:'Note',path:'/note'},{ref:'r1n1',label:'Add New saves immediately',path:'/add-new'}],blockedCount:1};
test('durable discovery is scoped, protects drafts, skips unknown routes and resumes metadata without chat',()=>{
 const directory=mkdtempSync(join(tmpdir(),'adoption-discovery-')),file=join(directory,'state.sqlite');let repository=openRepository(file),now=0;
 const create=()=>createDiscoveryJobs(repository,createLearningRuntime(repository,createLearningStore(repository)),{clock:()=>now});
 try{
  let jobs=create();const job=jobs.start(actor,{origin:actor.origin,seed:'/customer',paths:['/customer','/note']});
  assert.equal(jobs.next(actor,job.id,{hasUnsavedWork:true}).paused,true);assert.equal(jobs.status(actor,job.id).discovered,0);
  jobs.control(actor,job.id,'resume');assert.equal(jobs.next(actor,job.id,{hasUnsavedWork:false}).next.path,'/customer');jobs.observe(actor,job.id,screen);
  assert.equal(jobs.status(actor,job.id).blocked.length,2);assert.doesNotMatch(JSON.stringify(jobs.status(actor,job.id)),/PRIVATE_VALUE_CANARY/);
  jobs.control(actor,job.id,'pause');repository.close();repository=openRepository(file);jobs=create();
  const fresh={...actor,sessionId:'fresh-session'};jobs.control(fresh,job.id,'resume');assert.equal(jobs.next(fresh,job.id,{hasUnsavedWork:false}).next.path,'/note');
  jobs.observe(fresh,job.id,{revision:2,path:'/note',fields:[],links:[{ref:'r2n0',label:'Customer',path:'/customer'}]});assert.equal(jobs.next(fresh,job.id,{hasUnsavedWork:false}).done,true);assert.equal(jobs.status(fresh,job.id).discovered,2);
  for(const denied of [{...actor,embeddingId:'B'},{...actor,capabilities:{coach:false}},{...actor,origin:'https://other.example.com'}])assert.throws(()=>jobs.status(denied,job.id));
 }finally{repository.close();rmSync(directory,{recursive:true,force:true});}
});
test('page/time budgets and observer leases bound discovery without calling any write action',()=>{
 const repository=openRepository();let now=0;try{
  const jobs=createDiscoveryJobs(repository,createLearningRuntime(repository,createLearningStore(repository)),{clock:()=>now});
  const job=jobs.start(actor,{origin:actor.origin,seed:'/customer',paths:['/customer','/note'],maxPages:1});jobs.next(actor,job.id,{hasUnsavedWork:false});
  assert.throws(()=>jobs.next({...actor,sessionId:'two'},job.id,{hasUnsavedWork:false}));now=31_000;
  const second={...actor,sessionId:'two'};jobs.next(second,job.id,{hasUnsavedWork:false});assert.throws(()=>jobs.observe(actor,job.id,screen));jobs.observe(second,job.id,screen);assert.equal(jobs.next(second,job.id,{hasUnsavedWork:false}).report.status,'bounded');
  const timed=jobs.start(actor,{origin:actor.origin,seed:'/customer',paths:['/customer']});now+=121_000;assert.equal(jobs.next(actor,timed.id,{hasUnsavedWork:false}).report.status,'bounded');
 }finally{repository.close();}
});
