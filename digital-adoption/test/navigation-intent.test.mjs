import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainNavigation} from '../src/navigation-intent.mjs';

test('multiple current task fields exclude unrelated navigation, while an explicit destination still wins',()=>{
 const current={path:'/dispatch',fields:[{label:'Office code'},{label:'Desk zone'}],links:[{ref:'r1n0',label:'Reports',path:'/reports'}]};
 const constrained=constrainNavigation('Prepare office code A and desk zone West.',current);assert.equal(constrained.fields.length,2);assert.deepEqual(constrained.links,[]);assert.equal(constrained.currentFormMatchesTask,true);
 const explicit=constrainNavigation('Open Reports to compare office code and desk zone.',current);assert.equal(explicit.navigationRequired,true);assert.equal(explicit.links.length,1);
});

test('an observed current-page link cannot be proposed again after navigation',()=>{
 const snapshot={path:'/note',screen:'Note draft',fields:[{label:'Title'},{label:'Body'}],links:[{ref:'r1n0',label:'Note',path:'/note'}]};
 const next=constrainNavigation('Open Note and create a note with title Followup and body followup MrX on month end.',snapshot);
 assert.equal(next.fields.length,2);assert.deepEqual(next.links,[]);assert.equal(next.navigationRequired,undefined);
});
import {validateSnapshot} from '../src/proposals.mjs';
test('off-screen navigation discards current form and Save metadata before destination inspection',()=>{
 const snapshot={revision:1,path:'/customers',screen:'Customers',fields:[{ref:'r1f0',key:'city',label:'City',type:'text',form:'customer'}],forms:[{key:'customer',label:'Customer',fields:['city']}],submissions:[{ref:'r1s0',label:'Save'}],links:[{ref:'r1n0',label:'Opportunities',path:'/opportunities'}]};
 const narrowed=validateSnapshot(constrainNavigation('Create an opportunity',validateSnapshot(snapshot)));assert.deepEqual(narrowed.fields,[]);assert.deepEqual(narrowed.forms,[]);assert.deepEqual(narrowed.submissions,[]);assert.equal(narrowed.links.length,1);
});
test('explicit different destination removes wrong-form fields; current and ambiguous destinations do not',()=>{
 const source={path:'/customers',screen:'Customer draft',fields:[{ref:'r1f0'}],links:[{label:'Opportunities',path:'/opportunities'},{label:'Customer',path:'/customers'}]};
 assert.equal(constrainNavigation('Create a new opportunity',source).fields.length,0);
 assert.equal(constrainNavigation('Set customer name',source).fields.length,1);
 assert.equal(constrainNavigation('Help with a task',source).fields.length,1);
 const both={...source,screen:'Home',path:'/home'};
 assert.equal(constrainNavigation('Compare customer and opportunity',both).fields.length,1);
});

test('field payload mentions do not become navigation while an actual requested destination still wins',()=>{
 const note={path:'/note',screen:'Note draft',fields:[{label:'Title'},{label:'Body'}],links:[{ref:'r1n0',label:'Opportunity',path:'/opportunity'},{ref:'r1n1',label:'Customer',path:'/customer'}]};
 for(const text of ['Create a note with Title Followup and Body Follow up on the demonstration opportunity. Fill only; do not submit.','Set Body to Contact the customer about the opportunity.']){const result=constrainNavigation(text,note);assert.equal(result.fields.length,2);assert.equal(result.navigationRequired,undefined);}
 assert.equal(constrainNavigation('Open Opportunity to compare title and body.',note).navigationRequired,true);
 assert.equal(constrainNavigation('Create an opportunity with Title Followup and Body details.',note).navigationRequired,true);
});
