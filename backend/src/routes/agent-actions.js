import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listAgentsForUser } from '../services/users.js';

const router = Router();
const ACTIVE = new Set(['pending', 'queued', 'processing', 'running', 'in_progress', 'awaiting_ceo', 'awaiting_confirmation']);

function db() {
  return getDb();
}

function clip(value, n = 240) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function iso(value) {
  if (!value) return null;
  const s = String(value);
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
}

function owner(req) {
  return resolveAuthenticatedCeoUserId(req, req.query || {});
}

function liveSnapshot(ownerUserId) {
  const agents = listAgentsForUser(ownerUserId).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role || '',
    department: a.department || '',
    is_orchestrator: !!a.is_orchestrator || !!a.is_coo,
    state: 'idle',
    current: [],
    queued: [],
    blocked: [],
  }));
  const byId = new Map(agents.map((a) => [String(a.id).toLowerCase(), a]));
  const ensure = (id) => byId.get(String(id || '').toLowerCase());

  const delegations = db().prepare(
    `SELECT id, to_agent_id AS agent_id, status, prompt AS title, created_at, completed_at, error_message
     FROM agent_delegation_tasks
     WHERE owner_user_id = ? AND status IN ('pending','processing') ORDER BY created_at DESC LIMIT 250`
  ).all(ownerUserId);
  for (const row of delegations) {
    const a = ensure(row.agent_id);
    if (!a) continue;
    const item = { kind: 'delegation', id: row.id, title: clip(row.title), status: row.status, at: iso(row.created_at) };
    (row.status === 'pending' ? a.queued : a.current).push(item);
  }

  const goals = db().prepare(
    `SELECT g.id, g.agent_id, g.title, g.prompt, g.status, g.updated_at,
            s.label AS step_label, s.status AS step_status
     FROM agent_goal_runs g
     LEFT JOIN agent_goal_steps s ON s.goal_run_id = g.id AND s.step_index = g.current_step_index
     WHERE g.owner_user_id = ? AND g.status IN ('pending','running')
     ORDER BY g.updated_at DESC LIMIT 100`
  ).all(ownerUserId);
  for (const row of goals) {
    const a = ensure(row.agent_id);
    if (!a) continue;
    const item = {
      kind: 'goal', id: row.id, title: clip(row.step_label || row.title || row.prompt),
      status: row.step_status || row.status, at: iso(row.updated_at), link: `/goal-plans/${encodeURIComponent(row.id)}`,
    };
    (row.status === 'pending' ? a.queued : a.current).push(item);
  }

  const cards = db().prepare(
    `SELECT id, assigned_agent_id AS agent_id, title, status, updated_at
     FROM kanban_tasks
     WHERE owner_user_id = ? AND status IN ('open','in_progress','awaiting_confirmation')
     ORDER BY updated_at DESC LIMIT 250`
  ).all(ownerUserId);
  for (const row of cards) {
    const a = ensure(row.agent_id);
    if (!a) continue;
    const item = { kind: 'kanban', id: row.id, title: clip(row.title), status: row.status, at: iso(row.updated_at), link: '/kanban' };
    if (row.status === 'awaiting_confirmation') a.blocked.push(item);
    else if (row.status === 'open') a.queued.push(item);
    else a.current.push(item);
  }

  for (const a of agents) {
    if (a.blocked.length) a.state = 'blocked';
    else if (a.current.length) a.state = 'working';
    else if (a.queued.length) a.state = 'queued';
  }
  const workflowApprovals = db().prepare(
    `SELECT r.id, d.name, r.status, r.updated_at
     FROM agent_workflow_runs r LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
     WHERE r.owner_user_id = ? AND r.status = 'awaiting_ceo' ORDER BY r.updated_at DESC LIMIT 50`
  ).all(ownerUserId).map((r) => ({
    kind: 'workflow', id: r.id, title: r.name || `Workflow run ${r.id}`, status: r.status,
    at: iso(r.updated_at), link: `/workflows/runs/${r.id}`,
  }));
  const policyBlocks = db().prepare(
    `SELECT id, tool_name, source, status, response_payload, created_at
     FROM content_tool_logs
     WHERE owner_user_id = ? AND lower(status) IN ('blocked','denied','error')
       AND (lower(COALESCE(response_payload,'')) LIKE '%approval%'
         OR lower(COALESCE(response_payload,'')) LIKE '%prohibited%'
         OR lower(COALESCE(response_payload,'')) LIKE '%policy%')
       AND datetime(created_at) >= datetime('now', '-7 days')
     ORDER BY created_at DESC LIMIT 50`
  ).all(ownerUserId).map((r) => ({
    kind: 'action policy', id: r.id, title: `${r.tool_name}: ${clip(r.response_payload, 180)}`,
    status: /approval/i.test(String(r.response_payload || '')) ? 'awaiting_approval' : 'prohibited',
    at: iso(r.created_at), source: r.source || '', link: '/policies',
  }));
  const attention = [...workflowApprovals, ...policyBlocks];
  return {
    generated_at: new Date().toISOString(),
    summary: {
      working: agents.filter((a) => a.state === 'working').length,
      queued: agents.reduce((n, a) => n + a.queued.length, 0),
      blocked: agents.reduce((n, a) => n + a.blocked.length, 0) + attention.length,
      idle: agents.filter((a) => a.state === 'idle').length,
    },
    approvals: attention,
    agents,
  };
}

function historyRows(ownerUserId, limit, offset) {
  const fetchN = Math.min(1000, limit + offset + 100);
  const rows = [];
  for (const r of db().prepare(
    `SELECT id, to_agent_id AS agent_id, status, prompt AS title, response_content AS output,
            error_message, created_at, completed_at
     FROM agent_delegation_tasks WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(ownerUserId, fetchN)) {
    rows.push({ kind: 'delegation', ...r, title: clip(r.title), output: clip(r.output), at: iso(r.completed_at || r.created_at) });
  }
  for (const r of db().prepare(
    `SELECT id, tool_name AS title, source AS agent_id, status, response_payload AS output,
            created_at FROM content_tool_logs
     WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(ownerUserId, fetchN)) {
    rows.push({ kind: 'tool', ...r, output: clip(r.output), at: iso(r.created_at) });
  }
  for (const r of db().prepare(
    `SELECT id, agent_id, status, COALESCE(title, prompt) AS title, error_message,
            created_at, completed_at FROM agent_goal_runs
     WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(ownerUserId, fetchN)) {
    rows.push({ kind: 'goal', ...r, title: clip(r.title), at: iso(r.completed_at || r.created_at), link: `/goal-plans/${encodeURIComponent(r.id)}` });
  }
  for (const r of db().prepare(
    `SELECT id, assigned_agent_id AS agent_id, status, title, description AS output,
            created_at, updated_at FROM kanban_tasks
     WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT ?`
  ).all(ownerUserId, fetchN)) {
    rows.push({ kind: 'kanban', ...r, output: clip(r.output), at: iso(r.updated_at || r.created_at), link: '/kanban' });
  }
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const sliced = rows.slice(offset, offset + limit);
  return { items: sliced, total: rows.length, limit, offset, has_more: offset + sliced.length < rows.length };
}

router.get('/live', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    res.json(liveSnapshot(owner(req)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/history', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const limit = Math.max(10, Math.min(100, Number(req.query.limit) || 30));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json(historyRows(owner(req), limit, offset));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
