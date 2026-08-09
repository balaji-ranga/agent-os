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
 *
 * IP entries stored in owner_ip_whitelists (apply_a2a) — same central source as Settings.
 */
import { getDb } from '../db/schema.js';
import {
  validateIpOrCidr,
  listOwnerIpWhitelists,
  addOwnerIpWhitelistEntry,
  removeOwnerIpWhitelistEntry,
  assertFeatureIpAllowed,
  IP_FEATURES,
} from './owner-ip-whitelist.js';

export { validateIpOrCidr };
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
  const entries = listOwnerIpWhitelists(ownerUserId, {
    feature: IP_FEATURES.A2A,
    publishId,
  }).map((e) => ({
    id: e.id,
    publish_id: e.publish_id || publishId,
    cidr_or_ip: e.cidr_or_ip,
    label: e.label,
    created_at: e.created_at,
  }));
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
  const existing = listOwnerIpWhitelists(ownerUserId, {
    feature: IP_FEATURES.A2A,
    publishId,
  }).find((e) => e.cidr_or_ip === rule && (e.publish_id === publishId || !e.publish_id));
  if (existing && existing.publish_id === publishId) {
    throw new Error('This IP/CIDR is already on the whitelist');
  }
  addOwnerIpWhitelistEntry(ownerUserId, {
    cidr_or_ip: rule,
    label,
    apply_a2a: true,
    publish_id: publishId,
  });
  return getA2AAccessSettings(publishId, ownerUserId);
}

export function removeA2AIpWhitelistEntry(publishId, entryId, ownerUserId) {
  if (!ownedPublication(publishId, ownerUserId)) return null;
  const entry = listOwnerIpWhitelists(ownerUserId, {
    feature: IP_FEATURES.A2A,
    publishId,
  }).find((e) => e.id === entryId);
  if (!entry) return null;
  if (!removeOwnerIpWhitelistEntry(entryId, ownerUserId)) return null;
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

  const ipCheck = assertFeatureIpAllowed(
    publication.owner_user_id,
    IP_FEATURES.A2A,
    clientIp,
    { publishId: publication.id }
  );
  return ipCheck.ok
    ? { ok: true, policy, visibility: 'public' }
    : {
        ok: false,
        policy,
        visibility: 'public',
        reason: ipCheck.reason || 'Client IP is not allowed for this A2A agent',
      };
}