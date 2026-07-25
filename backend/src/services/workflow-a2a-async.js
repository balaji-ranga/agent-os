/**
 * A2A async invoke: durable tasks, run metadata, and optional HTTP callbacks.
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';

const CALLBACK_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.A2A_CALLBACK_TIMEOUT_MS) || 15000
);

function parseJson(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function buildRunMetadata(run) {
  if (!run) return null;
  const steps = Array.isArray(run.steps) ? run.steps : [];
  return {
    run_id: run.id,
    run_number: run.run_number ?? null,
    definition_id: run.definition_id ?? run.workflow_definition_id ?? null,
    status: run.status,
    trigger: run.trigger || null,
    progress_pct: run.progress_pct ?? null,
    error_message: run.error_message || null,
    started_at: run.started_at || null,
    completed_at: run.completed_at || null,
    steps: steps.map((s) => ({
      node_id: s.node_id,
      node_type: s.node_type,
      node_label: s.node_label || s.label || null,
      status: s.status,
      error_message: s.error_message || null,
    })),
  };
}

export function extractRunOutputText(run) {
  const steps = run?.steps || [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const out = steps[i]?.output;
    if (!out) continue;
    if (typeof out.text === 'string' && out.text.trim()) return out.text.trim();
    if (typeof out.result === 'string' && out.result.trim()) return out.result.trim();
    if (out.result && typeof out.result === 'object') {
      const t = out.result.text || out.result.summary || out.result.message;
      if (typeof t === 'string' && t.trim()) return t.trim();
    }
  }
  return run?.status === 'completed' ? 'Workflow completed successfully.' : '';
}

export function createA2ATaskRow({
  taskId,
  publishId,
  runId,
  ownerUserId,
  callbackUrl = null,
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO workflow_a2a_tasks (
      task_id, publish_id, run_id, owner_user_id, callback_url, state, output_text, run_metadata_json
    ) VALUES (?, ?, ?, ?, ?, 'working', '', '{}')`
  ).run(taskId, publishId, runId, ownerUserId, callbackUrl || null);
  return getA2ATaskRow(taskId);
}

export function getA2ATaskRow(taskId) {
  if (!taskId) return null;
  const row = getDb().prepare(`SELECT * FROM workflow_a2a_tasks WHERE task_id = ?`).get(taskId);
  return row ? hydrateTask(row) : null;
}

export function getA2ATasksByRunId(runId) {
  const rows = getDb()
    .prepare(`SELECT * FROM workflow_a2a_tasks WHERE run_id = ?`)
    .all(runId);
  return rows.map(hydrateTask);
}

function hydrateTask(row) {
  return {
    ...row,
    run_metadata: parseJson(row.run_metadata_json, {}),
  };
}

export function updateA2ATaskRow(taskId, patch = {}) {
  const db = getDb();
  const cur = db.prepare(`SELECT * FROM workflow_a2a_tasks WHERE task_id = ?`).get(taskId);
  if (!cur) return null;
  const state = patch.state != null ? patch.state : cur.state;
  const outputText = patch.output_text != null ? patch.output_text : cur.output_text;
  const metaJson =
    patch.run_metadata != null
      ? JSON.stringify(patch.run_metadata)
      : patch.run_metadata_json != null
        ? patch.run_metadata_json
        : cur.run_metadata_json;
  db.prepare(
    `UPDATE workflow_a2a_tasks SET
      state = ?, output_text = ?, run_metadata_json = ?, updated_at = datetime('now')
     WHERE task_id = ?`
  ).run(state, outputText || '', metaJson || '{}', taskId);
  return getA2ATaskRow(taskId);
}

async function postCallback(url, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);
  try {
    const res = await fetch(String(url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'AgentOS-A2A-Callback/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const bodyText = await res.text().catch(() => '');
    return { status: res.status, ok: res.ok, body: bodyText.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

export function buildA2ACallbackPayload(task, run) {
  const state = task.state || (run?.status === 'completed' ? 'completed' : 'failed');
  const event =
    state === 'completed'
      ? 'a2a.workflow.completed'
      : state === 'cancelled'
        ? 'a2a.workflow.cancelled'
        : 'a2a.workflow.failed';
  return {
    event,
    task_id: task.task_id,
    publish_id: task.publish_id,
    final_output: task.output_text || extractRunOutputText(run) || '',
    run: task.run_metadata && Object.keys(task.run_metadata).length
      ? task.run_metadata
      : buildRunMetadata(run),
    status: { state },
  };
}

/**
 * Mark task terminal from current run state and fire callback once (if configured).
 */
export async function finalizeA2ATask(taskId, { forceCallback = false } = {}) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM workflow_a2a_tasks WHERE task_id = ?`).get(taskId);
  if (!row) return null;

  const run = store.getRun(row.run_id, row.owner_user_id);
  if (!run) return getA2ATaskRow(taskId);

  let state = row.state;
  if (run.status === 'completed') state = 'completed';
  else if (run.status === 'cancelled') state = 'cancelled';
  else if (run.status === 'failed') state = 'failed';
  else if (['working', 'submitted'].includes(row.state)) {
    // still running
    return getA2ATaskRow(taskId);
  }

  const text =
    state === 'completed'
      ? extractRunOutputText(run)
      : run.error_message || `Workflow run ${run.status}`;
  const meta = buildRunMetadata(run);
  updateA2ATaskRow(taskId, { state, output_text: text, run_metadata: meta });

  const task = getA2ATaskRow(taskId);
  if (!task?.callback_url) return task;
  if (task.callback_at && !forceCallback) return task;

  // Claim callback slot
  const claim = db
    .prepare(
      `UPDATE workflow_a2a_tasks SET callback_at = datetime('now'), updated_at = datetime('now')
       WHERE task_id = ? AND (callback_at IS NULL OR ? = 1)`
    )
    .run(taskId, forceCallback ? 1 : 0);
  if (!claim.changes && !forceCallback) return getA2ATaskRow(taskId);

  try {
    const payload = buildA2ACallbackPayload(task, run);
    const result = await postCallback(task.callback_url, payload);
    db.prepare(
      `UPDATE workflow_a2a_tasks SET
        callback_status = ?, callback_error = ?, callback_at = datetime('now'), updated_at = datetime('now')
       WHERE task_id = ?`
    ).run(result.status, result.ok ? null : result.body || `HTTP ${result.status}`, taskId);
  } catch (e) {
    db.prepare(
      `UPDATE workflow_a2a_tasks SET
        callback_status = ?, callback_error = ?, callback_at = datetime('now'), updated_at = datetime('now')
       WHERE task_id = ?`
    ).run(0, e?.message || 'callback failed', taskId);
  }
  return getA2ATaskRow(taskId);
}

/** Called when a workflow run reaches a terminal status. */
export async function notifyA2ARunTerminal(runId) {
  const tasks = getA2ATasksByRunId(runId).filter((t) =>
    ['working', 'submitted', 'input-required'].includes(String(t.state || ''))
  );
  for (const t of tasks) {
    try {
      await finalizeA2ATask(t.task_id);
    } catch (e) {
      console.warn('[a2a] finalize task failed', t.task_id, e?.message || e);
    }
  }
}

export async function waitForRunCompletion(runId, ownerUserId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const run = store.getRun(runId, ownerUserId);
    if (!run) throw new Error('Workflow run not found');
    if (run.status === 'completed') return run;
    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(run.error_message || `Workflow run ${run.status}`);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Workflow run timed out');
}

/** Background watcher for async publishes (callback + task state). */
export function watchA2ATaskInBackground(taskId, ownerUserId, timeoutMs = 24 * 60 * 60 * 1000) {
  void (async () => {
    try {
      const task = getA2ATaskRow(taskId);
      if (!task) return;
      try {
        await waitForRunCompletion(task.run_id, ownerUserId, timeoutMs);
      } catch (_) {
        // terminal failure / timeout — finalize still reads run status
      }
      await finalizeA2ATask(taskId);
    } catch (e) {
      console.warn('[a2a] async watch failed', taskId, e?.message || e);
    }
  })();
}

export const ENQUIRE_SKILL_ID = 'enquire-progress';

export function buildEnquireSkill() {
  return {
    id: ENQUIRE_SKILL_ID,
    name: 'Enquire progress',
    description:
      'Poll progress for an async A2A workflow invocation. Pass taskId (preferred) or runId from the accepted response.',
    tags: ['workflow', 'agent-os', 'async', 'enquiry'],
    examples: ['Check status of task <taskId>', '{"taskId":"<uuid>"}'],
    inputModes: ['application/json', 'text/plain'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        taskId: { type: 'string', description: 'A2A task id returned when the async invoke was accepted' },
        runId: { type: 'integer', description: 'Workflow run id (optional alternative to taskId)' },
      },
      anyOf: [{ required: ['taskId'] }, { required: ['runId'] }],
    },
  };
}
