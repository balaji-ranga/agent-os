// Focused production-code test, synthetic tenant, disposable DB, mocked LLM HTTP.
// Never contacts providers or executes agents/connectors.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fixtureDir = mkdtempSync(join(tmpdir(), 'flolah-router-contract-'));
process.env.AGENT_OS_DATA_DIR = fixtureDir;
process.env.OPENAI_BASE_URL = 'https://maker.invalid/v1';
process.env.OPENAI_PRIMARY_BASE_URL = 'https://maker.invalid/v1';
process.env.OPENAI_PRIMARY_MODEL = 'test-maker';
process.env.OPENAI_API_KEY = 'fixture-only';
process.env.OPENAI_PRIMARY_API_KEY = 'fixture-only';
process.env.OPENAI_SECONDARY_BASE_URL = 'https://checker.invalid/v1';
process.env.OPENAI_SECONDARY_MODEL = 'test-checker';
process.env.OPENAI_SECONDARY_API_KEY = 'fixture-only';
const { getDb } = await import('../src/db/schema.js');
const { routeAgentTurn, validateRouteDecision, needsRouteAdjudication, ROUTER_SYSTEM, isDirectChatOnlyAgent } = await import('../src/services/agent-turn-router.js');
const { buildRouteSchema, routeContractPrompt } = await import('../src/services/agent-route-contract.js');
const db = getDb();
const nativeFetch = globalThis.fetch;
let queue = [], calls = [], checks = 0;
function check(label, fn) { fn(); checks++; console.log('PASS ' + label); }
const valid = { relation:'new_work',execution_mode:'delegate',relevant_turn_ids:[],parent_work_unit_id:null,target_agent_id:'specialist',resolved_request:'Review my inbox without making changes.',restart_requested:false,confidence:0.91,executor_evidence:{capability_names:['mailbox_review'],reason:'Mailbox review belongs to the mailbox specialist.'} };
const roster = ['specialist'];
globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/(maker|checker)\.invalid\/v1\/chat\/completions$/, 'no unmocked network');
  const body = JSON.parse(options.body);
  calls.push({url:String(url),body});
  assert(queue.length, 'unexpected extra LLM call');
  const next=queue.shift();
  return new Response(JSON.stringify({ choices:[{message:{content:typeof next==='string'?next:JSON.stringify(next)}}],model:body.model,usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2} }),{status:200,headers:{'content-type':'application/json'}});
};
try {
  db.pragma('foreign_keys = OFF'); // Only this disposable synthetic database.
  db.prepare("INSERT OR REPLACE INTO agents (id,name,role,is_coo,is_orchestrator,parent_id) VALUES ('router-coo','Coordinator','Coordinate specialists',1,1,NULL)").run();
  db.prepare("INSERT OR REPLACE INTO agents (id,name,role,parent_id) VALUES ('specialist','Mailbox specialist','Mailbox review','router-coo')").run();
  db.prepare("INSERT OR REPLACE INTO agents (id,name,role,parent_id) VALUES ('platformhelp','Platform Help','Explain how to use Flolah',NULL)").run();
  db.prepare("INSERT OR REPLACE INTO user_agents (user_id,agent_id,enabled) VALUES ('router-owner','specialist',1)").run();
  db.prepare("INSERT OR IGNORE INTO agent_tool_grants (agent_id,tool_name) VALUES ('specialist','mailbox_review'),('router-coo','ceo_profile')").run();
  const agent = db.prepare("SELECT * FROM agents WHERE id='router-coo'").get();
  const run = async (responses, extra={}) => {
    queue=[...responses]; calls=[];
    return routeAgentTurn({ownerUserId:'router-owner',agent,sessionId:'fixture-session',message:valid.resolved_request,...extra});
  };
  check('valid specialist route',()=>assert.equal(validateRouteDecision(valid,[],roster).ok,true));
  for (const confidence of [null,undefined,'0.9','',false,NaN,Infinity,-0.1,1.1]) check(`reject invalid confidence ${String(confidence)}`,()=>assert.equal(validateRouteDecision({...valid,confidence},[],roster).ok,false));
  for (const mode of ['chat','direct_tool','goal_plan']) check(`reject ${mode} plus target`,()=>assert.equal(validateRouteDecision({...valid,execution_mode:mode},[],roster).ok,false));
  for (const target of [null,'outsider','SPECIALIST',' specialist ']) check(`reject invalid delegate target ${target}`,()=>assert.equal(validateRouteDecision({...valid,target_agent_id:target},[],roster).ok,false));
  check('zero is a score but requires adjudication',()=>assert.equal(needsRouteAdjudication(validateRouteDecision({...valid,confidence:0},[],roster),{...valid,confidence:0}),true));
  check('75 percent accepted',()=>assert.equal(needsRouteAdjudication({ok:true},{confidence:0.75}),false));
  check('schema has mutually exclusive target rules and no fixed confidence',()=>{
    assert.equal(buildRouteSchema(roster).oneOf.length,2);
    assert.equal(buildRouteSchema([]).oneOf.length,1);
    assert.doesNotMatch(ROUTER_SYSTEM+routeContractPrompt(roster),/"confidence"\s*:\s*0/);
  });
  const good=await run([valid]);
  check('confident router uses one model call',()=>{assert.equal(calls.length,1);assert.equal(good.confidence,0.91);assert.equal(good.target_agent_id,'specialist');});
  for (const mode of ['chat','goal_plan']) {
    const result=await run([{...valid,execution_mode:mode,target_agent_id:null}]);
    check(`valid ${mode} skips adjudication`,()=>{assert.equal(calls.length,1);assert.equal(result.execution_mode,mode);});
  }
  const platformHelp = db.prepare("SELECT * FROM agents WHERE id='platformhelp'").get();
  check('platform help is a direct-chat-only agent',()=>assert.equal(isDirectChatOnlyAgent(platformHelp),true));
  const platformHelpGoal = await routeAgentTurn({
    ownerUserId:'router-owner',
    agent:platformHelp,
    sessionId:'platform-help-fixture-session',
    message:'Explain the full OKR setup flow and give me the steps.',
    semanticDecision:{
      relation:'new_work',execution_mode:'goal_plan',relevant_turn_ids:[],parent_work_unit_id:null,
      target_agent_id:null,resolved_request:'Explain the full OKR setup flow and give me the steps.',
      restart_requested:false,confidence:0.92,
      executor_evidence:{capability_names:[],reason:'The request is about Flolah product help.'},
    },
  });
  check('platform help goal-plan decision is forced to agent chat',()=>{
    assert.equal(platformHelpGoal.execution_mode,'chat');
    assert.equal(platformHelpGoal.direct_chat_only_guarded,true);
  });
  queue=[]; calls=[];
  const platformHelpDirect = await routeAgentTurn({
    ownerUserId:'router-owner',agent:platformHelp,sessionId:'platform-help-direct-session',
    message:'How do Key Results work in Flolah?',
  });
  check('platform help bypasses routing and adjudication model calls',()=>{
    assert.equal(calls.length,0);
    assert.equal(platformHelpDirect.execution_mode,'chat');
    assert.equal(platformHelpDirect.routing_model_bypassed,true);
  });
  check('ordinary agent goal planning remains available',()=>assert.equal(goalPlanModeForOrdinaryAgent(),'goal_plan'));
  function goalPlanModeForOrdinaryAgent() {
    return db.prepare("SELECT execution_mode FROM chat_work_units WHERE agent_id='router-coo' AND execution_mode='goal_plan' ORDER BY created_at DESC LIMIT 1").get()?.execution_mode;
  }
  const direct={...valid,execution_mode:'direct_tool',target_agent_id:null,executor_evidence:{capability_names:['ceo_profile'],reason:'The coordinator can read its CEO profile.'}};
  await run([direct,direct]);
  check('orchestrator direct execution requires independent fit check',()=>assert.equal(calls.length,2));
  const wrongOwner={...direct,executor_evidence:valid.executor_evidence};
  await run([wrongOwner,valid]);
  check('specialist capability cannot be borrowed by orchestrator',()=>assert.equal(calls.length,2));
  const bad={...valid,execution_mode:'direct_tool',confidence:0};
  const repaired=await run([bad,valid]);
  check('contradictory router adjudicated with original input and errors',()=>{
    assert.equal(calls.length,2);assert.match(calls[1].url,/checker.invalid/);
    const first=JSON.parse(calls[0].body.messages[1].content), judge=JSON.parse(calls[1].body.messages[1].content);
    assert.deepEqual(judge.candidate_decision,bad);assert.deepEqual(judge.organization,first.organization);
    assert.deepEqual(judge.agent,first.agent);assert.equal(judge.current_message,first.current_message);
    assert(judge.validation_errors.some(x=>x.includes('target_agent_id')));
    assert.equal(repaired.confidence,0.91);assert.equal(repaired.execution_mode,'delegate');
  });
  const history=[{id:45,role:'user',content:'Review inbox read-only',work_unit_id:'fixture-parent'}];
  const corrected={...valid,relation:'correction',relevant_turn_ids:[45],parent_work_unit_id:'fixture-parent',restart_requested:true};
  const resumed=await run([bad,corrected],{history});
  check('adjudication preserves selected context and restart intent',()=>{assert.equal(resumed.relation,'correction');assert.deepEqual(resumed.relevant_turn_ids,[45]);assert.equal(resumed.restart_requested,true);});
  const chat=await run([bad,{...valid,relation:'conversation',execution_mode:'chat',target_agent_id:null}]);
  check('adjudicator can choose chat',()=>assert.equal(chat.execution_mode,'chat'));
  const goal=await run([bad,{...valid,execution_mode:'goal_plan',target_agent_id:null,confidence:0.88}]);
  check('adjudicator can choose goal without forced confidence',()=>{assert.equal(goal.execution_mode,'goal_plan');assert.equal(goal.confidence,0.88);});
  for (const final of [{...valid,confidence:0.74},{...valid,confidence:null},bad,'not json',{...valid,target_agent_id:'outsider'}]) {
    const before=db.prepare('SELECT count(*) AS n FROM chat_work_units').get().n;
    await assert.rejects(()=>run([bad,final]),e=>e.code==='ROUTER_DECISION_INVALID');
    check('unresolved adjudication cannot create executable work',()=>{assert.equal(calls.length,2);assert.equal(db.prepare('SELECT count(*) AS n FROM chat_work_units').get().n,before);});
  }
  const { setPlatformSetting } = await import('../src/services/platform-llm-settings.js');
  setPlatformSetting('llm_active_endpoint','secondary');
  await run([bad,valid]);
  check('active slot switch swaps router and adjudicator models',()=>{assert.match(calls[0].url,/checker.invalid/);assert.match(calls[1].url,/maker.invalid/);});
  console.log(`PASS ${checks} focused router/adjudicator checks; zero live model or agent calls.`);
} finally {
  globalThis.fetch=nativeFetch;
  db.close();
  rmSync(fixtureDir,{recursive:true,force:true}); // Exact mkdtemp-created fixture only.
}
