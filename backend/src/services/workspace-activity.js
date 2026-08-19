/**
 * Recent AI activity for Operating Workspace / workspace boards.
 * Significant outcomes only: Kanban terminals, goal plans (agr-…), workflow runs.
 * Tool-spam and workflow step-shard Kanban cards are omitted.
 */
import { getDb } from '../db/schema.js';
import { listAgentsForUser } from './users.js';
import { kanbanOwnerSqlFilter } from './kanban-user-scope.js';

const KANBAN_TERMINAL = new Set(['completed', 'failed', 'done']);
const WORKFLOW_TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'canceled']);
const GOAL_TERMINAL = new Set(['completed', 'failed']);

function agentNameMap(ownerUserId) {
  const map = new Map();
  try {
    for (const a of listAgentsForUser(ownerUserId) || []) {
      if (a?.id) map.set(String(a.id), String(a.name || a.id));
    }
  } catch {
    /* optional */
  }
  return map;
}

function resolveAgentLabel(source, agentId, names) {
  const id = String(agentId || '').trim();
  if (id && names.has(id)) return { agent_id: id, agent_name: names.get(id) };
  const src = String(source || '').trim();
  const m = src.match(/--([a-z0-9_-]+)$/i) || src.match(/^([a-z0-9_-]+)$/i);
  const cand = (m && m[1]) || '';
  if (cand && names.has(cand)) return { agent_id: cand, agent_name: names.get(cand) };
  for (const [aid, nm] of names) {
    if (cand && (cand.includes(aid) || aid.includes(cand))) {
      return { agent_id: aid, agent_name: nm };
    }
  }
  return { agent_id: id || cand || src || null, agent_name: null };
}

function isWorkflowShardKanbanTitle(title) {
  const t = String(title || '');
  return /\s·\s/.test(t) || /\s•\s/.test(t);
}

/**
 * @param {string} ownerUserId
 * @param {{ limit?: number, names?: Map<string,string> }} [opts]
 * @returns {Array<object>}
 */
export function buildWorkspaceRecentActivity(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const limit = Math.min(Math.max(Number(opts.limit) || 30, 5), 60);
  const names = opts.names instanceof Map ? opts.names : agentNameMap(owner);
  const platformDb = getDb();
  const ownerFilter = kanbanOwnerSqlFilter({ id: ownerUserId, role: 'ceo' });
  const rows = [];

  // --- Kanban terminal outcomes ---
  try {
    const kanban = platformDb
      .prepare(
        `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.updated_at, k.created_at
         FROM kanban_tasks k
         WHERE ${ownerFilter.clause}
           AND lower(COALESCE(k.status, '')) IN ('completed', 'failed', 'done')
         ORDER BY COALESCE(k.updated_at, k.created_at) DESC
         LIMIT 60`
      )
      .all(...ownerFilter.params);

    for (const t of kanban) {
      const st = String(t.status || '').toLowerCase();
      if (!KANBAN_TERMINAL.has(st)) continue;
      const hasAgent = Boolean(String(t.assigned_agent_id || '').trim());
      if (!hasAgent && isWorkflowShardKanbanTitle(t.title)) continue;
      if (!hasAgent && st !== 'failed') continue;

      const label = resolveAgentLabel(null, t.assigned_agent_id, names);
      const verb = st === 'failed' ? 'failed' : 'completed';
      const who = label.agent_name || label.agent_id || 'Agent';
      const title = String(t.title || 'Task').trim().slice(0, 140);
      rows.push({
        id: `kanban-${t.id}`,
        kind: 'kanban',
        agent_id: label.agent_id,
        agent_name: label.agent_name || (hasAgent ? null : 'Workflow'),
        task_id: t.id,
        status: st === 'done' ? 'completed' : st,
        snippet: `${who} ${verb}: ${title}`,
        text: `${who} ${verb}: ${title}`,
        href: `/kanban?task=${t.id}`,
        created_at: t.updated_at || t.created_at,
        sort_at: t.updated_at || t.created_at,
      });
    }
  } catch (e) {
    console.warn('[workspace-activity] kanban', e?.message || e);
  }

  // --- Durable goal plans (agr-…) ---
  try {
    const goals = platformDb
      .prepare(
        `SELECT id, title, prompt, status, agent_id, error_message,
                completed_at, updated_at, created_at
         FROM agent_goal_runs
         WHERE owner_user_id = ?
           AND lower(COALESCE(status,'')) IN ('completed', 'failed')
         ORDER BY COALESCE(completed_at, updated_at, created_at) DESC
         LIMIT 40`
      )
      .all(owner);

    for (const g of goals) {
      const st = String(g.status || '').toLowerCase();
      if (!GOAL_TERMINAL.has(st)) continue;
      const label = resolveAgentLabel(null, g.agent_id, names);
      const who = label.agent_name || label.agent_id || 'COO';
      const title =
        String(g.title || '').trim() ||
        String(g.prompt || '').trim().slice(0, 80) ||
        g.id;
      let snippet = `Goal plan ${g.id}: ${who} ${st} — ${title}`.slice(0, 220);
      if (st === 'failed' && g.error_message) {
        snippet += ` (${String(g.error_message).slice(0, 80)})`;
      }
      rows.push({
        id: `goal-${g.id}`,
        kind: 'goal',
        agent_id: label.agent_id,
        agent_name: label.agent_name || who,
        goal_run_id: g.id,
        status: st,
        snippet,
        text: snippet,
        href: `/goal-plans/${encodeURIComponent(g.id)}`,
        created_at: g.completed_at || g.updated_at || g.created_at,
        sort_at: g.completed_at || g.updated_at || g.created_at,
      });
    }
  } catch (e) {
    console.warn('[workspace-activity] goals', e?.message || e);
  }

  // --- Workflow brain / runner outcomes ---
  try {
    const runs = platformDb
      .prepare(
        `SELECT r.id, r.run_number, r.status, r.trigger, r.error_message,
                r.started_at, r.completed_at, r.updated_at, r.definition_id,
                d.name AS definition_name
         FROM agent_workflow_runs r
         LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
         WHERE r.owner_user_id = ?
           AND lower(COALESCE(r.status, '')) IN (
             'completed', 'failed', 'error', 'cancelled', 'canceled'
           )
         ORDER BY COALESCE(r.completed_at, r.updated_at, r.started_at) DESC
         LIMIT 40`
      )
      .all(owner);

    for (const r of runs) {
      const st = String(r.status || '').toLowerCase();
      if (!WORKFLOW_TERMINAL.has(st)) continue;
      const name = String(r.definition_name || r.definition_id || 'Workflow').trim().slice(0, 100);
      const runNo = r.run_number != null ? `#${r.run_number}` : `#${r.id}`;
      const trig = r.trigger ? String(r.trigger) : 'run';
      let snippet = `Workflow ${name} ${runNo} ${st} (${trig})`;
      if ((st === 'failed' || st === 'error') && r.error_message) {
        snippet += `: ${String(r.error_message).slice(0, 100)}`;
      }
      rows.push({
        id: `wf-${r.id}`,
        kind: 'workflow',
        agent_id: null,
        agent_name: 'Workflow brain',
        definition_id: r.definition_id,
        run_id: r.id,
        status: st,
        snippet,
        text: snippet,
        href: `/workflows/runs/${r.id}`,
        created_at: r.completed_at || r.updated_at || r.started_at,
        sort_at: r.completed_at || r.updated_at || r.started_at,
      });
    }
  } catch (e) {
    console.warn('[workspace-activity] workflows', e?.message || e);
  }

  // Light feedback (ratings)
  try {
    const feedback = platformDb
      .prepare(
        `SELECT id, agent_id, source, rating, created_at,
                substr(COALESCE(message_content, ''), 1, 120) AS snippet
         FROM agent_response_feedback
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT 10`
      )
      .all(owner);
    for (const f of feedback) {
      const label = resolveAgentLabel(f.source, f.agent_id, names);
      const snip = f.snippet || 'Rated response';
      rows.push({
        id: `fb-${f.id}`,
        kind: 'feedback',
        agent_id: label.agent_id,
        agent_name: label.agent_name,
        source: f.source || 'feedback',
        rating: f.rating ?? null,
        snippet: snip,
        text: snip,
        created_at: f.created_at,
        sort_at: f.created_at,
      });
    }
  } catch (e) {
    console.warn('[workspace-activity] feedback', e?.message || e);
  }

  rows.sort((a, b) => String(b.sort_at || '').localeCompare(String(a.sort_at || '')));
  return rows.slice(0, limit).map(({ sort_at, ...rest }) => rest);
}
