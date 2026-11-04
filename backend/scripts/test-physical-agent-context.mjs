import assert from 'node:assert/strict';
import {physicalAgentAssets,physicalAgentInstructions} from '../src/services/physical/agent-context.js';
let reads=0;
const entity={
 id:'asset-fixture',siteId:'site-fixture',hubId:'hub-fixture',enabled:true,
 actions:{launch_app:'approval_required'},
 description:{title:'Fixture media device',description:'Shared lounge display',flolah:{simulated:false},actions:{launch_app:{
  title:'Open an application',description:'Select one of the installed applications',
  input:{type:'object',properties:{app:{type:'string',enum:['video']}},required:['app']},
  expected:{property:'app',input:'app'}
 }}},observations:{},privateToken:'must-not-leak'
};
const plane={resourceList(owner){reads++;assert.equal(owner,'owner-fixture');return {entities:[entity]};}};
assert.deepEqual(physicalAgentAssets({ownerUserId:'owner-fixture',enabled:true,grants:[],plane}),[]);
assert.deepEqual(physicalAgentAssets({ownerUserId:'owner-fixture',enabled:false,grants:['physical_entities_list'],plane}),[]);
assert.equal(reads,0);
const assets=physicalAgentAssets({ownerUserId:'owner-fixture',enabled:true,grants:['physical_entities_list'],plane});
assert.equal(reads,1);assert.equal(assets[0].entityId,entity.id);assert.deepEqual(assets[0].actions.launch_app.input.properties.app.enum,['video']);assert.equal(assets[0].actions.launch_app.policy,'approval_required');
assert.ok(!JSON.stringify(assets).includes('must-not-leak'));
assert.equal(assets[0].description,'Shared lounge display');
assert.equal(assets[0].actions.launch_app.title,'Open an application');
assert.equal(assets[0].actions.launch_app.description,'Select one of the installed applications');
assert.equal(physicalAgentInstructions([]),'');
const prompt=physicalAgentInstructions(assets);
for(const text of ['physical_entities_list','physical_invoke','physical_operation_get','Do not substitute desktop browser','never self-approve','fresh idempotencyKey'])assert.ok(prompt.includes(text));
console.log('PHYSICAL_AGENT_CONTEXT_PASS: granted owner-scoped schemas, no private fields, governed device route and evidence instructions');
