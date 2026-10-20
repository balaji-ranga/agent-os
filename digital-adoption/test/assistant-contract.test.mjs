import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAssistantResponse,responseContract} from '../src/assistant-contract.mjs';
import {createPlatformPlanner} from '../src/platform-model.mjs';
const snapshot={revision:1,path:'/home',fields:[{ref:'r1f0',label:'City',type:'text'}],links:[{ref:'r1n0',label:'Customers',path:'/customers'}]};

test('saved destinations without live controls require a manual explanation and no executable action',async()=>{
 const empty={revision:1,path:'/',fields:[],links:[]},contract=responseContract(empty);assert.deepEqual(contract.allowedActionTypes,[]);assert.deepEqual(contract.actionShapes,{});assert.match(contract.output.actions,/empty array/);assert.match(contract.policy,/open manually/);
 assert.throws(()=>parseAssistantResponse(JSON.stringify({message:'Go there',actions:[{type:'navigate',ref:'/known-screen'}]}),empty),/unobserved_navigation/);
 let request;const planner=createPlatformPlanner({gatewayUrl:'https://model.example.com/gateway',serviceToken:'synthetic-service-token-for-contract-testing',fetchImpl:async(_url,input)=>{request=JSON.parse(input.body);return {ok:true,json:async()=>({content:JSON.stringify({message:'Open /known-screen manually to continue; no safe live link is available here.',actions:[]})})};}});
 const result=await planner({text:'Which screen should I open?',snapshot:empty,siteGuidance:{observations:[{path:'/known-screen',fields:[{key:'city',label:'City',type:'text'}]}]}});assert.equal(result.actions.length,0);assert.match(result.message,/known-screen/);assert.match(request.messages[0].content,/no safe live link/);
});
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
 const text='Help me find the appropriate screen';
 const result=await planner({text,snapshot});assert.equal(result.actions[0].type,'navigate');assert.equal(requests.length,2);
 const repair=JSON.parse(requests[1].messages.at(-1).content);assert.equal(repair.task,text);assert.equal(repair.validation.category,'unobserved_field');assert.equal(repair.responseContract.links[0].ref,'r1n0');
 valid=false;await assert.rejects(()=>planner({text,snapshot}),/Nothing was changed/);assert.equal(requests.length,4);
});

test('empty creation proposals get one same-task input recheck, while genuinely missing values remain a clarification',async()=>{
 const requests=[];let supplied=true;
 const current={revision:2,path:'/destination',fields:[{ref:'r2f0',label:'Assigned operator',type:'text'}],links:[]};
 const planner=createPlatformPlanner({gatewayUrl:'https://model.example.com/gateway',serviceToken:'synthetic-service-token-for-contract-testing',fetchImpl:async(_url,input)=>{const body=JSON.parse(input.body);requests.push(body);const correction=JSON.parse(body.messages.at(-1).content).validation;return {ok:true,json:async()=>({content:JSON.stringify(correction&&supplied?{message:'Review the supplied operator',actions:[{type:'fill',ref:'r2f0',value:'Synthetic operator'}]}:{message:'Which assigned operator?',actions:[]})})};}});
 const result=await planner({text:'Create the task with assigned operator Synthetic operator.',snapshot:current});assert.equal(result.actions[0].value,'Synthetic operator');assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].messages.at(-1).content).validation.category,'recheck_current_task_inputs');
 supplied=false;const missing=await planner({text:'Create the task; I have not selected the assigned operator.',snapshot:current});assert.equal(missing.actions.length,0);assert.equal(requests.length,4);
});

test('prior proposals remain quoted context and the model receives current form plus navigation evidence',async()=>{
 let sent;const current={revision:1,path:'/dispatch',fields:[{ref:'r1f0',label:'Office code',type:'text'},{ref:'r1f1',label:'Desk zone',type:'text'}],links:[{ref:'r1n0',label:'Reports',path:'/reports'}]};
 const planner=createPlatformPlanner({gatewayUrl:'https://model.example.com/gateway',serviceToken:'synthetic-service-token-for-contract-testing',fetchImpl:async(_url,input)=>{sent=JSON.parse(input.body);return {ok:true,json:async()=>({content:JSON.stringify({message:'Review',actions:[{type:'fill',ref:'r1f0',value:'A'},{type:'fill',ref:'r1f1',value:'West'}]})})};}});
 await planner({text:'Prepare office code A and desk zone West.',snapshot:current,history:[{role:'assistant',text:'I can open Reports, then continue your request.'}]});assert.deepEqual(sent.messages.map(m=>m.role),['system','user']);const task=JSON.parse(sent.messages.at(-1).content);assert.equal(task.conversationContext[0].role,'assistant');assert.deepEqual(task.observed.links,current.links);assert.ok(task.responseContract.allowedActionTypes.includes('navigate'));assert.deepEqual((await planner({text:'Prepare office code A and desk zone West.',snapshot:current})).actions.map(a=>a.type),['fill','fill']);
});

test('comma-and assignments resolve all explicit fields without model inference or unrelated writes',async()=>{
 const current={revision:1,path:'/dispatch',fields:[{ref:'r1f0',label:'Office code',type:'text'},{ref:'r1f1',label:'Desk zone',type:'text'},{ref:'r1f2',label:'Shift',type:'text'},{ref:'r1f3',label:'Unrelated note',type:'text'}],links:[]};
 const planner=createPlatformPlanner({gatewayUrl:'https://model.example.com/gateway',serviceToken:'synthetic-service-token-for-contract-testing',fetchImpl:async(_,{body})=>{const input=JSON.parse(body);assert.equal(input.purpose,'digital_adoption_review');return {ok:true,json:async()=>({content:JSON.stringify(input.draft),quality:{enabled:false}})};}});
 const result=await planner({text:'Set office code to A, desk zone to West, and shift to Night.',snapshot:current});assert.deepEqual(result.actions.map(a=>[a.ref,a.value]),[['r1f0','A'],['r1f1','West'],['r1f2','Night']]);
});
