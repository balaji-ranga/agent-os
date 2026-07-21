/**
 * Admin-only OpenConnector console reverse proxy + short-lived launch cookie.
 * OAuth callback paths under /openconnector/oauth stay public (provider redirects).
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { getSessionUser } from './auth/session.js';
import { getOpenConnectorEnvConfig } from './openconnector.js';

const COOKIE_NAME = 'agent_os_oc_console';
const COOKIE_TTL_MS = 8 * 60 * 60 * 1000;

function cookieSecret() {
  return (
    String(process.env.AGENT_OS_INTERNAL_TOKEN || '').trim() ||
    String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim() ||
    'dev-oc-console-secret'
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

export function createOcConsoleLaunchCookie(adminUser) {
  const payload = {
    uid: adminUser.id,
    role: 'admin',
    exp: Date.now() + COOKIE_TTL_MS,
  };
  return {
    name: COOKIE_NAME,
    value: signPayload(payload),
    maxAgeMs: COOKIE_TTL_MS,
  };
}

export function adminFromOcConsoleCookie(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const payload = verifySigned(cookies[COOKIE_NAME]);
  if (!payload) return null;
  return { id: payload.uid, role: 'admin' };
}

function ocUpstreamBase() {
  const env = getOpenConnectorEnvConfig();
  const base = String(env.url || process.env.OPENCONNECTOR_URL || '').replace(/\/$/, '');
  if (!base) throw new Error('OPENCONNECTOR_URL not configured');
  return base;
}

function adminBearer() {
  const token = String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim();
  if (!token) throw new Error('OPENCONNECTOR_ADMIN_TOKEN not configured');
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}

/** Public origin for OAuth callbacks + console links (browser-facing). */
export function getOpenConnectorPublicOrigin() {
  return (
    String(process.env.OPENCONNECTOR_PUBLIC_ORIGIN || '').trim().replace(/\/$/, '') ||
    String(process.env.OOMOL_CONNECT_ORIGIN || '').trim().replace(/\/$/, '') ||
    ''
  );
}

export function getOcConsolePublicUrl() {
  const origin = getOpenConnectorPublicOrigin();
  if (origin) {
    // Path-style origin already includes /openconnector
    if (/\/openconnector\/?$/i.test(origin)) return origin.replace(/\/$/, '') + '/';
    return `${origin}/`;
  }
  return '/openconnector/';
}

/** One-time launch URL so window.open can set the cookie via top-level navigation. */
export function createOcConsoleLaunchUrl(adminUser) {
  const cookie = createOcConsoleLaunchCookie(adminUser);
  const base = getOcConsolePublicUrl();
  const join = base.includes('?') ? '&' : '?';
  return {
    cookie,
    url: `${base}${join}oc_launch=${encodeURIComponent(cookie.value)}`,
  };
}

const OC_PUBLIC_PREFIX = '/openconnector';

/** Prefix absolute OC paths so the console works behind /openconnector/ */
export function rewriteOcPublicPaths(text) {
  if (!text || typeof text !== 'string') return text;
  const P = OC_PUBLIC_PREFIX;
  let out = text;

  // Longer SPA routes first so /providers/:service is not partially mishandled
  const spaPaths = [
    '/providers/:service',
    '/actions/:actionId',
    '/overview',
    '/providers',
    '/actions',
    '/runs',
    '/access',
    '/resources',
    '/openapi.json',
    '/docs',
  ];
  for (const from of spaPaths) {
    const to = `${P}${from}`;
    for (const q of ['"', "'", '`']) {
      out = out.replaceAll(`${q}${from}`, `${q}${to}`);
    }
  }

  const segs = ['api/', 'v1/', 'oauth/', 'mcp/', 'assets/', 'favicon'];
  for (const seg of segs) {
    const from = `/${seg}`;
    const to = `${P}${from}`;
    for (const q of ['"', "'", '`']) {
      out = out.replaceAll(`${q}${from}`, `${q}${to}`);
    }
  }
  // Bare /oauth or /mcp route segments (no trailing slash)
  for (const seg of ['oauth', 'mcp']) {
    for (const q of ['"', "'", '`']) {
      out = out.replaceAll(`${q}/${seg}${q}`, `${q}${P}/${seg}${q}`);
    }
  }
  // window.location.origin + "/api/..." in template strings
  out = out.replaceAll('location.origin}/api/', `location.origin}${P}/api/`);
  out = out.replaceAll('location.origin}/v1/', `location.origin}${P}/v1/`);
  return out;
}

function injectOcFetchPatch(html) {
  // Keep SPA under /openconnector: rewrite fetch, XHR, and history so API/routes never hit Flowlah root.
  const patch = `<script data-oc-path-patch>(function(){var P="${OC_PUBLIC_PREFIX}";function fixPath(u){if(typeof u!=="string")return u;if(u.startsWith("http")){try{var x=new URL(u);if(x.origin===location.origin){x.pathname=fixPath(x.pathname);return x.toString();}}catch(e){}return u;}if(!u.startsWith("/")||u.startsWith("//")||u.startsWith(P+"/")||u===P)return u;if(/^\\/(api|v1|oauth|mcp|assets|favicon|overview|providers|actions|runs|access|resources|docs|openapi\\.json)/.test(u))return P+u;return u;}if(!location.pathname.startsWith(P)){var spa=/^\\/(overview|providers|actions|runs|access|resources|docs)(\\/|$)/;if(spa.test(location.pathname)){location.replace(P+location.pathname+location.search+location.hash);return;}}var f=window.fetch;window.fetch=function(i,n){if(typeof i==="string")i=fixPath(i);else if(i&&typeof i.url==="string"){try{i=new Request(fixPath(i.url),i);}catch(e){}}return f.call(this,i,n);};var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(typeof u==="string")arguments[1]=fixPath(u);return XO.apply(this,arguments);};var ps=history.pushState.bind(history);var rs=history.replaceState.bind(history);history.pushState=function(s,t,u){return ps(s,t,u==null?u:fixPath(String(u)));};history.replaceState=function(s,t,u){return rs(s,t,u==null?u:fixPath(String(u)));};})();</script>`;
  if (html.includes('data-oc-path-patch')) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${patch}`);
  }
  return patch + html;
}

function rewriteHtmlResponse(html) {
  let out = html
    .replace(/(href|src)=["']\//g, `$1="${OC_PUBLIC_PREFIX}/`)
    .replace(/url\(\//g, `url(${OC_PUBLIC_PREFIX}/`);
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${OC_PUBLIC_PREFIX}/">`);
  }
  out = rewriteOcPublicPaths(out);
  out = injectOcFetchPatch(out);
  return out;
}

function shouldRewriteBody(contentType, pathAfter) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html')) return true;
  if (ct.includes('javascript') || ct.includes('ecmascript')) return true;
  if (ct.includes('text/css')) return true;
  // Fallback for .js paths when upstream sends generic octet-stream
  if (pathAfter.includes('/assets/') && (pathAfter.endsWith('.js') || pathAfter.endsWith('.css'))) return true;
  return false;
}

/**
 * Express middleware: proxy /openconnector/* to OpenConnector.
 * - /openconnector/oauth/* : public (no admin gate)
 * - everything else: requires admin session (Bearer or launch cookie)
 */
export function openConnectorConsoleProxy() {
  return async function ocConsoleProxy(req, res) {
    const pathAfter = req.path || '/';
    const isOauth = pathAfter === '/oauth' || pathAfter.startsWith('/oauth/');

    // Top-level launch: ?oc_launch=<signed> sets cookie then redirects (works with window.open).
    const launchToken =
      (typeof req.query?.oc_launch === 'string' && req.query.oc_launch) ||
      (() => {
        const q = req.url.includes('?') ? new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1)) : null;
        return q?.get('oc_launch') || '';
      })();
    if (launchToken) {
      const payload = verifySigned(decodeURIComponent(String(launchToken)));
      if (!payload || payload.role !== 'admin') {
        return res.status(401).send('Invalid or expired OpenConnector console launch link. Use Admin → OpenConnector console.');
      }
      const cookie = {
        name: COOKIE_NAME,
        value: signPayload({ uid: payload.uid, role: 'admin', exp: Date.now() + COOKIE_TTL_MS }),
        maxAgeMs: COOKIE_TTL_MS,
      };
      const secure =
        String(req.protocol || '').includes('https') || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader(
        'Set-Cookie',
        `${cookie.name}=${encodeURIComponent(cookie.value)}; Path=/openconnector; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(cookie.maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
      );
      return res.redirect(302, '/openconnector/');
    }

    if (!isOauth) {
      let admin = null;
      if (req.authUser?.role === 'admin') admin = req.authUser;
      if (!admin) admin = adminFromOcConsoleCookie(req);
      if (!admin) {
        // Allow Bearer session from SPA if Authorization present
        const auth = String(req.headers.authorization || '');
        if (auth.startsWith('Bearer ')) {
          const user = getSessionUser(auth.slice(7).trim());
          if (user?.role === 'admin') admin = user;
        }
      }
      if (!admin) {
        return res.status(401).send('Admin session required. Open console from Flowlah Admin → OpenConnector console.');
      }
    }

    let upstream;
    try {
      upstream = ocUpstreamBase();
    } catch (e) {
      return res.status(503).send(e.message);
    }

    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    // SPA client routes (/overview, /providers, …) must hit OC index — already served by OC.
    // Never forward the public prefix to upstream.
    let upstreamPath = pathAfter;
    if (upstreamPath.startsWith('/openconnector')) {
      upstreamPath = upstreamPath.slice('/openconnector'.length) || '/';
    }
    const target = `${upstream}${upstreamPath}${qs}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    if (!isOauth) {
      headers.authorization = adminBearer();
    }

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
      const ct = upstreamRes.headers.get('content-type') || '';
      upstreamRes.headers.forEach((value, key) => {
        const lk = key.toLowerCase();
        if (['transfer-encoding', 'connection', 'content-encoding'].includes(lk)) return;
        if (lk === 'location') {
          // Keep redirects on same public prefix when possible
          const loc = value.startsWith('/') ? `/openconnector${value}` : value;
          res.setHeader(key, loc);
          return;
        }
        res.setHeader(key, value);
      });
      let buf = Buffer.from(await upstreamRes.arrayBuffer());
      if (shouldRewriteBody(ct, pathAfter)) {
        let text = buf.toString('utf8');
        if (ct.includes('text/html')) {
          text = rewriteHtmlResponse(text);
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        } else {
          text = rewriteOcPublicPaths(text);
          if (pathAfter.includes('/assets/') && pathAfter.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-store');
          }
        }
        buf = Buffer.from(text, 'utf8');
        res.setHeader('Content-Length', buf.length);
      }
      res.end(buf);
    } catch (e) {
      res.status(502).send(`OpenConnector proxy error: ${e.message}`);
    }
  };
}
