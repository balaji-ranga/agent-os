import test from 'node:test';
import assert from 'node:assert/strict';
import {openRepository} from '../src/repository.mjs';
import {createLearningStore} from '../src/learning-store.mjs';
import {createLearningRuntime} from '../src/learning-runtime.mjs';
import {validateInventory} from '../src/domain-inventory.mjs';
const inventory={fields:[{key:'message',label:'Message',type:'text',form:'feedback',visible:false,editable:true,required:true}],forms:[{key:'feedback',label:'Feedback',fields:['message']}],links:[{label:'Help',path:'/help',visible:false}]};
test('bounded structural inventory includes hidden metadata but rejects values, secrets and foreign navigation',()=>{
 const result=validateInventory(inventory);assert.equal(result.fields[0].visible,false);assert.equal(result.forms[0].fields[0],'message');assert.equal(result.links[0].visible,false);
 for(const patch of [{...inventory,fields:[{...inventory.fields[0],value:'PRIVATE'}]},{...inventory,fields:[{...inventory.fields[0],key:'password'}]},{...inventory,links:[{label:'Foreign',path:'https://foreign.test/'}]},{...inventory,fields:Array(501).fill(inventory.fields[0])}])assert.throws(()=>validateInventory(patch));
 assert.doesNotMatch(JSON.stringify(result),/"value"|"ref"/);
});
test('a hidden structural field never qualifies a recipe for publication',()=>{
 const repository=openRepository();try{
  const owner={embeddingId:'inventory',audienceId:'public',audienceIds:['public'],role:'maintainer'},learning=createLearningRuntime(repository,createLearningStore(repository));
  const result=learning.observe(owner,{revision:1,path:'/feedback',fields:[],links:[],inventory});assert.equal(result.inventory.fields.length,1);assert.equal(result.fieldCount,0);
  const recipe=learning.create(owner,{title:'Feedback',steps:[{action:'fill',path:'/feedback',field:'message',parameter:'message'}]});assert.equal(learning.validate(owner,{id:recipe.id,version:1}).compatible,false);assert.throws(()=>learning.publish(owner,{id:recipe.id,version:1,reviewed:true}));
 }finally{repository.close();}
});
