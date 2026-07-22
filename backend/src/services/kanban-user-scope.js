/**
 * Per-CEO Kanban isolation.
 * Tasks must have owner_user_id. Shared agent grants alone NEVER imply ownership.
 */
import { resolveCeoDataUserId } from './job-applicant-ceo.js';

export function getKanbanScopeIds(authUserId) {
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

  const scopeIds = getKanbanScopeIds(authUser.id);
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

/** SQL fragment + params for owner-scoped Kanban list queries. */
export function kanbanOwnerSqlFilter(authUser, { alias = 'k' } = {}) {
  if (!authUser?.id) {
    return { clause: '1=0', params: [] };
  }
  if (authUser.role === 'admin' && !authUser.impersonation) {
    return { clause: '1=0', params: [] };
  }
  const scopeIds = getKanbanScopeIds(authUser.id);
  if (!scopeIds.length) return { clause: '1=0', params: [] };
  const placeholders = scopeIds.map(() => '?').join(',');
  return {
    clause: `${alias}.owner_user_id IN (${placeholders})`,
    params: scopeIds,
  };
}
