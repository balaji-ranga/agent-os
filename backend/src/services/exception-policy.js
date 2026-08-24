import { getDb } from '../db/schema.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { notifyKanbanTaskCreated } from './platform-notifications.js';
import { withOwnerScope } from './org-context.js';

export const DEFAULT_EXCEPTION_POLICY = Object.freeze({
  retry_limit: 1,
  create_kanban: true,
  agent_pickup: true,
});

function db() {
  return getDb();
}

function bool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1';
}

function clip(value, max = 1000) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function ensureExceptionPolicyTables() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS exception_policies (
      owner_user_id TEXT PRIMARY KEY,
      retry_limit INTEGER NOT NULL DEFAULT 1,
      create_kanban INTEGER NOT NULL DEFAULT 1,
      agent_pickup INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  for (const sql of [
    'ALTER TABLE agent_goal_steps ADD COLUMN exception_retry_count INTEGER DEFAULT 0',
    'ALTER TABLE agent_goal_steps ADD COLUMN exception_kanban_id INTEGER',
    'ALTER TABLE agent_workflow_run_steps ADD COLUMN exception_retry_count INTEGER DEFAULT 0',
    'ALTER TABLE agent_workflow_run_steps ADD COLUMN exception_kanban_id INTEGER',
  ]) {
    try {
      db().exec(sql);
    } catch (_) {}
  }
}

export function getExceptionPolicy(ownerUserId) {
  ensureExceptionPolicyTables();
  const row = db()
    .prepare('SELECT * FROM exception_policies WHERE owner_user_id = ?')
    .get(ownerUserId);
  return {
    owner_user_id: ownerUserId,
    retry_limit: Math.max(0, Number(row?.retry_limit ?? DEFAULT_EXCEPTION_POLICY.retry_limit)),
    create_kanban: bool(row?.create_kanban, DEFAULT_EXCEPTION_POLICY.create_kanban),
    agent_pickup: bool(row?.agent_pickup, DEFAULT_EXCEPTION_POLICY.agent_pickup),
    updated_at: row?.updated_at || null,
  };
}

export function upsertExceptionPolicy(ownerUserId, input = {}) {
  ensureExceptionPolicyTables();
  const retryLimit = Number(input.retry_limit ?? input.retryLimit ?? DEFAULT_EXCEPTION_POLICY.retry_limit);
  if (!Number.isInteger(retryLimit) || retryLimit < 0 || retryLimit > 5) {
    const err = new Error('retry_limit must be an integer from 0 to 5');
    err.status = 400;
    throw err;
  }
  const createKanban = bool(input.create_kanban ?? input.createKanban, true);
  const agentPickup = bool(input.agent_pickup ?? input.agentPickup, true);
  db()
    .prepare(
      `INSERT INTO exception_policies
         (owner_user_id, retry_limit, create_kanban, agent_pickup, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(owner_user_id) DO UPDATE SET
         retry_limit = excluded.retry_limit,
         create_kanban = excluded.create_kanban,
         agent_pickup = excluded.agent_pickup,
         updated_at = datetime('now')`
    )
    .run(ownerUserId, retryLimit, createKanban ? 1 : 0, agentPickup ? 1 : 0);
  return getExceptionPolicy(ownerUserId);
}

export function workflowExceptionDecision(runId, nodeId) {
  ensureExceptionPolicyTables();
  const run = db()
    .prepare('SELECT * FROM agent_workflow_runs WHERE id = ?')
    .get(runId);
  if (!run) return { action: 'skip', reason: 'run_not_found' };
  const step = db()
    .prepare(
      `SELECT * FROM agent_workflow_run_steps
       WHERE run_id = ? AND node_id = ? ORDER BY id DESC LIMIT 1`
    )
    .get(runId, nodeId);
  if (!step) return { action: 'skip', reason: 'step_not_found' };
  const policy = getExceptionPolicy(run.owner_user_id);
  const retries = Number(step.exception_retry_count || 0);
  return {
    action: retries < policy.retry_limit ? 'retry' : policy.create_kanban ? 'kanban' : 'fail',
    retry_count: retries,
    policy,
    run,
    step,
  };
}

export function recordWorkflowExceptionRetry(stepId) {
  ensureExceptionPolicyTables();
  db()
    .prepare(
      `UPDATE agent_workflow_run_steps
       SET exception_retry_count = COALESCE(exception_retry_count, 0) + 1
       WHERE id = ?`
    )
    .run(stepId);
}

function resolveRecoveryAgent(ownerUserId, graph, nodeId) {
  const node = (graph?.nodes || []).find((candidate) => candidate.id === nodeId);
  const configured = String(node?.data?.agentId || node?.data?.agent_id || '').trim();
  if (configured) {
    const entitled = db()
      .prepare(
        `SELECT a.id, a.name FROM agents a
         JOIN user_agents ua ON ua.agent_id = a.id
         WHERE ua.user_id = ? AND ua.enabled = 1 AND a.id = ? LIMIT 1`
      )
      .get(ownerUserId, configured);
    if (entitled) return entitled;
  }
  return db()
    .prepare(
      `SELECT a.id, a.name FROM agents a
       JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ? AND ua.enabled = 1 AND a.is_coo = 1 LIMIT 1`
    )
    .get(ownerUserId) || null;
}

export function enqueueWorkflowExceptionKanban(runId, nodeId, error = '') {
  const state = workflowExceptionDecision(runId, nodeId);
  if (!state.step || !state.run) return { ok: false, skipped: true, reason: state.reason };
  if (state.step.exception_kanban_id) {
    return { ok: true, skipped: true, reason: 'already_enqueued', kanban_id: state.step.exception_kanban_id };
  }
  if (!state.policy.create_kanban) return { ok: false, skipped: true, reason: 'disabled_by_policy' };

  let graph = {};
  try {
    graph = JSON.parse(state.run.graph_json || '{}');
  } catch (_) {}
  const definition = db()
    .prepare('SELECT name FROM agent_workflow_definitions WHERE id = ?')
    .get(state.run.definition_id);
  const agent = state.policy.agent_pickup
    ? resolveRecoveryAgent(state.run.owner_user_id, graph, nodeId)
    : null;
  const nodeLabel = state.step.node_label || nodeId;
  const title = clip(`Workflow exception: ${definition?.name || state.run.definition_id} · ${nodeLabel}`, 120);
  const description = [
    '[workflow_exception_recovery]',
    `agent_wf_run_id: ${runId}`,
    `agent_wf_def_id: ${state.run.definition_id}`,
    `owner_user_id: ${state.run.owner_user_id}`,
    `node_id: ${nodeId}`,
    `node_label: ${nodeLabel}`,
    `retry_count: ${state.retry_count}`,
    '',
    'The automatic retry was unsuccessful. Inspect the error and repair or complete this step.',
    `Open the run: /workflows/runs/${runId}`,
    'Use “Retry from this step” after correcting credentials, inputs, policy, or the external dependency.',
    '',
    `Error: ${clip(error || state.step.error_message || state.run.error_message || 'Unknown failure', 2000)}`,
    agent ? '' : 'No eligible recovery agent was found; this task requires user action.',
  ].filter((line) => line !== '').join('\n');

  let delegationTaskId = null;
  let standupId = null;
  if (agent) {
    standupId = getOrCreateDelegationHubStandup(state.run.owner_user_id);
    const requestId = `workflow-exception-${runId}-${String(nodeId).replace(/[^a-zA-Z0-9-]/g, '').slice(0, 32)}-${Date.now()}`;
    const prompt = withOwnerScope([
      description,
      '',
      'Work only on the failed node and remaining outcome. Do not repeat completed upstream steps.',
      'If you can resolve the outcome with your normal tools, do so and mark this Kanban completed.',
      'If credentials, policy, or user input is required, leave a precise Kanban message for the user.',
    ].join('\n'), state.run.owner_user_id);
    const inserted = db()
      .prepare(
        `INSERT INTO agent_delegation_tasks
           (standup_id, request_id, to_agent_id, prompt, status, owner_user_id)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .run(standupId, requestId, agent.id, prompt, state.run.owner_user_id);
    delegationTaskId = Number(inserted.lastInsertRowid);
  }

  const inserted = db()
    .prepare(
      `INSERT INTO kanban_tasks
         (title, description, status, assigned_agent_id, created_by, standup_id,
          agent_delegation_task_id, owner_user_id, workflow_run_id)
       VALUES (?, ?, 'open', ?, 'exception-policy', ?, ?, ?, ?)`
    )
    .run(
      title,
      description,
      agent?.id || null,
      standupId,
      delegationTaskId,
      state.run.owner_user_id,
      Number(runId)
    );
  const kanbanId = Number(inserted.lastInsertRowid);
  db()
    .prepare('UPDATE agent_workflow_run_steps SET exception_kanban_id = ? WHERE id = ?')
    .run(kanbanId, state.step.id);
  notifyKanbanTaskCreated({
    userId: state.run.owner_user_id,
    task: { id: kanbanId, title, assigned_agent_id: agent?.id || null },
  });
  return {
    ok: true,
    kanban_id: kanbanId,
    delegation_task_id: delegationTaskId,
    agent_id: agent?.id || null,
  };
}
