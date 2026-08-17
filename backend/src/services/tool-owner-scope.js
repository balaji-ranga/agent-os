/**
 * Resolve CEO user id for content-tool invocations (OpenClaw plugin, COO tools, logs).
 * Owner must come from authenticated session or registered AgentSystem session — never another CEO.
 */
import { extractOwnerUserIdFromText } from './agent-chat-scope.js';
import { parseTenantOpenClawAgentId } from './openclaw-tenant.js';
import { getBalaCeoAuthId } from './job-applicant-ceo.js';

const SESSION_USER_PREFIXES = ['agent-os-user-', 'agent-os-'];
const SESSION_OWNER_TTL_MS = Number(process.env.OPENCLAW_SESSION_OWNER_TTL_MS || 4 * 3600000);
const sessionOwnerRegistry = new Map();

/** Dashboard agent chat in flight — used to block notify_ceo spam while CEO is already talking. */
const ACTIVE_DASHBOARD_CHAT_TTL_MS = Number(process.env.ACTIVE_DASHBOARD_CHAT_TTL_MS || 10 * 60 * 1000);
const activeDashboardChat = new Map();

function activeChatKey(agentId, ownerUserId) {
  return `${String(agentId || '').trim()}::${String(ownerUserId || '').trim()}`;
}

/** Mark that the CEO is in Dashboard chat with this agent (call before OpenClaw completion). */
export function registerActiveDashboardChat(agentId, ownerUserId, message = '') {
  if (!agentId || !ownerUserId) return;
  activeDashboardChat.set(activeChatKey(agentId, ownerUserId), {
    message: String(message || '').trim(),
    expiresAt: Date.now() + ACTIVE_DASHBOARD_CHAT_TTL_MS,
  });
}

export function clearActiveDashboardChat(agentId, ownerUserId) {
  if (!agentId || !ownerUserId) return;
  activeDashboardChat.delete(activeChatKey(agentId, ownerUserId));
}

export function lookupActiveDashboardChat(agentId, ownerUserId) {
  if (!agentId || !ownerUserId) return null;
  const key = activeChatKey(agentId, ownerUserId);
  const row = activeDashboardChat.get(key);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    activeDashboardChat.delete(key);
    return null;
  }
  return row;
}

/** True when any Dashboard agent chat is waiting on OpenClaw (local CPU Ollama must not fan out). */
export function hasAnyActiveDashboardChat() {
  const now = Date.now();
  for (const [key, row] of activeDashboardChat) {
    if (!row || row.expiresAt <= now) {
      activeDashboardChat.delete(key);
      continue;
    }
    return true;
  }
  return false;
}

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
  let rest = null;
  for (const prefix of SESSION_USER_PREFIXES) {
    if (s.startsWith(prefix)) {
      rest = s.slice(prefix.length);
      break;
    }
  }
  if (rest == null) return null;

  if (agentId) {
    const safeAgent = String(agentId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const agentPrefix = `${safeAgent}-`;
    if (rest.startsWith(agentPrefix)) return rest.slice(agentPrefix.length) || null;
  }

  // Tenant runtime: t-{ceo}--{base}-{owner} (ceo may contain dashes)
  const dd = rest.indexOf('--');
  if (dd >= 0) {
    const afterTenant = rest.slice(dd + 2); // {base}-{owner}
    const dash = afterTenant.indexOf('-');
    if (dash >= 0 && dash < afterTenant.length - 1) {
      return afterTenant.slice(dash + 1) || null;
    }
  }

  const dashIdx = rest.indexOf('-');
  if (dashIdx >= 0 && dashIdx < rest.length - 1) return rest.slice(dashIdx + 1);
  return null;
}

export function parseOwnerUserIdFromSessionKey(sessionKey) {
  if (!sessionKey || typeof sessionKey !== 'string') return null;
  // Prefer legacy agent:: then current agent: (OpenClaw 2026+).
  const m =
    sessionKey.match(/^agent::([^:]+):(.+)$/) || sessionKey.match(/^agent:([^:]+):(.+)$/);
  if (!m) return null;
  const agentId = m[1];
  const sessionUser = m[2];
  const tenant = parseTenantOpenClawAgentId(agentId);
  if (tenant?.ceoUserId) return tenant.ceoUserId;
  return parseOwnerUserIdFromSessionUser(sessionUser, agentId);
}

/** True when authUser is the placeholder used for TOOLS_API_KEY / internal service calls. */
export function isPlaceholderServiceUser(authUser) {
  return !!(authUser?.internal);
}

/**
 * Trusted owner for owner-scoped APIs (IBKR ledger/analytics, day-status, etc.).
 * Never trusts body owner_user_id / ceo_user_id (LLM / client spoof).
 * Order: real session CEO â†’ trusted headers â†’ AgentSystem session â†’ tenant agent id â†’ optional Bala fallback.
 */
export function resolveEntitledOwnerUserId(req, { fallbackToBala = true } = {}) {
  if (req?.authUser?.role === 'ceo' && !isPlaceholderServiceUser(req.authUser)) {
    return String(req.authUser.id).trim();
  }
  if (req?.authUser?.role === 'org_user' && req.authUser.owner_user_id) {
    return String(req.authUser.owner_user_id).trim();
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
  if (req?.authUser?.role === 'org_user' && req.authUser.owner_user_id) {
    return req.authUser.owner_user_id;
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
    'ceo_user_id could not be resolved — chat with the agent from the UI so the session is registered, or pass x-openclaw-session-key from the active AgentSystem session'
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
  delete out.user_id;
  delete out.userId;
  delete out.target_user_id;
  delete out.targetUserId;
  return out;
}

export function resolveToolOwnerUserIdOrNull(req, body = {}, resolveAuthenticatedCeoUserId = null) {
  try {
    return resolveToolOwnerUserId(req, body, resolveAuthenticatedCeoUserId);
  } catch {
    return null;
  }
}
