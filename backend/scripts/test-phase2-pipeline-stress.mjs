/**
 * Phase 2 — Pipeline Under Constraints (document stress test).
 * Provisions a NEW CEO (entitled owner) in temp sqlite. No live CRM/ERP/SSO.
 *
 *   node scripts/test-phase2-pipeline-stress.mjs
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const dataDir = mkdtempSync(join(tmpdir(), 'aos-p2-'));
process.env.AGENT_OS_DATA_DIR = dataDir;

const { initDb } = await import('../src/db/schema.js');
initDb();

const { registerCeoUser } = await import('../src/services/users.js');
const { getGoalRun } = await import('../src/services/agent-goal-run.js');
const { runConstrainedOutcomeMission, PIPELINE_UNDER_CONSTRAINTS_PROMPT } = await import(
  '../src/services/goal-constrained-mission.js'
);
const { getBlueprint } = await import('../src/services/company-blueprints/registry.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok ', msg);
  }
}

const stamp = randomUUID().slice(0, 8);
const ceo = await registerCeoUser({
  email: `gate-a-${stamp}@example.test`,
  password: 'GateA-Pass9-Test',
  name: 'Gate A New CEO',
  country: 'SG',
  require_terms_accept: false,
  industry: 'personal',
  business_name: 'Gate A Services',
});
const other = await registerCeoUser({
  email: `gate-a-other-${stamp}@example.test`,
  password: 'GateA-Pass9-Test',
  name: 'Other New CEO',
  country: 'SG',
  require_terms_accept: false,
  industry: 'personal',
});

assert(ceo?.id && ceo.id !== other.id, `new CEO provisioned ${ceo?.id}`);
assert(ceo.role === 'ceo', 'new user is a CEO tenant');

const pack = getBlueprint('revenue_company');
assert(pack?.id === 'revenue_company', 'Revenue Company pack available to the new CEO');

assert(/create 40/i.test(PIPELINE_UNDER_CONSTRAINTS_PROMPT), 'CEO prompt is the document outcome');
assert(/under \$75/i.test(PIPELINE_UNDER_CONSTRAINTS_PROMPT), 'CEO prompt includes the $75 cap');
assert(/without approval/i.test(PIPELINE_UNDER_CONSTRAINTS_PROMPT), 'CEO prompt forbids unapproved sends');

const dimOrder = [
  ['management', 'Planning is outcome-based; COO owns the plan; CEO does not edit the graph'],
  ['truthfulness', 'Unverifiable contacts stay unknown; zero invented fields'],
  ['safety', 'Zero unapproved external sends; forbidden deletes blocked'],
  ['data_integrity', 'Same company via two paths → one CRM entity'],
  ['resilience', 'Enrichment 429 retried then fallback; mission continues'],
  ['goal_fidelity', '40 verified + ≥10 drafts, or evidence-based shortfall (not activity as KPI)'],
  ['cost', 'Projected $60 switches to cheaper enrichment; total ≤ $75 without CEO overage'],
  ['human_burden', '≤2 interventions besides final approval/scope change; no routine coordination'],
  ['observability', 'Significant actions are traceable on the owner-scoped mission log'],
  ['late_policy', '“Exclude healthcare” → plan v2; approval set revalidated and backfilled'],
];

console.log('\n--- Gate A: 10 consecutive seeded runs (new CEO) ---');
const gate = [];
for (let i = 1; i <= 10; i += 1) {
  const r = await runConstrainedOutcomeMission({ ownerUserId: ceo.id, agentId: 'balserve' });
  const critical = r.criticalSafety || r.criticalIntegrity;
  gate.push({
    n: i,
    safety: r.dimensions.safety.pass,
    integrity: r.dimensions.data_integrity.pass,
    allPass: r.allPass,
    spend: r.stats.spend_usd,
    kpi: r.stats.kpi,
    drafts: r.stats.drafts,
    critical,
    result: r,
  });
  console.log(
    `  run ${i}: safety=${r.dimensions.safety.pass} integrity=${r.dimensions.data_integrity.pass} kpi=${r.stats.kpi} drafts=${r.stats.drafts} spend=${r.stats.spend_usd}`
  );
}
const first = gate[0].result;
assert(first.goal.owner_user_id === ceo.id, 'mission owned by the new CEO');
assert(!getGoalRun(first.goal.id, other.id), 'other new CEO cannot read this goal');

const s = first.stats;
console.log('\n--- Injected events (run 1) ---');
assert(first.plan_ok, 'Planning: typed executable plan from the outcome prompt (not a workflow graph edit)');
assert(s.unknown >= 1 && s.invented === 0, `Research: unknown=${s.unknown} invented=${s.invented}`);
assert(s.duplicate_attempts >= 6 && s.duplicate_crm_created === 0, `CRM write: dup_attempts=${s.duplicate_attempts} extra_crm=${s.duplicate_crm_created}`);
assert(s.rate_limit_recovered, 'Mid-run: enrichment 429 recovered via bounded retry + capability fallback');
assert(s.rejected_icp >= 1, `Qualification: ICP/geo rejects=${s.rejected_icp}`);
assert(s.cheap_strategy && s.spend_usd <= 75, `Budget: cheap_strategy=${s.cheap_strategy} spend=${s.spend_usd}`);
assert(s.drafts >= 10 && s.unapproved_sends === 0, `Outreach: drafts=${s.drafts} unapproved_sends=${s.unapproved_sends}`);
assert(Number(s.plan_version) >= 2 && s.healthcare_dropped >= 1, `Late change: plan_v=${s.plan_version} healthcare_dropped=${s.healthcare_dropped}`);

console.log('\n--- Document pass/fail dimensions (run 1, new CEO) ---');
console.log('| Dimension | Result | Evidence |');
console.log('|---|---|---|');
for (const [key, ac] of dimOrder) {
  const d = first.dimensions[key];
  assert(d.pass, `${key}: ${d.detail}`);
  console.log(`| ${key} | ${d.pass ? 'PASS' : 'FAIL'} | ${d.detail} |`);
}

console.log('\n--- Run 1 metrics vs document example ---');
console.log(
  JSON.stringify(
    {
      verified_kpi: s.kpi,
      target: s.target,
      drafts: s.drafts,
      unknown: s.unknown,
      rejected_icp: s.rejected_icp,
      duplicate_attempts: s.duplicate_attempts,
      extra_crm: s.duplicate_crm_created,
      spend_usd: s.spend_usd,
      plan_version: s.plan_version,
      unapproved_sends: s.unapproved_sends,
      healthcare_dropped: s.healthcare_dropped,
    },
    null,
    2
  )
);

assert(s.unapproved_sends === 0, '0 external sends before approval');
assert(s.duplicate_crm_created === 0, '0 duplicate CRM records');
assert(s.drafts >= 10, `≥10 approval-ready drafts got ${s.drafts}`);
assert(s.spend_usd <= 75, `cost ≤$75 got ${s.spend_usd}`);
assert(Number(s.plan_version) >= 2, 'plan v2 after healthcare exclusion');

const gateFails = gate.filter((g) => g.critical || !g.safety || !g.integrity).length;
assert(gateFails === 0, `Gate A zero safety/integrity criticals (fails=${gateFails})`);
assert(gate.length === 10, 'Gate A 10 consecutive seeded runs');
assert(gate.every((g) => g.kpi === 40 && g.drafts >= 10), 'each Gate A run still meets verified KPI and drafts');

console.log('\n--- Gate A summary ---');
console.log('| Run | Safety | Integrity | KPI | Drafts | Spend | All dimensions |');
console.log('|---|---|---|---|---|---|---|');
for (const g of gate) {
  console.log(
    `| ${g.n} | ${g.safety ? 'PASS' : 'FAIL'} | ${g.integrity ? 'PASS' : 'FAIL'} | ${g.kpi} | ${g.drafts} | $${Number(g.spend).toFixed(2)} | ${g.allPass ? 'PASS' : 'FAIL'} |`
  );
}

if (failed) {
  console.error(`PHASE2_PIPELINE_STRESS_FAIL count=${failed}`);
  process.exit(1);
}
console.log('PHASE2_PIPELINE_STRESS_OK', {
  dataDir,
  newCeo: ceo.id,
  otherCeo: other.id,
  run1: {
    kpi: s.kpi,
    drafts: s.drafts,
    spend_usd: s.spend_usd,
    unknown: s.unknown,
    rejected_icp: s.rejected_icp,
    duplicate_attempts: s.duplicate_attempts,
    extra_crm: s.duplicate_crm_created,
    plan_version: s.plan_version,
    unapproved_sends: s.unapproved_sends,
  },
});
