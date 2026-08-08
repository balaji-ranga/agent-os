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

/** High-noise tools — skip individual lines so real CRM/work action stays visible. */
const NOISY_TOOLS = new Set([
  'kanban_move_status',
  'kanban_list_tasks',
  'crm_status',
  'erp_status',
  'crm_list_people',
  'crm_list_companies',
  'crm_list_opportunities',
]);

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
  // t-ceo-bala--crm-s1-ceobala or bare agent id
  const m = src.match(/--([a-z0-9_-]+)$/i) || src.match(/^([a-z0-9_-]+)$/i);
  const cand = (m && m[1]) || '';
  if (cand && names.has(cand)) return { agent_id: cand, agent_name: names.get(cand) };
  for (const [aid, nm] of names) {
    if (cand && (cand.includes(aid) || aid.includes(cand))) {
      return { agent_id: aid, agent_name: nm };
    }
  }
  return { agent_id: id || cand || src || 'agent', agent_name: null };
}

function toolSnippet(toolName, requestPayload, status) {
  let body = {};
  try {
    body = requestPayload ? JSON.parse(requestPayload) : {};
  } catch {
    body = {};
  }
  const st = status === 'ok' ? '' : ` (${status})`;
  if (toolName === 'crm_create_person' || toolName === 'crm_create_company') {
    const n = body.name || body.displayName || body.display_name || '';
    return n ? `${toolName}: ${n}${st}` : `${toolName}${st}`;
  }
  if (toolName === 'crm_sync_org' || toolName === 'erp_sync_org') {
    return `${toolName}${st}`;
  }
  if (String(toolName).startsWith('crm_') || String(toolName).startsWith('erp_')) {
    const bits = [toolName];
    if (body.name) bits.push(String(body.name).slice(0, 60));
    return bits.join(': ') + st;
  }
  return `${toolName}${st}`;
}

/**
 * Merge CEO feedback + content tool work into a single recent activity stream.
 * Feedback alone missed CRM Maker actions that were never thumbs-rated.
 */
function buildRecentActivity(ownerUserId, names) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const db = getDb();
  const rows = [];

  try {
    const feedback = db
      .prepare(
        `SELECT id, agent_id, source, rating, created_at,
                substr(COALESCE(message_content, ''), 1, 160) AS snippet
         FROM agent_response_feedback
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT 20`
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

  try {
    const tools = db
      .prepare(
        `SELECT id, tool_name, source, status, request_payload, created_at
         FROM content_tool_logs
         WHERE owner_user_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 80`
      )
      .all(owner);
    for (const t of tools) {
      const name = String(t.tool_name || '').trim();
      if (!name || NOISY_TOOLS.has(name)) continue;
      const label = resolveAgentLabel(t.source, null, names);
      rows.push({
        id: `tool-${t.id}`,
        kind: 'tool',
        agent_id: label.agent_id,
        agent_name: label.agent_name,
        tool_name: name,
        source: t.source || 'tool',
        status: t.status,
        snippet: toolSnippet(name, t.request_payload, t.status),
        created_at: t.created_at,
        sort_at: t.created_at,
      });
    }
  } catch (e) {
    console.warn('[company-workspace] activity tools', e?.message || e);
  }

  rows.sort((a, b) => String(b.sort_at || '').localeCompare(String(a.sort_at || '')));
  return rows.slice(0, 25).map(({ sort_at, ...rest }) => rest);
}

router.get('/snapshot', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    // kanbanOwnerSqlFilter expects auth-like { id, role }, not a bare userId string
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
    const activity = buildRecentActivity(ownerUserId, names);

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
