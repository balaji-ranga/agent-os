/**
 * Shared internal service auth — replaces spoofable x-internal-test: 1.
 * Callers must send header x-agent-os-internal: <AGENT_OS_INTERNAL_TOKEN>
 * (or Authorization: Bearer <same token>).
 */
import { timingSafeEqual, randomBytes } from 'crypto';
import { bearerToken, requireAuth } from './auth.js';

export function getInternalToken() {
  return String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim();
}

/** Ensure a token exists for local/dev; production must set it explicitly. */
export function ensureInternalTokenConfigured() {
  let token = getInternalToken();
  if (token) return token;
  if (process.env.NODE_ENV === 'production' || process.env.AGENT_OS_STRICT_SECRETS === '1') {
    throw new Error(
      'AGENT_OS_INTERNAL_TOKEN is required in production (set a long random secret in .env)'
    );
  }
  token = randomBytes(32).toString('hex');
  process.env.AGENT_OS_INTERNAL_TOKEN = token;
  console.warn(
    '[security] AGENT_OS_INTERNAL_TOKEN was unset — generated an ephemeral token for this process. Set it in .env for stable workflow/tool auth.'
  );
  return token;
}

function safeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export function extractInternalToken(req) {
  const header = req.headers?.['x-agent-os-internal'];
  if (header) return String(header).trim();
  const q = req.query?.internal_token || req.query?.token;
  if (q) return String(q).trim();
  const bearer = bearerToken(req);
  const expected = getInternalToken();
  if (bearer && expected && safeEqualStr(bearer, expected)) return bearer;
  return null;
}

export function isInternalRequest(req) {
  const expected = getInternalToken();
  if (!expected) return false;
  const provided = extractInternalToken(req);
  if (!provided) return false;
  return safeEqualStr(provided, expected);
}

export function internalServiceUser() {
  return {
    id: process.env.AGENT_OS_BALA_CEO_ID || 'ceo-bala',
    role: 'ceo',
    internal: true,
  };
}

/** Headers for in-process / same-host service calls (workflow runner, tools proxy). */
export function internalAuthHeaders(extra = {}) {
  const token = ensureInternalTokenConfigured();
  return {
    'Content-Type': 'application/json',
    'x-agent-os-internal': token,
    ...extra,
  };
}

/**
 * Accept internal service token OR platform session.
 * Never trusts body owner_user_id for identity.
 */
export function allowInternalOrAuth(req, res, next) {
  if (isInternalRequest(req)) {
    req.isInternalService = true;
    req.authUser = req.authUser || internalServiceUser();
    return next();
  }
  return requireAuth(req, res, next);
}

/** Cron/gateway callbacks: internal token required (query or header). */
export function requireInternalToken(req, res, next) {
  if (isInternalRequest(req)) {
    req.isInternalService = true;
    return next();
  }
  return res.status(401).json({
    error: 'Internal service authentication required',
    hint: 'Send x-agent-os-internal header or internal_token query matching AGENT_OS_INTERNAL_TOKEN',
  });
}
