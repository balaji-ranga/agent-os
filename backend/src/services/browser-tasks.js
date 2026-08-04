/**
 * Browser tasks: autonomous observe-act loop, recorder mode, recipe replay.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';
import {
  ensureManagedBrowserReady,
  invokeBrowserAction,
  parseInvokeText,
  sleep,
} from './job-browser-auth.js';
import { resolveBrowserProfile } from './client-browser-session.js';
import {
  appendRecipeStep,
  createRecipe,
  getRecipe,
  getRecipeByName,
  publishRecipe,
  countActionableRecipeSteps,
} from './browser-recipes.js';
import { storeFeedback } from './agent-feedback.js';
import { assertUrlAllowed } from './browser-url-policy.js';

const MAX_STEPS_DEFAULT = 18;
// Backend CDP invokes use this OpenClaw agent (must have built-in browser allowed).
// Chat agents like techresearcher keep browser denied and use browse_* only.
const BROWSER_CDP_AGENT_ID = process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp';
const LOGIN_HINT_RE =
  /sign in|log in|login|authwall|password|verify you|captcha|challenge/i;

function nowIso() {
  return new Date().toISOString();
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '') ?? fallback;
  } catch {
    return fallback;
  }
}

function getTask(ceoUserId, taskId) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM browser_tasks WHERE id = ? AND ceo_user_id = ?')
    .get(taskId, ceoUserId);
  if (!row) return null;
  return {
    ...row,
    input: parseJson(row.input_json, {}),
    result: parseJson(row.result_json, null),
    steps: parseJson(row.steps_json, []),
  };
}

function updateTask(ceoUserId, taskId, patch) {
  const db = getDb();
  const cur = getTask(ceoUserId, taskId);
  if (!cur) return null;
  const status = patch.status != null ? patch.status : cur.status;
  const resultJson = patch.result != null ? JSON.stringify(patch.result) : cur.result_json;
  const stepsJson = patch.steps != null ? JSON.stringify(patch.steps) : cur.steps_json;
  const error = patch.error !== undefined ? patch.error : cur.error;
  const waitReason = patch.wait_reason !== undefined ? patch.wait_reason : cur.wait_reason;
  const recipeId = patch.recipe_id !== undefined ? patch.recipe_id : cur.recipe_id;
  db.prepare(
    `UPDATE browser_tasks SET
      status = ?, result_json = ?, steps_json = ?, error = ?, wait_reason = ?,
      recipe_id = ?, updated_at = ?
     WHERE id = ? AND ceo_user_id = ?`
  ).run(status, resultJson, stepsJson, error, waitReason, recipeId, nowIso(), taskId, ceoUserId);
  return getTask(ceoUserId, taskId);
}

const TASK_HISTORY_DAYS_DEFAULT = 7;

export function purgeBrowserTasksOlderThan(ceoUserId, days = TASK_HISTORY_DAYS_DEFAULT) {
  const db = getDb();
  const d = Math.max(1, Number(days) || TASK_HISTORY_DAYS_DEFAULT);
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const info = db
    .prepare(
      `DELETE FROM browser_tasks
       WHERE ceo_user_id = ?
         AND created_at < ?`
    )
    .run(ceoUserId, cutoff);
  if (info.changes) {
    console.info('[browser-task] purged %s tasks older than %s days ceo=%s', info.changes, d, ceoUserId);
  }
  return { deleted: info.changes || 0, days: d };
}

export function clearBrowserTasks(ceoUserId) {
  const db = getDb();
  const info = db.prepare('DELETE FROM browser_tasks WHERE ceo_user_id = ?').run(ceoUserId);
  console.info('[browser-task] cleared history ceo=%s deleted=%s', ceoUserId, info.changes || 0);
  return { ok: true, deleted: info.changes || 0 };
}

export function listBrowserTasks(
  ceoUserId,
  { limit = 10, offset = 0, days = TASK_HISTORY_DAYS_DEFAULT, purge = true } = {}
) {
  const db = getDb();
  const lim = Math.min(50, Math.max(1, Number(limit) || 10));
  const off = Math.max(0, Number(offset) || 0);
  const d = Math.max(1, Number(days) || TASK_HISTORY_DAYS_DEFAULT);
  if (purge !== false) purgeBrowserTasksOlderThan(ceoUserId, d);
  const cutoff = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
  const total =
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM browser_tasks
         WHERE ceo_user_id = ? AND created_at >= ?`
      )
      .get(ceoUserId, cutoff)?.c || 0;
  const tasks = db
    .prepare(
      `SELECT id, ceo_user_id, mode, status, goal_text, start_url, recipe_id, wait_reason, error, result_json, created_at, updated_at
       FROM browser_tasks
       WHERE ceo_user_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(ceoUserId, cutoff, lim, off)
    .map((row) => ({ ...row, result: parseJson(row.result_json, null) }));
  return { tasks, total, limit: lim, offset: off, days: d, has_more: off + tasks.length < total };
}


async function getCurrentPageUrl(ceoUserId, agentId = 'workflowbuilder') {
  try {
    const ev = await browserInvoke(
      ceoUserId,
      'evaluate',
      { fn: '() => location.href', expression: '() => location.href' },
      agentId
    );
    const text = parseInvokeText(ev);
    const m = String(text || '').match(/https?:\/\/[^\s"'<>\\]+/i);
    if (m) {
      try {
        return new URL(m[0].replace(/[),.;]+$/, '')).toString();
      } catch {
        /* fall through */
      }
    }
    // Sometimes the invoke returns a bare quoted URL
    const bare = String(text || '').trim().replace(/^"|"$/g, '');
    if (/^https?:\/\//i.test(bare)) return bare;
  } catch (e) {
    console.warn('[browser-task] getCurrentPageUrl evaluate failed: %s', e.message);
  }
  try {
    const snap = await takeSnapshot(ceoUserId, agentId);
    return extractPageUrlFromSnapshot(snap);
  } catch (e) {
    console.warn('[browser-task] getCurrentPageUrl snapshot failed: %s', e.message);
  }
  return null;
}

/** Extract current page URL from an OpenClaw accessibility snapshot text. */
export function extractPageUrlFromSnapshot(text) {
  const s = String(text || '');
  const patterns = [
    /Page URL:\s*(https?:\/\/[^\s\]\|"']+)/i,
    /\burl\s*[:=]\s*[\"']?(https?:\/\/[^\s\"']+)/i,
    /Current URL:\s*(https?:\/\/[^\s\]\|"']+)/i,
    /(https?:\/\/(?:www\.)?linkedin\.com\/[^\s\]\|"']+)/i,
    /(https?:\/\/[^\s\]\|"']+)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      try {
        const u = new URL(m[1].replace(/[),.;]+$/, ''));
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
      } catch {
        /* continue */
      }
    }
  }
  return null;
}

export function getBrowserTask(ceoUserId, taskId) {
  return getTask(ceoUserId, taskId);
}

export async function waitForBrowserTask(ceoUserId, taskId, waitMs = 0) {
  const maxWait = Math.min(Math.max(Number(waitMs) || 0, 0), 90000);
  let task = getBrowserTask(ceoUserId, taskId);
  if (!task || maxWait <= 0) return task;
  const terminal = new Set(['completed', 'failed', 'blocked_on_input']);
  const deadline = Date.now() + maxWait;
  while (task && !terminal.has(String(task.status || '')) && Date.now() < deadline) {
    await sleep(1500);
    task = getBrowserTask(ceoUserId, taskId);
  }
  return task;
}

async function browserInvoke(ceoUserId, action, extra = {}, agentId = 'browser-cdp') {
  const url = String(extra.url || extra.targetUrl || '').trim();
  if ((action === 'open' || url) && url) assertUrlAllowed(ceoUserId, url);
  const { profile } = resolveBrowserProfile(ceoUserId);
  if (profile === 'openclaw') {
    await ensureManagedBrowserReady({ restartOnFailure: false });
  }
  // Keep agentId for task ownership and audit context; browser CDP invokes must use an agent not denied browser.
  const cdpAgent = BROWSER_CDP_AGENT_ID;
  return invokeBrowserAction(action, cdpAgent, { profile, ...extra });
}

async function takeSnapshot(ceoUserId, agentId = 'workflowbuilder', { limit = 6000 } = {}) {
  const snap = await browserInvoke(ceoUserId, 'snapshot', { limit }, agentId);
  return parseInvokeText(snap);
}

/**
 * Site-specific DOM helper: Cheapflights result cards can be weak in a11y trees.
 */
async function extractFlightResultsDomText(ceoUserId, agentId) {
  const fn = `() => {
    const roots = [
      document.querySelector('#flight-results-list-wrapper'),
      document.querySelector('[class*="resultsList"]'),
      document.querySelector('[data-resultid]'),
      document.querySelector('main'),
    ].filter(Boolean);
    const parts = [];
    for (const el of roots.slice(0, 3)) {
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t) parts.push(t.slice(0, 8000));
    }
    const cards = Array.from(document.querySelectorAll('[class*="result"], [data-resultid], li'))
      .slice(0, 40)
      .map((n) => (n.innerText || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 40 && /\\$|SGD|USD|h\\s|nonstop|direct/i.test(t));
    if (cards.length) parts.push(cards.slice(0, 15).join('\\n---\\n'));
    return parts.join('\\n\\n').slice(0, 16000);
  }`;
  try {
    // Chrome Browser Relay rejects top-level action=evaluate; use act kind=evaluate.
    const ev = await browserInvoke(
      ceoUserId,
      'act',
      { request: { kind: 'evaluate', fn }, fn, expression: fn },
      agentId
    );
    const text = parseInvokeText(ev);
    // act evaluate often returns JSON { ok, result: "..." }
    try {
      const j = JSON.parse(text);
      if (j && typeof j.result === 'string') return j.result.trim();
      if (j && j.result != null) return String(j.result).trim();
    } catch {
      /* plain text */
    }
    return String(text || '').trim();
  } catch (e) {
    console.warn('[browser-task] extractFlightResultsDomText failed: %s', e.message);
    return '';
  }
}

/** Generic DOM fallback for pages whose accessibility tree omits visible content. */
async function extractVisibleDomText(ceoUserId, agentId, selectors = []) {
  const requested = Array.isArray(selectors) ? selectors.filter(Boolean) : [];
  const fn = '() => {' +
    'const selectors = ' + JSON.stringify(requested) + ';' +
    'const roots = [...selectors.map((selector) => document.querySelector(selector)), document.querySelector("main"), document.body].filter(Boolean);' +
    'return roots.map((el) => (el.innerText || "").replace(/\\s+/g, " ").trim()).filter(Boolean).join("\\n\\n").slice(0, 16000);' +
  '}';
  try {
    const ev = await browserInvoke(ceoUserId, 'act', { request: { kind: 'evaluate', fn }, fn, expression: fn }, agentId);
    const text = parseInvokeText(ev);
    try { return String(JSON.parse(text)?.result ?? text ?? '').trim(); } catch { return String(text || '').trim(); }
  } catch (e) {
    console.warn('[browser-task] extractVisibleDomText failed: %s', e.message);
    return '';
  }
}

function extractJsonObject(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let slice = raw.slice(start, end + 1);
  slice = slice.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(slice);
  } catch {
    try {
      const alt = slice
        .replace(/(['"])?([a-zA-Z_][a-zA-Z0-9_]*)\1\s*:/g, '"$2":')
        .replace(/:\s*'([^']*)'/g, ':"$1"');
      return JSON.parse(alt.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

async function decideNextAction({ ceoUserId, goal, snapshot, history, startUrl }) {
  const system = `You drive a browser for a CEO. Reply with ONLY one minified JSON object. No markdown fences, no commentary.
Schema: {"action":"click|type|press|scroll|open|done|wait_login|wait_approval","ref":"","text":"","url":"","key":"","summary":"","reason":""}
Rules:
- Prefer refs from the accessibility snapshot.
- On flight search results (prices/airlines visible), action=done and put top options in summary (airline, stops, duration, price ascending). Do not book.
- wait_login if a login wall blocks the goal.
- wait_approval before pay/submit/purchase/send message.
- done when the goal is satisfied; put the answer in summary.
- Never invent credentials. Keep JSON under 500 characters when possible.`;
  const user = `Goal: ${goal}
Start URL: ${startUrl || '(current)'}
Recent steps: ${JSON.stringify(history.slice(-6))}
Snapshot (truncated):
${String(snapshot || '').slice(0, 12000)}`;

  const { content } = await chatCompletions({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: 600,
    ownerUserId: ceoUserId,
    toolName: 'browse_task_start',
  });
  const parsed = extractJsonObject(content);
  if (!parsed?.action) {
    console.warn('[browser-task] decideNextAction parse_fallback ceo=%s len=%s', ceoUserId, String(content || '').length);
    return { action: 'retry', reason: 'parse_fallback', summary: String(content || '').slice(0, 500) };
  }
  return parsed;
}

async function executeDecision(ceoUserId, decision, agentId) {
  const action = String(decision.action || '').toLowerCase();
  if (action === 'open' && decision.url) {
    return browserInvoke(ceoUserId, 'open', { url: decision.url, targetUrl: decision.url }, agentId);
  }
  if (action === 'click' && decision.ref) {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'click', ref: decision.ref }, ref: decision.ref }, agentId);
  }
  if (action === 'type' && (decision.ref || decision.text != null)) {
    return browserInvoke(
      ceoUserId,
      'act',
      { request: { kind: 'type', ref: decision.ref, text: decision.text }, ref: decision.ref, text: decision.text },
      agentId
    );
  }
  if (action === 'press' && decision.key) {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'press', key: decision.key }, key: decision.key }, agentId);
  }
  if (action === 'scroll') {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'scroll', direction: 'down' } }, agentId);
  }
  if (decision.reason || decision.text) {
    return browserInvoke(ceoUserId, 'act', { request: String(decision.reason || decision.text).slice(0, 400) }, agentId);
  }
  return { ok: true, text: '{"skipped":true}' };
}


const CITY_IATA = {
  chennai: 'MAA',
  singapore: 'SIN',
  'new york': 'NYC',
  nyc: 'NYC',
  london: 'LON',
  dubai: 'DXB',
  mumbai: 'BOM',
  delhi: 'DEL',
  bangalore: 'BLR',
  bengaluru: 'BLR',
  hyderabad: 'HYD',
  bangkok: 'BKK',
  tokyo: 'TYO',
  sydney: 'SYD',
};

function resolveIataToken(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!t) return null;
  if (/^[a-z]{3}$/i.test(t)) return t.toUpperCase();
  return CITY_IATA[t] || null;
}

const IATA_WORD_DENYLIST = new Set([
  'ONE', 'WAY', 'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL',
  'CAN', 'HAD', 'HER', 'WAS', 'HIS', 'HAS', 'TOP', 'GET', 'NEW', 'OLD',
  'ANY', 'MAY', 'DAY', 'FLY', 'OUT', 'OFF', 'VIA',
]);
const KNOWN_IATA_CODES = new Set(Object.values(CITY_IATA));

/**
 * Accept known city codes and syntactically valid unknown airport codes, but never
 * interpret common English trigrams as airports.
 */
function isPlausibleIata(code) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized) || IATA_WORD_DENYLIST.has(normalized)) return false;
  return KNOWN_IATA_CODES.has(normalized) || /^[A-Z]{3}$/.test(normalized);
}

/**
 * Optional site heuristic accelerator: prefer a Cheapflights deep search URL over fragile homepage forms.
 */
export function inferFlightSearchStartUrl(goal, startUrl = '') {
  const g = String(goal || '');
  const existing = String(startUrl || '').trim();
  if (/cheapflights\.com\/flight-search\//i.test(existing)) return existing;
  if (!/cheapflights|flight/i.test(g) && !/cheapflights\.com/i.test(existing)) return existing;

  const cityNames = Object.keys(CITY_IATA).filter((k) => k.length > 3 || k === 'nyc');
  const cityAlt = cityNames.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const cityPair = g.match(new RegExp('\\b(' + cityAlt + ')\\s+to\\s+(' + cityAlt + ')\\b', 'i'));
  let from = cityPair ? resolveIataToken(cityPair[1]) : null;
  let to = cityPair ? resolveIataToken(cityPair[2]) : null;

  if (!from || !to) {
    const codePair = g.match(/\b([A-Za-z]{3})\s*(?:→|->|\bto\b)\s*([A-Za-z]{3})\b/i);
    const candidateFrom = codePair?.[1]?.toUpperCase();
    const candidateTo = codePair?.[2]?.toUpperCase();
    if (isPlausibleIata(candidateFrom) && isPlausibleIata(candidateTo)) {
      from = candidateFrom;
      to = candidateTo;
    }
  }

  if (!from || !to) {
    const paren = [...g.matchAll(/\(([A-Za-z]{3})\)/g)].map((m) => m[1].toUpperCase());
    if (paren.length >= 2 && isPlausibleIata(paren[0]) && isPlausibleIata(paren[1])) {
      from = from || paren[0];
      to = to || paren[1];
    }
  }

  if (!from || !to) return existing;

  let date = null;
  const iso = g.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) date = iso[1] + '-' + iso[2] + '-' + iso[3];
  if (!date) {
    const mon = g.match(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?/i
    );
    if (mon) {
      const months = {
        jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
        apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
        aug: '08', august: '08', sep: '09', sept: '09', september: '09',
        oct: '10', october: '10', nov: '11', november: '11', dec: '12', december: '12',
      };
      const mName = mon[0].match(/[A-Za-z]+/)[0].toLowerCase();
      const day = String(mon[1]).padStart(2, '0');
      let year = Number(mon[2]) || new Date().getFullYear();
      if (!mon[2]) {
        const candidate = new Date(year + '-' + months[mName] + '-' + day + 'T12:00:00Z');
        if (candidate.getTime() < Date.now() - 24 * 3600 * 1000) year += 1;
      }
      date = year + '-' + months[mName] + '-' + day;
    }
  }
  if (!date) return existing;

  const nonstop = /direct|non[\s-]?stop|nonstop/i.test(g);
  let url = 'https://www.cheapflights.com/flight-search/' + from + '-' + to + '/' + date + '?sort=price_a';
  if (nonstop) url += '&fs=stops=~0';
  console.info('[browser-task] inferred cheapflights url %s → %s', existing || '(none)', url);
  return url;
}

/** Prefer LinkedIn feed/notifications deep links when the goal mentions LinkedIn and no start_url. */
export function inferLinkedInStartUrl(goal, startUrl = '') {
  const existing = String(startUrl || '').trim();
  if (existing) return existing;
  const g = String(goal || '');
  if (!/linkedin|linked\s*in/i.test(g)) return '';
  if (/notification/i.test(g)) {
    const url = 'https://www.linkedin.com/notifications/';
    console.info('[browser-task] inferred linkedin notifications url → %s', url);
    return url;
  }
  const url = 'https://www.linkedin.com/feed/';
  console.info('[browser-task] inferred linkedin feed url → %s', url);
  return url;
}

export async function startBrowserTask(ceoUserId, body = {}) {
  const mode = ['autonomous', 'recorder', 'recipe_replay'].includes(body.mode) ? body.mode : 'autonomous';
  let goal = String(body.goal || body.goal_text || '').trim();
  let startUrl = String(body.start_url || body.url || '').trim();
  if (mode === 'autonomous') {
    startUrl = inferFlightSearchStartUrl(goal, startUrl) || startUrl;
    startUrl = inferLinkedInStartUrl(goal, startUrl) || startUrl;
  }
  if (startUrl) assertUrlAllowed(ceoUserId, startUrl);
  if (!goal && mode !== 'recorder') {
    const err = new Error('goal is required');
    err.status = 400;
    throw err;
  }
  if (mode === 'recorder' && !goal) goal = body.name || 'Recorded browser session';

  const db = getDb();
  const id = `bt-${randomUUID()}`;
  const agentId = String(body.agent_id || 'workflowbuilder');
  let recipeId = body.recipe_id || null;

  if (mode === 'recipe_replay' && !recipeId) {
    const recipeName = String(body.recipe_name || body.name || '').trim();
    if (recipeName) {
      const byName = getRecipeByName(ceoUserId, recipeName);
      if (!byName) {
        const err = new Error(`Recipe not found for name "${recipeName}"`);
        err.status = 404;
        throw err;
      }
      recipeId = byName.id;
    }
  }

  if (mode === 'recorder') {
    const recipe = createRecipe(ceoUserId, {
      name: body.recipe_name || body.name || goal || `Recording ${new Date().toISOString().slice(0, 16)}`,
      description: body.description || goal,
      start_url: startUrl,
    });
    recipeId = recipe.id;
  }

  db.prepare(
    `INSERT INTO browser_tasks (
      id, ceo_user_id, agent_id, recipe_id, mode, status, goal_text, start_url,
      input_json, steps_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`
  ).run(
    id,
    ceoUserId,
    agentId,
    recipeId,
    mode,
    mode === 'recorder' ? 'recording' : 'pending',
    goal,
    startUrl,
    JSON.stringify(body.input || {}),
    nowIso(),
    nowIso()
  );

  console.info('[browser-task] start id=%s ceo=%s mode=%s task_agent=%s', id, ceoUserId, mode, agentId);

  if (mode === 'recorder') {
    if (startUrl) {
      try {
        await browserInvoke(ceoUserId, 'open', { url: startUrl, targetUrl: startUrl }, agentId);
        await appendRecipeStep(ceoUserId, recipeId, { action: 'open', args: { url: startUrl }, label: 'Open start URL' });
      } catch (e) {
        console.warn('[browser-task] recorder open failed: %s', e.message);
      }
    }
    return getTask(ceoUserId, id);
  }

  if (mode === 'recipe_replay') {
    if (!recipeId) {
      const err = new Error('recipe_id or recipe_name required for recipe_replay');
      err.status = 400;
      throw err;
    }
    setImmediate(() => {
      runRecipeReplay(ceoUserId, id).catch((e) => {
        console.error('[browser-task] recipe replay failed id=%s: %s', id, e.message);
        updateTask(ceoUserId, id, { status: 'failed', error: e.message });
      });
    });
    return getTask(ceoUserId, id);
  }

  setImmediate(() => {
    runAutonomous(ceoUserId, id).catch((e) => {
      console.error('[browser-task] autonomous failed id=%s: %s', id, e.message);
      updateTask(ceoUserId, id, { status: 'failed', error: e.message });
      const failed = getTask(ceoUserId, id);
      if (failed) {
        recordBrowserTaskOutcome(ceoUserId, failed, {
          rating: 'down',
          comment: e.message,
          note: 'autonomous_failed',
        });
      }
    });
  });
  return getTask(ceoUserId, id);
}

function leafAgentIdForFeedback(agentId) {
  const raw = String(agentId || '').trim();
  const m = raw.match(/^t-[^-]+--(.+)$/);
  return m ? m[1] : raw || 'workflowbuilder';
}

function snapshotLooksLikeFlightResults(snapshot) {
  const t = String(snapshot || '');
  if (t.length < 80) return false;
  // Still hydrating — do not treat as ready
  if (/\b(?:\d{1,3}%\s*(?:complete|loaded)|results?\s+are\s+still\s+loading|loading\s+results|finding\s+flights)\b/i.test(t)) {
    return false;
  }
  const price = /(?:SGD|USD|EUR|GBP|INR|\$)\s?[\d,]+|from\s+(?:SGD|USD|\$)?\s?[\d,]+/i.test(t);
  const flightish = /nonstop|non-stop|direct|stops?|duration|airline|depart|arrive/i.test(t);
  // Prefer at least two distinct price-like hits so a stray currency symbol is not enough
  const priceHits = t.match(/(?:SGD|USD|EUR|GBP|INR|\$)\s?[\d,]{2,}/gi) || [];
  return price && flightish && priceHits.length >= 2;
}

function fallbackTaskSummary(task) {
  return `Opened ${task?.start_url || 'the requested page'}; no readable content captured. task_id=${task?.id || 'unknown'}`;
}

function completedTaskSummary(summary, task) {
  return String(summary || '').trim() || fallbackTaskSummary(task);
}

async function summarizeGoalFromSnapshot(ceoUserId, goal, snapshot) {
  const { content } = await chatCompletions({
    messages: [
      {
        role: 'user',
        content:
          'Goal: ' +
          goal +
          '\nFrom this page text (accessibility + DOM), answer the goal. ' +
          'If flights are visible, list the top options sorted by ascending price with airline, stops, duration, and price. ' +
          'Prefer direct/nonstop when the goal asks for that. Do not invent prices or airlines. ' +
          'Prefer the DOM_RESULTS section when present — it has the flight cards.\nSnapshot:\n' +
          String(snapshot || '').slice(0, 20000),
      },
    ],
    maxTokens: 1000,
    ownerUserId: ceoUserId,
    toolName: 'browse_task_start',
  });
  return String(content || '').trim();
}

function recordBrowserTaskOutcome(ceoUserId, task, { rating, comment, note }) {
  try {
    storeFeedback({
      ownerUserId: ceoUserId,
      agentId: leafAgentIdForFeedback(task.agent_id),
      source: 'browser_session',
      messageId: task.id,
      messageRole: 'assistant',
      messageContent: String(comment || '').slice(0, 4000),
      rating,
      comment: String(note || '').slice(0, 2000),
      context: {
        task_id: task.id,
        goal: task.goal_text,
        start_url: task.start_url,
        status: task.status,
      },
    });
  } catch (e) {
    console.warn('[browser-task] feedback store failed id=%s: %s', task.id, e.message);
  }
}

async function runAutonomous(ceoUserId, taskId) {
  const task = getTask(ceoUserId, taskId);
  if (!task) return;
  updateTask(ceoUserId, taskId, { status: 'running', wait_reason: null, error: null });
  const maxSteps = Number(task.input?.max_steps) || MAX_STEPS_DEFAULT;
  const agentId = task.agent_id || 'workflowbuilder';
  const steps = [];
  let parseFallbackStreak = 0;
  let exitNote = 'max_steps_reached';

  if (task.start_url) {
    await browserInvoke(ceoUserId, 'open', { url: task.start_url, targetUrl: task.start_url }, agentId);
    steps.push({ t: nowIso(), action: 'open', url: task.start_url });
    await sleep(3500);
  } else {
    await browserInvoke(ceoUserId, 'start', {}, agentId).catch(() => {});
  }

  // Any autonomous start URL with substantial readable content can complete early.
  // Cheapflights retains its stricter priced-results gate below.
  if (task.start_url && !/cheapflights\.com\/flight-search\//i.test(String(task.start_url))) {
    const snapshot = await takeSnapshot(ceoUserId, agentId, { limit: 18000 });
    const domText = await extractVisibleDomText(ceoUserId, agentId);
    const combined = (domText
      ? `DOM_VISIBLE_TEXT:\n${domText}\n\nA11Y_SNIPPET:\n${String(snapshot || '').slice(0, 6000)}`
      : String(snapshot || '')).trim();
    if (combined.length > 800) {
      const summary = completedTaskSummary(
        await summarizeGoalFromSnapshot(ceoUserId, task.goal_text, combined),
        task
      );
      steps.push({ t: nowIso(), action: 'early_summarize', chars: combined.length, dom_chars: domText.length });
      updateTask(ceoUserId, taskId, {
        status: 'completed',
        result: { summary, note: 'early_page_summarize', steps: steps.length },
        steps,
        wait_reason: null,
      });
      recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
        rating: 'up',
        comment: summary,
        note: 'early_page_summarize',
      });
      console.info('[browser-task] early page summarize id=%s chars=%s', taskId, combined.length);
      return;
    }
  }

  // Optional site heuristic accelerator: Cheapflights deep-link waits for priced results, then summarizes.
  if (/cheapflights\.com\/flight-search\//i.test(String(task.start_url || ''))) {
    let snapEarly = '';
    for (let w = 0; w < 8; w++) {
      snapEarly = await takeSnapshot(ceoUserId, agentId);
      if (snapshotLooksLikeFlightResults(snapEarly)) break;
      console.info('[browser-task] waiting for flight results id=%s try=%s', taskId, w + 1);
      await sleep(3500);
    }
    if (snapshotLooksLikeFlightResults(snapEarly)) {
      // Scroll into the results list — Cheapflights keeps cards below the filter chrome
      for (let s = 0; s < 3; s++) {
        await browserInvoke(ceoUserId, 'act', { request: { kind: 'scroll', direction: 'down' } }, agentId).catch(() => {});
        await sleep(900);
      }
      snapEarly = await takeSnapshot(ceoUserId, agentId, { limit: 18000 });
      const flightDomText = await extractFlightResultsDomText(ceoUserId, agentId);
      const domText = flightDomText || (await extractVisibleDomText(ceoUserId, agentId));
      // Prefer DOM flight cards — a11y trees often omit them and can crowd out the prompt
      const combined = (
        domText
          ? `DOM_RESULTS:\n${domText}\n\nA11Y_SNIPPET:\n${String(snapEarly || '').slice(0, 6000)}`
          : String(snapEarly || '')
      ).trim();
      const summary = completedTaskSummary(await summarizeGoalFromSnapshot(ceoUserId, task.goal_text, combined), task);
      steps.push({
        t: nowIso(),
        action: 'early_summarize',
        chars: combined.length,
        dom_chars: domText.length,
      });
      updateTask(ceoUserId, taskId, {
        status: 'completed',
        result: { summary, note: 'early_flight_summarize', steps: steps.length },
        steps,
        wait_reason: null,
      });
      const done = getTask(ceoUserId, taskId);
      recordBrowserTaskOutcome(ceoUserId, done, {
        rating: 'up',
        comment: summary,
        note: 'early_flight_summarize',
      });
      console.info('[browser-task] early flight summarize id=%s', taskId);
      return;
    }
    console.info('[browser-task] deep-link open without priced results yet id=%s; continuing loop', taskId);
  }

  for (let i = 0; i < maxSteps; i++) {
    const snapshot = await takeSnapshot(ceoUserId, agentId);
    void LOGIN_HINT_RE;
    const decision = await decideNextAction({
      ceoUserId,
      goal: task.goal_text,
      snapshot,
      history: steps,
      startUrl: task.start_url,
    });
    steps.push({ t: nowIso(), decision });
    updateTask(ceoUserId, taskId, { steps });

    const act = String(decision.action || '').toLowerCase();
    if (act === 'retry') {
      console.warn('[browser-task] retry after parse_fallback id=%s step=%s', taskId, i + 1);
      await sleep(800);
      parseFallbackStreak += 1;
      if (parseFallbackStreak >= 6) {
        console.warn('[browser-task] parse_fallback streak exhausted id=%s', taskId);
        exitNote = 'parse_fallback_exhausted';
        break;
      }
      // Do not burn max_steps on LLM JSON parse failures
      i -= 1;
      continue;
    }
    parseFallbackStreak = 0;
    if (act === 'done') {
      const summary = completedTaskSummary(decision.summary || decision.reason, task);
      updateTask(ceoUserId, taskId, {
        status: 'completed',
        result: { summary, steps: steps.length },
        steps,
        wait_reason: null,
      });
      recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
        rating: 'up',
        comment: summary,
        note: 'autonomous_done',
      });
      console.info('[browser-task] completed id=%s steps=%s', taskId, steps.length);
      return;
    }
    if (act === 'wait_login') {
      updateTask(ceoUserId, taskId, {
        status: 'blocked_on_input',
        wait_reason: decision.reason || 'Please log in in the browser window, then resume this task.',
        steps,
        result: { needs: 'login', message: decision.reason },
      });
      console.info('[browser-task] blocked_on_input login id=%s', taskId);
      return;
    }
    if (act === 'wait_approval') {
      updateTask(ceoUserId, taskId, {
        status: 'blocked_on_input',
        wait_reason: decision.reason || 'CEO approval required before continuing.',
        steps,
        result: { needs: 'approval', message: decision.reason },
      });
      return;
    }

    await executeDecision(ceoUserId, decision, agentId);
    await sleep(1500);
  }

  const finalSnap = await takeSnapshot(ceoUserId, agentId);
  const { content: summary } = await chatCompletions({
    messages: [
      {
        role: 'user',
        content: `Goal: ${task.goal_text}\n` +
          `The browser task hit the step limit. From this accessibility snapshot, answer the goal as completely as possible. ` +
          `If flights are visible, list them sorted by ascending price with airline, stops, duration, and price. ` +
          `Say clearly if data is incomplete.\nSnapshot:\n${finalSnap.slice(0, 14000)}`,
      },
    ],
    maxTokens: 1000,
    ownerUserId: ceoUserId,
    toolName: 'browse_task_start',
  });
  console.warn('[browser-task] loop exit id=%s note=%s steps=%s', taskId, exitNote, steps.length);
  const completedSummary = completedTaskSummary(summary, task);
  updateTask(ceoUserId, taskId, {
    status: 'completed',
    steps,
    result: { summary: completedSummary, note: exitNote, steps: steps.length },
  });
  const rating = exitNote === 'parse_fallback_exhausted' ? 'down' : 'up';
  recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
    rating,
    comment: completedSummary,
    note: exitNote,
  });
}

async function runRecipeReplay(ceoUserId, taskId) {
  const task = getTask(ceoUserId, taskId);
  if (!task?.recipe_id) throw new Error('missing recipe');
  const recipe = getRecipe(ceoUserId, task.recipe_id);
  if (!recipe) throw new Error('recipe not found');
  updateTask(ceoUserId, taskId, { status: 'running' });
  const agentId = task.agent_id || 'workflowbuilder';
  const actionable = (recipe.steps || []).filter((s) =>
    ['open', 'act', 'click', 'type', 'press', 'scroll'].includes(String(s.action || '').toLowerCase())
  );
  if (!actionable.length) {
    const msg =
      'Recipe has no actionable steps (only snapshots). Re-record: navigate in Chrome, then Capture current page after each navigation.';
    console.warn('[browser-task] recipe replay empty actionable id=%s recipe=%s', taskId, recipe.id);
    updateTask(ceoUserId, taskId, {
      status: 'failed',
      error: msg,
      result: { summary: msg, recipe_id: recipe.id, recipe_name: recipe.name, steps: 0 },
    });
    recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
      rating: 'down',
      comment: msg,
      note: 'recipe_empty_actionable',
    });
    return;
  }
  const steps = [];
  for (const step of recipe.steps) {
    const args = step.args || {};
    const act = String(step.action || '').toLowerCase();
    if (act === 'snapshot') {
      // Checkpoints are not replayed as browser actions
      steps.push({ t: nowIso(), step, skipped: true, reason: 'snapshot_checkpoint' });
      updateTask(ceoUserId, taskId, { steps });
      continue;
    }
    if (act === 'open' && args.url) {
      await browserInvoke(ceoUserId, 'open', { url: args.url, targetUrl: args.url }, agentId);
    } else if (act === 'act' || act === 'click' || act === 'type') {
      await browserInvoke(ceoUserId, 'act', args, agentId);
    } else if (act === 'press' || act === 'scroll' || act === 'wait') {
      await browserInvoke(ceoUserId, act === 'wait' ? 'act' : act, args, agentId);
    } else {
      await browserInvoke(ceoUserId, step.action, args, agentId);
    }
    steps.push({ t: nowIso(), step });
    updateTask(ceoUserId, taskId, { steps });
    await sleep(1500);
  }
  const snap = await takeSnapshot(ceoUserId, agentId);
  const summary = `Replayed ${actionable.length} actionable step(s) from recipe "${recipe.name}"`;
  updateTask(ceoUserId, taskId, {
    status: 'completed',
    steps,
    result: {
      summary,
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      actionable_steps: actionable.length,
      snapshot_excerpt: snap.slice(0, 4000),
    },
  });
  recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
    rating: 'up',
    comment: summary,
    note: 'recipe_replay_completed',
  });
  console.info('[browser-task] recipe replay done id=%s actionable=%s', taskId, actionable.length);
}

export async function resumeBrowserTask(ceoUserId, taskId, { approved = true } = {}) {
  const task = getTask(ceoUserId, taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  if (task.status !== 'blocked_on_input' && task.status !== 'recording') {
    const err = new Error(`Cannot resume from status ${task.status}`);
    err.status = 400;
    throw err;
  }
  if (!approved) {
    return updateTask(ceoUserId, taskId, { status: 'failed', error: 'Rejected by CEO', wait_reason: null });
  }
  if (task.mode === 'recorder') return task;
  setImmediate(() => {
    runAutonomous(ceoUserId, taskId).catch((e) => {
      updateTask(ceoUserId, taskId, { status: 'failed', error: e.message });
    });
  });
  return updateTask(ceoUserId, taskId, { status: 'running', wait_reason: null });
}

export async function captureRecorderStep(ceoUserId, taskId, { label = '', action, args = {}, url } = {}) {
  const task = getTask(ceoUserId, taskId);
  if (!task || task.mode !== 'recorder') {
    const err = new Error('Recorder task not found');
    err.status = 404;
    throw err;
  }
  if (!task.recipe_id) {
    const err = new Error('Recorder has no recipe');
    err.status = 400;
    throw err;
  }
  const agentId = task.agent_id || 'workflowbuilder';
  const snap = await takeSnapshot(ceoUserId, agentId);
  const pageUrl =
    String(url || args.url || '').trim() ||
    (await getCurrentPageUrl(ceoUserId, agentId)) ||
    extractPageUrlFromSnapshot(snap);
  const recipe = getRecipe(ceoUserId, task.recipe_id);
  const lastOpen = [...(recipe?.steps || [])].reverse().find((s) => String(s.action).toLowerCase() === 'open' && s.args?.url);
  const lastUrl = lastOpen?.args?.url || task.start_url || '';

  let recordedAction = String(action || '').toLowerCase();
  let stepArgs = { ...(args || {}) };
  let stepLabel = label || '';

  // Default Capture = record current page URL as open (so replay navigates).
  if (!recordedAction || recordedAction === 'snapshot' || recordedAction === 'page' || recordedAction === 'current') {
    if (pageUrl && pageUrl !== lastUrl) {
      recordedAction = 'open';
      stepArgs = { url: pageUrl, snapshot_excerpt: String(snap).slice(0, 1200) };
      stepLabel = stepLabel || `Open ${pageUrl}`;
    } else if (pageUrl && pageUrl === lastUrl) {
      recordedAction = 'open';
      stepArgs = { url: pageUrl, snapshot_excerpt: String(snap).slice(0, 1200), note: 'same_url_reconfirmed' };
      stepLabel = stepLabel || `Confirm ${pageUrl}`;
    } else {
      recordedAction = 'snapshot';
      stepArgs = { snapshot_excerpt: String(snap).slice(0, 2500), warning: 'no_url_detected' };
      stepLabel = stepLabel || `Checkpoint (no URL detected) at ${new Date().toISOString()}`;
      console.warn('[browser-task] capture without URL task=%s', taskId);
    }
  } else if (recordedAction === 'open') {
    const openUrl = String(stepArgs.url || pageUrl || '').trim();
    if (!openUrl) {
      const err = new Error('open capture requires url (or a detectable page URL)');
      err.status = 400;
      throw err;
    }
    stepArgs = { url: openUrl, snapshot_excerpt: String(snap).slice(0, 1200) };
    stepLabel = stepLabel || `Open ${openUrl}`;
  } else {
    stepArgs = { ...stepArgs, snapshot_excerpt: String(snap).slice(0, 1500) };
    stepLabel = stepLabel || `${recordedAction} at ${new Date().toISOString()}`;
  }

  const updated = await appendRecipeStep(ceoUserId, task.recipe_id, {
    action: recordedAction,
    args: stepArgs,
    label: stepLabel,
  });
  const steps = [
    ...(task.steps || []),
    { t: nowIso(), label: stepLabel, action: recordedAction, args: stepArgs, page_url: pageUrl },
  ];
  updateTask(ceoUserId, taskId, { steps });
  console.info(
    '[browser-task] recorder capture task=%s action=%s url=%s steps=%s',
    taskId,
    recordedAction,
    stepArgs.url || '',
    updated.steps.length
  );
  return {
    task: getTask(ceoUserId, taskId),
    recipe: updated,
    captured: { action: recordedAction, url: stepArgs.url || null, label: stepLabel },
  };
}

export async function stopRecorder(ceoUserId, taskId, { publish = true, name } = {}) {
  const task = getTask(ceoUserId, taskId);
  if (!task || task.mode !== 'recorder') {
    const err = new Error('Recorder task not found');
    err.status = 404;
    throw err;
  }
  let recipe = task.recipe_id ? getRecipe(ceoUserId, task.recipe_id) : null;
  if (recipe && publish) recipe = publishRecipe(ceoUserId, recipe.id);
  if (recipe && name) {
    const db = getDb();
    db.prepare(`UPDATE browser_recipes SET name = ?, updated_at = ? WHERE id = ? AND ceo_user_id = ?`).run(
      String(name).slice(0, 200),
      nowIso(),
      recipe.id,
      ceoUserId
    );
    recipe = getRecipe(ceoUserId, recipe.id);
  }
  const snap = await takeSnapshot(ceoUserId, task.agent_id || 'workflowbuilder').catch(() => '');
  const actionable = countActionableRecipeSteps(recipe);
  const warn =
    actionable < 1
      ? ' Warning: no open/click steps — replay will fail until you Capture pages after navigating.'
      : '';
  return updateTask(ceoUserId, taskId, {
    status: 'completed',
    wait_reason: null,
    result: {
      summary: `Recording saved as "${recipe?.name || 'recipe'}" (${actionable} actionable / ${recipe?.steps?.length || 0} total steps).${warn}`,
      recipe_id: recipe?.id,
      recipe_name: recipe?.name,
      actionable_steps: actionable,
      snapshot_excerpt: String(snap).slice(0, 3000),
    },
  });
}

export async function toolBrowseSnapshot(ceoUserId, { limit = 6000 } = {}) {
  const text = await takeSnapshot(ceoUserId);
  return { ok: true, profile: resolveBrowserProfile(ceoUserId).profile, snapshot: text.slice(0, Number(limit) || 6000) };
}

export async function toolBrowseAct(ceoUserId, body = {}) {
  const { url, targetUrl, ...actionBody } = body;
  const openUrl = String(url || targetUrl || '').trim();
  if (openUrl) {
    await browserInvoke(ceoUserId, 'open', { url: openUrl, targetUrl: openUrl }, 'workflowbuilder');
  }
  const result = await browserInvoke(
    ceoUserId,
    'act',
    { request: actionBody.request || actionBody.instruction || actionBody, ...actionBody },
    'workflowbuilder'
  );
  return { ok: result.ok, profile: resolveBrowserProfile(ceoUserId).profile, raw: parseInvokeText(result).slice(0, 4000) };
}