import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { isCeoDelegate } from './org-permissions.js';
import { notifyKanbanTaskCreated, clearKanbanTaskNotification } from './platform-notifications.js';
import { previewActionPolicy } from './action-policy.js';
import { preserveSlaHistoryForDeletedTask } from './kanban-sla.js';

const DEFAULT_TTL_SECONDS = Math.max(300, Number(process.env.CHAT_ACTION_APPROVAL_TTL_SECONDS || 1800));

function db() { return getDb(); }

export function ensureChatActionApprovalTable() {
  db().exec(`
    CREATE TABLE IF NOT EXISTS chat_action_approvals (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      session_key TEXT,
      channel TEXT NOT NULL DEFAULT 'web',
      tool_name TEXT NOT NULL,
      execution_tool_name TEXT,
      action_family TEXT NOT NULL,
      args_hash TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '{}',
      args_summary_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      kanban_task_id INTEGER,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT,
      decision_evidence TEXT,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chat_action_approval_lookup
      ON chat_action_approvals(owner_user_id, agent_id, status, requested_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_action_approval_kanban
      ON chat_action_approvals(owner_user_id, kanban_task_id);
    CREATE TABLE IF NOT EXISTS chat_action_approval_task_archive (
      approval_id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL,
      task_id INTEGER NOT NULL, reason TEXT NOT NULL,
      task_json TEXT NOT NULL, messages_json TEXT NOT NULL,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    const columns = db().prepare('PRAGMA table_info(chat_action_approvals)').all().map((row) => row.name);
    if (!columns.includes('args_json')) db().exec("ALTER TABLE chat_action_approvals ADD COLUMN args_json TEXT NOT NULL DEFAULT '{}'");
    if (!columns.includes('execution_tool_name')) db().exec('ALTER TABLE chat_action_approvals ADD COLUMN execution_tool_name TEXT');
  } catch (_) {}
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function approvalBody(body = {}) {
  const copy = { ...(body && typeof body === 'object' ? body : {}) };
  for (const key of [
    'approval_token', 'tool_name', 'toolName', 'caller_agent_id', 'x_openclaw_agent_id',
    'owner_user_id', 'ownerUserId', 'ceo_user_id', 'ceoUserId', 'user_id', 'userId',
  ]) delete copy[key];
  return stable(copy);
}

export function actionArgsHash(toolName, body = {}) {
  return createHash('sha256')
    .update(`${String(toolName || '').trim()}\n${JSON.stringify(approvalBody(body))}`)
    .digest('hex');
}

function safeSummary(body = {}) {
  const source = approvalBody(body);
  let nested = source?.input && typeof source.input === 'object' && !Array.isArray(source.input)
    ? source.input
    : {};
  if (typeof source?.input === 'string') {
    try {
      const parsed = JSON.parse(source.input);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) nested = parsed;
    } catch (_) {}
  }
  const summary = {};
  for (const key of ['to', 'recipient', 'email', 'phone', 'subject', 'amount', 'total', 'value', 'campaign_id']) {
    if (source[key] != null && source[key] !== '') summary[key] = String(source[key]).slice(0, 300);
  }
  if (source.html || source.body || source.text || source.message) {
    const content = String(source.html || source.body || source.text || source.message || '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    summary.content_preview = content.slice(0, 500);
  }
  const operation = String(nested.operation || source.operation || '').trim();
  if (operation) summary.operation = operation.slice(0, 100);
  const platform = String(nested.platform || source.platform || '').trim();
  if (platform) summary.platform = platform.slice(0, 100);
  const startUrl = String(source.start_url || source.startUrl || nested.start_url || nested.startUrl || '').trim();
  if (startUrl) summary.website = startUrl.slice(0, 500);
  if (!summary.content_preview && (nested.body || nested.text || nested.message)) {
    summary.content_preview = String(nested.body || nested.text || nested.message)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  const audience = String(nested.audience || source.audience || '').trim();
  if (audience) summary.audience = audience.slice(0, 200);
  if (Array.isArray(source.attachments)) summary.attachment_count = source.attachments.length;
  return summary;
}

function live(row) {
  return row && Date.parse(row.expires_at) > Date.now();
}

/** Close stale grants without executing/rearming them. Caller supplies trusted tenant scope. */
export function reconcileChatActionApprovals(ownerUserId, { taskId = null } = {}) {
  ensureChatActionApprovalTable();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('Authenticated owner required'), { status: 403 });
  const rows = db().prepare(`SELECT * FROM chat_action_approvals
    WHERE owner_user_id=? AND (status IN ('pending','approved') OR
      (status IN ('expired','superseded') AND EXISTS (SELECT 1 FROM kanban_tasks k
        WHERE k.id=chat_action_approvals.kanban_task_id AND k.owner_user_id=chat_action_approvals.owner_user_id)))${taskId == null ? '' : ' AND kanban_task_id=?'}`)
    .all(...(taskId == null ? [owner] : [owner, Number(taskId)]));
  const result = { expired: 0, superseded: 0, removed: 0 };
  for (const row of rows) {
    let state = ['expired','superseded'].includes(row.status) ? row.status : null;
    if (!state && row.tool_name === 'notify_ceo' && (row.execution_tool_name || row.tool_name) === 'notify_ceo') {
      let body = {};
      try { body = JSON.parse(row.args_json || '{}'); } catch (_) {}
      const policy = previewActionPolicy({ ownerUserId: owner, toolName: 'notify_ceo', body, context: { agentId: row.agent_id } });
      // Preserve intentional company/tool/agent approval policies and CEO risk overrides.
      if (policy.ok && policy.mode === 'autonomous' && policy.risk_tier === 'R1' &&
          policy.action_family === 'write_internal' && !policy.override_id) state = 'superseded';
    }
    if (!state && !live(row)) state = 'expired';
    if (!state) continue;
    const reason = state === 'superseded'
      ? 'Approval no longer required: notify_ceo is an internal in-app notification. This old request was closed without executing or replaying it.'
      : 'Approval expired. This action was not executed. Ask the agent to prepare a fresh request for approval.';
    db().transaction(() => {
      const changed = db().prepare(`UPDATE chat_action_approvals SET status=?
        WHERE id=? AND owner_user_id=? AND status IN ('pending','approved')`).run(state, row.id, owner).changes;
      if (changed) result[state]++;
      const current = db().prepare('SELECT status FROM chat_action_approvals WHERE id=? AND owner_user_id=?').get(row.id, owner);
      if (!['expired','superseded'].includes(current?.status)) return;
      // Only remove the exact generated chat approval, never linked goal/delegation work.
      const task = db().prepare(`SELECT * FROM kanban_tasks WHERE id=? AND owner_user_id=?
        AND created_by='action_policy' AND status IN ('awaiting_confirmation','in_progress','failed')`)
        .get(row.kanban_task_id, owner);
      if (task && String(task.description || '').includes('[CHAT_ACTION_APPROVAL]') &&
          String(task.description || '').includes(`approval_id: ${row.id}`) &&
          !task.goal_run_id && !task.goal_step_id && !task.standup_id && !task.agent_delegation_task_id) {
        const messages = db().prepare('SELECT * FROM task_messages WHERE task_id=? ORDER BY id').all(task.id);
        db().prepare(`INSERT OR IGNORE INTO chat_action_approval_task_archive
          (approval_id,owner_user_id,task_id,reason,task_json,messages_json) VALUES (?,?,?,?,?,?)`)
          .run(row.id, owner, task.id, reason, JSON.stringify(task), JSON.stringify(messages));
        preserveSlaHistoryForDeletedTask(task);
        db().prepare(`DELETE FROM platform_user_notifications WHERE user_id=?
          AND source IN ('kanban_sla_nudge','kanban_sla_escalation') AND source_key=?`).run(owner, String(task.id));
        db().prepare('DELETE FROM task_messages WHERE task_id=?').run(task.id);
        result.removed += db().prepare('DELETE FROM kanban_tasks WHERE id=? AND owner_user_id=?').run(task.id, owner).changes;
      }
      if (row.kanban_task_id) clearKanbanTaskNotification(row.kanban_task_id, owner);
    })();
  }
  return result;
}

export function chatActionApprovalState(task) {
  if (!String(task?.description || '').includes('[CHAT_ACTION_APPROVAL]')) return null;
  ensureChatActionApprovalTable();
  const row = db().prepare('SELECT id,status,expires_at FROM chat_action_approvals WHERE owner_user_id=? AND kanban_task_id=?')
    .get(String(task.owner_user_id || ''), Number(task.id));
  const status = row?.status || 'unavailable';
  return {
    id: row?.id || null, status, expires_at: row?.expires_at || null,
    can_decide: Boolean(row && live(row) && ['pending','approved'].includes(status) && ['awaiting_confirmation','in_progress'].includes(task.status)),
    checked_at: new Date().toISOString(),
  };
}

export function recordPendingChatAction({ ownerUserId, agentId, sessionKey = null, channel = 'web', toolName, executionToolName = null, actionFamily, body = {} } = {}) {
  ensureChatActionApprovalTable();
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  const tool = String(toolName || '').trim();
  const executionTool = String(executionToolName || tool).trim();
  if (!owner || !agent || !tool) return null;
  reconcileChatActionApprovals(owner);
  const hash = actionArgsHash(tool, body);
  const rows = db().prepare(`SELECT * FROM chat_action_approvals
    WHERE owner_user_id=? AND agent_id=? AND tool_name=? AND args_hash=?
      AND status IN ('pending','approved') ORDER BY requested_at DESC LIMIT 5`)
    .all(owner, agent, tool, hash);
  const existing = rows.find(live);
  if (existing) return existing;

  const id = `caa-${randomUUID()}`;
  const requestedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString();
  const summary = safeSummary(body);
  const description = [
    '[CHAT_ACTION_APPROVAL]',
    `approval_id: ${id}`,
    `tool: ${tool}`,
    `execution_tool: ${executionTool}`,
    `action_family: ${actionFamily}`,
    `agent_id: ${agent}`,
    `expires_at: ${expiresAt}`,
    '',
    'Exact action summary:',
    JSON.stringify(summary, null, 2),
    '',
    'Approve once to allow only this exact action. Changed arguments or replay require a new approval.',
  ].join('\n');
  const task = db().prepare(`INSERT INTO kanban_tasks
    (title,description,status,assigned_user_id,created_by,owner_user_id)
    VALUES (?,?,'awaiting_confirmation',?,'action_policy',?) RETURNING *`)
    .get(`Approval required: ${tool}`.slice(0, 240), description, owner, owner);
  db().prepare(`INSERT INTO chat_action_approvals
    (id,owner_user_id,agent_id,session_key,channel,tool_name,execution_tool_name,action_family,args_hash,args_json,args_summary_json,status,kanban_task_id,requested_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)`)
    .run(id, owner, agent, sessionKey ? String(sessionKey) : null, String(channel || 'web'), tool, executionTool,
      String(actionFamily || ''), hash, JSON.stringify(approvalBody(body)), JSON.stringify(summary), task.id, requestedAt, expiresAt);
  try { notifyKanbanTaskCreated({ userId: owner, task }); } catch (_) {}
  return db().prepare('SELECT * FROM chat_action_approvals WHERE id=?').get(id);
}

export function getChatActionApprovalByKanban(ownerUserId, kanbanTaskId) {
  ensureChatActionApprovalTable();
  reconcileChatActionApprovals(ownerUserId, { taskId: kanbanTaskId });
  return db().prepare('SELECT * FROM chat_action_approvals WHERE owner_user_id=? AND kanban_task_id=?')
    .get(String(ownerUserId || ''), Number(kanbanTaskId));
}

function authorizedActor(actor) {
  return actor?.role === 'ceo' || actor?.role === 'admin' || isCeoDelegate(actor);
}

export function isChatActionDecisionMessage(message) {
  const text = String(message || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(approve|approved|yes proceed|proceed|go ahead|send it|confirm|confirmed|ok|okay)$/.test(text)) return 'approve';
  if (/^(reject|rejected|do not proceed|don't proceed|cancel|deny|denied)$/.test(text)) return 'reject';
  return null;
}

/**
 * Interpret a Kanban chat reply as an approval decision only when the task is
 * an explicit, still-pending action approval. This keeps ordinary task
 * comments such as "approved" from changing unrelated work.
 */
export function kanbanActionDecisionFromMessage({ task, role = 'user', message } = {}) {
  if (!task || String(role).toLowerCase() !== 'user') return null;
  if (String(task.status || '') !== 'awaiting_confirmation') return null;
  const description = String(task.description || '');
  if (!description.includes('[CHAT_ACTION_APPROVAL]') && !description.includes('[GOAL_ACTION_APPROVAL]')) return null;
  return isChatActionDecisionMessage(message);
}

export function decideChatActionApproval({ ownerUserId, agentId = null, approvalId = null, kanbanTaskId = null, decision, actor, channel = 'web', evidence = '' } = {}) {
  ensureChatActionApprovalTable();
  if (!authorizedActor(actor)) throw Object.assign(new Error('Only the CEO or a CEO delegate may approve this external action'), { status: 403 });
  const owner = String(ownerUserId || '').trim();
  const wanted = String(decision || '').toLowerCase();
  if (!['approve', 'reject'].includes(wanted)) throw Object.assign(new Error('decision must be approve or reject'), { status: 400 });
  reconcileChatActionApprovals(owner);
  let row = null;
  if (approvalId) row = db().prepare('SELECT * FROM chat_action_approvals WHERE id=? AND owner_user_id=?').get(String(approvalId), owner);
  else if (kanbanTaskId) row = getChatActionApprovalByKanban(owner, kanbanTaskId);
  else if (agentId) row = db().prepare(`SELECT * FROM chat_action_approvals
    WHERE owner_user_id=? AND agent_id=? AND status IN ('pending','approved')
    ORDER BY requested_at DESC LIMIT 1`).get(owner, String(agentId));
  if (!row) throw Object.assign(new Error('No pending action is available in this conversation'), { status: 404 });
  if (row.status === 'superseded') throw Object.assign(new Error('Approval no longer required for this internal notification. The old request was closed without execution.'), { status: 409 });
  if (!['pending','approved','expired'].includes(row.status)) throw Object.assign(new Error(`Action approval is already ${row.status}`), { status: 409 });
  if (row.status === 'expired' || !live(row)) throw Object.assign(new Error('This approval expired. Ask the agent to prepare a fresh request; the action was not executed.'), { status: 409 });
  const next = wanted === 'approve' ? 'approved' : 'rejected';
  const note = String(evidence || wanted).slice(0, 4000);
  db().transaction(() => {
    db().prepare(`UPDATE chat_action_approvals SET status=?,decided_at=?,decided_by=?,decision_evidence=?
      WHERE id=? AND status IN ('pending','approved')`)
      .run(next, new Date().toISOString(), actor.id, `[${channel}] ${note}`, row.id);
    if (row.kanban_task_id) {
      db().prepare("UPDATE kanban_tasks SET status=?,updated_at=datetime('now') WHERE id=?")
        .run(next === 'approved' ? 'in_progress' : 'failed', row.kanban_task_id);
      db().prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'user',?)")
        .run(row.kanban_task_id, `[${actor.id} via ${channel}] ${note}`);
      if (next === 'rejected') clearKanbanTaskNotification(row.kanban_task_id, owner);
    }
  })();
  return { ok: true, decision: next, approval_id: row.id, kanban_task_id: row.kanban_task_id, tool_name: row.tool_name };
}

export function decidePendingChatActionFromMessage({ ownerUserId, agentId, actor, channel = 'web', message } = {}) {
  const decision = isChatActionDecisionMessage(message);
  if (!decision) return null;
  try {
    return decideChatActionApproval({ ownerUserId, agentId, decision, actor, channel, evidence: message });
  } catch (error) {
    if (error?.status === 404 || (error?.status === 409 && /expired|no longer required/.test(error.message))) return null;
    throw error;
  }
}

export function consumeApprovedChatAction({ ownerUserId, agentId, toolName, body = {} } = {}) {
  ensureChatActionApprovalTable();
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  const tool = String(toolName || '').trim();
  if (!owner || !agent || !tool) return null;
  reconcileChatActionApprovals(owner);
  const hash = actionArgsHash(tool, body);
  const rows = db().prepare(`SELECT * FROM chat_action_approvals
    WHERE owner_user_id=? AND agent_id=? AND tool_name=? AND args_hash=? AND status='approved'
    ORDER BY decided_at DESC LIMIT 5`).all(owner, agent, tool, hash);
  const row = rows.find(live);
  if (!row) return null;
  const used = db().prepare(`UPDATE chat_action_approvals SET status='consumed',consumed_at=?
    WHERE id=? AND status='approved'`).run(new Date().toISOString(), row.id);
  if (used.changes !== 1) return null;
  if (row.kanban_task_id) {
    db().prepare("UPDATE kanban_tasks SET status='completed',updated_at=datetime('now') WHERE id=?").run(row.kanban_task_id);
    clearKanbanTaskNotification(row.kanban_task_id, owner);
  }
  return { ok: true, grant_id: row.id, source: 'bound_chat_approval' };
}

export async function executeApprovedChatAction({ ownerUserId, approvalId } = {}) {
  ensureChatActionApprovalTable();
  reconcileChatActionApprovals(ownerUserId);
  const row = db().prepare(`SELECT * FROM chat_action_approvals
    WHERE id=? AND owner_user_id=? AND status='approved'`).get(String(approvalId || ''), String(ownerUserId || ''));
  if (!row || !live(row)) throw Object.assign(new Error('Approved action is unavailable or expired'), { status: 409 });
  let args = {};
  try { args = JSON.parse(row.args_json || '{}') || {}; } catch (_) {}
  const executionToolName = String(
    row.execution_tool_name ||
    (String(row.tool_name || '').startsWith('connector_action:') ? 'connector_execute_action' : '') ||
    (String(row.tool_name || '').startsWith('mcp_bound_action|') ? 'mcp_bound_tool_call' : '') ||
    row.tool_name || ''
  ).trim();
  const { invokeContentToolHttp } = await import('./content-tool-http-invoke.js');
  try {
    const result = await invokeContentToolHttp(executionToolName, args, row.owner_user_id, {
      agentId: row.agent_id,
      openclawAgentId: row.agent_id,
    });
    return {
      ok: true,
      approval_id: row.id,
      tool_name: row.tool_name,
      execution_tool_name: executionToolName,
      result,
    };
  } catch (error) {
    // The policy middleware consumes a one-shot approval before invoking the
    // external tool. If that tool then fails, reflect the real terminal state
    // on Kanban without rearming or replaying the authorization.
    if (row.kanban_task_id) {
      const reason = String(error?.message || 'External action failed').slice(0, 1000);
      db().transaction(() => {
        db().prepare("UPDATE kanban_tasks SET status='failed',updated_at=datetime('now') WHERE id=?")
          .run(row.kanban_task_id);
        db().prepare("INSERT INTO task_messages(task_id,role,content) VALUES (?,'system',?)")
          .run(row.kanban_task_id, `[Action execution failed] ${reason}`);
      })();
      clearKanbanTaskNotification(row.kanban_task_id, row.owner_user_id);
    }
    throw error;
  }
}
