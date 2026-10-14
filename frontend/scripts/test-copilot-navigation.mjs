import assert from 'node:assert/strict';
import {continueCopilotNavigation} from '../src/utils/copilotNavigation.js';
const catalog={screens:[{id:'crm',route:'/crm'},{id:'erp',route:'/erp'}]};
const proposal=action=>({proposal:{actions:[action]}});
const start=proposal({type:'navigate',screen:'crm'});
const path={type:'embed_navigate',screen:'crm',path:'/objects/opportunities'};
const creation={type:'embed_open_form',screen:'crm',label:'New Opportunity'};
let navigations=[],proposals=[proposal(path),proposal(creation)];
let result=await continueCopilotNavigation({session:start,catalog,navigate:async a=>navigations.push(a),inspect:async()=>({catalog}),propose:async()=>proposals.shift()});
assert.equal(navigations.length,2);assert.deepEqual(result.session.proposal.actions,[creation],'Creation stops for explicit review, never automatically executes');
for(const type of ['fill','embed_fill','screen_fill','agent_call','agent_chat','watch_connector','embed_open_form']){
  result=await continueCopilotNavigation({session:proposal({type}),catalog,navigate:async()=>assert.fail('Writes/calls are not navigation'),inspect:async()=>assert.fail(),propose:async()=>assert.fail()});
  assert.equal(result.session.proposal.actions[0].type,type);
}
navigations=[];
result=await continueCopilotNavigation({session:start,catalog,navigate:async a=>navigations.push(a),inspect:async()=>({catalog}),propose:async()=>start});
assert.equal(navigations.length,1);assert.equal(result.stopped,true,'Repeated navigation stops instead of looping');
await assert.rejects(()=>continueCopilotNavigation({session:start,catalog,isCurrent:()=>false}),/context changed/);
await assert.rejects(()=>continueCopilotNavigation({session:start,catalog:{screens:[]}}),/access/);
await assert.rejects(()=>continueCopilotNavigation({session:start,catalog,navigate:async()=>{},inspect:async()=>{throw Error('Not loaded');},propose:async()=>assert.fail()}),/Not loaded/);
console.log('PASS Copilot navigation: actual screen opening, fresh inspection, bounded continuation, permission/context checks and creation/write separation.');
