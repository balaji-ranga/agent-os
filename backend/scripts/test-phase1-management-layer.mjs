/**
 * Phase 1 management-layer gates: one test case each for T1 T2 T3 N1 N2 N3.
 * Uses a temp sqlite dir. No live CRM / LLM.
 *
 *   node scripts/test-phase1-management-layer.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), 'aos-phase1-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { initDb } = await import('../src/db/schema.js');
initDb();

const { parseOutcomeFromPrompt, observeStepResult, applyObservation, listMissionEvents } =
  await import('../src/services/goal-outcome.js');
const { createGoalRun, completeGoalStep, amendGoalRunConstraints, getGoalRun } = await import(
  '../src/services/agent-goal-run.js'
);
const { evaluateActionPolicy, upsertActionFamilyPolicies, inferRiskForTool } = await import(
  '../src/services/action-policy.js'
);
const { withWriteIdempotency } = await import('../src/services/tool-write-idempotency.js');
const { classifyToolFailure } = await import('../src/services/tool-failure-class.js');
const { resolveCapabilitiesFromPrompt, capabilityStepsForPlan } = await import(
  '../src/services/business-capabilities.js'
);
const { listIndustries, getBlueprint } = await import('../src/services/company-blueprints/registry.js');

const OWNER = 'ceo-phase1-test-owner';
const OTHER = 'ceo-phase1-other-owner';
const PIPELINE = `Over the next 5 business days, create 40 genuinely qualified prospects for our B2B service, add only verified prospects to CRM, prepare personalised outreach, and get at least 10 ready for my approval. Do not spend on ads. Never invent contact data. Do not send any external message without approval. Keep total AI/tool spend under $75 and notify me only for exceptions or final approvals.`;

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

// --- T1: outcome + observer + plan v2 ---
{
  const parsed = parseOutcomeFromPrompt(PIPELINE);
  assert(parsed.target === 40, `T1 parse target=40 got ${parsed.target}`);
  assert(parsed.budget_usd === 75, `T1 parse budget $75 got ${parsed.budget_usd}`);
  assert(parsed.kpi === 'verified_count', `T1 kpi verified_count got ${parsed.kpi}`);
  assert(
    parsed.constraints.some((c) => /never invent/i.test(c)),
    'T1 never-invent constraint'
  );

  const run = createGoalRun({
    ownerUserId: OWNER,
    agentId: 'balserve',
    title: 'Pipeline outcome',
    prompt: PIPELINE,
    source: 'test',
  });
  assert(run?.id && run.outcome?.target === 40, 'T1 goal persisted with KPI target');
  const stepId = run.steps[0]?.id;
  assert(!!stepId, 'T1 has a step');
  completeGoalStep({
    goalRunId: run.id,
    stepId,
    ownerUserId: OWNER,
    result: { verification_status: 'unknown', reason: 'missing contact' },
  });
  let g = getGoalRun(run.id, OWNER);
  assert(g.outcome.current_value === 0, `T1 unknown does not increment KPI (got ${g.outcome.current_value})`);
  assert(g.outcome.unknown_count >= 1, 'T1 unknown_count incremented');

  const next = g.steps.find((s) => s.status === 'pending');
  if (next) {
    completeGoalStep({
      goalRunId: run.id,
      stepId: next.id,
      ownerUserId: OWNER,
      result: { verification_status: 'verified', kpi_delta: 1 },
    });
    g = getGoalRun(run.id, OWNER);
    assert(g.outcome.current_value === 1, `T1 verified increments KPI (got ${g.outcome.current_value})`);
  }

  const amended = amendGoalRunConstraints(run.id, OWNER, {
    constraint: 'exclude healthcare from now on',
    rationale: 'CEO late policy change',
  });
  assert(amended.outcome.plan_version === 2, `T1 plan v2 got ${amended.outcome.plan_version}`);
  assert(
    (amended.plan_history || []).length >= 2,
    'T1 plan history has v1 snapshot plus current'
  );
  assert(
    amended.outcome.constraints.some((c) => /healthcare/i.test(c)),
    'T1 healthcare constraint recorded'
  );
  const other = getGoalRun(run.id, OTHER);
  assert(!other, 'T1 other owner cannot read goal');
}

// --- T2: policy gateway + idempotency + failure class ---
{
  assert(inferRiskForTool('email_send').risk_tier === 'R2', 'T2 email_send is R2');
  assert(inferRiskForTool('crm_delete_company').risk_tier === 'R3', 'T2 CRM delete is R3');
  assert(inferRiskForTool('business_discover').risk_tier === 'R0', 'T2 discover is R0');

  upsertActionFamilyPolicies(OWNER, [
    { family: 'communicate_external', mode: 'approval_required' },
    { family: 'financial_destructive', mode: 'prohibited' },
  ]);
  const blocked = evaluateActionPolicy({ ownerUserId: OWNER, toolName: 'email_send', body: {} });
  assert(blocked.ok === false && blocked.needs_approval, 'T2 email_send blocked without approval');
  const allowed = evaluateActionPolicy({
    ownerUserId: OWNER,
    toolName: 'email_send',
    body: { ceo_approved: true },
  });
  assert(allowed.ok === true, 'T2 email_send allowed with CEO approval');
  const del = evaluateActionPolicy({ ownerUserId: OWNER, toolName: 'crm_delete_company', body: { confirm: true } });
  assert(del.ok === false && del.mode === 'prohibited', 'T2 delete prohibited even with confirm');

  let executes = 0;
  const first = await withWriteIdempotency({
    ownerUserId: OWNER,
    toolName: 'crm_create_company',
    identity: { name: 'acme hotels', domain: 'acme.example' },
    execute: async () => {
      executes += 1;
      return { company: { id: 'co-1', name: 'Acme Hotels' } };
    },
  });
  const second = await withWriteIdempotency({
    ownerUserId: OWNER,
    toolName: 'crm_create_company',
    identity: { name: 'acme hotels', domain: 'acme.example' },
    execute: async () => {
      executes += 1;
      return { company: { id: 'co-2', name: 'DUP' } };
    },
  });
  assert(executes === 1, `T2 idempotent execute once (got ${executes})`);
  assert(second.idempotent_replay === true && second.company?.id === 'co-1', 'T2 replay same company id');
  assert(first.company?.id === 'co-1', 'T2 first write stored');

  const classified = classifyToolFailure({ message: 'Too Many Requests' }, { status: 429 });
  assert(classified.failure_class === 'rate_limit', 'T2 429 is rate_limit');
  assert(classified.retryable === true && classified.fallback_tool === 'browse_task_start', 'T2 fallback browser');
}

// --- T3: capability map from outcome language (no graph editor) ---
{
  const caps = resolveCapabilitiesFromPrompt(PIPELINE).map((c) => c.id);
  assert(caps.includes('find_lead'), `T3 find_lead in ${caps}`);
  assert(caps.includes('upsert_crm'), `T3 upsert_crm in ${caps}`);
  assert(caps.includes('draft_outreach'), `T3 draft_outreach in ${caps}`);
  const steps = capabilityStepsForPlan(PIPELINE);
  assert(
    steps.some((s) => s.type === 'workflow_trigger' && /crm maker checker/i.test(s.phrase || '')),
    'T3 CRM capability resolves to existing Maker/Checker phrase'
  );
  assert(
    steps.some((s) => s.tool_name === 'business_discover'),
    'T3 Find Lead resolves to business_discover'
  );
}

// --- N1: Revenue Company pack ---
{
  const industries = listIndustries();
  const card = (industries || []).find((i) => i.id === 'revenue_company');
  assert(!!card, 'N1 industries lists revenue_company');
  assert(card.featured === true, 'N1 revenue pack is featured wedge');
  const pack = getBlueprint('revenue_company');
  assert(pack?.id === 'revenue_company', 'N1 system blueprint loads');
  const names = (pack.agents || []).map((a) => a.name).join(',');
  assert(/Research/i.test(names) && /QA|Qualif/i.test(names), `N1 research + QA roles: ${names}`);
  assert(
    (pack.channels || []).some((c) => /Workflow Builder only to inspect/i.test(String(c))),
    'N1 pack tells CEO not to start in Workflow Builder'
  );
}

// --- N2: mission telemetry owner-scoped ---
{
  const mine = listMissionEvents(OWNER, { limit: 50 });
  assert(mine.some((e) => e.event_type === 'goal_created'), 'N2 goal_created event');
  assert(mine.some((e) => e.event_type === 're_plan'), 'N2 re_plan event');
  assert(mine.some((e) => e.event_type === 'policy_decision'), 'N2 policy_decision event');
  const theirs = listMissionEvents(OTHER, { limit: 50 });
  assert(theirs.length === 0, 'N2 other owner sees zero events');
}

// --- N3: outcome-first help (no Workflow Builder first) ---
{
  const repoRoot = join(__dirname, '../..');
  const getting = readFileSync(join(repoRoot, 'knowledgebase/platform-help/01-getting-started.md'), 'utf8');
  const chat = readFileSync(join(repoRoot, 'knowledgebase/platform-help/03-dashboard-agents-chat.md'), 'utf8');
  const policies = readFileSync(join(repoRoot, 'knowledgebase/platform-help/10-policies-guardrails.md'), 'utf8');
  const blob = `${getting}\n${chat}\n${policies}`;
  assert(/tell the COO the (business )?outcome first/i.test(blob) || /outcome first/i.test(blob), 'N3 help says outcome first');
  assert(!/open Workflow Builder first/i.test(blob), 'N3 does not tell CEOs to open Workflow Builder first');
}

if (failed) {
  console.error(`PHASE1_MANAGEMENT_LAYER_FAIL count=${failed}`);
  process.exit(1);
}
console.log('PHASE1_MANAGEMENT_LAYER_OK', { dataDir });
