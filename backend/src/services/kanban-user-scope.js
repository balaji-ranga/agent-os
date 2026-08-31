/**
 * Per-CEO Kanban isolation.
 * Tasks must have owner_user_id. Shared agent grants alone NEVER imply ownership.
 */
import { resolveCeoDataUserId } from './job-applicant-ceo.js';
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { isOrgUser, isTenantFullAccess, resolveRootOwnerUserId } from './org-permissions.js';

export function getKanbanScopeIds(authUserOrId) {
  let authUserId = authUserOrId;
  if (authUserOrId && typeof authUserOrId === 'object') {
    authUserId = resolveRootOwnerUserId(authUserOrId) || authUserOrId.id;
  }
  const dataUserId = resolveCeoDataUserId(authUserId);
  return [...new Set([authUserId, dataUserId].filter(Boolean))];
}

/** Extract owner from description / prompt text tags. */
export function extractOwnerUserIdFromKanbanText(text) {
  const raw = String(text || '');
  const owner = raw.match(/owner_user_id:\s*(\S+)/i);
  if (owner?.[1]) return owner[1].trim();
  const ceo = raw.match(/ceo_user_id:\s*(\S+)/i);
  if (ceo?.[1]) return ceo[1].trim();
  return null;
}

/**
 * Resolve effective owner for a task row (column first, then text / linked delegation).
 * @param {object} task
 * @param {{ delegation_prompt?: string, delegation_owner_user_id?: string } | null} [extra]
 */
export function resolveKanbanTaskOwnerId(task, extra = null) {
  if (!task) return null;
  const col = String(task.owner_user_id || '').trim();
  if (col) return col;
  const fromDelegationCol = String(extra?.delegation_owner_user_id || task.delegation_owner_user_id || '').trim();
  if (fromDelegationCol) return fromDelegationCol;
  const combined = `${task.description || ''}\n${extra?.delegation_prompt || task.delegation_prompt || ''}`;
  return extractOwnerUserIdFromKanbanText(combined);
}

export function kanbanTaskBelongsToUser(task, authUser) {
  if (!authUser?.id || !task) return false;
  // Platform admin without impersonation does not share a CEO Kanban board
  if (authUser.role === 'admin' && !authUser.impersonation) return false;

  const scopeIds = getKanbanScopeIds(authUser);
  const ownerId = resolveKanbanTaskOwnerId(task);
  if (!ownerId) return false;
  return scopeIds.includes(ownerId);
}

export function filterKanbanTasksForUser(tasks, authUser) {
  return (tasks || []).filter((task) => kanbanTaskBelongsToUser(task, authUser));
}

export function assertKanbanTaskAccess(task, authUser) {
  if (!kanbanTaskBelongsToUser(task, authUser)) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
}

function agentDepartment(agentId) {
  if (!agentId) return '';
  const row = getDb().prepare('SELECT department FROM agents WHERE id = ?').get(agentId);
  return String(row?.department || '').trim().toLowerCase();
}

function userDepartment(userId) {
  if (!userId) return '';
  const row = getDb().prepare('SELECT department, role FROM platform_users WHERE id = ?').get(userId);
  if (!row) return '';
  if (row.role === 'ceo') return '*';
  return String(row.department || '').trim().toLowerCase();
}

function normalizeDept(name) {
  return String(name || '').trim().toLowerCase();
}

/** Department of a card's assignee (agent or human). Empty if unassigned. */
export function kanbanTaskAssigneeDepartment(task) {
  if (!task) return '';
  if (task.assigned_user_id) return userDepartment(task.assigned_user_id);
  if (task.assigned_agent_id) return agentDepartment(task.assigned_agent_id);
  return '';
}

/**
 * CEO / CEO Delegate can mutate any company card.
 * Employees may mutate only cards assigned to their own user id. Department membership
 * is discovery scope, not authority to act for a colleague.
 */
export function canMutateKanbanTask(task, authUser) {
  if (!kanbanTaskBelongsToUser(task, authUser)) return false;
  if (isTenantFullAccess(authUser) || authUser?.role === 'ceo') return true;
  if (!isOrgUser(authUser)) return false;
  return String(task.assigned_user_id || '') === String(authUser.id || '');
}

export function assertKanbanTaskMutate(task, authUser) {
  assertKanbanTaskAccess(task, authUser);
  if (!canMutateKanbanTask(task, authUser)) {
    const err = new Error('Only the company CEO, a CEO delegate, or the assigned task owner may act on this task');
    err.status = 403;
    throw err;
  }
}

/** SQL fragment + params for owner-scoped Kanban list queries. */
export function kanbanOwnerSqlFilter(authUser, { alias = 'k' } = {}) {
  if (!authUser?.id) {
    return { clause: '1=0', params: [] };
  }
  if (authUser.role === 'admin' && !authUser.impersonation) {
    return { clause: '1=0', params: [] };
  }
  const scopeIds = getKanbanScopeIds(authUser);
  if (!scopeIds.length) return { clause: '1=0', params: [] };
  const placeholders = scopeIds.map(() => '?').join(',');
  return {
    clause: `${alias}.owner_user_id IN (${placeholders})`,
    params: scopeIds,
  };
}

const KANBAN_OPEN_SQL =
  "lower(COALESCE(k.status,'')) NOT IN ('done','completed','cancelled','archived','failed')";

/**
 * List Kanban rows the same way the /kanban UI does for multi-tenant CEOs.
 *
 * Agent workflows + Kanban API write to the **platform** DB with owner_user_id.
 * Tenant CEO SQLite may be empty / lack owner_user_id — Workspace used to query only
 * getDbForCeo and show "No open tasks" while Kanban still showed open cards.
 *
 * Strategy: platform first (source of truth for Kanban API), merge any extras from
 * the tenant DB for legacy per-tenant isolation.
 */
export function listKanbanTasksForOwner(ownerUserId, { limit = 80, openOnly = false } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const filter = kanbanOwnerSqlFilter({ id: owner, role: 'ceo' });
  if (filter.clause === '1=0') return [];
  const lim = Math.max(1, Math.min(500, Number(limit) || 80));
  const openClause = openOnly ? ` AND ${KANBAN_OPEN_SQL}` : '';
  const select = `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.assigned_member_key,
       k.due_date, k.created_at, k.updated_at, k.owner_user_id
     FROM kanban_tasks k
     WHERE ${filter.clause}${openClause}
     ORDER BY COALESCE(k.updated_at, k.created_at) DESC
     LIMIT ${lim}`;

  const byId = new Map();

  const pull = (db, label) => {
    if (!db) return;
    try {
      const rows = db.prepare(select).all(...filter.params);
      for (const r of rows) {
        if (r?.id != null && !byId.has(String(r.id))) byId.set(String(r.id), r);
      }
    } catch (e) {
      const msg = String(e?.message || e);
      // Tenant schema may predate owner_user_id — whole tenant file is that CEO.
      if (/owner_user_id/i.test(msg) && label === 'tenant') {
        try {
          const rows = db
            .prepare(
              `SELECT k.id, k.title, k.status, k.assigned_agent_id,
                      NULL AS assigned_member_key,
                      k.due_date, k.created_at, k.updated_at, NULL AS owner_user_id
               FROM kanban_tasks k
               WHERE 1=1${openOnly ? ` AND ${KANBAN_OPEN_SQL}` : ''}
               ORDER BY COALESCE(k.updated_at, k.created_at) DESC
               LIMIT ${lim}`
            )
            .all();
          for (const r of rows) {
            if (r?.id != null && !byId.has(String(r.id))) byId.set(String(r.id), r);
          }
        } catch (e2) {
          console.warn('[kanban-scope] tenant kanban fallback failed owner=%s %s', owner, e2?.message || e2);
        }
      } else {
        console.warn('[kanban-scope] list owner=%s db=%s err=%s', owner, label, msg);
      }
    }
  };

  // Platform DB matches Kanban routes (getDb).
  pull(getDb(), 'platform');
  try {
    const ceoDb = getDbForCeo(owner);
    if (ceoDb && ceoDb !== getDb()) pull(ceoDb, 'tenant');
  } catch (e) {
    console.warn('[kanban-scope] getDbForCeo owner=%s %s', owner, e?.message || e);
  }

  const rows = [...byId.values()].sort((a, b) =>
    String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''))
  );
  return rows.slice(0, lim);
}

/** Count non-terminal Kanban cards for metrics tiles (same DB strategy as list). */
export function countOpenKanbanTasksForOwner(ownerUserId) {
  return listKanbanTasksForOwner(ownerUserId, { limit: 500, openOnly: true }).length;
}
