/**
 * Kanban status read + watch-tick for COO OpenClaw cron monitors.
 * When a watched task reaches a terminal status, matching gateway crons are removed
 * so announce delivery cannot keep spamming WhatsApp.
 */
import { getDb } from '../db/schema.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';
import { resolveKanbanChatContext } from './kanban-chat-context.js';
import { resolveKanbanTaskArtifacts } from './kanban-artifacts.js';
import { parseAgentWorkflowMeta } from './agent-workflow-kanban.js';

export const KANBAN_TERMINAL_STATUSES = new Set(['completed', 'failed']);

const MAX_MESSAGE_CHARS = 800;
const MAX_RECENT_MESSAGES = 6;

/** Caps for COO/tool full-content reads (kanban_get_task). */
const FULL_MESSAGE_LIMIT = 40;
const FULL_CHAT_TURN_LIMIT = 40;
const FULL_FIELD_CHARS = 16000;

function clipText(value, maxChars = FULL_FIELD_CHARS) {
  const text = String(value ?? '');
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

/**
 * @param {number|string} taskId
 * @returns {{ task: object, messages: object[], latest_note: string|null } | null}
 */
export function loadKanbanTaskWithMessages(taskId) {
  const id = Number(taskId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const db = getDb();
  const task = db
    .prepare(
      `SELECT k.*, COALESCE(a.name, om.display_name) AS assigned_agent_name
       FROM kanban_tasks k
       LEFT JOIN agents a ON a.id = k.assigned_agent_id
       LEFT JOIN org_agent_members om
         ON om.id = k.assigned_member_key AND om.owner_user_id = k.owner_user_id
       WHERE k.id = ?`
    )
    .get(id);
  if (!task) return null;
  const messages = db
    .prepare(
      `SELECT id, role, content, created_at FROM task_messages
       WHERE task_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .all(id, MAX_RECENT_MESSAGES)
    .reverse();
  let latest_note = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const role = String(m.role || '').toLowerCase();
    if (role === 'user' || role === 'system') continue;
    const text = String(m.content || '').trim();
    if (text) {
      latest_note = text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)}…` : text;
      break;
    }
  }
  return { task, messages, latest_note };
}

function resolveWorkflowStepIo(db, description) {
  const meta = parseAgentWorkflowMeta(description);
  if (!meta?.run_id || !meta?.node_id) return { input: null, output: null };
  const step = db
    .prepare('SELECT input_json, output_json FROM agent_workflow_run_steps WHERE run_id = ? AND node_id = ?')
    .get(meta.run_id, meta.node_id);
  if (!step) return { input: null, output: null };
  let input = null;
  let output = null;
  try {
    if (step.input_json) input = JSON.parse(step.input_json);
  } catch {
    input = { _raw: clipText(step.input_json, 4000) };
  }
  try {
    if (step.output_json) output = JSON.parse(step.output_json);
  } catch {
    output = { _raw: clipText(step.output_json, 4000) };
  }
  return { input, output };
}

/**
 * Full Kanban task payload for COO/agents: status + description + task messages +
 * delegation deliverable + mirrored agent-chat turns (incl. archived).
 * @param {number|string} taskId
 * @param {{ messageLimit?: number, chatTurnLimit?: number, maxFieldChars?: number }} [opts]
 * @returns {object|null}
 */
export function loadKanbanTaskContent(taskId, opts = {}) {
  const base = loadKanbanTaskWithMessages(taskId);
  if (!base) return null;
  const db = getDb();
  const { task } = base;
  const messageLimit = Math.min(200, Math.max(1, Number(opts.messageLimit) || FULL_MESSAGE_LIMIT));
  const chatTurnLimit = Math.min(200, Math.max(1, Number(opts.chatTurnLimit) || FULL_CHAT_TURN_LIMIT));
  const maxFieldChars = Math.min(50000, Math.max(1000, Number(opts.maxFieldChars) || FULL_FIELD_CHARS));

  const messages = db
    .prepare(
      `SELECT id, role, content, created_at FROM task_messages
       WHERE task_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`
    )
    .all(task.id, messageLimit);

  let delegation_prompt = null;
  let delegation_response = null;
  if (task.agent_delegation_task_id) {
    const d = db
      .prepare('SELECT prompt, response_content FROM agent_delegation_tasks WHERE id = ?')
      .get(task.agent_delegation_task_id);
    if (d) {
      delegation_prompt = d.prompt ? clipText(d.prompt, maxFieldChars) : null;
      delegation_response = d.response_content ? clipText(d.response_content, maxFieldChars) : null;
    }
  }

  const chat_context = resolveKanbanChatContext(db, task, { limit: chatTurnLimit });
  const chat_turns = (chat_context.turns || []).map((t) => ({
    role: t.role,
    content: clipText(t.content, maxFieldChars),
    created_at: t.created_at,
    session_id: t.session_id || null,
    session_archived: !!t.session_archived,
  }));

  const { artifacts, groups, count: artifact_count } = resolveKanbanTaskArtifacts(
    task,
    task.agent_delegation_task_id
      ? { prompt: delegation_prompt, response_content: delegation_response }
      : null,
    messages
  );
  const { input: workflow_step_input, output: workflow_step_output } = resolveWorkflowStepIo(
    db,
    task.description
  );

  let latest_note = base.latest_note;
  if (!latest_note && delegation_response) {
    latest_note = clipText(delegation_response, MAX_MESSAGE_CHARS);
  }
  if (!latest_note) {
    for (let i = chat_turns.length - 1; i >= 0; i -= 1) {
      const t = chat_turns[i];
      if (String(t.role || '').toLowerCase() !== 'assistant') continue;
      const text = String(t.content || '').trim();
      if (text) {
        latest_note = clipText(text, MAX_MESSAGE_CHARS);
        break;
      }
    }
  }

  const deliverable =
    delegation_response ||
    (chat_turns.filter((t) => String(t.role).toLowerCase() === 'assistant').slice(-1)[0]?.content ?? null) ||
    (messages
      .filter((m) => {
        const role = String(m.role || '').toLowerCase();
        return role !== 'user' && role !== 'system' && String(m.content || '').trim();
      })
      .slice(-1)[0]?.content ?? null);

  return {
    task,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: clipText(m.content, maxFieldChars),
      created_at: m.created_at,
    })),
    latest_note: latest_note || null,
    description: task.description ? clipText(task.description, maxFieldChars) : null,
    delegation_prompt,
    delegation_response,
    deliverable: deliverable ? clipText(deliverable, maxFieldChars) : null,
    chat_context: {
      source: chat_context.source || 'none',
      agent_id: chat_context.agent_id || null,
      archived_sessions: chat_context.archived_sessions || [],
      turns: chat_turns,
      turn_count: chat_turns.length,
    },
    workflow_step_input,
    workflow_step_output,
    artifacts: artifacts.slice(0, 40).map((a) => ({
      id: a.id,
      kind: a.kind || a.type || null,
      group: a.group || null,
      label: a.label || a.title || null,
      url: a.url || null,
    })),
    artifact_groups: groups,
    artifact_count,
  };
}

/**
 * Build a short WhatsApp-safe notify line when the task is done/failed.
 * @param {{ title?: string, status?: string, id?: number }} task
 * @param {string|null} latestNote
 */
export function buildKanbanWatchNotifyText(task, latestNote) {
  const status = String(task?.status || '').trim() || 'unknown';
  const title = String(task?.title || 'Kanban task').trim();
  const id = task?.id != null ? `#${task.id}` : '';
  const head =
    status === 'completed'
      ? `Kanban ${id} completed: ${title}`
      : status === 'failed'
        ? `Kanban ${id} failed: ${title}`
        : `Kanban ${id} status=${status}: ${title}`;
  if (!latestNote) return head;
  const note = latestNote.replace(/\s+/g, ' ').trim();
  return `${head}\n${note}`.slice(0, 1500);
}

function jobBlob(job) {
  try {
    return JSON.stringify(job || {});
  } catch {
    return String(job?.name || job?.id || '');
  }
}

/**
 * @param {object} job
 * @param {number} taskId
 */
export function cronJobMentionsTask(job, taskId) {
  const id = Number(taskId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const blob = jobBlob(job);
  if (!blob) return false;
  if (blob.includes(`#${id}`)) return true;
  if (new RegExp(`["']?task_id["']?\\s*[:=]\\s*${id}\\b`).test(blob)) return true;
  if (new RegExp(`\\btask\\s*#?\\s*${id}\\b`, 'i').test(blob)) return true;
  if (new RegExp(`kanban_watch_tick[^\\n]{0,80}${id}`).test(blob)) return true;
  return false;
}

/**
 * List gateway cron jobs (best-effort). Returns [] if RPC unavailable.
 * @returns {Promise<object[]>}
 */
export async function listOpenClawCronJobs() {
  try {
    const data = await openclawAdminRpc('cron.list', {}, { timeoutMs: 20000 });
    const payload = data?.payload ?? data?.result ?? data;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.jobs)) return payload.jobs;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  } catch (e) {
    console.warn('[kanban-watch] cron.list failed: %s', e?.message || e);
    return [];
  }
}

/**
 * @param {string} jobId
 * @returns {Promise<{ ok: boolean, id: string, error?: string }>}
 */
export async function removeOpenClawCronJob(jobId) {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, id: '', error: 'cron job id required' };
  try {
    await openclawAdminRpc('cron.remove', { id }, { timeoutMs: 20000 });
    console.info('[kanban-watch] removed cron job=%s', id);
    return { ok: true, id };
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn('[kanban-watch] cron.remove failed job=%s err=%s', id, msg);
    return { ok: false, id, error: msg };
  }
}

/**
 * Stop watch crons for a task: explicit id and/or any job that mentions the task.
 * @param {number} taskId
 * @param {string|null} [cronJobId]
 * @returns {Promise<{ removed: string[], errors: object[] }>}
 */
export async function stopKanbanWatchCrons(taskId, cronJobId = null) {
  const removed = [];
  const errors = [];
  const seen = new Set();

  const tryRemove = async (id) => {
    const key = String(id || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    const r = await removeOpenClawCronJob(key);
    if (r.ok) removed.push(key);
    else errors.push({ id: key, error: r.error });
  };

  if (cronJobId) await tryRemove(cronJobId);

  const jobs = await listOpenClawCronJobs();
  for (const job of jobs) {
    if (!cronJobMentionsTask(job, taskId)) continue;
    const id = job?.id || job?.jobId || job?.job_id;
    if (id) await tryRemove(id);
  }

  return { removed, errors };
}

/**
 * One tick of a Kanban watch cron: read status; if terminal, stop matching crons.
 * @param {{ taskId: number, cronJobId?: string|null }} opts
 */
export async function runKanbanWatchTick({ taskId, cronJobId = null }) {
  const loaded = loadKanbanTaskWithMessages(taskId);
  if (!loaded) {
    return { ok: false, error: 'Task not found', done: false, reply: 'NO_REPLY' };
  }
  const { task, messages, latest_note } = loaded;
  const status = String(task.status || '').trim();
  const done = KANBAN_TERMINAL_STATUSES.has(status);
  const notify_text = done ? buildKanbanWatchNotifyText(task, latest_note) : null;

  let cron_removed = [];
  let cron_remove_errors = [];
  if (done) {
    const stop = await stopKanbanWatchCrons(task.id, cronJobId);
    cron_removed = stop.removed;
    cron_remove_errors = stop.errors;
    console.info(
      '[kanban-watch] tick done task=%s status=%s removed=%s',
      task.id,
      status,
      cron_removed.join(',') || '(none)'
    );
  } else {
    console.info('[kanban-watch] tick pending task=%s status=%s', task.id, status);
  }

  return {
    ok: true,
    done,
    task_id: task.id,
    title: task.title,
    status,
    assigned_agent_id: task.assigned_agent_id || null,
    assigned_agent_name: task.assigned_agent_name || null,
    latest_note: latest_note || null,
    recent_messages: messages.map((m) => ({
      role: m.role,
      content:
        String(m.content || '').length > MAX_MESSAGE_CHARS
          ? `${String(m.content).slice(0, MAX_MESSAGE_CHARS)}…`
          : m.content,
      created_at: m.created_at,
    })),
    notify_text,
    /** Cron agent should emit this as the entire reply. */
    reply: done ? notify_text : 'NO_REPLY',
    cron_removed,
    cron_remove_errors: cron_remove_errors.length ? cron_remove_errors : undefined,
  };
}
