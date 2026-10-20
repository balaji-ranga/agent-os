import test from 'node:test';import assert from 'node:assert/strict';
import {parseAssistantResponse,responseContract} from '../src/assistant-contract.mjs';
import {createProposalStore} from '../src/proposals.mjs';
import {openRepository} from '../src/repository.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
import {fieldGuidance} from '../src/field-guidance.mjs';
const snapshot={revision:1,path:'/draft',fields:[],links:[{ref:'r1n0',label:'Opportunity',path:'/opportunity'}]};
test('an observed navigation ref is also a read-only highlight target, never a field',()=>{
 const response={message:'I will point to the link.',actions:[{type:'highlight',ref:'r1n0'}]};
 assert.deepEqual(parseAssistantResponse(JSON.stringify(response),snapshot),response);
 const repository=openRepository();const prepared=createProposalStore(repository).prepare({embeddingId:'site',sessionId:'visitor'},snapshot,response);assert.equal(prepared.actions[0].label,'Opportunity');repository.close();
 assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'Fill',actions:[{type:'fill',ref:'r1n0',value:'test'}]}),snapshot),/unobserved_field/);
 assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'Show',actions:[{type:'highlight',ref:'r0n0'}]}),snapshot),/unobserved_field/);
});
test('read-only response contract exposes pointing without click or fill authority',()=>{
 const contract=responseContract(snapshot,{readOnly:true});assert.deepEqual(contract.allowedActionTypes,['highlight']);assert.equal(contract.actionShapes.navigate,undefined);assert.match(contract.actionShapes.highlight.ref,/point only/);
 assert.ok(responseContract(snapshot).allowedActionTypes.includes('navigate'));
});
test('button/link requests defer to reasoning over real controls rather than unrelated fields',()=>{
 assert.equal(fieldGuidance('show me opportunities button/link',snapshot),null);
 assert.deepEqual(fieldGuidance('Where is the missing button',{fields:[],links:[]}).actions,[]);
});
test('maker receives semantic intent contract and observed control vocabulary for pointing',async()=>{
 let request;const planner=createPlatformPlanner({gatewayUrl:'https://models.example.test/api',serviceToken:'x'.repeat(40),fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify({content:JSON.stringify({intent:'guide',message:'I will point to the visible Opportunity link.',actions:[{type:'highlight',ref:'r1n0'}]})}),{status:200});}});
 const response=await planner({text:'show me opportunities button/link',snapshot});assert.equal(response.actions[0].type,'highlight');const task=JSON.parse(request.messages.at(-1).content);assert.equal(task.responseContract.intent.requiredForNewProposals,true);assert.equal(task.observed.links[0].label,'Opportunity');assert.match(request.messages[0].content,/never navigate/);
});

test('declared semantic intent has a strict effect boundary independent of control spelling',()=>{
 const observed={...snapshot,fields:[{ref:'r1f0',label:'Update status',type:'text'}],links:[{ref:'r1n0',label:'Save view',path:'/saved'}]};
 for(const ref of ['r1f0','r1n0'])assert.equal(parseAssistantResponse(JSON.stringify({intent:'guide',message:'Pointing only',actions:[{type:'highlight',ref}]}),observed).intent,'guide');
 assert.throws(()=>parseAssistantResponse(JSON.stringify({intent:'guide',message:'Text only',actions:[]}),observed),/intent_action_mismatch/);
 for(const [intent,action] of [['guide',{type:'navigate',ref:'r1n0'}],['guide',{type:'fill',ref:'r1f0',value:'x'}],['edit',{type:'highlight',ref:'r1f0'}],['explain',{type:'navigate',ref:'r1n0'}]])assert.throws(()=>parseAssistantResponse(JSON.stringify({intent,message:'Invalid mixed purpose',actions:[action]}),observed),/intent_action_mismatch/);
 assert.throws(()=>parseAssistantResponse(JSON.stringify({intent:'save',message:'Unsupported',actions:[]}),observed),/invalid_intent/);
});
