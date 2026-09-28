import { getDb } from '../db/schema.js';

function assignmentError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}
/**
 * Return the explicit human target from an agent tool payload. Generic assign_to
 * is treated as human only when it carries a user:/human:/employee: prefix so an
 * agent id can never be silently reinterpreted as a person.
 */
export function humanAssignmentTarget(payload = {}) {
  for (const key of ['assigned_user_id', 'to_user_id', 'employee_id']) {
    const value = String(payload?.[key] || '').trim();
    if (value) return value;
  }
  const generic = String(payload?.assign_to || '').trim();
  const prefixed = generic.match(/^(?:user|human|employee)\s*:\s*(.+)$/i);
  return prefixed ? String(prefixed[1] || '').trim() : '';
}

/** Resolve one enabled employee inside the authoritative CEO/company scope. */
export function resolveCompanyEmployee(ownerUserId, target, database = getDb()) {
  const owner = String(ownerUserId || '').trim();
  const needle = String(target || '').trim();
  if (!owner || !needle) throw assignmentError('Company owner and employee target are required');

  const byId = database.prepare(
    `SELECT id,name,email,department,role_title,specialty,purpose
       FROM platform_users
      WHERE owner_user_id = ? AND role = 'org_user' AND enabled = 1
        AND LOWER(id) = LOWER(?)`
  ).get(owner, needle);
  if (byId) return byId;

  const byName = database.prepare(
    `SELECT id,name,email,department,role_title,specialty,purpose
       FROM platform_users
      WHERE owner_user_id = ? AND role = 'org_user' AND enabled = 1
        AND LOWER(name) = LOWER(?)
      ORDER BY id`
  ).all(owner, needle);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw assignmentError(`Employee name is ambiguous; use assigned_user_id (${byName.map((row) => row.id).join(', ')})`, 409);
  }
  throw assignmentError('Enabled employee not found in this company', 404);
}
