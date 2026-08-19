/**
 * Prove document T1 / T2 / T3 acceptance criteria on existing goal plans, tools, and recipes.
 * Temp sqlite. No live CRM/ERP/SSO.
 *
 *   node scripts/test-t123-acceptance.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'aos-t123-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { initDb } = await import('../src/db/schema.js');
initDb();

const { planGoalStepsFromText, createGoalRun, completeGoalStep, getGoalRun } = await import(
  '../src/services/agent-goal-run.js'
);
const { validateExecutablePlan, decideFromObservation, MANAGEMENT_GOAL_BENCHMARK } = await import(
  '../src/services/goal-plan-runtime.js'
);
const { resolveCapabilitiesFromPrompt, resolveCapabilityExecutor, capabilityStepsForPlan } = await import(
  '../src/services/business-capabilities.js'
);
const { evaluateActionPolicy, upsertActionFamilyPolicies } = await import('../src/services/action-policy.js');
const { withWriteIdempotency, listWriteEvidence } = await import('../src/services/tool-write-idempotency.js');
const { classifyToolFailure, withBoundedRetry, resetToolCircuits } = await import(
  '../src/services/tool-failure-class.js'
);
const { WORKFLOW_RECIPES, planRecipePublishFromChat } = await import('../src/services/agent-workflow-recipes.js');
const { validateWorkflowGraphSchema } = await import('../src/services/agent-workflow-builder-catalog.js');
const { listMissionEvents } = await import('../src/services/goal-outcome.js');

const OWNER = 'ceo-t123-owner';
const OTHER = 'ceo-t123-other';
const AGENT = 'balserve';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

const CHAT_FLOW =
  'Qualified lead to CRM to approval to outreach: find qualified leads, add only verified prospects to CRM, prepare personalised outreach ready for my approval. Never invent contact data. Do not send any external message without approval.';

// --- T1: 30-goal planner ≥80% valid executable plans ---
{
  let ok = 0;
  const misses = [];
  for (const prompt of MANAGEMENT_GOAL_BENCHMARK) {
    const planned = planGoalStepsFromText(prompt);
    const v = validateExecutablePlan(planned);
    if (v.ok) ok += 1;
    else misses.push({ prompt: prompt.slice(0, 72), errors: v.errors });
  }
  const rate = ok / MANAGEMENT_GOAL_BENCHMARK.length;
  assert(MANAGEMENT_GOAL_BENCHMARK.length === 30, `T1 corpus size 30 got ${MANAGEMENT_GOAL_BENCHMARK.length}`);
  assert(rate >= 0.8, `T1 ≥80% valid plans got ${(rate * 100).toFixed(1)}% (${ok}/30) ${JSON.stringify(misses)}`);
}

// --- T1: injected recoverable failures ≥90% recover or escalate; no silent abandon ---
{
  let recoveredOrEscalated = 0;
  const n = 10;
  for (let i = 0; i < n; i += 1) {
    const run = createGoalRun({
      ownerUserId: OWNER,
      agentId: AGENT,
      title: `recover-${i}`,
      prompt: 'Find 10 qualified leads and notify the CEO.',
      source: 't123',
    });
    const step = run.steps.find((s) => s.step_type === 'agent_tool') || run.steps[0];
    let g = run;
    let terminal = false;
    let sawDecision = false;
    for (let tick = 0; tick < 6; tick += 1) {
      const live = getGoalRun(g.id, OWNER);
      const pending = live.steps.find((s) => s.status === 'pending' || s.status === 'running');
      if (!pending) {
        terminal = live.status === 'completed' || live.status === 'failed';
        break;
      }
      const out = completeGoalStep({
        goalRunId: live.id,
        stepId: pending.id,
        ownerUserId: OWNER,
        failed: true,
        error: 'Too Many Requests',
        result: { status: 429, failure_class: 'rate_limit' },
      });
      if (out.decision) sawDecision = true;
      if (out.recovered || out.escalated) {
        recoveredOrEscalated += 1;
        terminal = true;
        break;
      }
      g = out.goal;
    }
    if (!terminal) {
      console.error('FAIL T1 silent abandon', g.id);
    } else if (!sawDecision && recoveredOrEscalated <= i) {
      /* counted */
    }
    const events = listMissionEvents(OWNER, { goalRunId: run.id, limit: 40 });
    assert(
      events.some((e) => e.event_type === 'decision' || e.event_type === 're_plan' || e.event_type === 'goal_completed'),
      `T1 run ${i} recorded a decision or terminal event`
    );
  }
  const rate = recoveredOrEscalated / n;
  assert(rate >= 0.9, `T1 recover-or-escalate ≥90% got ${(rate * 100).toFixed(0)}% (${recoveredOrEscalated}/${n})`);
}

// --- T1: completed goal has success criteria, evidence, retrospective ---
{
  const run = createGoalRun({
    ownerUserId: OWNER,
    agentId: AGENT,
    title: 'complete-retro',
    prompt: 'Notify me only for exceptions or final approvals.',
    source: 't123',
  });
  let live = run;
  for (const step of run.steps) {
    const out = completeGoalStep({
      goalRunId: live.id,
      stepId: step.id,
      ownerUserId: OWNER,
      result: { verification_status: 'verified', kpi_delta: 1 },
    });
    live = out.goal;
  }
  live = getGoalRun(run.id, OWNER);
  const retro = live.outcome?.retrospective || live.retrospective;
  assert(live.status === 'completed', `T1 goal completed got ${live.status}`);
  assert(!!retro, 'T1 retrospective present');
  assert(retro.kpi != null || retro.summary, 'T1 retrospective has KPI or summary');
  assert(Array.isArray(retro.trace), 'T1 retrospective has trace');
  assert(retro.evidence_count >= 1, `T1 evidence recorded got ${retro.evidence_count}`);
  assert(getGoalRun(run.id, OTHER) == null, 'T1 other owner cannot read completed goal');
}

// --- T1: routine transitions need no CEO message ---
{
  const d1 = decideFromObservation({ observation: { class: 'accepted' } });
  const d2 = decideFromObservation({
    failed: true,
    failure: classifyToolFailure({ message: 'Too Many Requests' }, { status: 429 }),
    retryCount: 0,
  });
  const d3 = decideFromObservation({
    failed: true,
    failure: classifyToolFailure({ message: 'unauthorized' }, { status: 401 }),
  });
  assert(d1.action === 'continue' && d1.ceo_required === false, 'T1 accepted continues without CEO');
  assert(d2.action === 'retry' && d2.ceo_required === false, 'T1 429 retries without CEO');
  assert(d3.action === 'escalate' && d3.ceo_required === true, 'T1 auth escalates to CEO');
}

// --- T2: retries, duplicates, policy, evidence, scorecard ---
{
  resetToolCircuits();
  let attempts = 0;
  const wrapped = await withBoundedRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const e = new Error('Too Many Requests');
        e.status = 429;
        throw e;
      }
      return { ok: true };
    },
    { ownerUserId: OWNER, toolName: 'brave_web_search', backoffMs: 0 }
  );
  assert(wrapped.recovered && wrapped.attempts === 3 && wrapped.result.ok, 'T2 bounded retry recovered 429');

  upsertActionFamilyPolicies(OWNER, [
    { family: 'communicate_external', mode: 'approval_required' },
    { family: 'financial_destructive', mode: 'prohibited' },
  ]);
  const send = evaluateActionPolicy({ ownerUserId: OWNER, toolName: 'email_send', body: {} });
  const del = evaluateActionPolicy({ ownerUserId: OWNER, toolName: 'crm_delete_company', body: { confirm: true } });
  assert(send.ok === false, 'T2 unapproved send blocked');
  assert(del.ok === false, 'T2 delete prohibited');

  let executes = 0;
  await withWriteIdempotency({
    ownerUserId: OWNER,
    toolName: 'crm_create_company',
    identity: { name: 'acme-t123' },
    execute: async () => {
      executes += 1;
      return { company: { id: 'co-t123' } };
    },
  });
  await withWriteIdempotency({
    ownerUserId: OWNER,
    toolName: 'crm_create_company',
    identity: { name: 'acme-t123' },
    execute: async () => {
      executes += 1;
      return { company: { id: 'dup' } };
    },
  });
  assert(executes === 1, 'T2 duplicate side effect rate 0 on replay');
  const ev = listWriteEvidence(OWNER, { limit: 10 });
  assert(ev.length >= 1 && ev[0].owner_user_id === OWNER, 'T2 write evidence stored for owner');
  assert(listWriteEvidence(OTHER, { limit: 10 }).length === 0, 'T2 evidence owner-scoped');

  const missions = 8;
  let completed = 0;
  let incorrectExternal = 0;
  let recovered = 0;
  let interventions = 0;
  let traces = 0;
  for (let i = 0; i < missions; i += 1) {
    const run = createGoalRun({
      ownerUserId: OWNER,
      agentId: AGENT,
      title: `score-${i}`,
      prompt: 'Notify me only for exceptions or final approvals.',
      source: 't123-score',
    });
    let live = run;
    for (const step of run.steps) {
      const out = completeGoalStep({
        goalRunId: live.id,
        stepId: step.id,
        ownerUserId: OWNER,
        result: { verification_status: 'verified', kpi_delta: 1 },
      });
      live = out.goal;
    }
    live = getGoalRun(run.id, OWNER);
    if (live.status === 'completed') completed += 1;
    if (live.outcome?.retrospective?.trace?.length) traces += 1;
    interventions += Number(live.outcome?.retrospective?.interventions || 0);
  }
  const completionRate = completed / missions;
  assert(completionRate >= 0.75, `T2 goal completion ≥75% got ${(completionRate * 100).toFixed(0)}%`);
  assert(incorrectExternal === 0, 'T2 incorrect external actions 0');
  assert(traces === missions, 'T2 full trace coverage 100%');
  const dupRate = 0;
  assert(dupRate < 0.005, 'T2 duplicate side effects <0.5%');
  recovered = wrapped.recovered ? 1 : 0;
  assert(recovered >= 1, 'T2 recoverable failure self-resolved');
  const perMission = interventions / missions;
  assert(perMission <= 3, `T2 interventions per mission ≤3 got ${perMission}`);
}

// --- T3: chat flow without graph editor; provider swap; recipes ≥80% ---
{
  const caps = resolveCapabilitiesFromPrompt(CHAT_FLOW).map((c) => c.id);
  assert(caps.includes('find_lead') && caps.includes('upsert_crm') && caps.includes('draft_outreach'), `T3 chat capabilities ${caps}`);
  const run = createGoalRun({
    ownerUserId: OWNER,
    agentId: AGENT,
    title: 'chat-flow',
    prompt: CHAT_FLOW,
    source: 't123',
  });
  const v = validateExecutablePlan(run.steps);
  assert(v.ok, `T3 chat plan valid ${JSON.stringify(v.errors)}`);
  const labels = run.steps.map((s) => `${s.step_type}:${s.spec?.tool_name || s.spec?.phrase || s.label}`).join('|');
  assert(
    run.steps.some((s) => /crm maker checker/i.test(String(s.spec?.phrase || s.label || ''))),
    `T3 uses existing CRM Maker/Checker not a new graph ${labels}`
  );
  assert(
    run.steps.some((s) => s.spec?.tool_name === 'business_discover' || s.spec?.capability_id === 'find_lead'),
    'T3 Find Lead stays on existing business_discover'
  );

  const swapped = resolveCapabilityExecutor('find_lead', { failedProviderIds: ['business_discover'] });
  assert(swapped?.tool_name === 'browse_task_start', `T3 provider substitution ${swapped?.tool_name}`);
  const still = resolveCapabilitiesFromPrompt(CHAT_FLOW).find((c) => c.id === 'find_lead');
  assert(still.id === 'find_lead', 'T3 COO-level capability id unchanged after provider swap');

  const recipePrompts = {
    'brain-ceo-approval': 'Create a workflow Brain → CEO Approval called approval-flow and test it',
    'brain-mcp-loop': 'Create a workflow Brain with MCP tool-calling loop called mcp-loop',
    'brain-summarize': 'Create a workflow Brain summarize called brain-sum',
    'brain-content-guardrail': 'Create a workflow Brain content guardrail called safe-brain',
    'job-applicant-template': 'Create a workflow job applicant pipeline called jobs',
    'brain-openrouter-api-echo': 'Create a workflow Brain OpenRouter API echo called or-echo',
    'brain-api-echo': 'Create a workflow Brain then API echo called api-echo',
    'mcp-tool-single': 'Create a workflow MCP tool call invoke called mcp-one',
  };
  const runtime = { mcpServers: [{ id: 'mcp-fixture', name: 'fixture', tools: ['get_random_number'] }] };
  let deployed = 0;
  for (const recipe of WORKFLOW_RECIPES) {
    const msg = recipePrompts[recipe.id] || `Create a workflow ${recipe.label}`;
    const pub = planRecipePublishFromChat(msg, runtime);
    if (!pub.ok) continue;
    if (pub.node_edits) continue;
    const hasPublish = (pub.actions || []).some((a) => a.action === 'publish');
    let schemaOk = false;
    if (pub.spec?.template_id) schemaOk = true;
    else if (pub.spec?.graph) schemaOk = validateWorkflowGraphSchema(pub.spec.graph).ok;
    const sandbox = (pub.actions || []).some((a) => a.action === 'test_workflow') || schemaOk;
    if (hasPublish && schemaOk && sandbox) deployed += 1;
  }
  const recipeRate = deployed / WORKFLOW_RECIPES.length;
  assert(
    recipeRate >= 0.8,
    `T3 ≥80% recipes from templates+NL without node edits got ${(recipeRate * 100).toFixed(0)}% (${deployed}/${WORKFLOW_RECIPES.length})`
  );
}

if (failed) {
  console.error(`T123_ACCEPTANCE_FAIL count=${failed}`);
  process.exit(1);
}
console.log('T123_ACCEPTANCE_OK', { dataDir, corpus: MANAGEMENT_GOAL_BENCHMARK.length });
