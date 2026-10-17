import test from 'node:test';
import assert from 'node:assert/strict';
import {constrainNavigation} from '../src/navigation-intent.mjs';
test('explicit different destination removes wrong-form fields; current and ambiguous destinations do not',()=>{
 const source={path:'/customers',screen:'Customer draft',fields:[{ref:'r1f0'}],links:[{label:'Opportunities',path:'/opportunities'},{label:'Customer',path:'/customers'}]};
 assert.equal(constrainNavigation('Create a new opportunity',source).fields.length,0);
 assert.equal(constrainNavigation('Set customer name',source).fields.length,1);
 assert.equal(constrainNavigation('Help with a task',source).fields.length,1);
 const both={...source,screen:'Home',path:'/home'};
 assert.equal(constrainNavigation('Compare customer and opportunity',both).fields.length,1);
});
