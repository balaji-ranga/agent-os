import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { resolveChatReply, workUnitBrowserEvidence } from '../src/services/chat-reply-context.js';
import { validateStepOutcome, correctionContext } from '../src/services/step-outcome-validation.js';

const conn = new Database(':memory:');
conn.exec('CREATE TABLE chat_turns(id INTEGER, owner_user_id TEXT, agent_id TEXT, work_unit_id TEXT, role TEXT, content TEXT, created_at TEXT)');
const add = conn.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?,?,?)');
add.run(1,'a','coo','old','user','Get ETF pricing and close new tabs','2026-01-01');
add.run(2,'a','coo','old','assistant','Price 42, change 5%','2026-01-01');
add.run(3,'b','coo','old','user','Private other tenant','2026-01-01');
add.run(4,'a','other','old','user','Private other agent','2026-01-01');
add.run(5,'a','coo','unrelated','user','Unrelated website builder','2026-09-04');
assert.equal(resolveChatReply(conn,{messageId:3,ownerUserId:'a',agentId:'coo'}),null);
assert.equal(resolveChatReply(conn,{messageId:4,ownerUserId:'a',agentId:'coo'}),null);
assert.equal(resolveChatReply(conn,{messageId:999,ownerUserId:'a',agentId:'coo'}),null);
const old = resolveChatReply(conn,{messageId:1,ownerUserId:'a',agentId:'coo'});
assert.equal(old.turns.length,2); assert.match(old.context,/Price 42/); assert.doesNotMatch(old.context,/Private|Unrelated/);
conn.exec('CREATE TABLE browser_tasks(id TEXT, ceo_user_id TEXT, input_json TEXT, status TEXT, result_json TEXT, error TEXT, created_at TEXT)');
const task=conn.prepare('INSERT INTO browser_tasks VALUES(?,?,?,?,?,?,?)');
task.run('one','a','{"work_unit_id":"old"}','completed','{"price":42}',null,'2026-01-01');
task.run('two','b','{"work_unit_id":"old"}','completed','{"private":true}',null,'2026-01-01');
task.run('three','a','{"work_unit_id":"other"}','completed','{"unrelated":true}',null,'2026-01-01');
assert.match(workUnitBrowserEvidence(conn,'a','old'),/42/);
assert.doesNotMatch(workUnitBrowserEvidence(conn,'a','old'),/private|unrelated/);
assert.equal(workUnitBrowserEvidence(conn,'a',null),'');
conn.exec('CREATE TABLE chat_work_units(id TEXT, owner_user_id TEXT, agent_id TEXT, session_id TEXT, relation TEXT, execution_mode TEXT, resolved_request TEXT, parent_work_unit_id TEXT, request_fingerprint TEXT, route_json TEXT, status TEXT)');
conn.prepare('INSERT INTO chat_work_units(id,owner_user_id,status) VALUES(?,?,?)').run('old','a','completed');
const routerSource=fs.readFileSync(new URL('../src/services/agent-turn-router.js',import.meta.url),'utf8');
const routeFunction=routerSource.slice(routerSource.indexOf('export async function routeAgentTurn'),routerSource.indexOf('export function bindWorkUnitExecution')).replace('export ','');
const route=vm.runInNewContext(routeFunction+'\nrouteAgentTurn',{
 ensureAgentTurnRouterSchema:()=>{}, buildRouterInput:({history})=>({organization:[],candidate_turns:history}),
 routeContractPrompt:()=>'', ROUTER_SYSTEM:'', RELATIONS:new Set(['new_work','follow_up','conversation']),MODES:new Set(['chat','direct_tool','delegate','goal_plan']),
 db:()=>conn, randomUUID,createHash,console,
});
const routeBase={ownerUserId:'a',agent:{id:'coo'},sessionId:'today',message:'What was the price?',history:old.turns,replyToMessageId:1};
const bound=await route({...routeBase,semanticDecision:{relation:'new_work',execution_mode:'direct_tool',relevant_turn_ids:[],resolved_request:'What was the price?',confidence:1}});
assert.equal(bound.parent_work_unit_id,'old');assert.equal(bound.execution_mode,'chat');assert.equal(bound.terminal_parent_guarded,true);
const restart=await route({...routeBase,semanticDecision:{relation:'follow_up',execution_mode:'direct_tool',relevant_turn_ids:[1],resolved_request:'Refresh the price',confidence:1,restart_requested:true}});
assert.equal(restart.execution_mode,'direct_tool');
conn.close();

const source=fs.readFileSync(new URL('../src/services/tool-owner-scope.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export /g,'');
const registry=vm.runInNewContext(source+'\n({registerOpenClawSessionOwner,lookupSessionExecutionContext})',{process:{env:{}},Map,Date});
registry.registerOpenClawSessionOwner('session-a','a',null,'web',{original_request:'ETF price and change, close new tabs'});
registry.registerOpenClawSessionOwner('session-b','a',null,'web',{original_request:'Different simultaneous task'});
assert.match(registry.lookupSessionExecutionContext('session-a','a').original_request,/close new tabs/);
assert.equal(registry.lookupSessionExecutionContext('session-a','b'),null);
assert.equal(registry.lookupSessionExecutionContext('missing','a'),null);
assert.match(registry.lookupSessionExecutionContext('session-b','a').original_request,/Different/);
for(const content of ['', '{"satisfied":"true"}', 'not JSON']) {
  assert.equal((await validateStepOutcome({},async()=>({content}))).satisfied,false);
}
assert.equal((await validateStepOutcome({},async()=>{throw new Error('timeout')})).satisfied,false);
assert.equal((await validateStepOutcome({},async()=>({content:'{"satisfied":true,"reason":"Evidence matches","missing_outcomes":[]}'}))).satisfied,true);
const correction=correctionContext({attempt:2,stepId:'step-1',error:'Draft missing',previousResult:'CRM lead #42 already created'});
assert.match(correction,/SAME step step-1/); assert.match(correction,/CRM lead #42/); assert.match(correction,/do not duplicate/);
console.log('PASS: historical replies, tenant/agent isolation, missing references, concurrent context, validation errors, correction context');
