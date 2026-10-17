import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainEdit} from '../src/edit-intent.mjs';
test('explicit partial edit scopes observed fields without inferring values or demanding unrelated fields',()=>{
 const snapshot={fields:[{ref:'r1f0',label:'Delivery city'},{ref:'r1f1',label:'Goal title',required:true}],links:[{ref:'r1n0'}]};
 const result=constrainEdit('Set Delivery city to Singapore.',snapshot);
 assert.deepEqual(result.fields,[snapshot.fields[0]]);assert.deepEqual(result.links,[]);
 assert.equal(result.partialEdit,true);assert.equal(result.fields[0].value,undefined);
 assert.equal(constrainEdit('Create a goal for Delivery city',snapshot),snapshot);
 assert.equal(constrainEdit('Update the draft',snapshot),snapshot);
 assert.equal(constrainEdit('Set Delivery city and Goal title',snapshot).fields.length,2);
 const nav={...snapshot,navigationRequired:true};assert.equal(constrainEdit('Set Delivery city',nav),nav);
});
