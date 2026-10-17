import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainNavigation} from '../src/navigation-intent.mjs';

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
