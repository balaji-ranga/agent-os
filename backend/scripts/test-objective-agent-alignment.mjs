import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'flolah-objective-agent-'));
process.env.AGENT_OS_DATA_DIR = dir;
const { initDb, getDb } = await import('../src/db/schema.js');
initDb();
const objective = await import('../src/services/company-objectives.js');
const alignment = await import('../src/services/objective-agent-tools.js');
const { buildStatusDigest, formatDigestMarkdown, formatDigestHtml } = await import('../src/services/coo-status-checker.js');
const { buildThisWeekDigest } = await import('../src/services/this-week-digest.js');
const agentTools = await import('../src/services/openclaw-agent-tools.js');

try {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO platform_users(id,email,name,role,enabled) VALUES('ceo-align','align@example.test','Alignment CEO','ceo',1)`).run();
  db.prepare(`INSERT OR IGNORE INTO agents(id,name,role,is_coo,owner_user_id) VALUES('coo-align','COO','COO',1,'ceo-align')`).run();
  db.prepare(`INSERT OR IGNORE INTO agents(id,name,role,is_coo,owner_user_id) VALUES('research-align','Research Employee','Research',0,'ceo-align')`).run();
  alignment.grantObjectiveAgentTools();
  assert(db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='research-align' AND tool_name='company_objectives_query'`).get()?.ok);
  assert(db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='research-align' AND tool_name='objective_deviation_record'`).get()?.ok);
  assert(!db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='research-align' AND tool_name='company_goal_link_objective'`).get());
  assert(db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='coo-align' AND tool_name='company_goal_link_objective'`).get()?.ok);
  assert.deepEqual(
    new Set(agentTools.MANDATORY_AGENT_EVIDENCE_TOOLS),
    new Set(['agent_work_history', 'company_objectives_query', 'objective_deviation_record'])
  );
  const toolsMd = agentTools.buildToolsMdContent(['company_objectives_query', 'objective_deviation_record', 'company_goal_link_objective']);
  assert.match(toolsMd, /do not delegate an objective lookup/i);
  assert.match(toolsMd, /Never claim it was recorded unless the tool returns `ok: true`/i);
  assert(agentTools.mergeAgentRuntimeAllowlist(['browser'], ['company_objectives_query']).includes('browser'));
  assert(!agentTools.mergeAgentRuntimeAllowlist([], ['company_objectives_query']).includes('browser'));
  db.prepare(`INSERT OR IGNORE INTO agents(id,name,role,is_coo,owner_user_id) VALUES('late-align','Late Specialist','Research',0,'ceo-align')`).run();
  alignment.grantObjectiveAgentTools('late-align');
  assert(db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='late-align' AND tool_name='company_objectives_query'`).get()?.ok);
  assert(db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='late-align' AND tool_name='objective_deviation_record'`).get()?.ok);
  assert(!db.prepare(`SELECT 1 ok FROM agent_tool_grants WHERE agent_id='late-align' AND tool_name='company_goal_link_objective'`).get());

  for (const extension of ['index.js', 'index.ts']) {
    const extensionText = readFileSync(new URL(`../../openclaw-extensions/agent-os-content-tools/${extension}`, import.meta.url), 'utf8');
    assert.match(extensionText, /company_objectives_query:\s*\{/);
    assert.match(extensionText, /company_goal_link_objective:\s*\{/);
    assert.match(extensionText, /objective_deviation_record:\s*\{/);
    assert.match(extensionText, /required:\s*\["request",\s*"rationale"\]/);
  }

  const created = objective.createObjective('ceo-align', {
    name: 'Grow qualified pipeline', outcome: 'Create measurable qualified pipeline',
    period_type: 'quarterly', starts_on: '2026-07-01', ends_on: '2026-09-30', status: 'active',
    key_results: [{ id: 'kr-align-1', name: 'Qualified pipeline', baseline: 0, target: 100000, unit: 'SGD' }, { id: 'kr-align-2', name: 'Qualified accounts', baseline: 0, target: 10, unit: 'accounts' }],
    initiatives: [{ id: 'init-align-1', name: 'Singapore SME campaign', prompt: 'Research and qualify Singapore SMEs' }],
  }, 'ceo-align');
  assert.equal(alignment.queryCompanyObjectives('ceo-align', { status: 'active' }).objectives[0].id, created.id);
  assert.equal(alignment.queryCompanyObjectives('another-ceo', {}).total, 0, 'objective query is tenant scoped');

  db.prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,source,status,context_json) VALUES('agr-align-1','ceo-align','coo-align','Campaign run','Execute campaign','tool','running','{}')`).run();
  const linked = alignment.linkCompanyGoal('ceo-align', { goal_run_id: 'agr-align-1', objective_id: created.id, initiative_id: 'init-align-1', key_result_ids: ['kr-align-1','kr-align-2'] });
  assert.equal(linked.goal_runs[0].initiative_id, 'init-align-1');
  const context = JSON.parse(db.prepare(`SELECT context_json FROM agent_goal_runs WHERE id='agr-align-1'`).get().context_json);
  assert.deepEqual(context.linked_key_result_ids, ['kr-align-1','kr-align-2']);
  assert.equal(context.objective_link_source, 'explicit_user_request');
  assert.throws(() => alignment.linkCompanyGoal('ceo-align', { goal_run_id: 'agr-align-1', objective_id: created.id, initiative_id: 'wrong-init' }), /does not belong/);

  const audit = alignment.recordObjectiveDeviation('ceo-align', {
    request: 'Pause pipeline work and produce an unrelated launch video',
    rationale: 'The request is outside the active revenue objective and initiative.',
    objective_ids: [created.id], initiative_ids: ['init-align-1'], goal_run_id: 'agr-align-1', channel: 'web',
  }, { user_id: 'ceo-align', agent_id: 'research-align' });
  assert.equal(audit.non_blocking, true);
  assert.equal(audit.table.name, 'Objective_deviation');
  const summary = alignment.getObjectiveDeviationSummary('ceo-align', { limit: 10 });
  assert.equal(summary.count, 1);
  assert.equal(summary.recent[0].data.user_id, 'ceo-align');
  assert(summary.recent[0].data.recorded_at, 'audit timestamp is retained');

  const status = buildStatusDigest('ceo-align', { reconcile: false });
  assert.equal(status.counts.objective_deviations_7d, 1);
  assert.match(formatDigestMarkdown(status), /Objective deviations/);
  assert.match(formatDigestHtml(status), /Objective deviations/);
  const utcToday = new Date().toISOString().slice(0, 10);
  const weekly = await buildThisWeekDigest('ceo-align', { weekStart: utcToday, weekEnd: utcToday });
  assert.equal(weekly.objective_deviations.count, 1);

  const sharedOps = readFileSync(new URL('../../openclaw-workspace-templates/_shared/AGENT-OS-OPS.md', import.meta.url), 'utf8');
  assert.match(sharedOps, /company_objectives_query/);
  assert.match(sharedOps, /objective_deviation_record/);
  console.log(JSON.stringify({ ok: true, objective_id: created.id, initiative_id: 'init-align-1', goal_run_id: 'agr-align-1', linked_key_results: context.linked_key_result_ids, deviation_table: summary.table_name, status_deviations_7d: status.counts.objective_deviations_7d, weekly_digest_deviations: weekly.objective_deviations.count, grants: { all_agents: ['company_objectives_query','objective_deviation_record'], coo_orchestrator: ['company_goal_link_objective'] } }, null, 2));
} finally {
  try { getDb().close(); } catch {}
  rmSync(dir, { recursive: true, force: true });
}
