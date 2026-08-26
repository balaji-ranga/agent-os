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

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return fallback; }
}

function toolLabel(toolName) {
  return String(toolName || '')
    .replace(/^(mcp_|browse_)/i, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function iso(value) {
  if (!value) return null;
  const s = String(value);
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
}

function owner(req) {
  return resolveAuthenticatedCeoUserId(req, req.query || {});
}

export function liveSnapshot(ownerUserId) {
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
    tools: [],
  }));
  const byId = new Map(agents.map((a) => [String(a.id).toLowerCase(), a]));
  const ensure = (id) => byId.get(String(id || '').toLowerCase());
  const goalById = new Map();
  const goalToolOwners = new Map();

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
            s.label AS step_label, s.status AS step_status, s.spec_json AS step_spec_json
     FROM agent_goal_runs g
     LEFT JOIN agent_goal_steps s ON s.goal_run_id = g.id AND s.step_index = g.current_step_index
     WHERE g.owner_user_id = ? AND g.status IN ('pending','running')
     ORDER BY g.updated_at DESC LIMIT 100`
  ).all(ownerUserId);
  for (const row of goals) {
    const a = ensure(row.agent_id);
    if (!a) continue;
    goalById.set(String(row.id), a);
    const item = {
      kind: 'goal', id: row.id, title: clip(row.step_label || row.title || row.prompt),
      status: row.step_status || row.status, at: iso(row.updated_at), link: `/goal-plans/${encodeURIComponent(row.id)}`,
    };
    (row.status === 'pending' ? a.queued : a.current).push(item);
    const spec = parseJson(row.step_spec_json);
    const toolName = String(spec.tool_name || spec.toolName || '').trim();
    if (toolName) {
      const key = toolName.toLowerCase();
      if (!goalToolOwners.has(key)) goalToolOwners.set(key, []);
      goalToolOwners.get(key).push(a);
      a.tools.push({
        name: toolName,
        label: toolLabel(toolName),
        status: row.status === 'pending' ? 'queued' : (row.step_status || 'running'),
        at: iso(row.updated_at),
        source: 'goal',
      });
    }
  }

  // Tool logs are terminal records, but calls from the latest polling window still provide
  // the best truthful connector signal for direct/agent-chat invocations outside goal steps.
  const recentTools = db().prepare(
    `SELECT id, tool_name, source, request_payload, response_payload, trace_id, status, created_at
     FROM content_tool_logs
     WHERE owner_user_id = ? AND datetime(created_at) >= datetime('now', '-2 minutes')
     ORDER BY created_at DESC LIMIT 100`
  ).all(ownerUserId);
  const toolEvents = [];
  for (const row of recentTools) {
    const source = String(row.source || '').toLowerCase();
    const request = parseJson(row.request_payload);
    const response = parseJson(row.response_payload);
    const context = { ...response, ...request, ...(request.context || {}), ...(response.context || {}) };
    const explicitAgentId = context.agent_id || context.agentId || context.owner_agent_id || context.source_agent_id || context.from_agent_id;
    const goalId = context.goal_run_id || context.goalRunId;
    const sourceMatch = agents.find((candidate) => {
      const id = String(candidate.id || '').toLowerCase();
      const name = String(candidate.name || '').toLowerCase();
      return source === id || source === name || (id && source.includes(id));
    });
    const matchingOwners = goalToolOwners.get(String(row.tool_name || '').toLowerCase()) || [];
    const busyAgents = agents.filter((candidate) => candidate.current.length > 0);
    const a = ensure(explicitAgentId) || goalById.get(String(goalId || '')) || sourceMatch
      || (matchingOwners.length === 1 ? matchingOwners[0] : null)
      || (busyAgents.length === 1 ? busyAgents[0] : null);
    if (a && !a.tools.some((tool) => tool.name === row.tool_name && tool.source === 'tool_log')) {
      a.tools.push({
        id: row.id,
        name: row.tool_name,
        label: toolLabel(row.tool_name),
        status: row.status,
        at: iso(row.created_at),
        source: 'tool_log',
      });
    }
    toolEvents.push({
      kind: 'tool', id: row.id, title: `${toolLabel(row.tool_name)} called`, status: row.status,
      at: iso(row.created_at), agent: a?.name || sourceMatch?.name || 'Platform', agent_id: a?.id || null,
      lane: ['blocked', 'denied', 'error', 'failed'].includes(String(row.status || '').toLowerCase()) ? 'blocked' : 'working',
    });
  }

  const cards = db().prepare(
    `SELECT k.id, k.assigned_agent_id AS agent_id, k.title, k.status, k.updated_at
     FROM kanban_tasks k
     LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
     WHERE k.owner_user_id = ? AND k.status IN ('open','in_progress','awaiting_confirmation')
       AND NOT (
         k.agent_delegation_task_id IS NOT NULL
         AND lower(COALESCE(d.status,'')) IN ('completed','failed','cancelled')
       )
     ORDER BY k.updated_at DESC LIMIT 250`
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
    else if (a.current.length || a.tools.length) a.state = 'working';
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
  const workEvents = agents.flatMap((agent) => [
    ...agent.blocked.map((item) => ({ ...item, agent: agent.name, agent_id: agent.id, lane: 'blocked' })),
    ...agent.current.map((item) => ({ ...item, agent: agent.name, agent_id: agent.id, lane: 'working' })),
    ...agent.queued.map((item) => ({ ...item, agent: agent.name, agent_id: agent.id, lane: 'queued' })),
  ]);
  return {
    generated_at: new Date().toISOString(),
    summary: {
      working: agents.filter((a) => a.state === 'working').length,
      queued: agents.reduce((n, a) => n + a.queued.length, 0),
      blocked: agents.reduce((n, a) => n + a.blocked.length, 0) + attention.length,
      idle: agents.filter((a) => a.state === 'idle').length,
    },
    approvals: attention,
    events: [...toolEvents, ...workEvents].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 100),
    agents,
    connectors: agents.flatMap((agent) => agent.tools.map((tool) => ({ ...tool, agent_id: agent.id, agent_name: agent.name }))),
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
