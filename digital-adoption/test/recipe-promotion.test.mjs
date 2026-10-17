import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
test('F31/F32 domain layer: scoped import retry, conflict and immutable rollback',()=>{
 const repository=openRepository();
 try{
  const store=createLearningStore(repository);
  const staging={embeddingId:'staging',audienceId:'public',role:'maintainer'},production={...staging,embeddingId:'production'};
  const original=store.create(staging,{title:'Open customers',steps:[{action:'navigate',path:'/customers',expectedPath:'/customers'}]});
  const published=store.publish(staging,original.id,original.version,{reviewed:true,validated:true});
  const bundle=store.export(staging,original.id);
  const imported=store.import(production,bundle,{operationId:'promotion-1'});
  assert.deepEqual(store.import(production,bundle,{operationId:'promotion-1'}),imported);
  assert.throws(()=>store.import(production,{...bundle,title:'Conflicting operation'},{operationId:'promotion-1'}));
  assert.equal(store.list({...production,role:'visitor'}).length,0);
  assert.throws(()=>store.publish(staging,imported.id,imported.version,{reviewed:true,validated:true}));
  store.publish(production,imported.id,imported.version,{reviewed:true,validated:true});
  const repair=store.repair(staging,original.id,published.version,[{action:'navigate',path:'/clients',expectedPath:'/clients'}]);
  const repaired=store.publish(staging,original.id,repair.version,{reviewed:true,validated:true});
  assert.throws(()=>store.rollback(staging,original.id,repaired.version,published.version,{reviewed:true,validated:false}));
  const rolled=store.rollback(staging,original.id,repaired.version,published.version,{reviewed:true,validated:true});
  assert.equal(rolled.steps[0].path,'/customers');assert.equal(rolled.rollbackOf,published.version);
  assert.equal(store.versions(staging,original.id).find(v=>v.version===repaired.version).steps[0].path,'/clients');
  assert.throws(()=>store.rollback(staging,original.id,repaired.version,published.version,{reviewed:true,validated:true}));
 }finally{repository.close();}
});
