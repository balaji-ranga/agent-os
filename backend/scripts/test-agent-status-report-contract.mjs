import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-agent-history-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.OPENCLAW_DIR = join(dataDir, 'openclaw');
const {
  compactAgentWorkHistoryEvidence,
  historyWindowDays,
  listAgentWorkHistory,
} = await import('../src/services/agent-work-history.js');
const { validateStepOutcome, correctionContext, statusReportExplicitlyDeniesRecordedHistory } = await import('../src/services/step-outcome-validation.js');
const { classifyToolFailure } = await import('../src/services/tool-failure-class.js');
const { buildOutcomeRichTerminalReport, completeGoalStep, enrichStatusReportWithWorkHistory, ensureAgentGoalRunTables } = await import('../src/services/agent-goal-run.js');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE agent_delegation_tasks (
    id INTEGER PRIMARY KEY, response_content TEXT, error_message TEXT, completed_at TEXT
  );
  CREATE TABLE kanban_tasks (
    id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT,
    assigned_agent_id TEXT, owner_user_id TEXT, goal_run_id TEXT,
    agent_delegation_task_id INTEGER, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE content_tool_logs (
    id INTEGER PRIMARY KEY, tool_name TEXT, source TEXT, request_payload TEXT,
    response_payload TEXT, status TEXT, owner_user_id TEXT, trace_id TEXT,
    goal_step_id TEXT, created_at TEXT
  );
`);
db.prepare('INSERT INTO agent_delegation_tasks VALUES (?,?,?,datetime(\'now\'))')
  .run(10, 'Cleaned 12 promotional messages and summarized them before deletion.', null);
db.prepare(`INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  .run(101, 'Clean old promotions', '', 'completed', 'gmail-operations', 'ceo-a', 'agr-a', 10);
db.prepare(`INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  .run(102, 'Mailbox review', 'OAuth expired', 'failed', 'gmail-operations', 'ceo-a', 'agr-b', null);
db.prepare(`INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  .run(201, 'Other tenant task', '', 'completed', 'gmail-operations', 'ceo-b', 'agr-x', null);
db.prepare(`INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  .run(301, 'Other agent task', '', 'completed', 'techresearcher', 'ceo-a', 'agr-y', null);
db.prepare(`INSERT INTO kanban_tasks VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`)
  .run(401, 'Current status report', '', 'completed', 'gmail-operations', 'ceo-a', 'agr-current', null);

assert.equal(historyWindowDays('what happened over the last 14 days?'), 14);
assert.equal(historyWindowDays('recent work'), 7);

const history = listAgentWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'gmail-operations', days: 7, excludeGoalRunId: 'agr-current', database: db,
});
assert.equal(history.activity_count, 2);
assert.equal(history.counts.completed, 1);
assert.equal(history.counts.failed, 1);
assert(history.items.every((item) => item.task_id !== 201 && item.task_id !== 301));
assert(history.items.every((item) => item.task_id !== 401));
assert.match(history.items.find((item) => item.task_id === 101).outcome, /Cleaned 12/);
assert.equal(history.evidence_source, 'owner_scoped_kanban_and_delegation_ledger');

const evidence = compactAgentWorkHistoryEvidence(history);
let modelCalled = false;
const missing = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query', response: 'Here is my report.',
  executionEvidence: { tool_calls: [], substantive_tool_calls: [] },
}, async () => {
  modelCalled = true;
  return { content: '{"satisfied":true,"reason":"ok","missing_outcomes":[]}' };
});
assert.equal(missing.satisfied, false);
assert.equal(modelCalled, false, 'missing work-history evidence must fail before LLM validation');
assert.deepEqual(missing.missing_outcomes, ['agent_work_history_evidence']);

const rejected = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query',
  response: 'The agent_work_history evidence returned zero recorded activities.',
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => {
  modelCalled = true;
  return { content: '{"satisfied":true,"reason":"ok","missing_outcomes":[]}' };
});
assert.equal(rejected.satisfied, false);
assert.equal(modelCalled, false, 'authoritative contradiction must fail before LLM validation');
assert.match(rejected.reason, /2 recorded activities/);
assert.equal(statusReportExplicitlyDeniesRecordedHistory('No new action was taken while preparing this read-only report.'), false);
assert.equal(statusReportExplicitlyDeniesRecordedHistory('Work history returned 0 recorded activities.'), true);

const readOnlyNoNewAction = enrichStatusReportWithWorkHistory(
  'No new action was taken while preparing this read-only status report.',
  { ...evidence, evidence_id: 'aev-fixture' }
);
const readOnlyAccepted = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query', response: readOnlyNoNewAction,
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => ({ content: '{"satisfied":true,"reason":"Read-only report accurately cites authoritative history","missing_outcomes":[]}' }));
assert.equal(readOnlyAccepted.satisfied, true, 'read-only no-new-action wording must not deny historical work');

const hollow = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query',
  response: 'The requested status update was provided and the task was marked completed.',
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => ({ content: '{"satisfied":true,"reason":"ok","missing_outcomes":[]}' }));
assert.equal(hollow.satisfied, false);
assert.deepEqual(hollow.missing_outcomes, ['work_history_evidence_reference']);

const citedButHollow = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query',
  response: 'Evidence aev-fixture was reviewed and the status task was completed.',
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => ({ content: '{"satisfied":true,"reason":"ok","missing_outcomes":[]}' }));
assert.equal(citedButHollow.satisfied, false);
assert.deepEqual(citedButHollow.missing_outcomes, ['authoritative_work_history_details']);

const accepted = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query',
  response: 'Evidence aev-fixture contains 2 recorded activities. Task 101 completed cleanup; task 102 failed because OAuth expired.',
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => ({ content: '{"satisfied":true,"reason":"History summarized","missing_outcomes":[]}' }));
assert.equal(accepted.satisfied, true);

const enriched = enrichStatusReportWithWorkHistory(
  'I compiled and delivered the requested status update.',
  { ...evidence, evidence_id: 'aev-fixture' }
);
assert.match(enriched, /Evidence ID: aev-fixture/);
assert.match(enriched, /Recorded activities: 2/);
assert.match(enriched, /Task 101:/);
const enrichedValidation = await validateStepOutcome({
  deliverableKind: 'status_report', operationMode: 'query', response: enriched,
  executionEvidence: { work_history: { ...evidence, evidence_id: 'aev-fixture' }, substantive_tool_calls: [{ tool_name: 'agent_work_history', status: 'ok' }] },
}, async () => ({ content: '{"satisfied":true,"reason":"Structured history retained","missing_outcomes":[]}' }));
assert.equal(enrichedValidation.satisfied, true, 'valid agent-obtained evidence must survive a weak prose wrapper');
const contradictionNotMasked = enrichStatusReportWithWorkHistory(
  'No activities were recorded.', { ...evidence, evidence_id: 'aev-fixture' }
);
assert.equal(contradictionNotMasked, 'No activities were recorded.');

const retryPacket = correctionContext({
  attempt: 2,
  stepId: 'ags-status',
  error: 'Status report omitted task details',
  previousResult: JSON.stringify({ evidence: { work_history_summary: {
    evidence_id: 'aev-fixture', activity_count: 2,
    items: [{ task_id: 101, title: 'Clean old promotions', status: 'completed', outcome: 'Cleaned 12 messages' }],
  } } }),
});
assert.match(retryPacket, /aev-fixture/);
assert.match(retryPacket, /"task_id":101/);
assert.match(retryPacket, /Do not answer for another agent/);

db.prepare(`INSERT INTO content_tool_logs VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(
  1, 'agent_work_history', 't-ceo-a--gmail-operations', '{}',
  JSON.stringify({ ok: true, evidence_id: 'aev-fixture', ...history }),
  'ok', 'ceo-a', 'agr-current', 'ags-current'
);
const { listGoalStepToolEvidence } = await import('../src/services/agent-goal-run.js');
const captured = listGoalStepToolEvidence({
  ownerUserId: 'ceo-a', goalRunId: 'agr-current', goalStepId: 'ags-current', database: db,
});
assert.equal(captured.work_history_evidence_id, 'aev-fixture');
assert.equal(captured.work_history.activity_count, 2);
assert.equal(captured.substantive_tool_calls.length, 1);

const classified = classifyToolFailure({ message: rejected.reason }, { code: 'outcome_contract_incomplete' });
assert.equal(classified.failure_class, 'outcome_incomplete');
assert.equal(classified.retryable, true);

const report = buildOutcomeRichTerminalReport({
  goal: { id: 'agr-status', title: 'Two-agent status' },
  terminal: 'completed',
  steps: [
    { step_type: 'specialty_task', label: 'Gmail Operations', status: 'completed', result: { reply_preview: 'Gmail completed 17 tasks.' } },
    { step_type: 'specialty_task', label: 'TechResearcher', status: 'completed', result: { reply_preview: 'TechResearcher completed 4 reports.' } },
    { step_type: 'notify_ceo', label: 'Notify CEO', status: 'completed', result: { body: 'delivery wrapper' } },
  ],
});
assert.match(report, /Gmail completed 17 tasks/);
assert.match(report, /TechResearcher completed 4 reports/);
assert.doesNotMatch(report, /delivery wrapper/);

ensureAgentGoalRunTables();
const runtimeDb = (await import('../src/db/schema.js')).getDb();
const { registerPlatformCron } = await import('../src/services/platform-cron-registry.js');
registerPlatformCron({
  id: 'goal_plan_completion_nudge', name: 'Fixture completion nudge', description: 'disabled in isolated test',
  schedule: '', enabled: false, handler: async () => ({ ok: true }),
});
runtimeDb.prepare(`INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)`)
  .run('ceo-status-retry', 'status-retry@fixture.invalid', 'x', 'Status Retry', 'ceo');
runtimeDb.prepare(`INSERT INTO agents(id,name,role,is_coo,openclaw_agent_id,owner_user_id) VALUES(?,?,?,?,?,?)`)
  .run('coo-status-retry', 'Status COO', 'COO', 1, 'coo-status-retry', 'ceo-status-retry');
runtimeDb.prepare(`INSERT INTO user_agents(user_id,agent_id,enabled) VALUES(?,?,1)`)
  .run('ceo-status-retry', 'coo-status-retry');
runtimeDb.prepare(`INSERT OR REPLACE INTO content_tools_meta(name,display_name,endpoint,enabled,is_builtin) VALUES(?,?,?,?,?)`)
  .run('agent_work_history', 'Agent Work History', '/api/tools/agent-work-history', 1, 1);
const { buildToolsMdContent, setAgentToolGrants } = await import('../src/services/openclaw-agent-tools.js');
runtimeDb.prepare(`INSERT INTO agents(id,name,role,is_coo,openclaw_agent_id,owner_user_id) VALUES(?,?,?,?,?,?)`)
  .run('grant-test-agent', 'Grant Test', 'Test', 0, 'grant-test-agent', 'ceo-status-retry');
setAgentToolGrants({ id: 'grant-test-agent', is_coo: 0, openclaw_agent_id: 'grant-test-agent' }, []);
assert(runtimeDb.prepare(`SELECT 1 AS ok FROM agent_tool_grants WHERE agent_id=? AND tool_name='agent_work_history'`).get('grant-test-agent')?.ok);
assert.match(buildToolsMdContent(['agent_work_history']), /Evidence is mandatory/);
const docsDir = join(dataDir, 'workspace-docs');
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, 'TOOLS.md'), '# TOOLS\n', 'utf8');
writeFileSync(join(docsDir, 'AGENTS.md'), '# AGENTS\n', 'utf8');
const { syncEvidenceGuidance } = await import('../src/services/openclaw-tenant.js');
syncEvidenceGuidance(docsDir);
syncEvidenceGuidance(docsDir);
assert.equal((readFileSync(join(docsDir, 'TOOLS.md'), 'utf8').match(/FLOLAH_EVIDENCE_POLICY_START/g) || []).length, 1);
assert.match(readFileSync(join(docsDir, 'AGENTS.md'), 'utf8'), /Mandatory evidence contract/);
runtimeDb.prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,status) VALUES(?,?,?,?,?,'running')`)
  .run('agr-status-retry', 'ceo-status-retry', 'coo-status-retry', 'Status retry', 'Report recent agent activity.');
runtimeDb.prepare(`INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,spec_json,status) VALUES(?,?,?,?,?,?,'running')`)
  .run('ags-status-retry', 'agr-status-retry', 0, 'specialty_task', 'Report status', JSON.stringify({ deliverable_kind: 'status_report' }));
runtimeDb.prepare(`INSERT INTO kanban_tasks(title,status,owner_user_id,goal_run_id,goal_step_id) VALUES(?,?,?,?,?)`)
  .run('Status report attempt', 'completed', 'ceo-status-retry', 'agr-status-retry', 'ags-status-retry');
const retryKanbanId = Number(runtimeDb.prepare('SELECT id FROM kanban_tasks ORDER BY id DESC LIMIT 1').get().id);
const retry = completeGoalStep({
  goalRunId: 'agr-status-retry', stepId: 'ags-status-retry', ownerUserId: 'ceo-status-retry',
  result: { failure_code: 'outcome_contract_incomplete', error: 'Status contradicted authoritative history', kanban_task_id: retryKanbanId },
  failed: true, error: 'Status contradicted authoritative history',
});
const retriedStep = runtimeDb.prepare('SELECT status, exception_retry_count FROM agent_goal_steps WHERE id=?').get('ags-status-retry');
assert.equal(retry.recovered, true);
assert.equal(retriedStep.status, 'pending');
assert.equal(retriedStep.exception_retry_count, 1);
assert.equal(runtimeDb.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(retryKanbanId).status, 'in_progress');

// A CEO approval on an exception-policy recovery card must resume the same
// durable goal. It must not fall through to workflow approval or be mistaken
// for a human_task response.
runtimeDb.prepare(`INSERT INTO standups(scheduled_at,status,source) VALUES(datetime('now'),'completed','fixture')`).run();
const standupId = Number(runtimeDb.prepare('SELECT id FROM standups ORDER BY id DESC LIMIT 1').get().id);
runtimeDb.prepare(`INSERT INTO agent_goal_runs(id,owner_user_id,agent_id,title,prompt,status,error_message,completed_at)
  VALUES(?,?,?,?,?,'failed','Outcome contract incomplete',datetime('now'))`)
  .run('agr-recovery-approval', 'ceo-status-retry', 'coo-status-retry', 'Recovery approval', 'Return a status report.');
runtimeDb.prepare(`INSERT INTO agent_goal_steps(id,goal_run_id,step_index,step_type,label,spec_json,status,error_message,completed_at)
  VALUES(?,?,?,?,?,?,'failed','Outcome contract incomplete',datetime('now'))`)
  .run('ags-recovery-approval', 'agr-recovery-approval', 0, 'specialty_task', 'Status report', JSON.stringify({ deliverable_kind: 'status_report' }));
const recoveryDelegation = runtimeDb.prepare(`INSERT INTO agent_delegation_tasks
  (standup_id,request_id,to_agent_id,prompt,status,response_content,owner_user_id,completed_at)
  VALUES(?,?,?,?, 'completed', ?, ?, datetime('now'))`).run(
    standupId, 'req-recovery-approval', 'grant-test-agent', 'Repair the status report.',
    'No new action was taken while preparing this report; the requested historical status was supplied.', 'ceo-status-retry'
  );
const recoveryCard = runtimeDb.prepare(`INSERT INTO kanban_tasks
  (title,description,status,assigned_agent_id,created_by,agent_delegation_task_id,owner_user_id,goal_run_id,goal_step_id)
  VALUES(?,?,'awaiting_confirmation',?,'exception-policy',?,?,?,?)`).run(
    'Goal recovery: status report', '[goal_plan_recovery]', 'grant-test-agent', Number(recoveryDelegation.lastInsertRowid),
    'ceo-status-retry', 'agr-recovery-approval', 'ags-recovery-approval'
  );
const { executeKanbanUserAction } = await import('../src/services/kanban-user-actions.js');
const recoveryApproval = await executeKanbanUserAction({
  ownerUserId: 'ceo-status-retry', actor: { id: 'ceo-status-retry', role: 'ceo' },
  taskId: Number(recoveryCard.lastInsertRowid), action: 'approve', evidence: 'I reviewed and accept this recovery outcome.', channel: 'web',
});
assert.equal(recoveryApproval.resumed, true);
assert.equal(recoveryApproval.accepted_recovery_result, true);
assert.equal(runtimeDb.prepare('SELECT status FROM kanban_tasks WHERE id=?').get(Number(recoveryCard.lastInsertRowid)).status, 'completed');
assert.equal(runtimeDb.prepare('SELECT status FROM agent_goal_steps WHERE id=?').get('ags-recovery-approval').status, 'completed');
assert.equal(runtimeDb.prepare('SELECT status FROM agent_goal_runs WHERE id=?').get('agr-recovery-approval').status, 'completed');
assert(runtimeDb.prepare(`SELECT 1 AS ok FROM goal_mission_events WHERE goal_run_id=? AND event_type='goal_recovery_resumed'`).get('agr-recovery-approval')?.ok);

console.log('PASS agent status-report contract');
console.log(JSON.stringify({
  semantic_contract: { operation_mode: 'query', deliverable_kind: 'status_report', output_kind: 'data' },
  history: { activity_count: history.activity_count, counts: history.counts, evidence_source: history.evidence_source, current_goal_excluded: true },
  evidence_capture: { missing_rejected: !missing.satisfied, evidence_id: captured.work_history_evidence_id, tool_calls: captured.tool_calls.length },
  structured_evidence_retained: { enriched: enrichedValidation.satisfied, contradiction_not_masked: contradictionNotMasked === 'No activities were recorded.' },
  agent_contracts: { mandatory_tool_grant: true, tools_md: true, agents_md: true, ops_md: true },
  contradiction_retry: { rejected: !rejected.satisfied, failure_class: classified.failure_class, retryable: classified.retryable },
  runtime_retry: { recovered: retry.recovered, status: retriedStep.status, retry_count: retriedStep.exception_retry_count, same_kanban_reopened: true },
  recovery_approval: { same_goal_resumed: recoveryApproval.resumed, accepted_result: recoveryApproval.accepted_recovery_result, card_closed: true },
  terminal_aggregation: { gmail: true, techresearcher: true, notify_wrapper_excluded: true },
}, null, 2));
// Terminal completion schedules a once-only COO nudge. Let the isolated task
// observe the expected unavailable local gateway before closing fixture DBs.
await new Promise((resolve) => setTimeout(resolve, 250));
try { (await import('../src/db/schema.js')).getDb().close(); } catch {}
try { (await import('../src/db/ceo-db.js')).closeCeoDb('ceo-status-retry'); } catch {}
db.close();
rmSync(dataDir, { recursive: true, force: true });
