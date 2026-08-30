import { getDb } from '../db/schema.js';
import { sendPlatformNotifications } from './platform-notifications.js';
import { executeEmailSend } from './email-send.js';
import { announceOnAgentChannel } from './agent-channel-announce.js';
import { insertChatTurn } from './chat-history.js';
import { resolvePolicyEtaHours } from './work-assignment-policy.js';

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
  const due = Date.parse(task.due_at);
  if (!Number.isFinite(due)) return 'none';
  const created = Date.parse(task.created_at || '') || (due - normalizeEtaHours(task.eta_hours) * 3600000);
  const duration = Math.max(1, due - created);
  const remaining = due - nowMs;
  if (remaining <= 0) return 'red';
  if (remaining <= Math.max(3600000, duration * 0.25)) return 'amber';
  return 'green';
}

export function withSlaState(task) {
  return { ...task, sla_state: slaState(task) };
}

async function notifyCeo(task, message) {
  const owner = String(task.owner_user_id || '');
  sendPlatformNotifications({ userIds: [owner], title: `Task SLA breached: ${task.title}`, body: message, linkUrl: `/kanban?task=${task.id}`, createdBy: 'system', source: 'kanban_sla_escalation', sourceKey: String(task.id) });
  const ceo = getDb().prepare("SELECT email FROM platform_users WHERE id = ? AND role = 'ceo'").get(owner);
  if (ceo?.email) {
    try { await executeEmailSend({ to: ceo.email, subject: `Flolah task SLA breached — #${task.id}`, body: message }); } catch (e) { console.warn('[kanban-sla] email escalation failed', e?.message || e); }
  }
  const coo = getDb().prepare(
    `SELECT a.id FROM user_agents ua JOIN agents a ON a.id=ua.agent_id
     WHERE ua.user_id=? AND ua.enabled=1 AND a.is_coo=1 ORDER BY a.id LIMIT 1`
  ).get(owner);
  if (coo?.id) {
    insertChatTurn({ agentId: coo.id, ownerUserId: owner, role: 'assistant', content: `[Task SLA escalation]\n${message}` });
    await announceOnAgentChannel({ ownerUserId: owner, agentId: coo.id, channel: 'whatsapp', text: message, idempotencyKey: `kanban-sla:${task.id}:breach` });
  }
}

export async function runKanbanSlaMonitor() {
  const rows = getDb().prepare("SELECT * FROM kanban_tasks WHERE status IN ('open','awaiting_confirmation','in_progress') AND due_at IS NOT NULL").all();
  let nudged = 0; let escalated = 0;
  for (const task of rows) {
    const state = slaState(task);
    const assignee = task.assigned_user_id || task.assigned_agent_id;
    if (state === 'amber' && !task.sla_nudged_at && assignee) {
      const userTarget = task.assigned_user_id || task.owner_user_id;
      sendPlatformNotifications({ userIds: [userTarget], title: `Deadline approaching: ${task.title}`, body: `Task #${task.id} is due ${task.due_at}. Record progress or a blocker in Kanban.`, linkUrl: `/kanban?task=${task.id}`, createdBy: 'system', source: 'kanban_sla_nudge', sourceKey: String(task.id) });
      if (task.assigned_agent_id) {
        insertChatTurn({
          agentId: task.assigned_agent_id,
          ownerUserId: task.owner_user_id,
          role: 'user',
          content: `[Task SLA nudge]\nTask #${task.id} “${task.title}” is approaching its deadline (${task.due_at}). Continue the assigned work and record a concrete outcome or blocker in Kanban.`,
        });
      }
      getDb().prepare("UPDATE kanban_tasks SET sla_nudged_at = datetime('now') WHERE id = ?").run(task.id); nudged += 1;
    }
    if (state === 'red' && !task.sla_escalated_at) {
      const msg = `Task #${task.id} “${task.title}” missed its ${task.eta_hours || '?'}h ETA. Assignee: ${assignee || 'unassigned'}. Review or reassign it in Kanban.`;
      await notifyCeo(task, msg);
      getDb().prepare("UPDATE kanban_tasks SET sla_escalated_at = datetime('now') WHERE id = ?").run(task.id); escalated += 1;
    }
  }
  return { ok: true, scanned: rows.length, nudged, escalated };
}
