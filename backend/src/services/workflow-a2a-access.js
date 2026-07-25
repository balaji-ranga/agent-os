/**
 * Per-publication A2A network access policy + marketplace visibility.
 *
 * deny_all (default): no public A2A endpoint is reachable.
 * allow_all: any client IP is accepted.
 * whitelist: client IP must match an exact IP or CIDR entry.
 *
 * visibility:
 *   public (default) — AgentExchange + public endpoints subject to access_policy.
 *   private — public card / oauth / invoke always denied; only COO or the org leaf's
 *             reports-to lead may call via org delegation (owner Test still bypasses).
 */
import { randomUUID } from 'crypto';
import { isIP } from 'net';
import { getDb } from '../db/schema.js';
import { ipMatchesCidrOrIp } from './agent-workflow-desktop-auth.js';

export const A2A_ACCESS_POLICIES = new Set(['deny_all', 'allow_all', 'whitelist']);
export const A2A_VISIBILITIES = new Set(['public', 'private']);

function db() {
  return getDb();
}

export function normalizeA2AAccessPolicy(raw) {
  const policy = String(raw || 'deny_all').trim().toLowerCase();
  if (!A2A_ACCESS_POLICIES.has(policy)) {
    throw new Error('access_policy must be deny_all, allow_all, or whitelist');
  }
  return policy;
}

export function normalizeA2AVisibility(raw) {
  const v = String(raw || 'public').trim().toLowerCase();
  if (!A2A_VISIBILITIES.has(v)) {
    throw new Error('visibility must be public or private');
  }
  return v;
}

export function isA2APrivate(publicationOrVisibility) {
  if (publicationOrVisibility && typeof publicationOrVisibility === 'object') {
    return normalizeA2AVisibility(publicationOrVisibility.visibility) === 'private';
  }
  return normalizeA2AVisibility(publicationOrVisibility) === 'private';
}

export function validateIpOrCidr(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('cidr_or_ip is required');
  if (!value.includes('/')) {
    if (!isIP(value)) throw new Error('cidr_or_ip must be a valid IPv4 or IPv6 address');
    return value;
  }

  const parts = value.split('/');
  if (parts.length !== 2 || !isIP(parts[0])) {
    throw new Error('cidr_or_ip must be a valid IP/CIDR');
  }
  const family = isIP(parts[0]);
  const prefix = Number(parts[1]);
  const max = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) {
    throw new Error(`CIDR prefix must be between 0 and ${max}`);
  }
  // Current matcher supports IPv4 CIDR and exact IPv6. Reject misleading IPv6 CIDR.
  if (family === 6 && prefix !== 128) {
    throw new Error('IPv6 CIDR ranges are not supported yet; use an exact IPv6 address');
  }
  return family === 6 ? parts[0] : `${parts[0]}/${prefix}`;
}

function ownedPublication(publishId, ownerUserId, { publishedOnly = true } = {}) {
  return db()
    .prepare(
      `SELECT * FROM workflow_a2a_publications
       WHERE id = ? AND owner_user_id = ? ${publishedOnly ? `AND status = 'published'` : ''}`
    )
    .get(publishId, ownerUserId);
}

export function getA2AAccessSettings(publishId, ownerUserId) {
  const publication = ownedPublication(publishId, ownerUserId);
  if (!publication) return null;
  const entries = db()
    .prepare(
      `SELECT id, publish_id, cidr_or_ip, label, created_at
       FROM workflow_a2a_ip_whitelist
       WHERE publish_id = ? AND owner_user_id = ?
       ORDER BY created_at DESC`
    )
    .all(publishId, ownerUserId);
  return {
    publish_id: publishId,
    access_policy: normalizeA2AAccessPolicy(publication.access_policy),
    visibility: normalizeA2AVisibility(publication.visibility),
    entries,
  };
}

export function setA2AAccessPolicy(publishId, ownerUserId, rawPolicy) {
  const policy = normalizeA2AAccessPolicy(rawPolicy);
  const result = db()
    .prepare(
      `UPDATE workflow_a2a_publications
       SET access_policy = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .run(policy, publishId, ownerUserId);
  if (!result.changes) return null;
  return getA2AAccessSettings(publishId, ownerUserId);
}

/** Set marketplace / public-calling visibility (public | private). */
export function setA2AVisibility(publishId, ownerUserId, rawVisibility) {
  const visibility = normalizeA2AVisibility(rawVisibility);
  const result = db()
    .prepare(
      `UPDATE workflow_a2a_publications
       SET visibility = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ? AND status = 'published'`
    )
    .run(visibility, publishId, ownerUserId);
  if (!result.changes) return null;
  console.log(
    `[a2a-access] visibility=${visibility} publish=${publishId} owner=${ownerUserId}`
  );
  return getA2AAccessSettings(publishId, ownerUserId);
}

export function addA2AIpWhitelistEntry(
  publishId,
  ownerUserId,
  { cidrOrIp, cidr_or_ip, label = '' } = {}
) {
  if (!ownedPublication(publishId, ownerUserId)) return null;
  const rule = validateIpOrCidr(cidrOrIp || cidr_or_ip);
  const duplicate = db()
    .prepare(
      `SELECT id FROM workflow_a2a_ip_whitelist
       WHERE publish_id = ? AND owner_user_id = ? AND cidr_or_ip = ?`
    )
    .get(publishId, ownerUserId, rule);
  if (duplicate) throw new Error('This IP/CIDR is already on the whitelist');

  const id = randomUUID();
  db()
    .prepare(
      `INSERT INTO workflow_a2a_ip_whitelist
       (id, publish_id, owner_user_id, cidr_or_ip, label)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(id, publishId, ownerUserId, rule, String(label || '').trim());
  return getA2AAccessSettings(publishId, ownerUserId);
}

export function removeA2AIpWhitelistEntry(publishId, entryId, ownerUserId) {
  const result = db()
    .prepare(
      `DELETE FROM workflow_a2a_ip_whitelist
       WHERE id = ? AND publish_id = ? AND owner_user_id = ?`
    )
    .run(entryId, publishId, ownerUserId);
  if (!result.changes) return null;
  return getA2AAccessSettings(publishId, ownerUserId);
}

/**
 * Enforce policy from a raw publication row.
 * Private agents always fail public IP checks (callers must use org bypass / owner test).
 */
export function checkA2AClientIp(publication, clientIp) {
  if (isA2APrivate(publication)) {
    return {
      ok: false,
      policy: 'private',
      visibility: 'private',
      reason:
        'This A2A agent is private — public calling is disabled. Only the COO or its org reports-to lead can invoke it.',
    };
  }
  const policy = normalizeA2AAccessPolicy(publication?.access_policy);
  if (policy === 'allow_all') return { ok: true, policy, visibility: 'public' };
  if (policy === 'deny_all') {
    return {
      ok: false,
      policy,
      visibility: 'public',
      reason: 'This A2A agent currently denies all public access',
    };
  }

  const entries = db()
    .prepare(
      `SELECT cidr_or_ip FROM workflow_a2a_ip_whitelist
       WHERE publish_id = ? AND owner_user_id = ?`
    )
    .all(publication.id, publication.owner_user_id);
  if (!entries.length) {
    return { ok: false, policy, visibility: 'public', reason: 'This A2A agent whitelist is empty' };
  }
  const hit = entries.some((entry) => ipMatchesCidrOrIp(clientIp, entry.cidr_or_ip));
  return hit
    ? { ok: true, policy, visibility: 'public' }
    : { ok: false, policy, visibility: 'public', reason: 'Client IP is not allowed for this A2A agent' };
}
