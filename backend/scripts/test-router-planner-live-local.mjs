/** Local production-code tests with REAL LLMs and a disposable synthetic tenant.
 * No server, SSH, production database, OpenClaw, Gmail or CRM is needed.
 * Credentials are read from an existing env file, never copied into fixtures/reports.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseEnv } from 'dotenv';

const {values:args}=parseArgs({options:{
  'env-file':{type:'string'}, slot:{type:'string',default:'primary'}, suite:{type:'string',default:'all'},
  'primary-model':{type:'string'},'secondary-model':{type:'string'},
  'inventory-file':{type:'string'},
  case:{type:'string'},
  'capture-request':{type:'string'},
  'max-calls':{type:'string',default:'18'},'timeout-seconds':{type:'string',default:'600'},
  report:{type:'string'},run:{type:'boolean',default:false},
}});
if(!args['env-file'])throw new Error('Pass --env-file pointing to your EXISTING local environment file. Do not put keys on the command line.');
if(!['primary','secondary'].includes(args.slot))throw new Error('slot must be primary or secondary');
if(!['router','planner','rag','all'].includes(args.suite))throw new Error('suite must be router, planner, rag or all');
const config=parseEnv(readFileSync(resolve(args['env-file'])));
const inventory=args['inventory-file']
  ? JSON.parse(readFileSync(args['inventory-file']==='-' ? 0 : resolve(args['inventory-file']),'utf8').replace(/^\uFEFF/,''))
  : null;
if(inventory)args.slot=inventory.active_slot;
// Import only model credentials/settings. Never load production database paths,
// business connector secrets or service URLs from the deployment environment.
const keys=['OPENAI_BASE_URL','OPENAI_API_URL','OPENAI_API_KEY','OPENAI_PRIMARY_BASE_URL','OPENAI_PRIMARY_API_KEY','OPENAI_PRIMARY_MODEL','OPENAI_DEFAULT_MODEL','OPENAI_SECONDARY_BASE_URL','OPENAI_SECONDARY_API_KEY','OPENAI_SECONDARY_MODEL'];
for(const key of keys){delete process.env[key];if(config[key])process.env[key]=config[key];}
if(args['primary-model'])process.env.OPENAI_PRIMARY_MODEL=args['primary-model'];
if(args['secondary-model'])process.env.OPENAI_SECONDARY_MODEL=args['secondary-model'];
const maxCalls=Number(args['max-calls']),timeoutSeconds=Number(args['timeout-seconds']);
if(!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>30||!Number.isFinite(timeoutSeconds)||timeoutSeconds<30||timeoutSeconds>1800)throw new Error('Invalid test budget (1–30 calls, 30–1800 seconds)');
const fixture=mkdtempSync(join(tmpdir(),'flolah-live-local-'));
process.env.AGENT_OS_DATA_DIR=join(fixture,'data');
process.env.OPENCLAW_DIR=join(fixture,'openclaw');
process.env.OPENCLAW_CONFIG_PATH=join(fixture,'openclaw','openclaw.json');
process.env.OPENCLAW_WORKSPACE_PATH=join(fixture,'workspace');
process.env.MODEL_ROUTING_ENABLED='0'; // Direct providers: private VPS LiteLLM DNS is not exposed.
process.env.PLATFORM_USE_LOCAL_OLLAMA='0';
const nativeFetch=globalThis.fetch;
const report={transport:'direct-provider',synthetic_tenant:true,slot:args.slot,suite:args.suite,cases:[],llm_calls:[],business_actions:0,goals_executed:0};
let db;let calls=0;
const started=Date.now();
try {
  const {getDb}=await import('../src/db/schema.js');db=getDb();
  const {getEnvLlmEndpoints,setPlatformSetting}=await import('../src/services/platform-llm-settings.js');
  setPlatformSetting('llm_active_endpoint',args.slot);
  const endpoints=getEnvLlmEndpoints();
  for(const [slot,endpoint] of Object.entries(endpoints)) {
    if(!endpoint?.baseUrl||!endpoint?.apiKey||!endpoint?.model)throw new Error(`Local ${slot} model endpoint/key/model is missing`);
    if(endpoint.baseUrl.includes('${')||endpoint.apiKey.includes('${'))throw new Error(`Unresolved variable in local ${slot} LLM settings`);
  }
  const urls=new Set(Object.values(endpoints).map(e=>`${e.baseUrl.replace(/\/$/,'')}/chat/completions`));
  report.endpoints=Object.fromEntries(Object.entries(endpoints).map(([slot,e])=>[slot,{origin:new URL(e.baseUrl).origin,model:e.model,key_configured:!!e.apiKey}]));
  console.log(JSON.stringify({preflight:report.endpoints,active_slot:args.slot,will_call_models:args.run,max_calls:maxCalls}));
  globalThis.fetch=async(url,options={})=>{
    assert(args.run,'Network disabled: add --run to opt into paid live-model calls');
    assert(urls.has(String(url)),`Non-LLM network access blocked by isolated test harness`);
    if(++calls>maxCalls)throw new Error('Live-model call budget exhausted');
    const remaining=timeoutSeconds*1000-(Date.now()-started);
    if(remaining<=0)throw new Error('Live-model test time budget exhausted');
    const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(remaining)]):AbortSignal.timeout(remaining);
    const request=JSON.parse(options.body);
    if(args['capture-request']){
      const path=resolve(args['capture-request']);
      if(!report.request_captured){
        mkdirSync(dirname(path),{recursive:true});
        writeFileSync(path,JSON.stringify(request,null,2));
        const input=request.messages.find(m=>m.role==='user'&&m.content.startsWith('{'));
        if(input)writeFileSync(path.replace(/\.json$/,'.metadata.json'),JSON.stringify(JSON.parse(input.content),null,2));
        report.request_captured=true;
      }
      return new Response(JSON.stringify({error:{message:'Offline capture only: no provider called'}}),{status:403,headers:{'content-type':'application/json'}});
    }
    const callStarted=Date.now();
    let response;
    try { response=await nativeFetch(url,{...options,signal,redirect:'error'}); }
    catch(error) {
      report.llm_calls.push({model:request.model,status:null,elapsed_ms:Date.now()-callStarted,error:error.name});
      throw error;
    }
    let body;try{body=await response.clone().json();}catch{}
    report.llm_calls.push({model:body?.model||request.model,status:response.status,elapsed_ms:Date.now()-callStarted,usage:body?.usage||null});
    return response;
  };
  if(args.run){
    db.pragma('foreign_keys=OFF'); // Synthetic tenant only; no production DB is opened.
    const owner=inventory?.owner||'local-fixture-company';
    const actualIds={'coordinator':'balserve','mail-specialist':'gmail-operations','research-specialist':'techresearcher','discovery-specialist':'businessdiscovery','crm-specialist':'crm-s1-ceobala','erp-checker':'erp-ap-ceobala','creative-director':'video-orch-ceobala','narrative-writer':'video-story-ceobala'};
    const agentId=id=>inventory?(actualIds[id]||id):id;
    const agents=[
      ['coordinator','COO','Coordinate company specialists and consolidate outcomes',null,1,1],
      ['mail-specialist','Gmail Operations','Manage Gmail inbox, review mail and save drafts','coordinator',0,0],
      ['research-specialist','Tech Researcher','Research technology topics and report recent agent work','coordinator',0,0],
      ['discovery-specialist','Business Discovery','Find and verify local businesses and contact information','coordinator',0,0],
      ['crm-specialist','CRM Maker','Create and verify CRM company, person and lead records','coordinator',0,0],
      ['creative-director','Content Orchestrator','Delegate narrative to Story Agent and export storyboards','coordinator',0,1],
      ['narrative-writer','Story Agent','Develop narratives for the Content Orchestrator','creative-director',0,0],
    ];
    const insertAgent=db.prepare('INSERT INTO agents (id,name,role,parent_id,is_coo,is_orchestrator,planning_status) VALUES (?,?,?,?,?,?,\'production\')');
    for(const row of agents){insertAgent.run(...row);db.prepare('INSERT INTO user_agents (user_id,agent_id,enabled) VALUES (?,?,1)').run(owner,row[0]);}
    const tools=[
      ['ceo_profile','Read CEO company profile and business context',['coordinator']],
      ['notify_ceo','Deliver an outcome report to CEO',['coordinator']],
      ['agent_work_history','Read the calling agent\'s owner-scoped work history and return an immutable evidence snapshot',['coordinator','mail-specialist','research-specialist','discovery-specialist','crm-specialist','creative-director','narrative-writer']],
      ['gmail_mailbox_review','Read and summarize recent Gmail mail',['mail-specialist']],
      ['gmail_mailbox_cleanup','Organize or clean Gmail with policy-controlled changes',['mail-specialist']],
      ['connector_execute_action','Execute granted connector actions, including saving Gmail drafts',['mail-specialist']],
      ['business_discover','Discover local businesses with source evidence and contact details',['discovery-specialist']],
      ['google_places_nearby','Search local places by area and business category',['discovery-specialist']],
      ['crm_create_lead','Create a CRM lead from verified company/contact fields',['crm-specialist']],
      ['crm_search','Search CRM and verify created records',['crm-specialist']],
      ['intent_classify_and_delegate','Delegate a full assignment to an enabled reportee with isolated context',['coordinator','creative-director']],
      ['video_storyboard_export','Export a draft storyboard as an artifact',['creative-director']],
      ['story_write','Write a narrative from a supplied brief',['narrative-writer']],
    ];
    for(const [name,purpose,owners] of tools){
      db.prepare('INSERT INTO content_tools_meta (name,display_name,endpoint,purpose,enabled) VALUES (?,?,?,?,1)').run(name,name,'https://business-actions.invalid/'+name,purpose);
      for(const agent of owners)db.prepare('INSERT INTO agent_tool_grants (agent_id,tool_name) VALUES (?,?)').run(agent,name);
    }
    db.prepare('INSERT INTO connector_action_registry (action_id,risk_tier,action_family,description) VALUES (?,?,?,?)').run('gmail.create_draft','R1','write_internal','Save a draft in the connected Gmail account without sending');
    db.prepare('INSERT INTO agent_connector_action_grants (agent_id,action_id) VALUES (?,?)').run('mail-specialist','gmail.create_draft');
    if(inventory){
      const allowed=['agents','user_agents','agent_tool_grants','content_tools_meta','agent_connector_action_grants','connector_action_registry','platform_users','work_assignment_policies','agent_workflow_definitions'];
      for(const table of allowed){
        db.prepare(`DELETE FROM ${table}`).run();
        for(const original of inventory.tables[table]||[]){
          const row={...original};
          // Local placeholders satisfy schema constraints; no credentials or executable endpoints are imported.
          if(table==='content_tools_meta')row.endpoint='https://business-actions.invalid/'+row.name;
          if(table==='platform_users'){row.email=row.id+'@fixture.invalid';row.password_hash='disabled-local-fixture';}
          const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
          const keys=Object.keys(row).filter(k=>columns.has(k));
          db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));
        }
      }
      report.synthetic_tenant=false;
      report.inventory={owner,exported_at:inventory.exported_at,counts:Object.fromEntries(allowed.map(t=>[t,(inventory.tables[t]||[]).length]))};
      console.log(JSON.stringify({inventory:report.inventory}));
    }
    // Production enforces this grant for every enabled agent. Keep the safe
    // local fixture equivalent so live-LLM planner tests see the same invariant.
    db.prepare(`INSERT OR IGNORE INTO content_tools_meta (name,display_name,endpoint,purpose,enabled)
                VALUES ('agent_work_history','Agent Work History','https://business-actions.invalid/agent_work_history',
                        'Read owner- and agent-scoped work history as evidence for status reporting',1)`).run();
    for(const row of db.prepare('SELECT agent_id FROM user_agents WHERE user_id = ? AND enabled = 1').all(owner)){
      db.prepare(`INSERT OR IGNORE INTO agent_tool_grants (agent_id,tool_name) VALUES (?,'agent_work_history')`).run(row.agent_id);
    }
    const {routeAgentTurn}=await import('../src/services/agent-turn-router.js');
    const {qualityAssureGoalPlan}=await import('../src/services/goal-plan-quality.js');
    const {filterRelevantEvidence}=await import('../src/services/retrieval-relevance.js');
    const {validateStepOutcome}=await import('../src/services/step-outcome-validation.js');
    const {enrichStatusReportWithWorkHistory}=await import('../src/services/agent-goal-run.js');
    const {chatCompletions:platformChatCompletions}=await import('../src/config/llm.js');
    const launch='Create a concise launch concept for a 30-second Flolah explainer about humans and AI employees working together. Use ceo_profile for company context. Delegate creative ownership to Content Orchestrator, who must delegate narrative development to its Story Agent, use the returned narrative to create and export a draft storyboard using video_storyboard_export, and report to COO. COO must give the CEO the consolidated result with delegation trace and step outputs.';
    async function test(name,run){
      const at=Date.now();console.log('START '+name);
      try{const details=await run();report.cases.push({name,pass:true,elapsed_ms:Date.now()-at,details});console.log('PASS '+name);}
      catch(error){report.cases.push({name,pass:false,elapsed_ms:Date.now()-at,error:error.message,details:error.details});console.log('FAIL '+name+': '+error.message);}
    }
    if(['router','all'].includes(args.suite))for(const [name,id,prompt,mode,target] of [
      ['coo-inbox','coordinator','I want to organize my email inbox','delegate','mail-specialist'],
      ['specialist-review','mail-specialist','Summarize my past seven days of emails and identify those requiring a reply. Read only.','direct_tool',null],
      ['nested-launch-route','coordinator',launch,'goal_plan',null],
      ['dental-route','coordinator','Search and get dental clinics around Tampines Singapore. Add these as potential leads to CRM including their email and contact number. create an email draft for those leads in my GMAIL inbox.','goal_plan',null],
    ])await test(name,async()=>{
      const route=await routeAgentTurn({ownerUserId:owner,agent:db.prepare('SELECT * FROM agents WHERE id=?').get(agentId(id)),sessionId:name,message:prompt});
      assert.equal(route.execution_mode,mode);assert.equal(route.target_agent_id,target?agentId(target):null);assert.equal(route.resolved_request,prompt,'Original constraints must survive routing');
      return {mode:route.execution_mode,target:route.target_agent_id,confidence:route.confidence,attempts:route.decision_attempts};
    });
    if(['planner','all'].includes(args.suite))for(const [name,prompt,requiredAgents] of [
      ['discovery-crm-drafts','Find dental clinics in Tampines Singapore. Add them as CRM leads with verified email and phone. Save email drafts for those leads in my Gmail drafts. Do not send emails or fabricate missing details. Report the outcome to CEO.',['discovery-specialist','crm-specialist','mail-specialist']],
      ['gmail-cleanup','Clean up my Gmail inbox spam folders, summarize what will be removed, and report the completed cleanup.',['mail-specialist']],
      ['nested-launch-plan',launch,['creative-director']],
      ['agent-seven-day-status','Get me status update from "gmail operator" and "tech researcher" on what they worked last 7days.',['mail-specialist','research-specialist']],
      ['crm-workflow-erp-verification','Run a controlled TEST cross-system onboarding goal. Create one clearly labelled TEST CRM lead named "Flolah Goal Evidence Test Sep 5 2026" with email "no-reply+flolah-goal-test@example.com" through the existing published workflow "CRM: draft → CEO gate → check" (workflow id crm-mc-ceo-bala). Require the CRM maker/checker path to return the workflow run id plus the created CRM record id and read-back evidence. Then delegate ERP Checker to perform a read-only ERP verification and report whether any customer or invoice exists for that exact TEST name, with current-run tool evidence. Do not create, submit, post, pay, email, delete, or otherwise mutate anything in ERP. Finally consolidate the CRM workflow outcome and ERP verification, preserving prior-step outputs, and report the evidence-backed result to me in COO chat.',['erp-checker']],
    ].filter(([name])=>!args.case||args.case===name))await test(name,async()=>{
      const plan=await qualityAssureGoalPlan({ownerUserId:owner,orchestratorAgentId:agentId('coordinator'),prompt,candidateSteps:[],onProgress:event=>console.log(JSON.stringify({test:name,...event}))});
      try {
      assert.equal(plan.quality.llm_maker_checker_succeeded,true);
      assert.equal(plan.quality.maker_degraded_to_catalog,false,'A fallback is not a successful live planner test');
      assert.equal(plan.steps.at(-1)?.type,'notify_ceo','Final result must be delivered to CEO');
      for(const id of requiredAgents)assert(plan.steps.some(s=>s.type==='specialty_task'&&(s.spec.agent_id===agentId(id)||(inventory&&id==='crm-specialist'&&s.spec.agent_id==='crm-s2-ceobala'))),`Missing expected specialist ${agentId(id)}`);
      for(const step of plan.steps.filter(s=>s.type!=='notify_ceo')){
        assert(step.spec.objective,`${name}: ${step.key} missing semantic objective`);
        assert(step.spec.operation_mode,`${name}: ${step.key} missing operation_mode`);
        assert(step.spec.subject,`${name}: ${step.key} missing subject`);
        assert(step.spec.deliverable_kind,`${name}: ${step.key} missing deliverable_kind`);
      }
      if(name==='agent-seven-day-status'){
        const reports=plan.steps.filter(s=>s.type==='specialty_task');
        assert(reports.every(s=>['query','analyze'].includes(s.spec.operation_mode)),`Status request must not become a mutation: ${JSON.stringify(reports)}`);
        assert(reports.every(s=>s.spec.deliverable_kind==='status_report'),`Status request must use semantic deliverable_kind=status_report: ${JSON.stringify(reports)}`);
        assert(reports.every(s=>(s.produces||[]).every(output=>output.kind==='data')),`Status report transport must remain typed data: ${JSON.stringify(reports)}`);
        assert(reports.every(s=>!/clean up|move .*trash|delete/i.test(String(s.spec.message||''))),`Status request must not repeat historical operations: ${JSON.stringify(reports)}`);
      }
      if(name==='nested-launch-plan'){
        const profileIndex=plan.steps.findIndex(s=>s.type==='agent_tool'&&s.spec.tool_name==='ceo_profile');
        const creativeIndex=plan.steps.findIndex(s=>s.spec.agent_id===agentId('creative-director'));
        assert(profileIndex>=0&&profileIndex<creativeIndex,'CEO profile must actually be read by its entitled executor before creative work, not merely mentioned');
        assert(!plan.steps.some(s=>s.spec.agent_id===agentId('narrative-writer')),'Root must not bypass the Content Orchestrator to delegate directly to its grandchild');
        const work=plan.steps.filter(s=>s.spec.agent_id===agentId('creative-director')).map(s=>s.spec.message).join(' ');
        assert.match(work,/Story Agent|narrative-writer/i);assert.match(work,/delegat/i);assert.match(work,/export/i);
      }
      if(name==='crm-workflow-erp-verification'){
        const workflow=plan.steps.find(s=>s.type==='workflow_trigger');
        assert.equal(workflow?.spec?.workflow_id,'crm-mc-ceo-bala','Planner must select the requested published CRM workflow');
        assert.equal(workflow?.spec?.operation_mode,'coordinate','Workflow trigger uses the canonical orchestration operation');
        assert.match(String(workflow?.spec?.message||''),/Flolah Goal Evidence Test Sep 5 2026/);
        assert.match(String(workflow?.spec?.message||''),/no-reply\+flolah-goal-test@example\.com/);
        assert.match(JSON.stringify(plan.steps),/read[_ -]?back[_ -]?evidence/i,'Plan must preserve the explicitly requested CRM read-back evidence');
        const erp=plan.steps.find(s=>s.type==='specialty_task'&&s.spec.agent_id===agentId('erp-checker'));
        assert(erp,'ERP Checker read-only verification step is required');
        assert(['query','analyze'].includes(erp.spec.operation_mode),'ERP verification must remain read-only');
        assert.match(String(erp.spec.message||''),/Do not create|read-only|without mutat/i);
      }
      } catch(error) { error.details={plan}; throw error; }
      return plan;
    });
    if(['planner','all'].includes(args.suite)&&(!args.case||args.case==='status-outcome-validator'))await test('status-outcome-validator',async()=>{
      const history={
        evidence_id:'aev-live-validator-fixture',captured_at:new Date().toISOString(),owner_user_id:owner,
        agent_id:agentId('mail-specialist'),days:7,activity_count:2,
        counts:{total:2,completed:1,failed:1,in_progress:0,open:0,awaiting_confirmation:0,cancelled:0},
        evidence_source:'owner_scoped_kanban_and_delegation_ledger',
        items:[
          {task_id:9101,title:'Mailbox cleanup',status:'completed',outcome:'Removed old promotional mail after summary.'},
          {task_id:9102,title:'Mailbox review',status:'failed',outcome:'OAuth authorization expired.'},
        ],
      };
      const response=enrichStatusReportWithWorkHistory('No new action was taken while preparing this read-only report.',history);
      let validatorModel=null;
      const validation=await validateStepOutcome({
        originalGoal:'Report the Gmail operator work status for the last 7 days.',assignment:'Return the historical status only.',
        objective:'Report prior Gmail Operations work.',operationMode:'query',subject:'Gmail Operations work history',
        deliverableKind:'status_report',requiredInputs:[],requiredOutputs:[{key:'gmail_status',kind:'data',required:true}],
        response,executionEvidence:{work_history:history,substantive_tool_calls:[{tool_name:'agent_work_history',status:'ok',evidence_id:history.evidence_id}]},
      },async options=>{
        const result=await platformChatCompletions({...options,ownerUserId:owner,toolName:'goal_outcome_validation',responseFormat:'json_object',thinkingMode:'disabled',temperature:0});
        validatorModel=result.modelUsed||result.model||null;
        return result;
      });
      assert.equal(validation.satisfied,true,`Live validator rejected authoritative read-only history: ${JSON.stringify(validation)}`);
      return {validation,validator_model:validatorModel,evidence_id:history.evidence_id,activity_count:history.activity_count};
    });
    if(['rag','all'].includes(args.suite))await test('rag-entity-relevance',async()=>{
      const result=await filterRelevantEvidence(owner,'Find dental clinics in Tampines Singapore',[
        {document_id:'fictional-person',content:'Alex Sample is a software engineer living in Tampines, Singapore.'},
        {document_id:'fictional-clinic',content:'Example Dental Clinic operates in Tampines, Singapore. This is synthetic test data.'},
      ]);
      assert.deepEqual(result.chunks.map(c=>c.document_id),['fictional-clinic']);return result.relevance;
    });
    report.passed=report.cases.length>0&&report.cases.every(c=>c.pass);
    process.exitCode=report.passed?0:1;
  }
}catch(error){report.error=error.message;process.exitCode=1;}
finally {
  globalThis.fetch=nativeFetch;
  db?.close();rmSync(fixture,{recursive:true,force:true});
  report.fixture_cleaned=true;report.elapsed_ms=Date.now()-started;
  if(args.report){const path=resolve(args.report);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(report,null,2));}
  console.log(JSON.stringify({passed:report.passed??null,error:report.error,cases:report.cases.map(({name,pass,elapsed_ms})=>({name,pass,elapsed_ms})),llm_calls:report.llm_calls.length,fixture_cleaned:true,business_actions:0}));
}
