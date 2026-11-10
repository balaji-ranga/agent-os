import assert from 'node:assert/strict';
import {assignedSkillContextHint,stripNativeSkillMarker} from '../../openclaw-extensions/agent-os-content-tools/skill-context.js';
let calls=0;
const options={prompt:'review my email',sessionKey:'agent:fixture:main',baseUrl:'http://backend/',brokerSecret:()=> 'fixture',fetchImpl:async(url,init)=>{
 calls++;assert.equal(url,'http://backend/api/tools/native-skill-context');
 assert.equal(JSON.parse(init.body).session_key,'agent:fixture:main');
 assert.ok(JSON.parse(init.body).prompt.length<=24000);
 return {ok:true,json:async()=>({instruction:'assigned ready skill'})};
}};
assert.equal(await assignedSkillContextHint(options),'assigned ready skill');
assert.equal(await assignedSkillContextHint({...options,prompt:'[FLOLAH SKILL CONTRACT] already attached'}),'');
assert.equal(await assignedSkillContextHint({...options,sessionKey:''}),'');
assert.equal(calls,1);
assert.equal(await assignedSkillContextHint({...options,prompt:'x'.repeat(25000)}),'assigned ready skill');
for(const fetchImpl of [async()=>{throw Error('offline')},async()=>({ok:false}),async()=>({ok:true,json:async()=>({instruction:'x'.repeat(96001)})})])assert.match(await assignedSkillContextHint({...options,fetchImpl}),/could not be refreshed/);
console.log('NATIVE_SKILL_CONTEXT_OK: scoped request, bounded prompt/response, no duplicate web context, explicit failure');
assert.deepEqual(stripNativeSkillMarker({payload:{text:'Verified reply\n[FLOLAH_SKILLS_USED: fixture@v1]',mediaUrl:'retained'}}),{payload:{text:'Verified reply',mediaUrl:'retained'}});
assert.equal(stripNativeSkillMarker({payload:{text:'ordinary reply'}}),undefined);
assert.deepEqual(stripNativeSkillMarker({payload:{text:'old'}},{payload:{text:'budget refusal'}}),{payload:{text:'budget refusal'}});
