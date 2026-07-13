/**
 * Resolve CEO user id for content-tool invocations (OpenClaw plugin, COO tools, logs).
 * Owner must come from authenticated session or registered OpenClaw session — never another CEO.
 */
import { extractOwnerUserIdFromText } from './agent-chat-scope.js';
import { parseTenantOpenClawAgentId } from './openclaw-tenant.js';
import { getBalaCeoAuthId } from './job-applicant-ceo.js';

const SESSION_USER_PREFIX = 'agent-os-';
const SESSION_OWNER_TTL_MS = Number(process.env.OPENCLAW_SESSION_OWNER_TTL_MS || 4 * 3600000);
const sessionOwnerRegistry = new Map();

function pruneSessionOwners() {
  const now = Date.now();
  for (const [key, row] of sessionOwnerRegistry) {
    if (row.expiresAt <= now) sessionOwnerRegistry.delete(key);
  }
}

export function registerOpenClawSessionOwner(sessionKey, ownerUserId) {
  if (!sessionKey || !ownerUserId) return;
  pruneSessionOwners();
  sessionOwnerRegistry.set(String(sessionKey), {
    ownerUserId: String(ownerUserId).trim(),
    expiresAt: Date.now() + SESSION_OWNER_TTL_MS,
  });
}

export function lookupOpenClawSessionOwner(sessionKey) {
  if (!sessionKey) return null;
  pruneSessionOwners();
  const row = sessionOwnerRegistry.get(String(sessionKey));
  if (!row || row.expiresAt <= Date.now()) {
    if (row) sessionOwnerRegistry.delete(String(sessionKey));
    return null;
  }
  return row.ownerUserId;
}

export function resolveOwnerFromOpenClawSession(req) {
  const sessionKey = req?.headers?.['x-openclaw-session-key'] || req?.headers?.['x-session-key'] || '';
  if (!sessionKey) return null;
  return lookupOpenClawSessionOwner(String(sessionKey)) || parseOwnerUserIdFromSessionKey(String(sessionKey));
}

export function parseOwnerUserIdFromSessionUser(sessionUser, agentId = null) {
  if (!sessionUser || typeof sessionUser !== 'string') return null;
  const s = sessionUser.trim();
  if (!s.startsWith(SESSION_USER_PREFIX)) return null;
  const rest = s.slice(SESSION_USER_PREFIX.length);
  if (agentId) {
    const safeAgent = String(agentId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const prefix = `${safeAgent}-`;
    if (rest.startsWith(prefix)) return rest.slice(prefix.length) || null;
  }
  const dashIdx = rest.indexOf('-');
  if (dashIdx >= 0 && dashIdx < rest.length - 1) return rest.slice(dashIdx + 1);
  return null;
}

export function parseOwnerUserIdFromSessionKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return null;
  const m = sessionKey.match(/^agent::([^:]+):(.+)$/);
  if (!m) return null;
  return parseOwnerUserIdFromSessionUser(m[2], m[1]);
}

/** True when authUser is the placeholder used for TOOLS_API_KEY / internal service calls. */
export function isPlaceholderServiceUser(authUser) {
  return !!(authUser?.internal);
}

/**
 * Trusted owner for owner-scoped APIs (IBKR ledger/analytics, day-status, etc.).
 * Never trusts body owner_user_id / ceo_user_id (LLM / client spoof).
 * Order: real session CEO → trusted headers → OpenClaw session → tenant agent id → optional Bala fallback.
 */
export function resolveEntitledOwnerUserId(req, { fallbackToBala = true } = {}) {
  if (req?.authUser?.role === 'ceo' && !isPlaceholderServiceUser(req.authUser)) {
    return String(req.authUser.id).trim();
  }
  if (req?.authUser?.role === 'admin' && req.authUser.impersonation) {
    return String(req.authUser.id).trim();
  }

  const fromHeader = String(
    req?.headers?.['x-ceo-user-id'] || req?.headers?.['x-agent-os-user-id'] || ''
  ).trim();
  if (fromHeader) return fromHeader;

  const fromRegistry = resolveOwnerFromOpenClawSession(req);
  if (fromRegistry) return fromRegistry;

  const sessionKey = req?.headers?.['x-openclaw-session-key'] || req?.headers?.['x-session-key'];
  const fromSessionKey = parseOwnerUserIdFromSessionKey(String(sessionKey || ''));
  if (fromSessionKey) return fromSessionKey;

  const agentId = req?.headers?.['x-openclaw-agent-id'] || req?.headers?.['x-agent-id'];
  const sessionUser = req?.headers?.['x-openclaw-session-user'];
  const fromSessionUser = parseOwnerUserIdFromSessionUser(String(sessionUser || ''), agentId);
  if (fromSessionUser) return fromSessionUser;

  const tenant = parseTenantOpenClawAgentId(agentId);
  if (tenant?.ceoUserId) return tenant.ceoUserId;

  if (fallbackToBala) return getBalaCeoAuthId();
  return null;
}

export function resolveToolOwnerUserId(req, body = {}, resolveAuthenticatedCeoUserId = null) {
  // Skip placeholder internalServiceUser (always ceo-bala) — resolve from session/tenant/headers.
  if (req?.authUser?.role === 'ceo' && !isPlaceholderServiceUser(req.authUser)) {
    return req.authUser.id;
  }

  if (req?.authUser?.role === 'admin') {
    if (req.authUser.impersonation) return req.authUser.id;
    if (resolveAuthenticatedCeoUserId) {
      try {
        return resolveAuthenticatedCeoUserId(req, body);
      } catch (_) {}
    }
  }

  const fromHeader = String(
    req?.headers?.['x-ceo-user-id'] || req?.headers?.['x-agent-os-user-id'] || ''
  ).trim();
  if (fromHeader) return fromHeader;

  const sessionKey = req?.headers?.['x-openclaw-session-key'] || req?.headers?.['x-session-key'];
  const fromRegistry = resolveOwnerFromOpenClawSession(req);
  if (fromRegistry) return fromRegistry;

  const fromSessionKey = parseOwnerUserIdFromSessionKey(String(sessionKey || ''));
  if (fromSessionKey) return fromSessionKey;

  const agentId = req?.headers?.['x-openclaw-agent-id'] || req?.headers?.['x-agent-id'];
  const sessionUser = req?.headers?.['x-openclaw-session-user'];
  const fromSessionUser = parseOwnerUserIdFromSessionUser(String(sessionUser || ''), agentId);
  if (fromSessionUser) return fromSessionUser;

  // Tenant runtime ids encode the CEO: t-{ceoUserId}--{baseAgentId}
  const tenant = parseTenantOpenClawAgentId(agentId || body?.caller_agent_id || body?.x_openclaw_agent_id);
  if (tenant?.ceoUserId) return tenant.ceoUserId;

  if (req?.authUser && !isPlaceholderServiceUser(req.authUser) && resolveAuthenticatedCeoUserId) {
    return resolveAuthenticatedCeoUserId(req, body);
  }

  const text = [body?.message, body?.query, body?.description, body?.input].filter(Boolean).join('\n');
  const fromText = extractOwnerUserIdFromText(text, null);
  if (fromText) return fromText;

  const err = new Error(
    'ceo_user_id could not be resolved — chat with the agent from the UI so the session is registered, or pass x-openclaw-session-key from the active OpenClaw session'
  );
  err.status = 400;
  throw err;
}

/** Strip spoofable owner fields from OpenClaw tool bodies; owner comes from session only. */
export function bodyWithoutSpoofedOwner(body = {}) {
  const out = { ...(body || {}) };
  delete out.ceo_user_id;
  delete out.ceoUserId;
  delete out.owner_user_id;
  delete out.ownerUserId;
  return out;
}

export function resolveToolOwnerUserIdOrNull(req, body = {}, resolveAuthenticatedCeoUserId = null) {
  try {
    return resolveToolOwnerUserId(req, body, resolveAuthenticatedCeoUserId);
  } catch {
    return null;
  }
}
