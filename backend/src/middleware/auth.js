import { getSessionUser, revokeSession } from '../services/auth/session.js';
import { resolveCeoUserId as legacyResolveCeoUserId, resolveCeoDataUserId } from '../services/job-applicant-ceo.js';
import {
  clearOcConsoleCookieHeader,
  isRequestSecure,
} from '../services/openconnector-console-proxy.js';
import { clearOsConsoleCookieHeaders } from '../services/opensearch/index.js';

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
      req.authUser = user;
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
  if (req.authUser.role !== 'ceo' && req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'CEO or admin role required' });
  }
  next();
}

/** Platform auth user id (session / user_agents). */
export function resolveAuthenticatedCeoUserId(req, body = {}) {
  if (req.authUser?.role === 'ceo') return req.authUser.id;
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
