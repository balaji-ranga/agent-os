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
  'capture-request':{type:'string'},
  'max-calls':{type:'string',default:'18'},'timeout-seconds':{type:'string',default:'600'},
  report:{type:'string'},run:{type:'boolean',default:false},
}});
if(!args['env-file'])throw new Error('Pass --env-file pointing to your EXISTING local environment file. Do not put keys on the command line.');
if(!['primary','secondary'].includes(args.slot))throw new Error('slot must be primary or secondary');
if(!['router','planner','rag','all'].includes(args.suite))throw new Error('suite must be router, planner, rag or all');
const config=parseEnv(readFileSync(resolve(args['env-file'])));
const inventory=args['inventory-file']?JSON.parse(readFileSync(resolve(args['inventory-file']),'utf8').replace(/^\uFEFF/,'')):null;
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
    const actualIds={'coordinator':'balserve','mail-specialist':'gmail-operations','discovery-specialist':'businessdiscovery','crm-specialist':'crm-s1-ceobala','creative-director':'video-orch-ceobala','narrative-writer':'video-story-ceobala'};
    const agentId=id=>inventory?(actualIds[id]||id):id;
    const agents=[
      ['coordinator','COO','Coordinate company specialists and consolidate outcomes',null,1,1],
      ['mail-specialist','Gmail Operations','Manage Gmail inbox, review mail and save drafts','coordinator',0,0],
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
    const {routeAgentTurn}=await import('../src/services/agent-turn-router.js');
    const {qualityAssureGoalPlan}=await import('../src/services/goal-plan-quality.js');
    const {filterRelevantEvidence}=await import('../src/services/retrieval-relevance.js');
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
      ['nested-launch-plan',launch,['creative-director']],
    ])await test(name,async()=>{
      const plan=await qualityAssureGoalPlan({ownerUserId:owner,orchestratorAgentId:agentId('coordinator'),prompt,candidateSteps:[],onProgress:event=>console.log(JSON.stringify({test:name,...event}))});
      try {
      assert.equal(plan.quality.llm_maker_checker_succeeded,true);
      assert.equal(plan.quality.maker_degraded_to_catalog,false,'A fallback is not a successful live planner test');
      assert.equal(plan.steps.at(-1)?.type,'notify_ceo','Final result must be delivered to CEO');
      for(const id of requiredAgents)assert(plan.steps.some(s=>s.type==='specialty_task'&&(s.spec.agent_id===agentId(id)||(inventory&&id==='crm-specialist'&&s.spec.agent_id==='crm-s2-ceobala'))),`Missing expected specialist ${agentId(id)}`);
      if(name==='nested-launch-plan'){
        const profileIndex=plan.steps.findIndex(s=>s.type==='agent_tool'&&s.spec.tool_name==='ceo_profile');
        const creativeIndex=plan.steps.findIndex(s=>s.spec.agent_id===agentId('creative-director'));
        assert(profileIndex>=0&&profileIndex<creativeIndex,'CEO profile must actually be read by its entitled executor before creative work, not merely mentioned');
        assert(!plan.steps.some(s=>s.spec.agent_id===agentId('narrative-writer')),'Root must not bypass the Content Orchestrator to delegate directly to its grandchild');
        const work=plan.steps.filter(s=>s.spec.agent_id===agentId('creative-director')).map(s=>s.spec.message).join(' ');
        assert.match(work,/Story Agent|narrative-writer/i);assert.match(work,/delegat/i);assert.match(work,/export/i);
      }
      } catch(error) { error.details={plan}; throw error; }
      return plan;
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
