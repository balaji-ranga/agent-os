import { getDb } from '../db/schema.js';
import { sendPlatformNotifications, deleteNotificationsBySource } from './platform-notifications.js';
import { executeEmailSend } from './email-send.js';
import { announceOnAgentChannel } from './agent-channel-announce.js';
import { insertChatTurn } from './chat-history.js';
import { getWorkAssignmentPolicy, resolvePolicyEtaHours } from './work-assignment-policy.js';

const ALLOWED = [1, 2, 4, 8, 12, 24, 36, 48, 72, 168];

export function normalizeEtaHours(value, context = '') {
  const explicit = Number(value);
  if (ALLOWED.includes(explicit)) return explicit;
  const text = String(context || '').toLowerCase();
  if (/critical|urgent|immediate|high[- ]risk|risk\s*[:=]\s*high|regulatory|legal|overdue|payment|finance/.test(text)) return 4;
  if (/complex|research|investigat|multi[- ]step|customer/.test(text)) return 12;
  return 8;
}

export function resolveKanbanEtaHours(ownerUserId, value, context = '') {
  return resolvePolicyEtaHours(ownerUserId, value, context);
}

export function computeDueAt(hours, from = Date.now()) {
  return new Date(Number(from) + normalizeEtaHours(hours) * 3600000).toISOString();
}

/**
 * SQLite datetime() values are UTC but omit a timezone suffix. Date.parse()
 * treats those strings as server-local time, which shifts SLA deadlines when
 * the backend TZ is not UTC. Preserve explicit offsets and normalize only the
 * timezone-less database representation to UTC.
 */
export function parseDbTimestampMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    return Date.parse(`${raw.replace(' ', 'T')}Z`);
  }
  return Date.parse(raw);
}

export function applyPolicyEtaToTask(taskId, ownerUserId, { etaHours = null, context = '' } = {}) {
  if (!taskId || !ownerUserId) return null;
  const hours = resolveKanbanEtaHours(ownerUserId, etaHours, context);
  const dueAt = computeDueAt(hours);
  getDb().prepare(`UPDATE kanban_tasks SET eta_hours=?, due_at=? WHERE id=? AND owner_user_id=?`)
    .run(hours, dueAt, taskId, ownerUserId);
  return { eta_hours: hours, due_at: dueAt };
}

export function slaState(task, nowMs = Date.now()) {
  if (!task?.due_at || ['completed', 'failed', 'cancelled'].includes(String(task.status))) return 'none';
  const due = parseDbTimestampMs(task.due_at);
  if (!Number.isFinite(due)) return 'none';
  const parsedCreated = parseDbTimestampMs(task.created_at);
  const created = Number.isFinite(parsedCreated)
    ? parsedCreated
    : due - normalizeEtaHours(task.eta_hours) * 3600000;
  const duration = Math.max(1, due - created);
  const remaining = due - nowMs;
  if (remaining <= 0) return 'red';
  if (remaining <= Math.max(3600000, duration * 0.25)) return 'amber';
  return 'green';
}

export function withSlaState(task) {
  return { ...task, sla_state: slaState(task) };
}

function assigneeForEvent(task) {
  return String(task.assigned_user_id || task.assigned_agent_id || task.assigned_member_key || 'unassigned');
}

export function recordSlaEvent(task, eventType, delivery = {}) {
  if (!task?.id || !task?.owner_user_id) return null;
  getDb().prepare(`INSERT INTO kanban_sla_events
    (owner_user_id,task_id,event_type,task_title,task_status,assignee,eta_hours,due_at,occurred_at,delivery_json)
    VALUES(?,?,?,?,?,?,?,?,COALESCE(?,datetime('now')),?)
    ON CONFLICT(owner_user_id,task_id,event_type) DO NOTHING`).run(
    String(task.owner_user_id), Number(task.id), String(eventType), String(task.title || ''),
    String(task.status || ''), assigneeForEvent(task), task.eta_hours || null, task.due_at || null,
    eventType === 'breach' ? task.sla_escalated_at || null : task.sla_nudged_at || null,
    JSON.stringify(delivery || {})
  );
  return getDb().prepare(
    `SELECT * FROM kanban_sla_events WHERE owner_user_id=? AND task_id=? AND event_type=?`
  ).get(String(task.owner_user_id), Number(task.id), String(eventType));
}

export function preserveSlaHistoryForDeletedTask(task) {
  if (!task?.id || !task?.owner_user_id) return { preserved: 0 };
  if (task.sla_nudged_at) recordSlaEvent(task, 'nudge', { legacy_preserved: true });
  if (task.sla_escalated_at) recordSlaEvent(task, 'breach', { legacy_preserved: true });
  const changed = getDb().prepare(
    `UPDATE kanban_sla_events SET task_deleted_at=COALESCE(task_deleted_at,datetime('now'))
     WHERE owner_user_id=? AND task_id=?`
  ).run(String(task.owner_user_id), Number(task.id)).changes;
  return { preserved: changed };
}

export function clearKanbanSlaNotifications(taskId) {
  const key = String(Number(taskId));
  const nudge = deleteNotificationsBySource('kanban_sla_nudge', key);
  const breach = deleteNotificationsBySource('kanban_sla_escalation', key);
  return { deleted: Number(nudge?.deleted || 0) + Number(breach?.deleted || 0) };
}

export function listRecentSlaBreaches(ownerUserId, days = 30) {
  const windowDays = Math.min(365, Math.max(1, Number(days) || 30));
  return getDb().prepare(
    `SELECT id,task_id,task_title,task_status,assignee,eta_hours,due_at,occurred_at,task_deleted_at,delivery_json
     FROM kanban_sla_events
     WHERE owner_user_id=? AND event_type='breach'
       AND datetime(occurred_at) >= datetime('now', ?)
     ORDER BY datetime(occurred_at) DESC, id DESC LIMIT 200`
  ).all(String(ownerUserId), `-${windowDays} days`).map((row) => {
    let delivery = {};
    try { delivery = JSON.parse(row.delivery_json || '{}'); } catch {}
    return { ...row, delivery, deleted: !!row.task_deleted_at };
  });
}

async function notifyCeo(task, message, policy) {
  const owner = String(task.owner_user_id || '');
  const delivery = { in_app: 'disabled', email: 'disabled', coo_chat: 'disabled', whatsapp: 'disabled' };
  if (policy.sla_notify_in_app) {
    try {
      sendPlatformNotifications({ userIds: [owner], title: `Task SLA breached: ${task.title}`, body: message, linkUrl: `/kanban?task=${task.id}`, createdBy: 'system', source: 'kanban_sla_escalation', sourceKey: String(task.id) });
      delivery.in_app = 'sent';
    } catch (e) { delivery.in_app = `failed: ${String(e?.message || e).slice(0, 200)}`; }
  }
  const ceo = getDb().prepare("SELECT email FROM platform_users WHERE id = ? AND role = 'ceo'").get(owner);
  if (policy.sla_notify_email) {
    if (ceo?.email) {
      try {
        const result = await executeEmailSend({ to: ceo.email, subject: `Flolah task SLA breached — #${task.id}`, body: message });
        delivery.email = result?.sent === false ? 'failed' : 'sent';
      } catch (e) {
        delivery.email = `failed: ${String(e?.message || e).slice(0, 200)}`;
        console.warn('[kanban-sla] email escalation failed', e?.message || e);
      }
    } else delivery.email = 'skipped: CEO email unavailable';
  }
  const coo = getDb().prepare(
    `SELECT a.id FROM user_agents ua JOIN agents a ON a.id=ua.agent_id
     WHERE ua.user_id=? AND ua.enabled=1 AND a.is_coo=1 ORDER BY a.id LIMIT 1`
  ).get(owner);
  if (coo?.id) {
    if (policy.sla_notify_in_app) {
      try {
        insertChatTurn({ agentId: coo.id, ownerUserId: owner, role: 'assistant', content: `[Task SLA escalation]\n${message}` });
        delivery.coo_chat = 'sent';
      } catch (e) { delivery.coo_chat = `failed: ${String(e?.message || e).slice(0, 200)}`; }
    }
    if (policy.sla_notify_whatsapp) {
      try {
        const result = await announceOnAgentChannel({ ownerUserId: owner, agentId: coo.id, channel: 'whatsapp', text: message, idempotencyKey: `kanban-sla:${task.id}:breach` });
        delivery.whatsapp = result?.sent || result?.ok ? 'sent' : `skipped: ${result?.reason || 'channel unavailable'}`;
      } catch (e) { delivery.whatsapp = `failed: ${String(e?.message || e).slice(0, 200)}`; }
    }
  } else {
    if (policy.sla_notify_in_app) delivery.coo_chat = 'skipped: COO unavailable';
    if (policy.sla_notify_whatsapp) delivery.whatsapp = 'skipped: COO unavailable';
  }
  return delivery;
}

export async function runKanbanSlaMonitor() {
  const rows = getDb().prepare("SELECT * FROM kanban_tasks WHERE status IN ('open','awaiting_confirmation','in_progress') AND due_at IS NOT NULL").all();
  let nudged = 0; let escalated = 0;
  for (const task of rows) {
    const state = slaState(task);
    const assignee = task.assigned_user_id || task.assigned_agent_id;
    const policy = getWorkAssignmentPolicy(task.owner_user_id);
    if (state === 'amber' && !task.sla_nudged_at && assignee) {
      const userTarget = task.assigned_user_id || task.owner_user_id;
      const delivery = { in_app: 'disabled', agent_chat: 'not_applicable' };
      if (policy.sla_notify_in_app) {
        sendPlatformNotifications({ userIds: [userTarget], title: `Deadline approaching: ${task.title}`, body: `Task #${task.id} is due ${task.due_at}. Record progress or a blocker in Kanban.`, linkUrl: `/kanban?task=${task.id}`, createdBy: 'system', source: 'kanban_sla_nudge', sourceKey: String(task.id) });
        delivery.in_app = 'sent';
      }
      if (task.assigned_agent_id) {
        insertChatTurn({
          agentId: task.assigned_agent_id,
          ownerUserId: task.owner_user_id,
          role: 'user',
          content: `[Task SLA nudge]\nTask #${task.id} “${task.title}” is approaching its deadline (${task.due_at}). Continue the assigned work and record a concrete outcome or blocker in Kanban.`,
        });
        delivery.agent_chat = 'sent';
      }
      recordSlaEvent(task, 'nudge', delivery);
      getDb().prepare("UPDATE kanban_tasks SET sla_nudged_at = datetime('now') WHERE id = ?").run(task.id); nudged += 1;
    }
    if (state === 'red' && !task.sla_escalated_at) {
      const msg = `Task #${task.id} “${task.title}” missed its ${task.eta_hours || '?'}h ETA. Assignee: ${assignee || 'unassigned'}. Review or reassign it in Kanban.`;
      const delivery = await notifyCeo(task, msg, policy);
      recordSlaEvent(task, 'breach', delivery);
      getDb().prepare("UPDATE kanban_tasks SET sla_escalated_at = datetime('now') WHERE id = ?").run(task.id); escalated += 1;
    }
  }
  return { ok: true, scanned: rows.length, nudged, escalated };
}
