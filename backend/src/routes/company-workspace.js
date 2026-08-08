/**
 * Daily operating Workspace snapshot (not Home executive view, not AI Employees).
 * Owner + agent entitlements only.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { listAgentsForUser } from '../services/users.js';
import { kanbanOwnerSqlFilter } from '../services/kanban-user-scope.js';
import { getBusinessProfile } from '../services/company-business-profile.js';
import { getTwentyStatusForOwner } from '../services/twenty-crm.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

const KANBAN_TERMINAL = new Set(['completed', 'failed', 'done']);
const WORKFLOW_TERMINAL = new Set(['completed', 'failed', 'error', 'cancelled', 'canceled']);

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

/**
 * Skip workflow-step shard cards ("Workflow Name · Node Label") — the
 * parent workflow run is already summarized separately.
 */
function isWorkflowShardKanbanTitle(title) {
  const t = String(title || '');
  return /\s·\s/.test(t) || /\s•\s/.test(t);
}

/**
 * Significant activity only: agent Kanban outcomes + workflow brain runs.
 * Tool call spam and workflow micro-tasks are intentionally omitted.
 */
function buildRecentActivity(ownerUserId, names, ceoDb, ownerFilter) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const platformDb = getDb();
  const rows = [];

  // --- Kanban terminal outcomes (agent-assigned, not step shards) ---
  try {
    const kanban = ceoDb
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
      // Prefer agent-owned specialty work. Skip silent workflow node cards.
      const hasAgent = Boolean(String(t.assigned_agent_id || '').trim());
      if (!hasAgent && isWorkflowShardKanbanTitle(t.title)) continue;
      if (!hasAgent && st === 'completed') continue; // still show unassigned failures?
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
        created_at: t.updated_at || t.created_at,
        sort_at: t.updated_at || t.created_at,
      });
    }
  } catch (e) {
    console.warn('[company-workspace] activity kanban', e?.message || e);
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
        created_at: r.completed_at || r.updated_at || r.started_at,
        sort_at: r.completed_at || r.updated_at || r.started_at,
      });
    }
  } catch (e) {
    console.warn('[company-workspace] activity workflows', e?.message || e);
  }

  // Light feedback (ratings) still useful, deprioritized vs outcomes
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
      rows.push({
        id: `fb-${f.id}`,
        kind: 'feedback',
        agent_id: label.agent_id,
        agent_name: label.agent_name,
        source: f.source || 'feedback',
        rating: f.rating ?? null,
        snippet: f.snippet || 'Rated response',
        created_at: f.created_at,
        sort_at: f.created_at,
      });
    }
  } catch (e) {
    console.warn('[company-workspace] activity feedback', e?.message || e);
  }

  rows.sort((a, b) => String(b.sort_at || '').localeCompare(String(a.sort_at || '')));
  return rows.slice(0, 30).map(({ sort_at, ...rest }) => rest);
}

router.get('/snapshot', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const ownerFilter = kanbanOwnerSqlFilter({ id: ownerUserId, role: 'ceo' });
    const ceoDb = getDbForCeo(ownerUserId);

    let tasks = [];
    let openCount = 0;
    try {
      tasks = ceoDb
        .prepare(
          `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date,
                  k.created_at, k.updated_at
           FROM kanban_tasks k
           WHERE ${ownerFilter.clause}
           ORDER BY COALESCE(k.updated_at, k.created_at) DESC
           LIMIT 40`
        )
        .all(...ownerFilter.params);

      openCount =
        ceoDb
          .prepare(
            `SELECT COUNT(*) AS n FROM kanban_tasks k
             WHERE ${ownerFilter.clause}
               AND lower(COALESCE(k.status,'')) NOT IN ('done','completed','cancelled','archived','failed')`
          )
          .get(...ownerFilter.params)?.n || 0;
    } catch (e) {
      console.warn('[company-workspace] tasks query', e?.message || e);
    }

    let agentRows = [];
    try {
      const agents = listAgentsForUser(ownerUserId) || [];
      agentRows = (Array.isArray(agents) ? agents : []).map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        department: a.department || '',
        is_coo: !!a.is_coo,
      }));
    } catch (e) {
      console.warn('[company-workspace] agents list', e?.message || e);
    }

    const names = agentNameMap(ownerUserId);
    const activity = buildRecentActivity(ownerUserId, names, ceoDb, ownerFilter);

    const business = getBusinessProfile(ownerUserId);
    const twenty = getTwentyStatusForOwner(ownerUserId);

    res.json({
      owner_user_id: ownerUserId,
      metrics: {
        tasks_open: openCount,
        tasks_listed: tasks.length,
        agents_active: agentRows.length,
        crm_enabled: business.crm_enabled,
        erp_enabled: business.erp_enabled,
      },
      tasks,
      agents: agentRows,
      activity,
      business,
      twenty,
      links: {
        kanban: '/kanban',
        ai_employees: '/workspace',
        home: '/',
        profile_business: '/profile',
      },
    });
  } catch (e) {
    console.warn('[company-workspace] snapshot', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
