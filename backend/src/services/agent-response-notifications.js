import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import { resolveCeoDataUserId } from './job-applicant-ceo.js';

function db() {
  return getDb();
}

function promptBelongsToCeo(prompt, authUserId) {
  const text = String(prompt || '');
  if (!text.includes('ceo_user_id')) return true;
  const dataUserId = resolveCeoDataUserId(authUserId);
  const ids = [...new Set([authUserId, dataUserId].filter(Boolean))];
  return ids.some(
    (id) => text.includes(`ceo_user_id: ${id}`) || text.includes(`ceo_user_id:${id}`)
  );
}

function isJobPipelineRow(row) {
  return row.standup_source === 'job_pipeline' || String(row.prompt || '').includes('[job_pipeline:');
}

const AGENT_FEED_KIND = 'agent_delegation';

function agentStandupDismissKey(toAgentId, standupId) {
  const agent = String(toAgentId || '').trim();
  const standup = String(standupId || '').trim();
  if (!agent || !standup) return null;
  return `standup:${standup}:agent:${agent}`;
}

function dismissedAgentKeys(userId) {
  return new Set(
    db()
      .prepare(
        `SELECT feed_id FROM user_feed_dismissals
         WHERE user_id = ? AND feed_kind = ?`
      )
      .all(userId, AGENT_FEED_KIND)
      .map((r) => String(r.feed_id))
  );
}

function isAgentTaskDismissed(row, dismissed) {
  const taskId = String(row.id);
  if (dismissed.has(taskId)) return true;
  const composite = agentStandupDismissKey(row.to_agent_id, row.standup_id);
  return composite ? dismissed.has(composite) : false;
}

export function dismissAgentResponseNotifications(userId, ids = [], rows = []) {
  const uid = String(userId || '').trim();
  if (!uid) return { dismissed: 0 };
  const list = [...new Set((ids || []).map((id) => String(id).trim()).filter(Boolean))];
  const feedIds = new Set(list);
  const rowById = new Map((rows || []).map((row) => [String(row.id), row]));

  for (const id of list) {
    if (rowById.has(id)) continue;
    const row = db()
      .prepare(`SELECT id, to_agent_id, standup_id FROM agent_delegation_tasks WHERE id = ?`)
      .get(Number(id));
    if (row) rowById.set(String(row.id), row);
  }

  for (const row of rowById.values()) {
    if (!row?.id) continue;
    feedIds.add(String(row.id));
    const composite = agentStandupDismissKey(row.to_agent_id, row.standup_id);
    if (composite) feedIds.add(composite);
  }
  if (!feedIds.size) return { dismissed: 0 };
  const ins = db().prepare(
    `INSERT OR IGNORE INTO user_feed_dismissals (user_id, feed_kind, feed_id) VALUES (?, ?, ?)`
  );
  let dismissed = 0;
  for (const feedId of feedIds) {
    const r = ins.run(uid, AGENT_FEED_KIND, feedId);
    if (r.changes) dismissed += 1;
  }
  return { dismissed };
}

export function dismissAllAgentResponseNotifications(authUser) {
  if (!authUser?.id || authUser.role === 'admin') return { dismissed: 0 };
  const visible = listAgentResponseNotificationsForUser(authUser, { limit: 50, includeDismissed: true });
  return dismissAgentResponseNotifications(
    authUser.id,
    visible.map((n) => n.id),
    visible.map((n) => ({ id: n.id, to_agent_id: n.to_agent_id, standup_id: n.standup_id }))
  );
}

export function listAgentResponseNotificationsForUser(authUser, { limit = 20, includeDismissed = false } = {}) {
  if (!authUser?.id) return [];
  if (authUser.role === 'admin') return [];

  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const agents = listAgentsForUser(authUser.id);
  const agentIds = agents.map((a) => a.id);
  if (!agentIds.length) return [];

  const placeholders = agentIds.map(() => '?').join(',');
  const rows = db()
    .prepare(
      `SELECT t.id, t.standup_id, t.to_agent_id, t.prompt, t.response_content, t.completed_at, t.request_id,
              s.scheduled_at, s.title, s.source AS standup_source,
              a.name AS agent_name,
              k.id AS kanban_task_id
       FROM agent_delegation_tasks t
       JOIN standups s ON s.id = t.standup_id
       LEFT JOIN agents a ON a.id = t.to_agent_id
       LEFT JOIN kanban_tasks k ON k.agent_delegation_task_id = t.id
       WHERE t.status = 'completed'
         AND t.response_content IS NOT NULL
         AND t.response_content != ''
         -- Goal-step delegations report through their originating orchestrator when the
         -- whole goal terminates. Surfacing every internal attempt here creates duplicate,
         -- recurring CEO notifications and breaks that ownership contract.
         AND t.prompt NOT LIKE '%[goal_run_id:%'
         AND t.to_agent_id IN (${placeholders})
         AND s.owner_user_id = ?
         AND datetime(t.completed_at) >= datetime('now', '-3 days')
       ORDER BY t.completed_at DESC
       LIMIT ?`
    )
    .all(...agentIds, authUser.id, cap * 4);

  const dismissed = includeDismissed ? null : dismissedAgentKeys(authUser.id);

  return rows
    .filter((r) => !isJobPipelineRow(r) || promptBelongsToCeo(r.prompt, authUser.id))
    .filter((r) => includeDismissed || !isAgentTaskDismissed(r, dismissed))
    .slice(0, cap)
    .map((r) => ({
      id: r.id,
      kind: 'agent',
      standup_id: r.standup_id,
      to_agent_id: r.to_agent_id,
      agent_name: r.agent_name || r.to_agent_id,
      completed_at: r.completed_at,
      scheduled_at: r.scheduled_at,
      standup_title: r.title,
      standup_source: r.standup_source,
      kanban_task_id: r.kanban_task_id,
      is_job_pipeline: isJobPipelineRow(r),
      prompt_snippet: (r.prompt || '').trim().slice(0, 120),
      response_snippet: (r.response_content || '').trim().slice(0, 150),
      // Full text for UI hover tooltip (capped so payloads stay reasonable)
      response_full: (r.response_content || '').trim().slice(0, 4000),
    }));
}
