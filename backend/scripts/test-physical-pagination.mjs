import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {PhysicalControlPlane} from '../src/services/physical/control-plane.js';
import {physicalPage,physicalOnboardingPage} from '../src/services/physical/pagination.js';
import {profile} from '../src/services/physical/contracts.js';
const p=new PhysicalControlPlane({load:()=>null,save:()=>{}});
for(const owner of ['company-a','company-b']){
 for(let site=0;site<2;site++){
  const h=p.enroll(owner,{siteId:'site-'+site,name:owner+' hub '+site});p.discover(h.hubId,[profile('fixture-tv','tv')]);
  for(let i=0;i<27;i++){const e={id:owner+'-asset-'+site+'-'+i,owner,hubId:h.hubId,siteId:h.siteId,deviceId:'device-'+i,description:profile('device-'+i,'tv'),enabled:true,createdAt:i,observations:{},actions:{launch_app:'approval_required'},entitlements:[{principal:'user:viewer',discover:i%2===0,actions:[]}]};p.state.entities[e.id]=e;
   for(let n=0;n<10;n++){const id=e.id+'-operation-'+n;p.state.operations[id]={id,owner,entityId:e.id,hubId:h.hubId,action:'launch_app',status:'completed',createdAt:i*10+n,input:{app:'video'}};}
  }
 }
}
const first=physicalPage(p,'company-a',{resource:'devices',pageSize:'10'}),second=physicalPage(p,'company-a',{resource:'devices',pageSize:'10',page:'2'});
assert.equal(first.total,54);assert.equal(first.entities.length,10);assert.equal(first.totalPages,6);assert.ok(first.entities.every(e=>e.owner==='company-a'));assert.ok(!first.entities.some(e=>second.entities.some(x=>x.id===e.id)));
assert.equal(physicalPage(p,'company-a',{page:999,pageSize:10}).page,6);assert.equal(physicalPage(p,'empty',{}).total,0);
const filtered=physicalPage(p,'company-a',{siteId:'site-1',q:'device-2'});assert.equal(filtered.total,8);assert.ok(filtered.entities.every(e=>e.siteId==='site-1'));
const viewer=physicalPage(p,'company-a',{pageSize:100},'user:viewer');assert.equal(viewer.total,28);assert.equal(viewer.entities[0].entitlements,undefined);assert.equal(viewer.entities[0].actions.launch_app,'prohibited');assert.ok(viewer.hubs.every(h=>!('candidates' in h)&&!('tokenHash' in h)&&!('managedActive' in h)));
const ops=physicalPage(p,'company-a',{resource:'operations',pageSize:20},'user:viewer');assert.equal(ops.total,280);assert.equal(ops.operations.length,20);assert.ok(ops.operations.every(o=>viewer.entities.some(e=>e.id===o.entityId)));
const foreignHub=Object.values(p.state.hubs).find(h=>h.owner==='company-b').id;assert.throws(()=>physicalPage(p,'company-a',{hubId:foreignHub}),{status:404});
for(const q of [{page:0},{pageSize:101},{page:'1.5'},{resource:'audit'},{q:'x'.repeat(101)}])assert.throws(()=>physicalPage(p,'company-a',q),{status:400});
const onboarding=physicalOnboardingPage(p,'company-a',{page:2,pageSize:5});assert.equal(onboarding.hubs.length,0);assert.equal(onboarding.entities.length,5);assert.equal(onboarding.operations.length,5);
for(let n=0;n<10000;n++){const id='large-'+n;p.state.operations[id]={id,owner:'company-a',entityId:first.entities[0].id,hubId:first.entities[0].hubId,createdAt:n,action:'launch_app',status:'completed',input:{app:'video'}};}
const start=performance.now();const large=physicalPage(p,'company-a',{resource:'operations',page:200,pageSize:20});const ms=performance.now()-start;assert.equal(large.operations.length,20);assert.ok(JSON.stringify(large).length<100000,'Response stays bounded independent of history size');
console.log('PHYSICAL_PAGINATION_PASS: tenant/resource isolation before counts and paging, deterministic ordering, search/location filters, strict limits, bounded onboarding, 10k-operation page '+ms.toFixed(1)+'ms');
