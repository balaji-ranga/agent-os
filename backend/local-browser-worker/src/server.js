/**
 * Flolah Local Browser Worker - Windows laptop process.
 * Persistent Chromium profile (cookies/login survive restarts). Headed by default.
 * Loopback HTTP + outbound job pull to Flolah.
 */
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WORKER_VERSION = '2.1.1';
const PROTOCOL_VERSION = 1;

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
/**
 * Preferred for Google account sign-in: attach to a Chrome you started yourself
 * (Start-ChromeForGoogleLogin.ps1) via CDP — Playwright launch is often blocked by Google.
 * Example: BROWSER_CDP_URL=http://127.0.0.1:9222
 */
const BROWSER_CDP_URL = String(process.env.BROWSER_CDP_URL || '').trim();
const rawUserData = String(process.env.BROWSER_USER_DATA_DIR || 'browser-profile').trim() || 'browser-profile';
const USER_DATA_DIR = isAbsolute(rawUserData) ? rawUserData : join(ROOT, rawUserData);
const NODE_FILE = join(ROOT, 'browser-node.json');

function loadOrCreateNodeId() {
  try {
    const parsed = JSON.parse(readFileSync(NODE_FILE, 'utf8'));
    if (parsed?.node_id) return String(parsed.node_id);
  } catch { /* first run */ }
  const nodeId = randomUUID();
  writeFileSync(NODE_FILE, JSON.stringify({ node_id: nodeId, created_at: new Date().toISOString() }, null, 2));
  return nodeId;
}
const NODE_ID = loadOrCreateNodeId();
const DEVICE_NAME = String(process.env.BROWSER_DEVICE_NAME || hostname() || 'Windows browser').slice(0, 120);

if (!TOKEN || !TOKEN.startsWith('bwk_')) {
  console.error('[browser-worker] BROWSER_WORKER_TOKEN missing or invalid');
  process.exit(1);
}
if (!BASE_URL) {
  console.error('[browser-worker] AGENT_OS_BASE_URL missing');
  process.exit(1);
}

mkdirSync(USER_DATA_DIR, { recursive: true });

/** @type {import('playwright').Browser | null} */
let cdpBrowser = null;
/** @type {import('playwright').BrowserContext | null} */
let context = null;
/** @type {import('playwright').Page | null} */
let page = null;
/** Stable task-to-page pins. Popups are registered but never steal another task's page. */
const taskPages = new Map();
/** Pages created by this worker may be closed at task end; attached user tabs must never be closed. */
const taskOwnedPages = new Set();

async function closeTaskPage(taskId) {
  const taskKey = String(taskId || '').trim();
  if (!taskKey) return { ok: true, closed: false, reason: 'task_id_missing' };
  const pinned = taskPages.get(taskKey);
  taskPages.delete(taskKey);
  const owned = taskOwnedPages.delete(taskKey);
  if (!pinned || pinned.isClosed()) return { ok: true, closed: false, reason: 'already_closed' };
  if (!owned) return { ok: true, closed: false, reason: 'not_worker_owned' };
  await pinned.close({ runBeforeUnload: false }).catch(() => {});
  if (page === pinned) page = null;
  return { ok: true, closed: pinned.isClosed(), reason: 'task_complete' };
}

function profileHasLocalState() {
  return (
    existsSync(join(USER_DATA_DIR, 'Default')) ||
    existsSync(join(USER_DATA_DIR, 'Local State')) ||
    existsSync(join(USER_DATA_DIR, 'Cookies'))
  );
}

async function ensureBrowser(taskId = '') {
  const taskKey = String(taskId || '').trim();
  const pinned = taskKey ? taskPages.get(taskKey) : null;
  if (pinned && !pinned.isClosed()) return pinned;
  if (taskKey && context) {
    try {
      const dedicated = await context.newPage();
      taskPages.set(taskKey, dedicated);
      taskOwnedPages.add(taskKey);
      return dedicated;
    } catch {
      // Reconnect or relaunch below when the prior context is no longer usable.
    }
  }
  if (!taskKey && page && !page.isClosed()) return page;

  // CDP attach: do not close the user's Chrome — only drop our handles.
  if (BROWSER_CDP_URL) {
    if (cdpBrowser) {
      try {
        const contexts = cdpBrowser.contexts();
        context = contexts[0] || null;
        if (context) {
          const pages = context.pages();
          page = pages.find((p) => !p.isClosed()) || (await context.newPage());
          if (taskKey) taskPages.set(taskKey, page);
          if (page && !page.isClosed()) return page;
        }
      } catch {
        cdpBrowser = null;
        context = null;
        page = null;
      }
    }
    console.info('[browser-worker] connecting over CDP %s', BROWSER_CDP_URL);
    cdpBrowser = await chromium.connectOverCDP(BROWSER_CDP_URL);
    const contexts = cdpBrowser.contexts();
    context = contexts[0] || (await cdpBrowser.newContext({ acceptDownloads: true }));
    const pages = context.pages();
    page = pages.find((p) => !p.isClosed()) || (await context.newPage());
    context.on('page', (p) => { if (!page || page.isClosed()) page = p; });
    if (taskKey) taskPages.set(taskKey, page);
    console.info('[browser-worker] browser ready via CDP contexts=%s', contexts.length);
    return page;
  }

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
    args: ['--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    // Helps Google account sign-in (Playwright Chromium is often blocked as "not secure").
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: true,
  };
  if (channel) launchOpts.channel = channel;
  context = await chromium.launchPersistentContext(USER_DATA_DIR, launchOpts);
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    } catch {
      /* ignore */
    }
  });
  const pages = context.pages();
  page = pages.length ? pages[0] : await context.newPage();
  context.on('page', (p) => { if (!page || page.isClosed()) page = p; });
  if (taskKey) {
    taskPages.set(taskKey, page);
    taskOwnedPages.add(taskKey);
  }
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

async function structuredSnapshot(p, limit = 12000) {
  const data = await p.evaluate(({ max }) => {
    const state = globalThis.__flolahSnapshotState || { href: '', generation: 0, counter: 0 };
    if (state.href !== location.href) {
      state.href = location.href;
      state.generation += 1;
      state.counter = 0;
    }
    globalThis.__flolahSnapshotState = state;
    const selector = [
      'a[href]', 'button', 'input', 'textarea', 'select', '[contenteditable="true"]',
      '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="menuitem"]', '[tabindex]'
    ].join(',');
    const elements = [];
    for (const el of document.querySelectorAll(selector)) {
      if (elements.length >= max) break;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      let localRef = el.getAttribute('data-flolah-ref');
      if (!localRef) {
        localRef = String(++state.counter);
        el.setAttribute('data-flolah-ref', localRef);
      }
      const role = el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox' }[el.tagName] || el.tagName.toLowerCase());
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const sensitive = type === 'password' || /password|secret|token|card number|cvv/i.test(String(el.getAttribute('aria-label') || el.getAttribute('name') || ''));
      elements.push({
        ref: `g${state.generation}-e${localRef}`,
        role,
        name: String(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('name') || '').trim().slice(0, 180),
        enabled: !el.disabled,
        visible: true,
        editable: el.matches('input,textarea,[contenteditable="true"]'),
        sensitive,
        focused: document.activeElement === el,
        bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      });
    }
    return {
      protocol_version: 1,
      page: { url: location.href, title: document.title, navigation_generation: state.generation },
      elements,
      dialogs: [...document.querySelectorAll('[role="dialog"],dialog[open]')].slice(0, 20).map((el) => ({
        role: 'dialog', name: String(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 240),
      })),
    };
  }, { max: Math.max(20, Math.min(1000, Math.floor(Number(limit) / 30) || 400)) });
  const text = data.elements.map((el) => `- ${el.role} "${el.name}" [ref=${el.ref}]${el.enabled ? '' : ' [disabled]'}`).join('\n');
  return { ...data, text: `URL: ${data.page.url}\nTitle: ${data.page.title}\n\n${text}`.slice(0, Math.max(1000, Number(limit) || 12000)) };
}

function failureCode(error) {
  const message = String(error?.message || error || '');
  if (/not found|not visible/i.test(message)) return 'TARGET_NOT_FOUND';
  if (/closed/i.test(message)) return 'PAGE_CLOSED';
  if (/timeout/i.test(message)) return 'ACTION_TIMEOUT';
  return 'ACTION_FAILED';
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
  if (await clickByTextViaCdp(p, target).catch(() => false)) return;
  if (target.startsWith('#') || target.startsWith('.') || target.startsWith('[')) {
    await p.click(target, { timeout: 10000 });
    return;
  }
  throw new Error('Element not found or not visible for "' + target.slice(0, 80) + '"');
}

/**
 * Chromium fallback for controls hidden behind closed/encapsulated shadow roots.
 * DOM.getFlattenedDocument with pierce=true sees those nodes; Input mouse events
 * preserve a real user-like click instead of invoking an untrusted JS click.
 */
async function clickByTextViaCdp(p, label) {
  const session = await p.context().newCDPSession(p);
  try {
    await session.send('DOM.enable');
    const { nodes = [] } = await session.send('DOM.getFlattenedDocument', { depth: -1, pierce: true });
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const children = new Map();
    for (const node of nodes) {
      if (!node.parentId) continue;
      if (!children.has(node.parentId)) children.set(node.parentId, []);
      children.get(node.parentId).push(node.nodeId);
    }
    const textMemo = new Map();
    const nodeText = (id) => {
      if (textMemo.has(id)) return textMemo.get(id);
      const node = byId.get(id);
      if (!node) return '';
      const own = node.nodeType === 3 ? String(node.nodeValue || '') : '';
      const nested = (children.get(id) || []).map(nodeText).join(' ');
      const value = `${own} ${nested}`.replace(/\s+/g, ' ').trim();
      textMemo.set(id, value);
      return value;
    };
    const wanted = String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const candidates = [];
    for (const node of nodes) {
      if (node.nodeType !== 1) continue;
      const attrs = {};
      for (let i = 0; i < (node.attributes || []).length; i += 2) {
        attrs[String(node.attributes[i] || '').toLowerCase()] = String(node.attributes[i + 1] || '');
      }
      const tag = String(node.nodeName || '').toLowerCase();
      const interactive = tag === 'button' || tag === 'a' || ['button', 'link', 'menuitem'].includes(String(attrs.role || '').toLowerCase());
      if (!interactive) continue;
      const rendered = [attrs['aria-label'], attrs.title, attrs.value, nodeText(node.nodeId)]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!rendered) continue;
      const exact = rendered === wanted || String(attrs['aria-label'] || '').trim().toLowerCase() === wanted;
      if (exact || rendered.includes(wanted)) candidates.push({ node, exact, length: rendered.length });
    }
    candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || a.length - b.length);
    for (const { node } of candidates) {
      try {
        const { model } = await session.send('DOM.getBoxModel', { backendNodeId: node.backendNodeId });
        const quad = model?.border || model?.content;
        if (!quad || quad.length < 8) continue;
        const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
        await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
        return true;
      } catch {
        /* try next matching control */
      }
    }
    return false;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function locatorForRef(p, ref) {
  const match = /^g(\d+)-e(.+)$/.exec(String(ref || ''));
  if (!match) return null;
  const currentGeneration = await p.evaluate(() => Number(globalThis.__flolahSnapshotState?.generation || 0));
  if (currentGeneration !== Number(match[1])) {
    throw Object.assign(new Error('Snapshot reference is stale after navigation or rerender'), { code: 'STALE_REF' });
  }
  return p.locator(`[data-flolah-ref="${match[2].replace(/"/g, '')}"]`);
}

async function runAction(action, args = {}) {
  const act = String(action || '').toLowerCase();
  const taskKey = String(args.task_id || '').trim();
  if (act === 'task_cleanup' || act === 'close_task') {
    return closeTaskPage(taskKey);
  }
  let p = await ensureBrowser(taskKey);
  if (taskKey && taskPages.get(taskKey)?.isClosed()) {
    taskPages.delete(taskKey);
    taskOwnedPages.delete(taskKey);
  }
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
    const snapshot = await structuredSnapshot(p, Number(args.limit) || 12000).catch(async () => {
      const text = await accessibilitySnapshot(p, Number(args.limit) || 12000);
      return { protocol_version: 1, page: { url: p.url(), title: await p.title().catch(() => '') }, elements: [], text };
    });
    return { ok: true, text: snapshot.text, snapshot: snapshot.text, structured_snapshot: snapshot };
  }
  if (act === 'screenshot') {
    const fullPage = args.full_page !== false && args.fullPage !== false;
    const image = await p.screenshot({ type: 'png', fullPage, animations: 'disabled' });
    return {
      ok: true,
      mime_type: 'image/png',
      filename: `browser-${taskKey || Date.now()}.png`,
      screenshot_base64: image.toString('base64'),
      url: p.url(),
      title: await p.title().catch(() => ''),
      full_page: fullPage,
    };
  }
  if (act === 'action_batch' || act === 'batch') {
    const actions = Array.isArray(args.actions) ? args.actions.slice(0, 20) : [];
    const results = [];
    for (const action of actions) {
      try {
        const result = await runAction(action.kind || action.action || 'act', { ...action, task_id: taskKey, request: action });
        results.push({ ok: true, result });
      } catch (error) {
        results.push({ ok: false, error: error.message, failure_code: failureCode(error) });
        if (args.stop_on_failure !== false) break;
      }
    }
    const snapshot = args.return_snapshot ? await structuredSnapshot(p, Number(args.limit) || 12000) : null;
    return { ok: results.every((item) => item.ok), result_state: 'action_applied', results, structured_snapshot: snapshot };
  }
  if (act === 'act' || act === 'click' || act === 'type' || act === 'press' || act === 'scroll') {
    const req = args.request && typeof args.request === 'object' ? args.request : args;
    const kind = String(req.kind || act || 'click').toLowerCase();
    const ref = String(req.ref || args.ref || '').trim();
    const text = req.text != null ? String(req.text) : args.text != null ? String(args.text) : '';
    if (kind === 'click' || act === 'click') {
      const refLocator = await locatorForRef(p, ref);
      if (refLocator) await refLocator.click({ timeout: 15000 });
      else if (ref) await clickByTextOrSelector(p, ref);
      else if (text) await clickByTextOrSelector(p, text);
      else if (req.selector) await p.click(String(req.selector), { timeout: 15000 });
      else throw new Error('click requires ref, text, or selector');
      return { ok: true, kind: 'click' };
    }
    if (kind === 'type' || act === 'type') {
      const refLocator = await locatorForRef(p, ref);
      if (refLocator) await refLocator.fill(text, { timeout: 15000 });
      else if (req.selector) await p.fill(String(req.selector), text, { timeout: 15000 });
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
  // OpenClaw / browse recipes sometimes emit "start" after open — treat as no-op if already on a page,
  // otherwise navigate when a URL is provided.
  if (act === 'start' || act === 'browser_start') {
    const url = String(args.url || args.targetUrl || args.startUrl || '').trim();
    if (url) {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    }
    return {
      ok: true,
      action: 'start',
      url: p.url(),
      title: await p.title().catch(() => ''),
    };
  }
  throw new Error('unsupported action: ' + act);
}

function workerCapabilities() {
  return {
    protocol_version: PROTOCOL_VERSION,
    actions: ['open', 'snapshot', 'screenshot', 'act', 'action_batch', 'status', 'evaluate', 'wait', 'start', 'task_cleanup'],
    structured_snapshot: true,
    action_batch: true,
    screenshots: true,
    persistent_profile: true,
    headless: HEADLESS,
    user_data_dir_configured: true,
  };
}

async function cloudFetch(path, { method = 'GET', body = null, retries = 2 } = {}) {
  const url = BASE_URL + '/api/browser-worker/v1' + path;
  const maxAttempts = Math.max(1, Number(retries || 0) + 1);
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
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
      if (res.ok) return json;
      const detail = String(json?.error || json?.message || text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
      const err = new Error(`HTTP ${res.status}${detail ? ': ' + detail : ''}`);
      err.status = res.status;
      lastError = err;
      if (res.status < 500 && res.status !== 429) throw err;
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      if (status > 0 && status < 500 && status !== 429) throw error;
    }
    if (attempt < maxAttempts) {
      const delay = Math.min(10000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError || new Error('Cloud request failed');
}

function driverMode() {
  if (BROWSER_CDP_URL) return 'chrome_cdp';
  if (BROWSER_CHANNEL === 'chrome' || BROWSER_CHANNEL === 'msedge') return `playwright_${BROWSER_CHANNEL}`;
  return 'playwright_persistent';
}

async function registerAndHeartbeat() {
  await cloudFetch('/register', {
    method: 'POST',
    body: {
      worker_version: WORKER_VERSION,
      protocol_version: PROTOCOL_VERSION,
      node_id: NODE_ID,
      device_name: DEVICE_NAME,
      driver_mode: driverMode(),
      capabilities: workerCapabilities(),
    },
  });
}

async function jobLoop() {
  let consecutiveErrors = 0;
  while (true) {
    try {
      const pulled = await cloudFetch(`/jobs?wait_ms=25000&node_id=${encodeURIComponent(NODE_ID)}&worker_version=${encodeURIComponent(WORKER_VERSION)}&driver_mode=${encodeURIComponent(driverMode())}&protocol_version=${PROTOCOL_VERSION}`, { method: 'GET' });
      const job = pulled?.job || null;
      if (!job?.id) {
        await cloudFetch('/heartbeat', {
          method: 'POST',
          body: {
            worker_version: WORKER_VERSION,
            protocol_version: PROTOCOL_VERSION,
            node_id: NODE_ID,
            device_name: DEVICE_NAME,
            driver_mode: driverMode(),
            capabilities: workerCapabilities(),
          },
        }).catch(() => {});
        consecutiveErrors = 0;
        continue;
      }
      console.info('[browser-worker] job id=%s action=%s', job.id, job.action);
      try {
        const result = await runAction(job.action, job.args || {});
        await cloudFetch('/jobs/' + encodeURIComponent(job.id) + '/result', {
          method: 'POST',
          body: { ok: true, result, node_id: NODE_ID, result_state: result?.result_state || 'outcome_verified' },
        });
      } catch (e) {
        console.warn('[browser-worker] job fail id=%s: %s', job.id, e.message);
        await cloudFetch('/jobs/' + encodeURIComponent(job.id) + '/result', {
          method: 'POST',
          body: { ok: false, error: e.message || String(e), node_id: NODE_ID, failure_code: failureCode(e), result_state: 'outcome_not_observed' },
        });
      }
      consecutiveErrors = 0;
    } catch (e) {
      consecutiveErrors += 1;
      if (consecutiveErrors === 1 || consecutiveErrors % 5 === 0) {
        console.warn('[browser-worker] job loop error attempt=%s: %s', consecutiveErrors, e.message || e);
      }
      if (consecutiveErrors % 3 === 0) {
        await registerAndHeartbeat().catch(() => {});
      }
      const delay = Math.min(30000, 2000 * 2 ** Math.min(consecutiveErrors - 1, 4));
      await new Promise((r) => setTimeout(r, delay));
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
        protocol_version: PROTOCOL_VERSION,
        node_id: NODE_ID,
        device_name: DEVICE_NAME,
        driver_mode: driverMode(),
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
