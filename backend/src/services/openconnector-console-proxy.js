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

export function createOcConsoleLaunchCookie(adminUser, sessionToken) {
  const st = String(sessionToken || '').trim();
  if (!st) throw new Error('OpenConnector console launch requires an active admin session');
  const payload = {
    uid: adminUser.id,
    role: 'admin',
    exp: Date.now() + COOKIE_TTL_MS,
    // Bound to Flowlah session so admin logout immediately ends console access
    st,
  };
  return {
    name: COOKIE_NAME,
    value: signPayload(payload),
    maxAgeMs: COOKIE_TTL_MS,
  };
}

/** Clear HttpOnly OC console cookie (call on Flowlah logout / OC logout). */
export function clearOcConsoleCookieHeader(secure = false) {
  return `${COOKIE_NAME}=; Path=/openconnector; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function isRequestSecure(req) {
  return String(req.protocol || '').includes('https') || req.headers?.['x-forwarded-proto'] === 'https';
}

/**
 * Cookie grants console access only while the bound Flowlah admin session is still valid.
 * After Admin → Logout (session revoked), this returns null even if the cookie is still present.
 */
export function adminFromOcConsoleCookie(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  const payload = verifySigned(cookies[COOKIE_NAME]);
  if (!payload?.st) return null;
  const user = getSessionUser(payload.st);
  if (!user || user.role !== 'admin') return null;
  if (String(user.id) !== String(payload.uid)) return null;
  return user;
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
export function createOcConsoleLaunchUrl(adminUser, sessionToken) {
  const cookie = createOcConsoleLaunchCookie(adminUser, sessionToken);
  const base = getOcConsolePublicUrl();
  const join = base.includes('?') ? '&' : '?';
  return {
    cookie,
    url: `${base}${join}oc_launch=${encodeURIComponent(cookie.value)}`,
  };
}

const OC_PUBLIC_PREFIX = '/openconnector';

/**
 * Prefix absolute OC *API/asset* paths for subpath hosting.
 * Do NOT rewrite SPA routes (/overview, /providers, …) — React Router needs those
 * unchanged when BrowserRouter basename is /openconnector (see injectOcRouterBasename).
 */
export function rewriteOcPublicPaths(text) {
  if (!text || typeof text !== 'string') return text;
  const P = OC_PUBLIC_PREFIX;
  let out = text;

  const segs = ['api/', 'v1/', 'oauth/', 'mcp/', 'assets/', 'favicon', 'openapi.json', 'docs'];
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

/**
 * Inject BrowserRouter basename so useLocation().pathname stays /overview (not /openconnector/overview).
 * OC's shell parses the first path segment as the page id — rewriting routes broke that and leaked /api to Flowlah.
 */
export function injectOcRouterBasename(text) {
  if (!text || typeof text !== 'string') return text;
  const basenames = [
    `basename:"${OC_PUBLIC_PREFIX}"`,
    `basename:'${OC_PUBLIC_PREFIX}'`,
    `basename:\`${OC_PUBLIC_PREFIX}\``,
  ];
  if (basenames.some((b) => text.includes(b))) return text;

  const markers = ['getElementById(`root`)', 'getElementById("root")', "getElementById('root')"];
  let idx = -1;
  for (const m of markers) {
    idx = text.indexOf(m);
    if (idx >= 0) break;
  }
  if (idx < 0) return text;

  const end = Math.min(text.length, idx + 500);
  const before = text.slice(0, idx);
  const region = text.slice(idx, end);
  const after = text.slice(end);
  // <BrowserRouter><App /></BrowserRouter> minified: (ur,{children:(0,V.jsx)(gy,{})})
  const updated = region.replace(
    /\((\w+),\{children:(\(0,\w+\.jsx\)\(\w+,\{\}\))\}\)/,
    `($1,{basename:"${OC_PUBLIC_PREFIX}",children:$2})`
  );
  return before + updated + after;
}

function injectOcFetchPatch(html) {
  // Keep SPA under /openconnector: rewrite fetch/XHR for APIs; hard-fix if URL escapes the prefix.
  // History is NOT rewritten here — BrowserRouter basename owns client navigations.
  const patch = `<script data-oc-path-patch>(function(){var P="${OC_PUBLIC_PREFIX}";function fixPath(u){if(typeof u!=="string")return u;if(u.startsWith("http")){try{var x=new URL(u);if(x.origin===location.origin){x.pathname=fixPath(x.pathname);return x.toString();}}catch(e){}return u;}if(!u.startsWith("/")||u.startsWith("//")||u.startsWith(P+"/")||u===P)return u;if(/^\\/(api|v1|oauth|mcp|assets|favicon|docs|openapi\\.json)/.test(u))return P+u;return u;}if(!location.pathname.startsWith(P)){var spa=/^\\/(overview|providers|actions|runs|access|resources|docs)(\\/|$)/;if(spa.test(location.pathname)){location.replace(P+location.pathname+location.search+location.hash);return;}}var f=window.fetch;window.fetch=function(i,n){if(typeof i==="string")i=fixPath(i);else if(i&&typeof i.url==="string"){try{i=new Request(fixPath(i.url),i);}catch(e){}}return f.call(this,i,n);};var XO=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(typeof u==="string")arguments[1]=fixPath(u);return XO.apply(this,arguments);};})();</script>`;
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
    const qsParams = req.url.includes('?')
      ? new URLSearchParams(req.url.slice(req.url.indexOf('?') + 1))
      : null;

    const ocLogout =
      (typeof req.query?.oc_logout === 'string' && req.query.oc_logout) ||
      qsParams?.get('oc_logout') ||
      '';
    if (ocLogout) {
      const existing = res.getHeader('Set-Cookie');
      const list = existing ? (Array.isArray(existing) ? existing.map(String) : [String(existing)]) : [];
      res.setHeader('Set-Cookie', [
        ...list,
        clearOcConsoleCookieHeader(true),
        clearOcConsoleCookieHeader(false),
      ]);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      console.info('[openconnector-console] cleared console cookie via oc_logout');
      return res.status(204).end();
    }

    // Top-level launch: ?oc_launch=<signed> sets cookie then redirects (works with window.open).
    const launchToken =
      (typeof req.query?.oc_launch === 'string' && req.query.oc_launch) ||
      qsParams?.get('oc_launch') ||
      '';
    if (launchToken) {
      const payload = verifySigned(decodeURIComponent(String(launchToken)));
      if (!payload || payload.role !== 'admin' || !payload.st) {
        return res.status(401).send('Invalid or expired OpenConnector console launch link. Use Admin → OpenConnector console.');
      }
      const sessionUser = getSessionUser(payload.st);
      if (!sessionUser || sessionUser.role !== 'admin' || String(sessionUser.id) !== String(payload.uid)) {
        return res
          .status(401)
          .send('Admin session expired. Sign in to Flowlah Admin, then open OpenConnector console again.');
      }
      const cookie = createOcConsoleLaunchCookie(sessionUser, payload.st);
      const secure = isRequestSecure(req);
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
        res.setHeader('Set-Cookie', clearOcConsoleCookieHeader(isRequestSecure(req)));
        return res.status(401).send('Admin session required. Open console from Flowlah Admin → OpenConnector console.');
      }
    }

    const isOcAuthLogout =
      (req.method || 'GET').toUpperCase() === 'POST' &&
      (pathAfter === '/api/auth/logout' || pathAfter === '/auth/logout');

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
          if (
            pathAfter.includes('/assets/') &&
            (pathAfter.endsWith('.js') || ct.includes('javascript') || ct.includes('ecmascript'))
          ) {
            text = injectOcRouterBasename(text);
            res.setHeader('Cache-Control', 'no-store');
          }
        }
        buf = Buffer.from(text, 'utf8');
        res.setHeader('Content-Length', buf.length);
      }
      if (isOcAuthLogout) {
        // Drop Flowlah OC launch cookie so console cannot stay open after OC Logout
        const prev = res.getHeader('Set-Cookie');
        const clear = clearOcConsoleCookieHeader(isRequestSecure(req));
        if (!prev) res.setHeader('Set-Cookie', clear);
        else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, clear]);
        else res.setHeader('Set-Cookie', [String(prev), clear]);
      }
      res.end(buf);
    } catch (e) {
      res.status(502).send(`OpenConnector proxy error: ${e.message}`);
    }
  };
}
