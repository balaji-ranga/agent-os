import assert from 'node:assert/strict';
import {physicalContextHint} from '../../openclaw-extensions/agent-os-content-tools/physical-context.js';
let calls=0;const base={allowed:true,sessionKey:'agent:t-test--helper:whatsapp:direct:test',baseUrl:'http://backend',brokerSecret:()=> 'test-only',fetchImpl:async(url,init)=>{calls++;assert.equal(url,'http://backend/api/tools/native-model-budget/physical-context');assert.deepEqual(JSON.parse(init.body),{session_key:base.sessionKey});return {ok:true,json:async()=>({instructions:'scoped devices'})}}};
assert.equal(await physicalContextHint(base),'scoped devices');
assert.equal(await physicalContextHint({...base,allowed:false}),'');assert.equal(calls,1);
assert.equal(await physicalContextHint({...base,sessionKey:''}),'');assert.equal(calls,1);
for(const fetchImpl of [async()=>{throw Error('timeout')},async()=>({ok:false}),async()=>({ok:true,json:async()=>({instructions:'x'.repeat(32001)})})])assert.match(await physicalContextHint({...base,fetchImpl}),/physical_entities_list/);
assert.equal(await physicalContextHint({...base,fetchImpl:async()=>({ok:true,json:async()=>({instructions:''})})}),'');
console.log('PHYSICAL_NATIVE_CONTEXT_OK: fresh session-scoped hints, grant gate, bounded response and explicit failure guidance');
