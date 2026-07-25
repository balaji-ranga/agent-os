/**
 * Org leaf members: external agents and published A2A workflows placed in the CEO org chart.
 *
 * Leaf members always report to an internal agent (`agents.id`) and can never manage others.
 * They are delegation targets for the COO and are budgeted like internal agents.
 */
import { getDb } from '../db/schema.js';

export const ORG_MEMBER_KINDS = Object.freeze(['external', 'a2a_publish']);

function memberId(kind, refId) {
  const prefix = kind === 'a2a_publish' ? 'a2a' : 'ext';
  return `${prefix}:${String(refId)}`;
}

function mapMember(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    kind: row.kind,
    ref_id: row.ref_id,
    display_name: row.display_name,
    purpose: row.purpose || '',
    department: row.department || '',
    parent_id: row.parent_id || '',
    monthly_token_budget:
      row.monthly_token_budget == null ? null : Number(row.monthly_token_budget),
    error_budget_pct: row.error_budget_pct == null ? null : Number(row.error_budget_pct),
    enabled: !!row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Leaf members for a CEO. `enabledOnly` restricts to members usable for delegation. */
export function listOrgAgentMembers(ownerUserId, { enabledOnly = false } = {}) {
  if (!ownerUserId) return [];
  const sql = enabledOnly
    ? `SELECT * FROM org_agent_members WHERE owner_user_id = ? AND enabled = 1 ORDER BY display_name`
    : `SELECT * FROM org_agent_members WHERE owner_user_id = ? ORDER BY display_name`;
  return getDb().prepare(sql).all(String(ownerUserId)).map(mapMember);
}

export function getOrgAgentMember(ownerUserId, id) {
  if (!ownerUserId || !id) return null;
  return mapMember(
    getDb()
      .prepare(`SELECT * FROM org_agent_members WHERE id = ? AND owner_user_id = ?`)
      .get(String(id), String(ownerUserId))
  );
}

function assertInternalParent(ownerUserId, parentId) {
  const pid = String(parentId || '').trim();
  if (!pid) throw new Error('reports_to (internal agent) is required');
  const row = getDb()
    .prepare(
      `SELECT a.id FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
       WHERE a.id = ?`
    )
    .get(String(ownerUserId), pid);
  if (!row) throw new Error(`reports_to agent not found in your org: ${pid}`);
  return pid;
}

function assertRefOwned(ownerUserId, kind, refId) {
  const ref = String(refId || '').trim();
  if (!ref) throw new Error('ref_id is required');
  const db = getDb();
  if (kind === 'external') {
    const row = db
      .prepare(`SELECT id, name, description FROM external_agents WHERE id = ? AND owner_user_id = ?`)
      .get(ref, String(ownerUserId));
    if (!row) throw new Error('External agent not found for this account');
    return { name: row.name, purpose: row.description || '' };
  }
  const row = db
    .prepare(
      `SELECT id, name, description FROM workflow_a2a_publications WHERE id = ? AND owner_user_id = ?`
    )
    .get(ref, String(ownerUserId));
  if (!row) throw new Error('A2A publication not found for this account');
  return { name: row.name, purpose: row.description || '' };
}

/**
 * Create or update the org placement for an external / A2A agent (idempotent per ref).
 */
export function upsertOrgAgentMember(ownerUserId, body = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  const kind = String(body.kind || '').trim();
  if (!ORG_MEMBER_KINDS.includes(kind)) throw new Error(`kind must be one of ${ORG_MEMBER_KINDS.join(', ')}`);
  const refId = String(body.ref_id || '').trim();
  const source = assertRefOwned(owner, kind, refId);
  const parentId = assertInternalParent(owner, body.parent_id);
  const id = memberId(kind, refId);
  const displayName = String(body.display_name || source.name || id).trim();
  const purpose = String(body.purpose ?? source.purpose ?? '').trim();
  const department = String(body.department || '').trim();
  const budget =
    body.monthly_token_budget == null || body.monthly_token_budget === ''
      ? null
      : Math.max(0, Math.round(Number(body.monthly_token_budget) || 0));
  const errPct =
    body.error_budget_pct == null || body.error_budget_pct === ''
      ? null
      : Math.min(100, Math.max(0, Number(body.error_budget_pct) || 0));
  const enabled = body.enabled === undefined ? 1 : body.enabled ? 1 : 0;

  getDb()
    .prepare(
      `INSERT INTO org_agent_members
         (id, owner_user_id, kind, ref_id, display_name, purpose, department, parent_id,
          monthly_token_budget, error_budget_pct, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, kind, ref_id) DO UPDATE SET
         display_name = excluded.display_name,
         purpose = excluded.purpose,
         department = excluded.department,
         parent_id = excluded.parent_id,
         monthly_token_budget = excluded.monthly_token_budget,
         error_budget_pct = excluded.error_budget_pct,
         enabled = excluded.enabled,
         updated_at = datetime('now')`
    )
    .run(
      id,
      owner,
      kind,
      refId,
      displayName,
      purpose,
      department,
      parentId,
      budget,
      errPct,
      enabled
    );
  console.log(
    `[org-members] upsert member=${id} kind=${kind} owner=${owner} dept=${department || '-'} parent=${parentId} enabled=${enabled}`
  );
  return getOrgAgentMember(owner, id);
}

export function deleteOrgAgentMember(ownerUserId, id) {
  const existing = getOrgAgentMember(ownerUserId, id);
  if (!existing) throw new Error('Org member not found');
  getDb()
    .prepare(`DELETE FROM org_agent_members WHERE id = ? AND owner_user_id = ?`)
    .run(String(id), String(ownerUserId));
  console.log(`[org-members] deleted member=${id} owner=${ownerUserId}`);
  return { ok: true, id: String(id) };
}

/** Record a terminal outcome for a leaf member (feeds error budget + Agent View). */
export function recordOrgMemberInvocation(
  ownerUserId,
  memberKey,
  { source = 'delegation', status = 'ok', errorMessage = null, latencyMs = null, taskId = null } = {}
) {
  if (!ownerUserId || !memberKey) return null;
  try {
    getDb()
      .prepare(
        `INSERT INTO org_member_invocations
           (owner_user_id, member_key, source, status, error_message, latency_ms, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(ownerUserId),
        String(memberKey),
        String(source),
        status === 'ok' ? 'ok' : 'failed',
        errorMessage ? String(errorMessage).slice(0, 500) : null,
        latencyMs == null ? null : Number(latencyMs),
        taskId ? String(taskId) : null
      );
  } catch (e) {
    console.warn('[org-members] invocation log failed', memberKey, e?.message || e);
  }
  return true;
}
