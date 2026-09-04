// Explicit opt-in live-model probe using real tenant catalog, no goal execution.
// Usage: FLOLAH_LIVE_MODEL_TEST=1 node scripts/test-router-planner-live.mjs OWNER COO SPECIALIST [router|planner|rag|all]
import assert from 'node:assert/strict';
import { getDb } from '../src/db/schema.js';
import { chatCompletions } from '../src/config/llm.js';
import { buildRouterInput, ROUTER_SYSTEM, validateRouteDecision, needsRouteAdjudication } from '../src/services/agent-turn-router.js';
import { routeContractPrompt, validateExecutorEvidence, requiresExecutorFitCheck, adjudicatorInput, ADJUDICATOR_INSTRUCTION } from '../src/services/agent-route-contract.js';
import { qualityAssureGoalPlan } from '../src/services/goal-plan-quality.js';
import { filterRelevantEvidence } from '../src/services/retrieval-relevance.js';
if (process.env.FLOLAH_LIVE_MODEL_TEST !== '1') throw new Error('Explicit FLOLAH_LIVE_MODEL_TEST=1 required');
const [owner,coo,specialist,mode='all'] = process.argv.slice(2);
if (!owner || !coo || !specialist) throw new Error('Owner and two entitled agent IDs required');
for (const id of [coo,specialist]) assert(getDb().prepare('SELECT 1 FROM user_agents WHERE user_id=? AND agent_id=? AND enabled=1').get(owner,id),'Agent not entitled');
const results=[];
const launch='Create a concise launch concept for a 30-second Flolah explainer about humans and AI employees working together. Use the CEO profile tool for company context. Delegate creative ownership to Content Orchestrator. Content Orchestrator must delegate narrative development to its Story Agent, use the returned narrative to create and export a draft storyboard, then report the outcome back to COO. COO must provide the consolidated final result to the CEO. This test must demonstrate COO → Content Orchestrator → Story Agent, use ceo_profile and videostoryboard_export, and preserve the delegation trace and step outputs.';
const dental='Search and get dental clinics around Tampines Singapore. Add these as potential leads to CRM including their email and contact number. Create an email draft for those leads in my Gmail drafts. Do not send emails; never fabricate missing contact details.';
async function route(id,prompt,expected,target=null) {
  const agent=getDb().prepare('SELECT * FROM agents WHERE id=?').get(id);
  const input=buildRouterInput({ownerUserId:owner,agent,message:prompt});
  const system=ROUTER_SYSTEM+'\n'+routeContractPrompt(input.organization.map(a=>a.id));
  const started=Date.now(); let decision, validation, model;
  for(let round=0;round<2;round++) {
    const response=await chatCompletions({ownerUserId:owner,toolName:round?'agent_turn_goal_adjudicator':'agent_turn_router',endpointPreference:round?'secondary':'primary',thinkingMode:'disabled',responseFormat:'json_object',temperature:0,maxTokens:5200,
      messages:[{role:'system',content:system+(round?'\n'+ADJUDICATOR_INSTRUCTION:'')},{role:'user',content:JSON.stringify(round?adjudicatorInput(input,decision,JSON.stringify(decision),validation.errors):input)}]});
    model=response.modelUsed;
    decision=JSON.parse(response.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    validation=validateRouteDecision(decision,[],input.organization.map(a=>a.id));
    if(validation.ok) { const errors=validateExecutorEvidence(decision,input); if(errors.length)validation={ok:false,errors}; }
    if(!round&&validation.ok&&requiresExecutorFitCheck(decision,input))validation={ok:false,errors:['Verify orchestrator versus specialist capability ownership']};
    console.log(JSON.stringify({phase:'route',round:round+1,agent:id,decision,validation,model,elapsed_ms:Date.now()-started}));
    if(!needsRouteAdjudication(validation,decision))break;
  }
  assert(!needsRouteAdjudication(validation,decision),'Route not validated');
  assert.equal(decision.execution_mode,expected); assert.equal(decision.target_agent_id,target);
  results.push({test:`route:${id}:${expected}`,pass:true,model,elapsed_ms:Date.now()-started});
}
try {
  if(['router','all'].includes(mode)) {
    await route(coo,'I want to organize my email inbox','delegate',specialist);
    await route(specialist,'Summarize my past seven days of emails and identify those needing a response. Read only.','direct_tool');
    await route(coo,launch,'goal_plan');
  }
  if(['planner','launch','all'].includes(mode)) for(const [name,prompt] of (mode==='launch'?[['nested-launch',launch]]:[['dental',dental],['nested-launch',launch]])) {
    const started=Date.now();
    const plan=await qualityAssureGoalPlan({ownerUserId:owner,orchestratorAgentId:coo,prompt,candidateSteps:[],onProgress:event=>console.log(JSON.stringify({test:name,...event}))});
    assert.equal(plan.quality.llm_maker_checker_succeeded,true);
    console.log(JSON.stringify({test:name,steps:plan.steps,quality:plan.quality,elapsed_ms:Date.now()-started}));
    results.push({test:name,pass:true,rounds:plan.quality.maker_attempts,elapsed_ms:Date.now()-started});
  }
  if(['rag','all'].includes(mode)) {
    const result=await filterRelevantEvidence(owner,'Find dental clinics in Tampines, Singapore',[
      {document_id:'synthetic-person',content:'Alex Sample is a software engineer living in Tampines, Singapore. This is a fictional resume.'},
      {document_id:'synthetic-clinic',content:'Example Dental Clinic is a fictional dental clinic operating in Tampines, Singapore. No real contact details supplied.'},
    ]);
    assert.equal(result.relevance.status,'supported');
    assert.deepEqual(result.chunks.map(c=>c.document_id),['synthetic-clinic']);
    results.push({test:'rag-synthetic-entity-relevance',pass:true});
  }
  console.log(JSON.stringify({results,goals_executed:0,connector_actions:0}));
} catch(error) { console.error(JSON.stringify({results,error:error.message,details:error.details}));process.exitCode=1; }
finally { getDb().close(); }
