import test from 'node:test';
import assert from 'node:assert/strict';
import {goalResponseSchema,parseGoalResponse} from '../src/goal-contract.mjs';
test('provider schema and parser agree on required nonempty goal text and valid empty completion remainder',()=>{
 const plan=goalResponseSchema();assert.equal(plan.properties.message.minLength,1);
 for(const key of ['title','instruction','expected'])assert.equal(plan.properties.steps.items.properties[key].minLength,1);
 const assessment=goalResponseSchema('assess');assert.equal(assessment.properties.remainingInstruction.minLength,0);
 assert.equal(parseGoalResponse(JSON.stringify({message:'Observed the reviewed result.',status:'complete',remainingInstruction:''}),'assess').status,'complete');
 for(const message of ['',null,undefined,'   '])assert.throws(()=>parseGoalResponse(JSON.stringify({message,steps:[]})),error=>error.message==='invalid_goal_response'&&error.contractIssues[0].includes('nonempty message'));
});
