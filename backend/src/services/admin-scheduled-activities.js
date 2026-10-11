import { getDb } from '../db/schema.js';
import { pauseScheduledGoal, resumeScheduledGoal, deleteScheduledGoal } from './scheduled-goals.js';
import { getDefinition, setPaused, updateTriggers } from './agent-workflow-store.js';
import {
  ensureEventProductivitySchema,
  updateEventSubscription,
  deleteEventSubscription,
} from './event-productivity.js';

const KINDS = new Set(['standup', 'scheduled_goal', 'workflow_schedule', 'event_listener']);
const ACTIONS = new Set(['pause', 'resume', 'remove']);

function db() { return getDb(); }

function userFields(row) {
  return {
    user_id: row.owner_user_id,
    user_name: row.user_name || row.owner_user_id,
    user_email: row.user_email || '',
    user_enabled: !!row.user_enabled,
  };
}

export function listAdminScheduledActivities({ userId = '', kind = '', status = '', q = '' } = {}) {
  ensureEventProductivitySchema();
  const standups = db().prepare(`
    SELECT x.*, u.name AS user_name, u.email AS user_email, u.enabled AS user_enabled
      FROM standups x
      LEFT JOIN platform_users u ON u.id = x.owner_user_id
     WHERE COALESCE(x.source, 'manual') = 'manual'
       AND x.scheduled_at IS NOT NULL
       AND x.status IN ('scheduled','active','paused')
     ORDER BY datetime(x.created_at) DESC
  `).all().map((row) => ({
    kind: 'standup', job_id: String(row.id), name: row.title || 'Daily standup',
    status: row.status === 'paused' ? 'paused' : 'active', schedule: row.scheduled_at,
    source: row.source || 'manual', updated_at: row.created_at, ...userFields(row),
  }));
  const goals = db().prepare(`
    SELECT x.*, u.name AS user_name, u.email AS user_email, u.enabled AS user_enabled,
           a.name AS agent_name
      FROM scheduled_goals x
      LEFT JOIN platform_users u ON u.id = x.owner_user_id
      LEFT JOIN agents a ON a.id = x.agent_id
     ORDER BY datetime(x.updated_at) DESC
  `).all().map((row) => ({
    kind: 'scheduled_goal', job_id: row.id, name: row.title,
    status: row.status, schedule: [row.cadence, row.weekday != null ? `weekday ${row.weekday}` : '', row.time_local, row.timezone].filter(Boolean).join(' · '),
    agent_id: row.agent_id, agent_name: row.agent_name || row.agent_id,
    source: row.source || 'ceo', updated_at: row.updated_at, ...userFields(row),
  }));
  const workflows = db().prepare(`
    SELECT x.*, u.name AS user_name, u.email AS user_email, u.enabled AS user_enabled
      FROM agent_workflow_definitions x
      LEFT JOIN platform_users u ON u.id = x.owner_user_id
     WHERE x.trigger_modes LIKE '%schedule%' OR COALESCE(x.schedule_cron, '') != ''
     ORDER BY datetime(x.updated_at) DESC
  `).all().map((row) => ({
    kind: 'workflow_schedule', job_id: row.id, name: row.name,
    status: row.paused ? 'paused' : row.status === 'published' ? 'active' : 'draft',
    schedule: row.schedule_cron || '', source: 'workflow', updated_at: row.updated_at,
    ...userFields(row),
  }));
  const listeners = db().prepare(`
    SELECT x.*, u.name AS user_name, u.email AS user_email, u.enabled AS user_enabled
      FROM productivity_event_subscriptions x
      LEFT JOIN platform_users u ON u.id = x.owner_user_id
     ORDER BY datetime(x.updated_at) DESC
  `).all().map((row) => ({
    kind: 'event_listener', job_id: row.id, name: row.name,
    status: row.enabled && row.listener_enabled ? 'active' : 'paused',
    schedule: `Every ${Number(row.listener_poll_seconds || 300)} seconds`,
    source: `${row.provider} · ${row.event_type}`,
    agent_name: row.target_type === 'goal' ? row.target_id : row.target_type === 'workflow' ? `Workflow ${row.target_id}` : 'Inbox only',
    updated_at: row.updated_at, ...userFields(row),
  }));

  const needle = String(q || '').trim().toLowerCase();
  const items = [...standups, ...goals, ...workflows, ...listeners].filter((item) => {
    if (userId && item.user_id !== userId) return false;
    if (kind && item.kind !== kind) return false;
    if (status && item.status !== status) return false;
    if (needle && ![item.name, item.job_id, item.user_name, item.user_email, item.agent_name].some((value) => String(value || '').toLowerCase().includes(needle))) return false;
    return true;
  });
  return {
    items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.status === 'active').length,
      paused: items.filter((item) => item.status === 'paused').length,
      standups: items.filter((item) => item.kind === 'standup').length,
      scheduled_goals: items.filter((item) => item.kind === 'scheduled_goal').length,
      workflow_schedules: items.filter((item) => item.kind === 'workflow_schedule').length,
      event_listeners: items.filter((item) => item.kind === 'event_listener').length,
    },
  };
}

function deleteStandup(id, ownerUserId) {
  const row = db().prepare('SELECT id FROM standups WHERE id=? AND owner_user_id=?').get(id, ownerUserId);
  if (!row) throw Object.assign(new Error('Standup schedule not found'), { status: 404 });
  db().prepare('UPDATE kanban_tasks SET standup_id=NULL, agent_delegation_task_id=NULL WHERE standup_id=? OR agent_delegation_task_id IN (SELECT id FROM agent_delegation_tasks WHERE standup_id=?)').run(id, id);
  const requestIds = db().prepare('SELECT DISTINCT request_id FROM agent_delegation_tasks WHERE standup_id=?').all(id).map((item) => item.request_id).filter(Boolean);
  const removeCallback = db().prepare('DELETE FROM delegation_callbacks WHERE request_id=?');
  requestIds.forEach((requestId) => removeCallback.run(requestId));
  db().prepare('DELETE FROM agent_delegation_tasks WHERE standup_id=?').run(id);
  db().prepare('DELETE FROM standup_messages WHERE standup_id=?').run(id);
  db().prepare('DELETE FROM standup_responses WHERE standup_id=?').run(id);
  db().prepare('DELETE FROM standups WHERE id=? AND owner_user_id=?').run(id, ownerUserId);
}

function applyOne(item, action, actor) {
  if (item.kind === 'standup') {
    if (action === 'remove') deleteStandup(Number(item.job_id), item.user_id);
    else db().prepare('UPDATE standups SET status=? WHERE id=? AND owner_user_id=?').run(action === 'pause' ? 'paused' : 'active', Number(item.job_id), item.user_id);
  } else if (item.kind === 'scheduled_goal') {
    if (action === 'remove') deleteScheduledGoal(item.user_id, item.job_id);
    else if (action === 'pause') pauseScheduledGoal(item.user_id, item.job_id);
    else resumeScheduledGoal(item.user_id, item.job_id);
  } else if (item.kind === 'workflow_schedule') {
    if (action === 'remove') {
      const definition = getDefinition(item.job_id, item.user_id);
      const modes = (definition?.trigger_modes || []).filter((mode) => mode !== 'schedule');
      updateTriggers(item.job_id, item.user_id, { trigger_modes: modes.length ? modes : ['manual'], schedule_cron: '' }, actor);
    } else {
      setPaused(item.job_id, item.user_id, action === 'pause', actor);
    }
  } else if (item.kind === 'event_listener') {
    if (action === 'remove') deleteEventSubscription(item.user_id, item.job_id);
    else updateEventSubscription(item.user_id, item.job_id, action === 'resume' ? { enabled: true, listener_enabled: true } : { listener_enabled: false });
  }
}

export function mutateAdminScheduledActivities(input = {}, actor = null) {
  const action = String(input.action || '').trim().toLowerCase();
  const kind = String(input.kind || '').trim();
  const userId = String(input.user_id || input.userId || '').trim();
  const jobId = String(input.job_id || input.jobId || '').trim();
  const allUsers = input.all_users === true || input.allUsers === true;
  if (!ACTIONS.has(action)) throw Object.assign(new Error('action must be pause, resume, or remove'), { status: 400 });
  if (kind && !KINDS.has(kind)) throw Object.assign(new Error('Unknown scheduled activity kind'), { status: 400 });
  if (!jobId && !userId && !allUsers) throw Object.assign(new Error('Choose a job, user, or all users'), { status: 400 });
  if (jobId && (!userId || !kind)) throw Object.assign(new Error('user_id and kind are required with job_id'), { status: 400 });
  if (action === 'remove' && !jobId) {
    const expected = allUsers ? 'REMOVE ALL SCHEDULED ACTIVITIES' : userId;
    if (String(input.confirm || '') !== expected) throw Object.assign(new Error(`Removal confirmation must equal ${expected}`), { status: 400 });
  }

  const snapshot = listAdminScheduledActivities({ userId, kind });
  const candidates = jobId ? snapshot.items.filter((item) => item.job_id === jobId) : snapshot.items;
  const selected = jobId
    ? candidates
    : candidates.filter((item) => action === 'remove' || (action === 'pause' ? item.status === 'active' : item.status === 'paused'));
  if (jobId && selected.length === 0) throw Object.assign(new Error('Scheduled activity not found'), { status: 404 });
  const results = [];
  for (const item of selected) {
    try {
      applyOne(item, action, actor);
      results.push({ kind: item.kind, job_id: item.job_id, user_id: item.user_id, ok: true });
    } catch (error) {
      results.push({ kind: item.kind, job_id: item.job_id, user_id: item.user_id, ok: false, error: error.message });
    }
  }
  console.info('[admin-scheduled-activities]', { action, count: results.length, actor: actor?.id, failures: results.filter((item) => !item.ok).length });
  return { action, matched: selected.length, succeeded: results.filter((item) => item.ok).length, failed: results.filter((item) => !item.ok).length, results };
}
