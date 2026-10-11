import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// No .env, production DB, external services, or broker connections are used.
const dir = mkdtempSync(join(tmpdir(), 'flolah-tenant-boundary-'));
process.env.AGENT_OS_DATA_DIR = dir;
process.env.OPENCLAW_DIR = join(dir, 'openclaw');
process.env.OPENCLAW_TOOLS_LIST_PATH = join(dir, 'tools.json');
process.env.OPENCLAW_TOOL_CREDENTIALS_PATH = join(dir, 'credentials.json');
process.env.AGENT_OS_INTERNAL_TOKEN = 'tenant-boundary-fixture-internal-token';
process.env.OPENCONNECTOR_URL = 'https://connector.invalid';
process.env.IBKR_QUANT_BACKEND = 'baseline';
process.env.IBKR_QUANT_ENDPOINT_URL = '';
const baseline = process.argv.includes('--baseline');
let baselineScopeUrl;
async function moduleFor(path) {
  if (!baseline || !['../src/routes/job-applicant-tools.js', '../src/routes/tools.js', '../src/routes/ibkr-trading.js', '../src/services/tool-owner-scope.js'].includes(path)) return import(path);
  const url = new URL(path, import.meta.url);
  const relative = 'backend/' + path.replace('../', '');
  const source = execFileSync('git', ['show', `094eba2f:${relative}`], { encoding: 'utf8' });
  const resolved = source.replace(/(from\s+|import\s*\()(['"])([^'"]+)\2/g, (_m, prefix, quote, specifier) => `${prefix}${quote}${specifier.endsWith('/tool-owner-scope.js') && baselineScopeUrl ? baselineScopeUrl : specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)}${quote}`);
  const moduleUrl='data:text/javascript;base64,' + Buffer.from(resolved).toString('base64');
  if(path.endsWith('/tool-owner-scope.js')) baselineScopeUrl=moduleUrl;
  return import(moduleUrl);
}
const originalFetch = globalThis.fetch;
let db, server;
let checks = 0;
const check = (actual, expected, name) => { assert.deepEqual(actual, expected, name); checks++; };
try {
  const { initDb } = await import('../src/db/schema.js'); db = initDb();
  // Production has completed the legacy job-table column migration on startup.
  for (const [column,type] of [['ceo_user_id','TEXT'],['profile_id','TEXT']]) {
    if(!db.prepare('PRAGMA table_info(job_applications)').all().some(c=>c.name===column)) db.exec(`ALTER TABLE job_applications ADD COLUMN ${column} ${type}`);
  }
  const owners = ['test-ceo-a', 'test-ceo-b', 'ceo-bala'];
  for (const owner of owners) db.prepare("INSERT OR IGNORE INTO platform_users(id,email,password_hash,name,role,enabled) VALUES (?,?,'fixture',?,'ceo',1)").run(owner, `${owner}@example.test`, owner);
  db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled,owner_user_id) VALUES ('test-employee','employee@example.test','fixture','Employee','org_user',1,?)").run(owners[0]);
  db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES ('test-admin','admin@example.test','fixture','Admin','admin',1)").run();
  const { createSession } = await import('../src/services/auth/session.js');
  const tokens = Object.fromEntries([...owners, 'test-employee', 'test-admin'].map(owner => [owner, createSession(owner).token]));
  db.prepare("INSERT INTO agents(id,name,openclaw_agent_id,is_coo) VALUES ('balserve','Fixture COO','balserve',1)").run();
  for(const owner of owners.slice(0,2)) db.prepare("INSERT INTO user_agents(user_id,agent_id,enabled) VALUES (?,'balserve',1)").run(owner);
  const { createJobSearchProfileService } = await import('../src/services/job-search-profile.js');
  const profiles = createJobSearchProfileService(() => db);
  for (const owner of owners.slice(0, 2)) profiles.createProfile(owner, { profile_id: 'scope-profile', display_name: owner });
  db.prepare("UPDATE job_search_profiles SET status='active' WHERE id='scope-profile'").run();
  db.prepare("INSERT INTO job_applications(job_id,ceo_user_id,profile_id,status,company,title,url) VALUES ('job-b',?,'scope-profile','discovered','Private B','Private role','https://example.test/job-b')").run(owners[1]);
  db.prepare("INSERT INTO job_applications(job_id,ceo_user_id,profile_id,status,company,title,url) VALUES ('job-a',?,'scope-profile','discovered','Company A','Own role','https://example.test/job-a')").run(owners[0]);
  const scope = await moduleFor('../src/services/tool-owner-scope.js');
  // Equivalent representations must not turn an unauthenticated request into an owner.
  for (const headers of [ {'x-ceo-user-id':owners[1]}, {'x-agent-os-user-id':owners[1]}, {'x-openclaw-agent-id':'t-test-ceo-b--balserve'}, {'x-session-key':'agent:t-test-ceo-b--balserve:main'}, {'x-openclaw-session-user':'agent-os-user-balserve-test-ceo-b'} ]) {
    if (!baseline) assert.throws(() => scope.resolveToolOwnerUserId({ headers }, { ceo_user_id:owners[1], message:`[owner_user_id=${owners[1]}]` }), /Authenticated owner/);
    checks++;
  }
  if (!baseline) {
    assert.throws(() => scope.resolveToolOwnerUserId({ authUser:{id:'ceo-bala',role:'ceo',internal:true},headers:{'x-ceo-user-id':owners[1]} }), /Authenticated owner/);
    check(scope.resolveToolOwnerUserId({isInternalService:true,authUser:{id:'ceo-bala',role:'ceo',internal:true},headers:{'x-ceo-user-id':owners[1]} }), owners[1], 'verified internal hop uses explicit owner, not placeholder');
    assert.throws(() => scope.resolveToolOwnerUserId({isInternalService:true,headers:{'x-ceo-user-id':owners[0],'x-agent-os-user-id':owners[1]}}), /Conflicting/);
    check(scope.resolveEntitledOwnerUserId({headers:{'x-ceo-user-id':owners[1]}}), null, 'no default tenant fallback');
    const { injectInternalServiceAuth } = await import('../src/services/agent-workflow-api-auth.js');
    process.env.AGENT_OS_INTERNAL_URL = 'http://127.0.0.1:3999';
    const forwarded = injectInternalServiceAuth({'X-Ceo-User-Id':owners[1],'X-Agent-Os-User-Id':owners[1]}, 'http://127.0.0.1:3999/api/tools/job-search-profile-list', owners[0]);
    check(forwarded['x-ceo-user-id'], owners[0], 'workflow stored owner overrides mixed-case node headers');
    check(Object.keys(forwarded).filter(k=>k.toLowerCase()==='x-ceo-user-id').length, 1, 'no duplicate header encoding');
  }
  const { default:express } = await import('express');
  const { attachAuthUser } = await import('../src/middleware/auth.js');
  const { default:tools } = await moduleFor('../src/routes/tools.js');
  const { default:ibkr } = await moduleFor('../src/routes/ibkr-trading.js');
  const { default:jobTools } = await moduleFor('../src/routes/job-applicant-tools.js');
  const { requireToolsAccess } = await import('../src/middleware/tools-auth.js');
  const app=express(); app.use(express.json()); app.use(attachAuthUser);
  app.use('/probe/jobs',requireToolsAccess,jobTools);
  app.use('/api/tools',tools); app.use('/api/ibkr-trading',ibkr);
  server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`; process.env.TOOLS_BASE_URL=base;
  const auth=owner=>({Authorization:`Bearer ${tokens[owner]}`});
  const internal=owner=>({'x-agent-os-internal':process.env.AGENT_OS_INTERNAL_TOKEN,'x-ceo-user-id':owner});
  async function request(path, headers={}, body, method=body===undefined?'GET':'POST') {
    const response=await originalFetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json()};
  }
  // Keep baseline probes informative even when all four are vulnerable.
  if (baseline) {
    const job=await request('/probe/jobs/job-search-profile-list',auth(owners[0]),{ceo_user_id:owners[1]});
    check(job.data.ceo_user_id, owners[1], 'baseline: body overrides CEO session');
    const advisory=await request('/api/ibkr-trading/quant-signal/runs',{'x-ceo-user-id':owners[1]});
    check(advisory.status, 200, 'baseline: anonymous advisory history');
    console.log('BASELINE_REPRODUCED: authenticated job owner override and unauthenticated advisory history');
  } else {
    for (const alias of ['ceo_user_id','ceoUserId','owner_user_id','ownerUserId','user_id','userId']) {
      const out=await request('/probe/jobs/job-search-profile-list',{...auth(owners[0]),'x-ceo-user-id':owners[1],'x-agent-os-user-id':owners[1],'x-user-id':owners[1]}, {[alias]:owners[1]});
      check(out.status,200,`job list legitimate access (${alias})`); check(out.data.ceo_user_id,owners[0],`job body/header alias ignored (${alias})`);
      assert.ok(out.data.profiles.every(p=>p.display_name===owners[0]));
    }
    for (const [headers, expected] of [[auth('test-employee'), owners[0]], [{...auth('test-admin'),'x-impersonate-ceo':owners[1]},owners[1]], [internal(owners[1]),owners[1]]]) {
      const out=await request('/probe/jobs/job-search-profile-list',headers,{}); check(out.status,200,'legitimate employee/admin/internal job call'); check(out.data.ceo_user_id,expected,'legitimate tenant');
    }
    check((await request('/probe/jobs/job-search-profile-list',auth('test-admin'),{ceoUserId:owners[1]})).data.ceo_user_id,owners[1],'admin explicit body target');
    check((await request('/probe/jobs/job-search-profile-list',auth('test-admin'),{})).status,403,'admin missing target fails closed');
    const created=await request('/probe/jobs/job-search-profile-create',auth(owners[0]),{ceo_user_id:owners[1],profile_id:'created-a',display_name:'Own new profile'});
    check(created.status,200,'own profile create remains supported');
    check(db.prepare("SELECT ceo_user_id FROM job_search_profiles WHERE id='created-a'").get().ceo_user_id,owners[0],'create cannot write another tenant');
    const {createJobApplicationsService}=await import('../src/services/job-applications.js'); const jobs=createJobApplicationsService(()=>db,owners[0]);
    check(jobs.get('job-b'),null,'shared DB foreign ID invisible'); assert.throws(()=>jobs.update('job-b',{title:'changed'}),/not found/);
    check(jobs.get('job-a').company,'Company A','own ID visible'); check(jobs.update('job-a',{title:'updated own role'}).title,'updated own role','own ID writable');
    check(jobs.checkJobSeen(owners[0],'scope-profile',{job_id:'job-b'}).seen,false,'inventory ID cannot leak foreign job');
    for(const [path,body] of [['/jobs-update',{job_id:'job-b',patch:{title:'changed'}}],['/job-fit-score',{job_id:'job-b'}],['/job-tailor-resume',{job_id:'job-b'}]]) {
      const out=await request('/probe/jobs'+path,auth(owners[0]),{profile_id:'scope-profile',...body}); assert.ok(out.status>=400,`${path} rejects foreign job`); checks++;
    }
    check(db.prepare("SELECT title FROM job_applications WHERE job_id='job-b'").get().title,'Private role','victim job unchanged');
    const {getJobWorkflowTracker}=await import('../src/services/job-workflow-tracker.js');
    const tracker=getJobWorkflowTracker(()=>db);
    const foreignRun=tracker.startRun({ceoUserId:owners[1],profileId:'scope-profile'});
    check(tracker.getRun(foreignRun.workflow_id,owners[0],'scope-profile'),null,'foreign workflow ID invisible');
    const review=await import('../src/services/job-applicant-ceo-review.js');
    const workflow=await import('../src/services/job-applicant-workflow-run.js');
    await assert.rejects(review.confirmCeoReview(owners[0],'scope-profile',true,{workflow_run_id:foreignRun.workflow_id}),/Workflow not found/);
    await assert.rejects(review.runPhase1SubmitCeoReview({ceoUserId:owners[0],profileId:'scope-profile',workflowRunId:foreignRun.workflow_id,tailorShortlisted:false}),/Workflow not found/);
    await assert.rejects(workflow.runJobSearchWorkflowNow(owners[0],'scope-profile',{workflow_run_id:foreignRun.workflow_id,scoreDiscovered:false}),/Workflow not found/);
    const victimTask=review.createConsolidatedCeoReviewKanban(owners[1],'scope-profile',[],profiles.getProfile(owners[1],'scope-profile'),{});
    check(review.findExistingCeoReviewKanban('scope-profile',owners[0]),undefined,'foreign same-profile Kanban invisible');
    const ownTask=review.createConsolidatedCeoReviewKanban(owners[0],'scope-profile',[],profiles.getProfile(owners[0],'scope-profile'),{});
    assert.notEqual(ownTask.kanban_task_id,victimTask.kanban_task_id); checks++;
    check(db.prepare('SELECT owner_user_id FROM kanban_tasks WHERE id=?').get(victimTask.kanban_task_id).owner_user_id,owners[1],'victim Kanban unchanged');
    for(const [path,body] of [['/quant-signal',{features:{}}],['/quant-signal/runs',undefined],['/strategy-bundles/draft',{}],['/strategy-bundles/validate',{}],['/strategy-bundles/replay',{}],['/strategy-bundles',undefined]]) {
      check((await request('/api/ibkr-trading'+path,{'x-ceo-user-id':owners[1]},body)).status,401,`anonymous advisory rejected: ${path}`);
    }
    const quant=await request('/api/ibkr-trading/quant-signal',{...auth(owners[0]),'x-ceo-user-id':owners[1]},{task:'regime_classification',features:{momentum_pct:1}}); check(quant.status,200,'authorized quant inference');
    check(db.prepare('SELECT owner_user_id FROM ibkr_quant_inference_runs ORDER BY id DESC LIMIT 1').get().owner_user_id,owners[0],'quant evidence owner is session');
    check((await request('/api/ibkr-trading/strategy-bundles/replay',auth(owners[0]),{series:[100,101,102]})).status,200,'authorized replay');
    const draft=await request('/api/ibkr-trading/strategy-bundles/draft',auth(owners[0]),{name:'fixture',bundle:{goal:{},strategy:{},strategy_skill:{},policy:{environment:'paper'},universe:{},market_data:{allow_delayed_for_execution:false}}}); check(draft.status,200,'authorized draft');
    check((await request('/api/ibkr-trading/strategy-bundles/validate',auth(owners[0]),{bundle_id:draft.data.id})).status,200,'own bundle validation');
    check((await request('/api/ibkr-trading/strategy-bundles/validate',auth(owners[1]),{bundle_id:draft.data.id})).status,404,'foreign bundle inaccessible');
    const webhook=await request('/api/ibkr-trading/local-bridge-webhook',{},{}); assert.ok([403,404].includes(webhook.status),'bridge still reaches its own secret verifier'); checks++;
    for(const path of ['local-bridge-webhook/','LOCAL-BRIDGE-WEBHOOK']) check((await request('/api/ibkr-trading/'+path,{},{})).status,webhook.status,'bridge route variants preserve secret verifier');
  }
  const { upsertOpenConnectorLink }=await import('../src/services/openconnector.js');
  for(const owner of owners) upsertOpenConnectorLink(owner,{runtime_token:`fixture-${owner}`,connection_name:`alias-${owner}`});
  const gatewayCalls=[];
  globalThis.fetch=async (url,options={})=>{
    if(String(url).startsWith(base)) return originalFetch(url,options);
    assert.ok(String(url).startsWith('https://connector.invalid'),`unexpected external request blocked: ${new URL(url).hostname}`);
    gatewayCalls.push(options.headers);
    return Response.json({success:true,data:{messages:[]}});
  };
  const connector=await request('/api/tools/connector-execute-action',internal(owners[1]),{action_id:'gmail.fetch_emails',input:{maxResults:1,detail:'ids'}});
  check(connector.status,200,'internal connector execution remains supported');
  check(gatewayCalls.at(-1)['x-oo-connector-alias'],baseline?'alias-ceo-bala':`alias-${owners[1]}`,'connector uses verified tenant, not default CEO');
  if(!baseline) {
    const human=await request('/api/tools/connector-execute-action',{...auth(owners[0]),'x-ceo-user-id':owners[1]},{ceoUserId:owners[1],action_id:'gmail.fetch_emails',input:{maxResults:1,detail:'ids'}});
    check(human.status,200,'human connector access'); check(gatewayCalls.at(-1)['x-oo-connector-alias'],`alias-${owners[0]}`,'human connector ignores spoofed owner');
    for(const alias of ['connection_name','connectionName']) {
      const before=gatewayCalls.length;
      check((await request('/api/tools/connector-execute-action',auth(owners[0]),{[alias]:`alias-${owners[1]}`,action_id:'gmail.fetch_emails',input:{maxResults:1}})).status,403,'foreign connector alias rejected');
      check(gatewayCalls.length,before,'foreign alias never reaches gateway');
    }
    check((await request('/api/tools/connector-execute-action',auth(owners[0]),{connection_name:`alias-${owners[0]}`,action_id:'gmail.fetch_emails',input:{maxResults:1,detail:'ids'}})).status,200,'own explicit connector alias works');
    const {reviewGmailMailbox}=await import('../src/services/gmail-mailbox-operations.js');
    const plan=await reviewGmailMailbox(owners[1],{}, {executeConnectorAction:async()=>({data:{messages:[]}}),chatCompletions:async()=>({choices:[{message:{content:'Fixture review'}}]})});
    check((await request('/api/tools/gmail-mailbox-cleanup-status',internal(owners[1]),{plan_id:plan.plan_id})).status,200,'internal Gmail plan uses tenant B, not placeholder');
    check((await request('/api/tools/gmail-mailbox-cleanup-status',internal(owners[0]),{plan_id:plan.plan_id})).status,404,'foreign Gmail plan inaccessible');
  }
  const {seedIbkrTradingToolsIfMissing}=await import('../src/db/seed-ibkr-trading-tools.js'); seedIbkrTradingToolsIfMissing();
  db.prepare("INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES ('balserve','ibkrnew_paper_strategy_status')").run();
  const {ensureIbkrNewDefaults}=await import('../src/services/ibkrnew-event-trader.js');
  for(const owner of owners.slice(0,2)) {
    ensureIbkrNewDefaults(owner);
    db.prepare('DELETE FROM ibkrnew_goal_cycles WHERE owner_user_id=?').run(owner);
    db.prepare('DELETE FROM ibkrnew_goals WHERE owner_user_id=?').run(owner);
    const now=new Date().toISOString();
    db.prepare('INSERT INTO ibkrnew_goals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(`goal-${owner}`,owner,'paper',owner,'PERPETUAL',5,30,'CALENDAR_DAYS','CYCLE_START_ELIGIBLE_CAPITAL_CAPPED_BY_TOTAL_BUDGET','NET_REALIZED_AFTER_COMMISSIONS','ACTIVE',now,now);
  }
  const dispatch=await request('/api/tools/invoke',{...auth(owners[0]),'x-ceo-user-id':owners[1],'x-agent-os-user-id':owners[1]},{tool_name:'ibkrnew_paper_strategy_status'});
  check(dispatch.status,200,'Paper evidence dispatch remains read-only and available');
  check(dispatch.data.goal.goal_id,`goal-${baseline?owners[1]:owners[0]}`,'dispatcher never promotes caller-selected owner');
  if(!baseline) {
    const {issueToolCredentialLease}=await import('../src/services/tool-scoped-token.js');
    const agent='t-test-ceo-a--balserve', session=`agent:${agent}:main`;
    const lease=issueToolCredentialLease({ownerUserId:owners[0],agentId:agent,sessionKey:session,toolName:'ibkrnew_paper_strategy_status'});
    const scoped={Authorization:`Bearer ${lease.token}`,'x-openclaw-agent-id':agent,'x-openclaw-session-key':session};
    check((await request('/api/tools/invoke',{...scoped,'x-ceo-user-id':owners[0],'x-agent-os-user-id':owners[1]},{tool_name:'ibkrnew_paper_strategy_status'})).status,401,'lease rejects conflicting secondary owner alias');
    const own=await request('/api/tools/invoke',scoped,{tool_name:'ibkrnew_paper_strategy_status'});
    check(own.status,200,`valid scoped lease: ${JSON.stringify(own.data)}`); check(own.data.goal.goal_id,`goal-${owners[0]}`,'scoped lease preserves tenant');
    check((await request('/api/tools/test/ibkrnew_paper_strategy_status',{...auth(owners[0]),'x-ceo-user-id':owners[1]},{})).data.goal.goal_id,`goal-${owners[0]}`,'test endpoint also canonicalizes identity');
  }
  if (baseline) console.log('BASELINE_REPRODUCED: default-CEO connector selection and spoofed owner on privileged IBKR dispatch');
  else console.log(`TENANT_BOUNDARIES_OK: ${checks} checks; job aliases/shared DB, verified connector tenant, canonical dispatch, advisory auth and legitimate controls`);
} finally {
  globalThis.fetch=originalFetch;
  if(server) await new Promise(r=>server.close(r));
  db?.close();
  rmSync(dir,{recursive:true,force:true});
}
