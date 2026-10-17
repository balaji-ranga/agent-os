import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAssistantResponse} from '../src/assistant-contract.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
const snapshot={revision:1,path:'/home',fields:[{ref:'r1f0',label:'City',type:'text'}],links:[{ref:'r1n0',label:'Customers',path:'/customers'}]};
test('assistant instances accept whole fences but reject schemas, invented targets, mixed navigation and code',()=>{
 assert.equal(parseAssistantResponse('```json\n{"message":"Which city?","actions":[]}\n```',snapshot).actions.length,0);
 for(const result of [{type:'object',properties:{}},{message:'Review',actions:[{type:'fill',ref:'persistent-city-key',value:'Singapore'}]},{message:'Review',actions:[{type:'navigate',ref:'r1n0'},{type:'fill',ref:'r1f0',value:'Singapore'}]},{message:'Run',actions:[{type:'script',code:'alert(1)'}]}])assert.throws(()=>parseAssistantResponse(JSON.stringify(result),snapshot));
 assert.throws(()=>parseAssistantResponse('Some prose {"message":"OK","actions":[]}',snapshot),/invalid_json/);
});
test('one bounded repair preserves original request and observed contract; repeated invalid output fails closed',async()=>{
 const requests=[];let valid=true;
 const planner=createPlatformPlanner({gatewayUrl:'https://model.example.com/gateway',serviceToken:'synthetic-service-token-for-contract-testing',fetchImpl:async(url,options)=>{
  requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({content:JSON.stringify(requests.length%2===1||!valid?{message:'Review',actions:[{type:'fill',ref:'offscreen',value:'x'}]}:{message:'Review',actions:[{type:'navigate',ref:'r1n0'}]})})};
 }});
 const result=await planner({text:'Open customers',snapshot});assert.equal(result.actions[0].type,'navigate');assert.equal(requests.length,2);
 const repair=JSON.parse(requests[1].messages.at(-1).content);assert.equal(repair.task,'Open customers');assert.equal(repair.validation.category,'unobserved_field');assert.equal(repair.responseContract.links[0].ref,'r1n0');
 valid=false;await assert.rejects(()=>planner({text:'Open customers',snapshot}),/Nothing was changed/);assert.equal(requests.length,4);
});
