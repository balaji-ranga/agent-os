import { getSessionUser, revokeSession } from '../services/auth/session.js';
import { resolveCeoUserId as legacyResolveCeoUserId, resolveCeoDataUserId } from '../services/job-applicant-ceo.js';
import {
  clearOcConsoleCookieHeader,
  isRequestSecure,
} from '../services/openconnector-console-proxy.js';
import { clearOsConsoleCookieHeaders } from '../services/opensearch/index.js';
import {
  attachOrgFieldsToAuthUser,
  hasPermission,
  isOrgUser,
  isTenantFullAccess,
  matchApiPermission,
  resolveRootOwnerUserId,
} from '../services/org-permissions.js';

function appendSetCookies(res, cookies) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...list, ...cookies]);
}
export function bearerToken(req) {
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return req.headers?.['x-session-token'] || null;
}

export function attachAuthUser(req, res, next) {
  const token = bearerToken(req);
  if (token) {
    const user = getSessionUser(token);
    if (user) {
      req.authUser = attachOrgFieldsToAuthUser(user);
      req.sessionToken = token;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
    if (req.authUser.role !== role) {
      return res.status(403).json({ error: `${role} role required` });
    }
    next();
  };
}

export function requireCeoOrAdmin(req, res, next) {
  if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
  const role = req.authUser.role;
  if (role !== 'ceo' && role !== 'admin' && role !== 'org_user') {
    return res.status(403).json({ error: 'Company or admin role required' });
  }
  next();
}

export function requireTenantFullAccess(req, res, next) {
  if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
  if (req.authUser.role === 'admin' || isTenantFullAccess(req.authUser)) return next();
  return res.status(403).json({ error: 'CEO or CEO Delegate access required' });
}

export function requirePermission(key) {
  return (req, res, next) => {
    if (!req.authUser) return res.status(401).json({ error: 'Authentication required' });
    if (req.authUser.role === 'admin' || isTenantFullAccess(req.authUser)) return next();
    if (hasPermission(req.authUser, key)) return next();
    return res.status(403).json({ error: `Missing permission: ${key}` });
  };
}

/** Deny org_user (employees) unless their role grants the API prefix. CEO/delegate skip. */
export function enforceOrgUserApiPermissions(req, res, next) {
  const user = req.authUser;
  if (!user || !isOrgUser(user)) return next();
  if (isTenantFullAccess(user)) return next();
  const path = String(req.path || '');
  const matched = matchApiPermission(req.method, path);
  if (matched === true) return next();
  if (matched === '__full__') {
    return res.status(403).json({ error: 'CEO or CEO Delegate access required' });
  }
  if (matched && typeof matched === 'object' && Array.isArray(matched.any)) {
    if (matched.any.some((k) => hasPermission(user, k))) return next();
    return res.status(403).json({ error: 'Permission denied' });
  }
  if (typeof matched === 'string' && hasPermission(user, matched)) return next();
  console.info('[auth] org_user denied method=%s path=%s user=%s', req.method, path, user.id);
  return res.status(403).json({ error: 'Permission denied' });
}

/** Platform auth user id (session / user_agents). Org employees resolve to the CEO root. */
export function resolveAuthenticatedCeoUserId(req, body = {}) {
  if (req.authUser?.role === 'ceo') return req.authUser.id;
  if (req.authUser?.role === 'org_user') {
    const owner = resolveRootOwnerUserId(req.authUser);
    if (owner) return owner;
    const err = new Error('Employee is not tagged to a company');
    err.status = 403;
    throw err;
  }
  if (req.authUser?.role === 'admin') {
    const imp =
      req.headers?.['x-impersonate-ceo'] ||
      body?.ceo_user_id ||
      body?.ceoUserId;
    if (imp) return String(imp).trim();
    const err = new Error('Admin must impersonate a user or specify ceo_user_id');
    err.status = 403;
    throw err;
  }
  return legacyResolveCeoUserId(req, body);
}

/** ceo_user_id for job tables, spreadsheets, tenant DB (Bala → default). */
export function resolveCeoDataUserIdFromRequest(req, body = {}) {
  return resolveCeoDataUserId(resolveAuthenticatedCeoUserId(req, body));
}

export function logout(req, res) {
  if (req.sessionToken) revokeSession(req.sessionToken);
  const secure = isRequestSecure(req);
  // End OpenConnector + OpenSearch console access tied to this admin session.
  // Emit Secure and non-Secure clears so the browser matches whichever was set.
  appendSetCookies(res, [
    clearOcConsoleCookieHeader(true),
    clearOcConsoleCookieHeader(false),
    ...clearOsConsoleCookieHeaders(),
  ]);
  console.info('[auth] logout user=%s cleared console cookies secureHint=%s', req.authUser?.id || '?', secure);
  res.json({ ok: true });
}
