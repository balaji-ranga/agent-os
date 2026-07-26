/**
 * Admin-only OpenSearch Dashboards reverse proxy + short-lived launch cookie.
 * Dashboards is expected with SERVER_BASEPATH=/opensearch and SERVER_REWRITEBASEPATH=true,
 * so this proxy does minimal HTML rewriting.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getSessionUser } from '../auth/session.js';

const COOKIE_NAME = 'agent_os_os_console';
/** Short-lived; access always re-checks bound Flowlah admin session. */
const COOKIE_TTL_MS = 30 * 60 * 1000;
const OS_PUBLIC_PREFIX = '/opensearch';
const DEFAULT_DASHBOARDS_URL = 'http://opensearch-dashboards:5601';

function cookieSecret() {
  return (
    String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim() ||
    String(process.env.OPENSEARCH_ADMIN_PASSWORD || '').trim() ||
    'dev-os-console-secret'
  );
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', cookieSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySigned(token) {
  const raw = String(token || '').trim();
  const i = raw.lastIndexOf('.');
  if (i < 1) return null;
  const body = raw.slice(0, i);
  const sig = raw.slice(i + 1);
  const expect = createHmac('sha256', cookieSecret()).update(body).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.exp || Date.now() > Number(payload.exp)) return null;
    if (payload.role !== 'admin' || !payload.uid) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookieHeader(cookieHeader) {
  const out = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

export function createOsConsoleLaunchCookie(adminUser, sessionToken) {
  const st = String(sessionToken || '').trim();
  if (!st) throw new Error('OpenSearch console launch requires an active admin session');
  const payload = {
    uid: adminUser.id,
    role: 'admin',
    exp: Date.now() + COOKIE_TTL_MS,
    st,
  };
  return {
    name: COOKIE_NAME,
    value: signPayload(payload),
    maxAgeMs: COOKIE_TTL_MS,
  };
}

/**
 * Clear HttpOnly OS console cookie variants.
 * Browsers only delete when Path/Secure match the original Set-Cookie — emit both.
 */
export function clearOsConsoleCookieHeaders() {
  const base = `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0`;
  return [
    `${base}; Path=${OS_PUBLIC_PREFIX}`,
    `${base}; Path=${OS_PUBLIC_PREFIX}; Secure`,
    `${base}; Path=/`,
    `${base}; Path=/; Secure`,
  ];
}

/** @deprecated Prefer clearOsConsoleCookieHeaders() — kept for callers expecting a string. */
export function clearOsConsoleCookieHeader(secure = false) {
  return `${COOKIE_NAME}=; Path=${OS_PUBLIC_PREFIX}; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

function applyClearOsConsoleCookies(res) {
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...list, ...clearOsConsoleCookieHeaders()]);
}

export function isRequestSecure(req) {
  return String(req.protocol || '').includes('https') || req.headers?.['x-forwarded-proto'] === 'https';
}

/**
 * Cookie grants console access only while the bound Flowlah admin session is still valid.
 */
export function adminFromOsConsoleCookie(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const payload = verifySigned(cookies[COOKIE_NAME]);
  if (!payload?.st) return null;
  const user = getSessionUser(payload.st);
  if (!user || user.role !== 'admin') return null;
  if (String(user.id) !== String(payload.uid)) return null;
  return user;
}

function osUpstreamBase() {
  return String(process.env.OPENSEARCH_DASHBOARDS_URL || DEFAULT_DASHBOARDS_URL)
    .trim()
    .replace(/\/$/, '');
}

export function getOsConsolePublicUrl() {
  const origin = String(process.env.OPENSEARCH_DASHBOARDS_PUBLIC_ORIGIN || '')
    .trim()
    .replace(/\/$/, '');
  if (origin) {
    if (/\/opensearch\/?$/i.test(origin)) return origin.replace(/\/$/, '') + '/';
    return `${origin}${OS_PUBLIC_PREFIX}/`;
  }
  return `${OS_PUBLIC_PREFIX}/`;
}

/** One-time launch URL so window.open can set the cookie via top-level navigation. */
export function createOsConsoleLaunchUrl(adminUser, sessionToken) {
  const cookie = createOsConsoleLaunchCookie(adminUser, sessionToken);
  const base = getOsConsolePublicUrl();
  const join = base.includes('?') ? '&' : '?';
  return {
    cookie,
    url: `${base}${join}os_launch=${encodeURIComponent(cookie.value)}`,
  };
}

function shouldRewriteBody(contentType) {
  const ct = String(contentType || '').toLowerCase();
  return ct.includes('text/html');
}

/**
 * Express middleware: proxy /opensearch/* to OpenSearch Dashboards.
 * Requires admin session (Bearer or launch cookie).
 */
export function openSearchConsoleProxy() {
  return async function osConsoleProxy(req, res) {
    const pathAfter = req.path || '/';
    const qsParams = req.url.includes('?')
      ? new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1))
      : null;

    // Explicit logout (Flowlah SPA calls this with credentials so Path=/opensearch cookie clears).
    const osLogout =
      (typeof req.query?.os_logout === 'string' && req.query.os_logout) ||
      qsParams?.get('os_logout') ||
      '';
    if (osLogout) {
      applyClearOsConsoleCookies(res);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      console.info('[opensearch-console] cleared console cookie via os_logout');
      return res.status(204).end();
    }

    const launchToken =
      (typeof req.query?.os_launch === 'string' && req.query.os_launch) ||
      qsParams?.get('os_launch') ||
      '';

    if (launchToken) {
      const payload = verifySigned(decodeURIComponent(String(launchToken)));
      if (!payload || payload.role !== 'admin' || !payload.st) {
        return res
          .status(401)
          .send('Invalid or expired OpenSearch console launch link. Use Admin -> OpenSearch.');
      }
      const sessionUser = getSessionUser(payload.st);
      if (
        !sessionUser ||
        sessionUser.role !== 'admin' ||
        String(sessionUser.id) !== String(payload.uid)
      ) {
        return res
          .status(401)
          .send('Admin session expired. Sign in to Flowlah Admin, then open OpenSearch again.');
      }
      const cookie = createOsConsoleLaunchCookie(sessionUser, payload.st);
      const secure = isRequestSecure(req);
      res.setHeader(
        'Set-Cookie',
        `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=${OS_PUBLIC_PREFIX}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
      );
      return res.redirect(302, `${OS_PUBLIC_PREFIX}/`);
    }

    let admin = null;
    if (req.authUser?.role === 'admin') admin = req.authUser;
    if (!admin) admin = adminFromOsConsoleCookie(req);
    if (!admin) {
      const auth = String(req.headers.authorization || '');
      if (auth.startsWith('Bearer ')) {
        const user = getSessionUser(auth.slice(7).trim());
        if (user?.role === 'admin') admin = user;
      }
    }
    if (!admin) {
      applyClearOsConsoleCookies(res);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      console.info('[opensearch-console] rejected: no valid admin session/cookie');
      return res
        .status(401)
        .send('Admin session required. Open console from Flowlah Admin -> OpenSearch.');
    }

    let upstream;
    try {
      upstream = osUpstreamBase();
      if (!upstream) throw new Error('OPENSEARCH_DASHBOARDS_URL not configured');
    } catch (e) {
      return res.status(503).send(e.message);
    }

    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let upstreamPath = pathAfter;
    // Dashboards is configured with SERVER_BASEPATH=/opensearch, so keep the prefix.
    if (!upstreamPath.startsWith(OS_PUBLIC_PREFIX)) {
      upstreamPath = `${OS_PUBLIC_PREFIX}${upstreamPath.startsWith('/') ? '' : '/'}${upstreamPath}`;
    }
    const target = `${upstream}${upstreamPath}${qs}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    // Never forward Flowlah Authorization to Dashboards.
    delete headers.authorization;
    delete headers.Authorization;

    const method = req.method || 'GET';
    const init = {
      method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(120000),
    };
    if (method !== 'GET' && method !== 'HEAD' && req.body != null) {
      if (Buffer.isBuffer(req.body)) init.body = req.body;
      else if (typeof req.body === 'string') init.body = req.body;
      else if (typeof req.body === 'object') {
        init.body = JSON.stringify(req.body);
        headers['content-type'] = headers['content-type'] || 'application/json';
      }
    }

    try {
      const upstreamRes = await fetch(target, init);
      res.status(upstreamRes.status);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const ct = upstreamRes.headers.get('content-type') || '';
      upstreamRes.headers.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (['transfer-encoding', 'connection', 'content-encoding', 'cache-control'].includes(lk)) {
          return;
        }
        if (lk === 'location') {
          let loc = value;
          if (loc.startsWith('/') && !loc.startsWith(OS_PUBLIC_PREFIX)) {
            loc = `${OS_PUBLIC_PREFIX}${loc}`;
          }
          res.setHeader(key, loc);
          return;
        }
        // Do not leak Dashboards auth cookies to the browser; Flowlah BFF cookie is the gate.
        if (lk === 'set-cookie') return;
        res.setHeader(key, value);
      });

      let buf = Buffer.from(await upstreamRes.arrayBuffer());
      if (shouldRewriteBody(ct)) {
        // Minimal rewrite: ensure absolute root asset refs stay under /opensearch when needed.
        // With SERVER_REWRITEBASEPATH=true most links are already correct.
        let text = buf.toString('utf8');
        if (!/<base\s/i.test(text) && /<head[^>]*>/i.test(text)) {
          text = text.replace(
            /<head([^>]*)>/i,
            `<head$1><base href="${OS_PUBLIC_PREFIX}/">`
          );
        }
        buf = Buffer.from(text, 'utf8');
        res.setHeader('Content-Length', buf.length);
      }
      res.end(buf);
    } catch (e) {
      res.status(502).send(`OpenSearch Dashboards proxy error: ${e.message}`);
    }
  };
}
