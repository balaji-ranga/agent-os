/**
 * Flolah Local Browser Worker - Windows laptop process.
 * Persistent Chromium profile (cookies/login survive restarts). Headed by default.
 * Loopback HTTP + outbound job pull to Flolah.
 */
import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_VERSION = '1.1.0';

function loadEnvFile() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvFile();

const TOKEN = String(process.env.BROWSER_WORKER_TOKEN || '').trim();
const BASE_URL = String(process.env.AGENT_OS_BASE_URL || '').replace(/\/$/, '').replace(/\/api$/i, '');
const LOOPBACK_HOST = String(process.env.LOOPBACK_HOST || '127.0.0.1').trim();
const LOOPBACK_PORT = Number(process.env.LOOPBACK_PORT || 3020);
// Default headed (0). Only force headless when explicitly 1/true/yes.
const HEADLESS = ['1', 'true', 'yes'].includes(String(process.env.BROWSER_HEADLESS ?? '0').toLowerCase());
const HEARTBEAT_MS = Math.max(10000, Number(process.env.HEARTBEAT_MS || 30000));
/** Use installed Chrome for Google login: set BROWSER_CHANNEL=chrome (avoids "browser may not be secure"). */
const BROWSER_CHANNEL = String(process.env.BROWSER_CHANNEL || '').trim().toLowerCase();
const rawUserData = String(process.env.BROWSER_USER_DATA_DIR || 'browser-profile').trim() || 'browser-profile';
const USER_DATA_DIR = isAbsolute(rawUserData) ? rawUserData : join(ROOT, rawUserData);

if (!TOKEN || !TOKEN.startsWith('bwk_')) {
  console.error('[browser-worker] BROWSER_WORKER_TOKEN missing or invalid');
  process.exit(1);
}
if (!BASE_URL) {
  console.error('[browser-worker] AGENT_OS_BASE_URL missing');
  process.exit(1);
}

mkdirSync(USER_DATA_DIR, { recursive: true });

/** @type {import('playwright').BrowserContext | null} */
let context = null;
/** @type {import('playwright').Page | null} */
let page = null;

function profileHasLocalState() {
  return (
    existsSync(join(USER_DATA_DIR, 'Default')) ||
    existsSync(join(USER_DATA_DIR, 'Local State')) ||
    existsSync(join(USER_DATA_DIR, 'Cookies'))
  );
}

async function ensureBrowser() {
  if (page && !page.isClosed()) return page;
  if (context) {
    try {
      await context.close();
    } catch {
      /* ignore */
    }
    context = null;
    page = null;
  }
  const channel = BROWSER_CHANNEL === 'chrome' || BROWSER_CHANNEL === 'msedge' ? BROWSER_CHANNEL : '';
  console.info(
    '[browser-worker] launching persistent browser headless=%s channel=%s profile=%s existing=%s',
    HEADLESS,
    channel || 'chromium',
    USER_DATA_DIR,
    profileHasLocalState()
  );
  const launchOpts = {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-dev-shm-usage'],
    // Helps Google account sign-in (Playwright Chromium is often blocked as "not secure").
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true,
  };
  if (channel) launchOpts.channel = channel;
  context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts);
  const pages = context.pages();
  page = pages.length ? pages[0] : await context.newPage();
  context.on('page', (p) => {
    page = p;
  });
  console.info(
    '[browser-worker] browser ready headless=%s channel=%s persistent=true',
    HEADLESS,
    channel || 'chromium'
  );
  return page;
}

function timingSafeEqualStr(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
function checkLocalAuth(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  return m ? timingSafeEqualStr(m[1], TOKEN) : false;
}
function assertLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  if (['127.0.0.1', '::1', 'localhost'].includes(h)) return;
  if (process.env.BROWSER_WORKER_ALLOW_NON_LOOPBACK === '1') return;
  throw new Error('LOOPBACK_HOST must be loopback; got ' + host);
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function formatA11y(node, depth) {
  if (!node) return [];
  const name = node.name ? ' "' + String(node.name).slice(0, 120) + '"' : '';
  const lines = ['  '.repeat(depth) + '- ' + (node.role || 'node') + name];
  for (const c of node.children || []) lines.push(...formatA11y(c, depth + 1));
  return lines;
}
async function accessibilitySnapshot(p, limit = 12000) {
  let snap = '';
  try {
    snap = formatA11y(await p.accessibility.snapshot({ interestingOnly: true }), 0).join('\n');
  } catch (e) {
    snap = '(a11y failed: ' + e.message + ')';
  }
  const body =
    'URL: ' +
    p.url() +
    '\nTitle: ' +
    (await p.title().catch(() => '')) +
    '\n\n' +
    snap;
  return body.slice(0, Math.max(1000, Number(limit) || 12000));
}
async function clickByTextOrSelector(p, label) {
  const target = String(label || '').trim();
  if (!target) throw new Error('empty click target');
  try {
    await p.getByRole('button', { name: new RegExp(escapeRe(target), 'i') }).first().click({ timeout: 8000 });
    return;
  } catch {
    /* next */
  }
  try {
    await p.getByText(new RegExp(escapeRe(target), 'i')).first().click({ timeout: 8000 });
    return;
  } catch {
    /* next */
  }
  if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[')) {
    await p.click(target, { timeout: 10000 });
    return;
  }
  throw new Error('Element not found or not visible for "' + target.slice(0, 80) + '"');
}

async function runAction(action, args = {}) {
  const act = String(action || '').toLowerCase();
  const p = await ensureBrowser();
  if (act === 'status' || act === 'browser_status') {
    return {
      ok: true,
      worker_version: WORKER_VERSION,
      url: p.url(),
      headless: HEADLESS,
      driver: 'playwright',
      persistent_profile: true,
      user_data_dir: USER_DATA_DIR,
      profile_has_data: profileHasLocalState(),
    };
  }
  if (act === 'open' || (act === 'navigate' && args.url)) {
    const url = String(args.url || args.targetUrl || '').trim();
    if (!url) throw new Error('url required');
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    return { ok: true, url: p.url(), title: await p.title().catch(() => '') };
  }
  if (act === 'snapshot') {
    const text = await accessibilitySnapshot(p, Number(args.limit) || 12000);
    return { ok: true, text, snapshot: text };
  }
  if (act === 'act' || act === 'click' || act === 'type' || act === 'press' || act === 'scroll') {
    const req = args.request && typeof args.request === 'object' ? args.request : args;
    const kind = String(req.kind || act || 'click').toLowerCase();
    const ref = String(req.ref || args.ref || '').trim();
    const text = req.text != null ? String(req.text) : args.text != null ? String(args.text) : '';
    if (kind === 'click' || act === 'click') {
      if (ref) await clickByTextOrSelector(p, ref);
      else if (text) await clickByTextOrSelector(p, text);
      else if (req.selector) await p.click(String(req.selector), { timeout: 15000 });
      else throw new Error('click requires ref, text, or selector');
      return { ok: true, kind: 'click' };
    }
    if (kind === 'type' || act === 'type') {
      if (req.selector) await p.fill(String(req.selector), text, { timeout: 15000 });
      else await p.keyboard.type(text, { delay: 15 });
      return { ok: true, kind: 'type', length: text.length };
    }
    if (kind === 'press' || act === 'press') {
      await p.keyboard.press(String(req.key || args.key || 'Enter'));
      return { ok: true, kind: 'press' };
    }
    if (kind === 'scroll' || act === 'scroll') {
      const dir = String(req.direction || 'down').toLowerCase();
      await p.mouse.wheel(0, dir === 'up' ? -800 : 800);
      return { ok: true, kind: 'scroll', direction: dir };
    }
    if (kind === 'evaluate' && (req.fn || req.expression || args.fn)) {
      const result = await p.evaluate(String(req.fn || req.expression || args.fn));
      return { ok: true, kind: 'evaluate', result };
    }
    throw new Error('unsupported act kind: ' + kind);
  }
  if (act === 'evaluate') {
    const fnBody = String(args.fn || args.expression || '');
    if (!fnBody) throw new Error('fn required');
    return { ok: true, result: await p.evaluate(fnBody) };
  }
  if (act === 'wait') {
    await new Promise((r) => setTimeout(r, Math.min(30000, Number(args.ms || args.timeout || 1500))));
    return { ok: true };
  }
  throw new Error('unsupported action: ' + act);
}

function workerCapabilities() {
  return {
    actions: ['open', 'snapshot', 'act', 'status', 'evaluate'],
    persistent_profile: true,
    headless: HEADLESS,
    user_data_dir_configured: true,
  };
}

async function cloudFetch(path, { method = 'GET', body = null } = {}) {
  const url = BASE_URL + '/api/browser-worker/v1' + path;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error || 'HTTP ' + res.status);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function registerAndHeartbeat() {
  await cloudFetch('/register', {
    method: 'POST',
    body: {
      worker_version: WORKER_VERSION,
      driver_mode: 'playwright_persistent',
      capabilities: workerCapabilities(),
    },
  });
}

async function jobLoop() {
  while (true) {
    try {
      const pulled = await cloudFetch('/jobs?wait_ms=25000', { method: 'GET' });
      const job = pulled?.job || null;
      if (!job?.id) {
        await cloudFetch('/heartbeat', {
          method: 'POST',
          body: {
            worker_version: WORKER_VERSION,
            driver_mode: 'playwright_persistent',
            capabilities: workerCapabilities(),
          },
        }).catch(() => {});
        continue;
      }
      console.info('[browser-worker] job id=%s action=%s', job.id, job.action);
      try {
        const result = await runAction(job.action, job.args || {});
        await cloudFetch('/jobs/' + encodeURIComponent(job.id) + '/result', {
          method: 'POST',
          body: { ok: true, result },
        });
      } catch (e) {
        console.warn('[browser-worker] job fail id=%s: %s', job.id, e.message);
        await cloudFetch('/jobs/' + encodeURIComponent(job.id) + '/result', {
          method: 'POST',
          body: { ok: false, error: e.message || String(e) },
        });
      }
    } catch (e) {
      console.warn('[browser-worker] job loop error: %s', e.message || e);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

function startLoopbackServer() {
  assertLoopbackHost(LOOPBACK_HOST);
  const server = createServer(async (req, res) => {
    try {
      if (!checkLocalAuth(req) && req.url !== '/health') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const u = new URL(req.url || '/', 'http://' + LOOPBACK_HOST);
      if (req.method === 'GET' && u.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            worker_version: WORKER_VERSION,
            loopback: true,
            headless: HEADLESS,
            persistent_profile: true,
            profile_has_data: profileHasLocalState(),
          })
        );
        return;
      }
      if (req.method === 'POST' && u.pathname.startsWith('/v1/')) {
        const action = u.pathname.slice('/v1/'.length).split('/')[0];
        const bufs = [];
        for await (const c of req) bufs.push(c);
        let args = {};
        const raw = Buffer.concat(bufs).toString('utf8');
        if (raw.trim()) {
          try {
            args = JSON.parse(raw);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid JSON body' }));
            return;
          }
        }
        const result = await runAction(action, args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message || String(e) }));
    }
  });
  server.listen(LOOPBACK_PORT, LOOPBACK_HOST, () => {
    console.info('[browser-worker] loopback http://%s:%s', LOOPBACK_HOST, LOOPBACK_PORT);
  });
}

async function main() {
  console.info(
    '[browser-worker] starting version=%s base=%s headless=%s profile=%s',
    WORKER_VERSION,
    BASE_URL,
    HEADLESS,
    USER_DATA_DIR
  );
  await ensureBrowser();
  try {
    await registerAndHeartbeat();
    console.info('[browser-worker] registered with Flolah');
  } catch (e) {
    console.error('[browser-worker] register failed: %s', e.message || e);
    process.exit(1);
  }
  startLoopbackServer();
  setInterval(() => {
    cloudFetch('/heartbeat', {
      method: 'POST',
      body: {
        worker_version: WORKER_VERSION,
        driver_mode: 'playwright_persistent',
        capabilities: workerCapabilities(),
      },
    }).catch((e) => console.warn('[browser-worker] heartbeat failed: %s', e.message || e));
  }, HEARTBEAT_MS);
  jobLoop().catch((e) => {
    console.error('[browser-worker] fatal: %s', e.message || e);
    process.exit(1);
  });
}
main().catch((e) => {
  console.error('[browser-worker] fatal: %s', e.message || e);
  process.exit(1);
});
