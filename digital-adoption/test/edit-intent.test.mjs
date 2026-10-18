import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainEdit,explicitEditProposal} from '../src/edit-intent.mjs';
import {validateSnapshot} from '../src/proposals.mjs';
test('partial edits retain a valid narrowed form map for repeated server validation',()=>{
 const snapshot={revision:1,fields:[{ref:'r1f0',key:'city',label:'City',type:'text',form:'customer'},{ref:'r1f1',key:'company',label:'Company',type:'text',form:'customer'}],forms:[{key:'customer',label:'Customer',fields:['city','company']}],links:[]};
 const narrowed=validateSnapshot(constrainEdit('Set City to Singapore',validateSnapshot(snapshot)));assert.deepEqual(narrowed.forms[0].fields,['city']);assert.equal(narrowed.fields.length,1);
});
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

test('a partially matched multi-field request retains live controls for semantic resolution',()=>{
 const snapshot={fields:[{label:'Search MCPs, publishers, capabilities…',key:'q'},{label:'transport',key:'transport'}],links:[]};
 assert.equal(constrainEdit('Set the search query to github and transport to stdio.',snapshot),snapshot);
});

test('explicit assignments resolve all unique live fields and preserve new parameters without a model',()=>{
 const snapshot={fields:[{ref:'r1f0',label:'Search catalog, publishers, capabilities',key:'q',type:'search'},{ref:'r1f1',label:'Transport',key:'transport',type:'select-one',choices:['All transports','streamable-http','sse','stdio']}]};
 assert.deepEqual(explicitEditProposal('Set the search query to github and transport to stdio. Do not search or submit anything.',snapshot).actions,[{type:'fill',ref:'r1f0',value:'github'},{type:'fill',ref:'r1f1',value:'stdio'}]);
 assert.equal(explicitEditProposal('Set name to X',{fields:[{ref:'r1f0',label:'Company name'},{ref:'r1f1',label:'Contact name'}]}),null);
 assert.equal(explicitEditProposal('Set missing field to X',snapshot),null);
 assert.equal(explicitEditProposal('Set transport to stdio',{...snapshot,navigationRequired:true}),null);
 assert.deepEqual(explicitEditProposal('Set transport to "stdio."',snapshot).actions[0].value,'stdio');
});
