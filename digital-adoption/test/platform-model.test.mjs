import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformPlanner } from '../src/platform-model.mjs';
import { createPlatformGateway } from '../integrations/platform-gateway.mjs';

test('server-side gateway resolves current primary/secondary on every call, no browser model override',async()=>{
 const serviceToken='synthetic-test-only-service-token-000000';let active='primary';const seen=[];
 const gateway=createPlatformGateway({serviceToken,resolveActive:async()=>({active}),complete:async({config})=>{seen.push(config.active);return {content:JSON.stringify({message:'Review',actions:[]})};}});
 const planner=createPlatformPlanner({gatewayUrl:'https://platform.test/internal/adoption-model',serviceToken,fetchImpl:async(url,init)=>{
  assert.equal(String(url),'https://platform.test/internal/adoption-model');
  const result=await gateway({authorization:init.headers.Authorization,body:JSON.parse(init.body)});return {ok:true,json:async()=>result};
 }});
 const task={text:'Help',snapshot:{revision:1,fields:[]}};
 await planner(task);active='secondary';await planner(task);
 assert.deepEqual(seen,['primary','secondary']);
 await assert.rejects(()=>gateway({authorization:'Bearer incorrect',body:{}}),/denied/);
 await assert.rejects(()=>gateway({authorization:`Bearer ${serviceToken}`,body:{purpose:'digital_adoption_plan',selection:'platform_active',messages:[],model:'override'}}),/Invalid/);
});
