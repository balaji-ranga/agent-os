/**
 * Efficiency View → User View (human employees / CEO).
 * Metrics are Kanban task and approval outcomes — not token budgets.
 */
import { getDb } from '../db/schema.js';
import { getKanbanScopeIds } from './kanban-user-scope.js';
import { parseEfficiencyRange } from './efficiency.js';
import { monthPeriod } from './token-usage.js';

function dayKeys(days) {
  const keys = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    d.setDate(d.getDate() - i);
    keys.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }
  return keys;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function listEfficiencyUsers(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const db = getDb();
  const ceo = db.prepare('SELECT id, name, email, role FROM platform_users WHERE id = ?').get(owner);
  const people = db
    .prepare(
      `SELECT id, name, email, department, role, enabled FROM platform_users
       WHERE owner_user_id = ? AND role = 'org_user' ORDER BY name`
    )
    .all(owner);
  const out = [];
  if (ceo) {
    out.push({
      user_id: ceo.id,
      name: ceo.name,
      email: ceo.email,
      department: '',
      kind: 'ceo',
      enabled: true,
    });
  }
  for (const p of people) {
    out.push({
      user_id: p.id,
      name: p.name,
      email: p.email,
      department: p.department || '',
      kind: 'org_user',
      enabled: !!p.enabled,
    });
  }
  return out;
}

export function getUsersEfficiencySummary(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const users = listEfficiencyUsers(owner);
  const db = getDb();
  const kanbanIds = getKanbanScopeIds(owner);
  const kph = kanbanIds.length ? kanbanIds.map(() => '?').join(',') : '?';
  const kanbanParams = kanbanIds.length ? kanbanIds : ['__none__'];
  const stats = db
    .prepare(
      `SELECT assigned_user_id AS user_id,
              COUNT(*) AS assigned,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph}) AND assigned_user_id IS NOT NULL AND assigned_user_id != ''
       GROUP BY assigned_user_id`
    )
    .all(...kanbanParams);
  const byUser = new Map(stats.map((s) => [String(s.user_id), s]));
  const enriched = users.map((u) => {
    const s = byUser.get(String(u.user_id)) || {};
    const assigned = Number(s.assigned) || 0;
    const completed = Number(s.completed) || 0;
    const failed = Number(s.failed) || 0;
    const terminal = completed + failed;
    return {
      ...u,
      assigned,
      completed,
      failed,
      completion_pct: terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : null,
      role_title: u.kind === 'ceo' ? 'CEO' : 'Employee',
    };
  });
  const assigned = enriched.reduce((a, u) => a + (u.assigned || 0), 0);
  const completed = enriched.reduce((a, u) => a + (u.completed || 0), 0);
  const failed = enriched.reduce((a, u) => a + (u.failed || 0), 0);
  const terminal = completed + failed;
  return {
    period: monthPeriod(),
    users: enriched,
    totals: {
      people: enriched.filter((u) => u.kind !== 'ceo').length,
      assigned,
      completed,
      failed,
      completion_pct: terminal > 0 ? Math.round((completed / terminal) * 1000) / 10 : null,
    },
  };
}

export function requireEfficiencyUser(ownerUserId, userId) {
  const list = listEfficiencyUsers(ownerUserId);
  const row = list.find((u) => u.user_id === String(userId));
  if (!row) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return row;
}

export function getUserEfficiency(ownerUserId, userId, { days = 30 } = {}) {
  const member = requireEfficiencyUser(ownerUserId, userId);
  const range = parseEfficiencyRange(days);
  const windowDays = range.days ?? 90;
  const keys = dayKeys(windowDays);
  const since = keys[0];
  const until = todayKey();
  const db = getDb();
  const kanbanIds = getKanbanScopeIds(ownerUserId);
  const kph = kanbanIds.map(() => '?').join(',');

  const byDay = new Map(keys.map((k) => [k, { date: k, tasks_completed: 0, tasks_failed: 0, awaiting: 0, assigned: 0 }]));
  const apply = (day, fn) => {
    const slot = byDay.get(String(day || '').slice(0, 10));
    if (slot) fn(slot);
  };

  const assignedRows = db
    .prepare(
      `SELECT date(updated_at, 'localtime') AS day, status, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph}) AND assigned_user_id = ?
         AND date(updated_at, 'localtime') BETWEEN ? AND ?
       GROUP BY date(updated_at, 'localtime'), status`
    )
    .all(...kanbanIds, member.user_id, since, until);

  for (const r of assignedRows) {
    apply(r.day, (s) => {
      s.assigned += Number(r.c) || 0;
      if (r.status === 'completed') s.tasks_completed += Number(r.c) || 0;
      else if (r.status === 'failed') s.tasks_failed += Number(r.c) || 0;
      else if (r.status === 'awaiting_confirmation') s.awaiting += Number(r.c) || 0;
    });
  }

  const snapshot = db
    .prepare(
      `SELECT status, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph}) AND assigned_user_id = ?
       GROUP BY status`
    )
    .all(...kanbanIds, member.user_id);

  const byStatus = { open: 0, awaiting_confirmation: 0, in_progress: 0, completed: 0, failed: 0 };
  for (const r of snapshot) {
    if (byStatus[r.status] != null) byStatus[r.status] = Number(r.c) || 0;
  }

  const cycle = db
    .prepare(
      `SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS avg_hours, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph}) AND assigned_user_id = ?
         AND status = 'completed'
         AND date(updated_at, 'localtime') BETWEEN ? AND ?`
    )
    .get(...kanbanIds, member.user_id, since, until);

  const approvalCycle = db
    .prepare(
      `SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS avg_hours, COUNT(*) AS c
       FROM kanban_tasks
       WHERE owner_user_id IN (${kph}) AND assigned_user_id = ?
         AND status IN ('completed', 'failed')
         AND created_by IN ('agent_workflow_ceo', 'coo')
         AND date(updated_at, 'localtime') BETWEEN ? AND ?`
    )
    .get(...kanbanIds, member.user_id, since, until);

  const timeline = [...byDay.values()];
  const tasksCompleted = timeline.reduce((a, s) => a + s.tasks_completed, 0);
  const tasksFailed = timeline.reduce((a, s) => a + s.tasks_failed, 0);
  const terminal = tasksCompleted + tasksFailed;

  return {
    user_id: member.user_id,
    name: member.name,
    kind: member.kind,
    department: member.department,
    range: range.key,
    days: range.days,
    since,
    until,
    period: monthPeriod(),
    by_status: byStatus,
    totals: {
      tasks_completed: tasksCompleted,
      tasks_failed: tasksFailed,
      failure_rate: terminal > 0 ? Math.round((tasksFailed / terminal) * 1000) / 10 : null,
      awaiting_confirmation: byStatus.awaiting_confirmation,
      open: byStatus.open,
      in_progress: byStatus.in_progress,
      avg_cycle_hours: cycle?.avg_hours == null ? null : Math.round(Number(cycle.avg_hours) * 10) / 10,
      cycle_samples: Number(cycle?.c) || 0,
      avg_approval_hours:
        approvalCycle?.avg_hours == null ? null : Math.round(Number(approvalCycle.avg_hours) * 10) / 10,
      approval_samples: Number(approvalCycle?.c) || 0,
    },
    recent_tasks: db
      .prepare(
        `SELECT id, title, status, updated_at
         FROM kanban_tasks
         WHERE owner_user_id IN (${kph}) AND assigned_user_id = ?
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT 12`
      )
      .all(...kanbanIds, member.user_id),
    timeline,
  };
}
