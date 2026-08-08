/**
 * Shared Twenty public URL helpers (minimal deps).
 */
import { createHash } from 'crypto';

export function strip(s) {
  return String(s || '').trim();
}

export const TWENTY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTwentyUuid(id) {
  return TWENTY_UUID_RE.test(strip(id));
}

/** Front origin (https://crm.example.com) from platform env. */
export function getTwentyFrontOrigin() {
  for (const raw of [
    process.env.TWENTY_EMBED_URL,
    process.env.TWENTY_SERVER_URL,
    process.env.TWENTY_PUBLIC_URL,
  ]) {
    const v = strip(raw);
    if (!v || /twenty-server|internal/i.test(v)) continue;
    try {
      return new URL(v).origin;
    } catch {
      /* continue */
    }
  }
  return '';
}

/**
 * Multi-workspace origin for a Twenty subdomain:
 * SERVER_URL host = crm.flolah.cloud -> https://{subdomain}.crm.flolah.cloud
 */
export function getTwentyWorkspacePublicBase(subdomain) {
  const origin = getTwentyFrontOrigin();
  if (!origin) return '';
  const sub = strip(subdomain)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  if (!sub) return origin;
  try {
    const u = new URL(origin);
    const multi = String(
      process.env.TWENTY_IS_MULTIWORKSPACE_ENABLED ||
        process.env.IS_MULTIWORKSPACE_ENABLED ||
        '1'
    ).toLowerCase();
    const multiOn = !(multi === '0' || multi === 'false' || multi === 'off' || multi === 'no');
    if (multiOn) u.hostname = `${sub}.${u.hostname}`;
    return u.origin;
  } catch {
    return origin;
  }
}

export function subdomainForOwner(ownerUserId, displayName = '') {
  const owner = strip(ownerUserId);
  const hash = createHash('sha256').update(owner).digest('hex').slice(0, 8);
  const slug = String(displayName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 12);
  const base = (slug || 'co') + hash;
  return (`f${base}`).slice(0, 48);
}