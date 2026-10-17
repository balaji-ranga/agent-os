import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createControlPlane} from '../src/control-plane.mjs';
test('same-owner registration retries retain challenge and reject changed payload',()=>{
 const repository=openRepository(),owner={id:'owner',organizationId:'owner',role:'owner'},other={id:'other',organizationId:'other',role:'owner'};
 try{
  const control=createControlPlane(repository,{}),input={origin:'https://example.test',environment:'staging',operationId:'synthetic-operation-1'};
  const first=control.register(owner,input);assert.deepEqual(control.register(owner,input),first);assert.equal(control.list(owner).length,1);
  assert.throws(()=>control.register(owner,{...input,environment:'production'}));
  assert.notEqual(control.register(other,input).id,first.id);
  // Simulate service recreation over the same persistent store.
  assert.deepEqual(createControlPlane(repository,{}).register(owner,input),first);
 }finally{repository.close();}
});
