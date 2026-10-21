import test from 'node:test';
import assert from 'node:assert/strict';
import {explicitEditProposal} from '../src/edit-intent.mjs';
import {deterministicReview} from '../integrations/checker-contract.mjs';
const observed={revision:1,fields:[{ref:'r1f0',label:'Account',type:'text'},{ref:'r1f1',label:'Territory',type:'text'}],links:[]};
test('quoted explicit values exclude later sentences without removing semantic constraints',()=>{
 const task='Set Account to "Synthetic Example", and Territory to "North". Ensure no duplicates or changes to other records.',proposal={intent:'edit',message:'Review',actions:[{type:'fill',ref:'r1f0',value:'Synthetic Example'},{type:'fill',ref:'r1f1',value:'North'}]};
 assert.deepEqual(explicitEditProposal(task,observed).actions,proposal.actions);assert.equal(deterministicReview({purpose:'digital_adoption_plan',task,observed,proposal}),null);
 assert.match(deterministicReview({purpose:'digital_adoption_plan',task,observed,proposal:{...proposal,actions:[proposal.actions[0],{...proposal.actions[1],value:'South'}]}}),/explicitly requested/);
 assert.equal(explicitEditProposal('Set Account to "First" or "Second".',observed),null);
 assert.equal(explicitEditProposal('Set Account to "Unclosed',observed),null);
});
