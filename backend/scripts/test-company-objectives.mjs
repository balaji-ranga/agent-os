import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'flolah-objectives-'));
process.env.AGENT_OS_DATA_DIR = dir;
const { initDb, getDb } = await import('../src/db/schema.js');
initDb();
const svc = await import('../src/services/company-objectives.js');

try {
  const registry = svc.measurementRegistry();
  assert.ok(registry.sources.length >= 10, 'common Flolah and integration measurement sources are registered');
  assert.ok(registry.sources.find((source) => source.id === 'goal_plans').formulas.some((formula) => formula.id === 'completion_rate'));
  assert.ok(registry.sources.find((source) => source.id === 'custom_api').formulas.some((formula) => formula.id === 'average'));
  let companyRegistry = svc.upsertMeasurementRegistryEntry('ceo-demo-northstar', { kind: 'source', id: 'sales_warehouse', label: 'Sales warehouse', provider: 'Warehouse' });
  companyRegistry = svc.upsertMeasurementRegistryEntry('ceo-demo-northstar', { kind: 'formula', id: 'qualified_rate', source_id: 'sales_warehouse', label: 'Qualified rate', description: 'Qualified divided by researched' });
  assert.ok(companyRegistry.sources.find((source) => source.id === 'sales_warehouse').formulas.some((item) => item.id === 'qualified_rate'), 'company registry source and formula are merged');
  svc.deleteMeasurementRegistryEntry('ceo-demo-northstar', 'formula', 'qualified_rate');
  assert.equal(svc.measurementRegistry('ceo-demo-northstar').sources.find((source) => source.id === 'sales_warehouse').formulas.length, 0);
  const boot = svc.bootstrapNorthstarDemo('ceo-demo-northstar', 'test');
  assert.equal(boot.created, true);
  assert.equal(boot.objectives.length, 4);
  assert.equal(boot.objectives.filter((o) => o.status === 'active').length, 2, 'current reference periods are immediately visible in Digest');
  assert.deepEqual(new Set(boot.objectives.map((o) => o.period_type)), new Set(['monthly','quarterly','half_yearly','annual']));
  assert.equal(svc.bootstrapNorthstarDemo('ceo-demo-northstar', 'test').created, false, 'demo bootstrap is idempotent');
  assert.equal(svc.listObjectives('ceo-demo-northstar', { limit: 2 }).objectives.length, 2);
  assert.equal(svc.listObjectives('ceo-demo-northstar', { limit: 2 }).has_more, true);
  assert.equal(svc.listObjectives('another-ceo', {}).total, 0, 'tenant isolation');

  const q4 = svc.getObjective('ceo-demo-northstar', 'obj-demo-northstar-q4-2026');
  assert.equal(q4.authority.external_communications, 'approval_required');
  assert.equal(q4.key_results.length, 5);
  assert.equal(q4.key_results[0].measurement_config.provenance, true, 'measurement contract is retained with the KR');
  assert.equal(q4.initiatives.length, 6);
  const active = svc.updateObjective('ceo-demo-northstar', q4.id, { status: 'active', reason: 'acceptance' }, 'ceo-demo-northstar');
  assert.equal(active.version, 2);
  assert.equal(active.initiatives.every((initiative) => initiative.status === 'active'), true, 'initiatives inherit objective operating state');
  assert.equal(active.initiatives[0].scheduled_goals.length, 1, 'recurring initiative materialises a scheduled goal');
  const schedule = active.initiatives[0].scheduled_goals[0];
  assert.equal(schedule.source, 'company_objective');
  for (let n = 1; n <= 3; n += 1) {
    getDb().prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,source,scheduled_goal_id,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?,datetime('now',?),datetime('now',?))`).run(`agr-scheduled-${n}`, 'ceo-demo-northstar', schedule.agent_id, `Scheduled run ${n}`, 'test', 'scheduled_goal', schedule.id, 'completed', `-${4-n} days`, `-${4-n} days`);
  }
  getDb().prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,source,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run('agr-adhoc-1', 'ceo-demo-northstar', schedule.agent_id, 'Ad-hoc qualification', 'test', 'objective_initiative', 'completed');
  svc.linkGoalRun('ceo-demo-northstar', q4.id, { goal_run_id: 'agr-adhoc-1', initiative_id: active.initiatives[0].id });
  const hierarchy = svc.getObjective('ceo-demo-northstar', q4.id);
  assert.equal(hierarchy.initiatives[0].scheduled_goals[0].goal_plan_runs.length, 3, 'scheduled runs associate autonomously');
  assert.equal(hierarchy.initiatives[0].adhoc_goal_plans.length, 1, 'one-off plans sit under their initiative');
  assert.deepEqual(hierarchy.execution_summary, { goal_plan_runs: 4, completed_runs: 4, scheduled_goals: 1, adhoc_goal_plans: 1 });
  assert.equal(svc.listObjectiveVersions('ceo-demo-northstar', q4.id).length, 2);

  svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'candidate', external_id: 'candidate-1', account_name: 'Lion Logistics', status: 'researched', evidence: ['https://example.test/lion'] });
  svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'candidate', external_id: 'candidate-1', account_name: 'Lion Logistics', status: 'researched', evidence: ['https://example.test/lion'] });
  svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'qualification', external_id: 'candidate-1', account_name: 'Lion Logistics', status: 'qualified', evidence: ['source-1'] });
  const measured = svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'opportunity', external_id: 'opp-1', account_name: 'Lion Logistics', status: 'qualified', amount: 20000, probability: 0.5, evidence: ['crm:opp-1'] });
  assert.equal(measured.revenue.researched, 1, 'idempotent candidate counting');
  assert.equal(measured.revenue.qualified, 1);
  assert.equal(measured.revenue.weighted_pipeline, 10000);
  assert.equal(measured.key_results.find((k) => k.formula === 'weighted_pipeline').current_value, 10000);

  assert.throws(() => svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'send', external_id: 'send-no-grant', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'approved-copy' }), /approved grant/);
  const grant = svc.createObjectiveApproval('ceo-demo-northstar', q4.id, { channel: 'email', content_hash: 'approved-copy', recipients: ['buyer@example.test'], max_uses: 1 });
  assert.equal(grant.status, 'pending');
  svc.decideObjectiveApproval('ceo-demo-northstar', q4.id, grant.id, 'approved', 'ceo-demo-northstar');
  assert.throws(() => svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'send', external_id: 'send-wrong-copy', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'changed-copy', approval_id: grant.id }), /does not match/);
  const sent = svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'send', external_id: 'send-approved', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'approved-copy', approval_id: grant.id });
  assert.equal(sent.revenue.approved_sends, 1);
  assert.throws(() => svc.upsertRevenueEvidence('ceo-demo-northstar', q4.id, { record_type: 'send', external_id: 'send-exhausted', status: 'sent', channel: 'email', recipient: 'buyer@example.test', content_hash: 'approved-copy', approval_id: grant.id }), /expired or exhausted/);
  assert.equal(svc.listRevenueEvidence('ceo-demo-northstar', q4.id, { limit: 2 }).has_more, true);

  const llm = await svc.ideateObjective('ceo-demo-northstar', { outcome: 'Generate S$100k qualified pipeline', period_type: 'quarterly', period_label: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31' }, { callModel: async () => ({ content: JSON.stringify({ name: 'LLM proposal', key_results: [{ name: 'Pipeline', target: 100000, unit: 'SGD', source_type: 'crm', formula: 'weighted_pipeline' }], initiatives: [{ name: 'Research', owner_label: 'Research Analyst', cadence: 'daily', prompt: 'research' }] }), modelUsed: 'live-test-model' }) });
  assert.equal(llm.proposal.name, 'LLM proposal');
  assert.equal(llm.proposal.authority.external_communications, 'approval_required', 'LLM cannot widen authority');
  assert.equal(llm.model_used, 'live-test-model');

  const goalIdeas = await svc.ideateInitiativeGoals('ceo-demo-northstar', { objective: llm.proposal, initiative: llm.proposal.initiatives[0], key_results: llm.proposal.key_results }, { callModel: async () => ({ content: JSON.stringify([{ goal_type: 'scheduled', title: 'Research daily', prompt: 'Produce evidence-backed research and record exceptions.', cadence: 'weekdays', time_local: '09:00', linked_key_result_ids: [llm.proposal.key_results[0].id] }, { goal_type: 'adhoc', title: 'Seed target list', prompt: 'Create the initial reviewed target list.' }]), modelUsed: 'live-goal-model' }) });
  assert.equal(goalIdeas.goals.length, 2, 'AI can recommend multiple goals for one initiative');
  assert.equal(goalIdeas.goals[0].linked_key_result_ids.length, 1, 'AI goal retains valid KR links');
  assert.equal(goalIdeas.model_used, 'live-goal-model');

  const fallback = await svc.ideateObjective('ceo-demo-northstar', { outcome: 'Generate S$100k qualified pipeline', period_type: 'quarterly', period_label: 'Q4 2026', starts_on: '2026-10-01', ends_on: '2026-12-31' }, { callModel: async () => { throw new Error('offline'); } });
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.proposal.key_results.length, 6);

  assert.equal(svc.getObjective('another-ceo', q4.id), null, 'cross-tenant get returns no object');
} finally {
  getDb().close();
  rmSync(dir, { recursive: true, force: true });
}

const route = readFileSync(new URL('../src/routes/company-objectives.js', import.meta.url), 'utf8');
for (const marker of ["router.use(requireAuth, requireCeoOrAdmin)", "router.post('/ideate'", "router.get('/digest'", "router.post('/demo/northstar'"]) assert.match(route, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
const appUrl = new URL('../../frontend/src/App.jsx', import.meta.url);
const navUrl = new URL('../../frontend/src/utils/ceoNavCatalog.js', import.meta.url);
if (existsSync(appUrl) && existsSync(navUrl)) {
  assert.match(readFileSync(appUrl, 'utf8'), /path="\/objectives"/);
  assert.match(readFileSync(navUrl, 'utf8'), /label: 'Objectives Key Results \(OKR\)'/);
}
console.log('company objectives: PASS (kernel, four periods, isolation, evidence, LLM contract, fallback, UI routes)');
