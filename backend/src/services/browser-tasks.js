/**
 * Browser tasks: autonomous observe-act loop, recorder mode, recipe replay.
 */
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
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
  isBrowserWorkerOnline,
  invokeViaBrowserWorker,
  selectBrowserExecutor,
  getBrowserExecutorNode,
} from './browser-worker-dispatch.js';
import {
  appendRecipeStep,
  createRecipe,
  getRecipe,
  getRecipeByName,
  publishRecipe,
  countActionableRecipeSteps,
  normalizeRecipeInputs,
  recipeRequiredInputs,
  substituteRecipeInputs,
} from './browser-recipes.js';
import { storeFeedback } from './agent-feedback.js';
import { assertUrlAllowed } from './browser-url-policy.js';
import {
  extractPublishBody,
  runAutonomousSocialPublish,
} from './browser-social-publish.js';

const MAX_STEPS_DEFAULT = 18;
const TASK_TAB_RETENTION_MS = Math.max(
  0,
  Number(process.env.BROWSER_TASK_TAB_RETENTION_MS || 60000) || 0
);
const TASK_STALE_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.BROWSER_TASK_STALE_MS || 20 * 60 * 1000) || 20 * 60 * 1000
);
// Backend CDP invokes use this OpenClaw agent (must have built-in browser allowed).
// Chat agents like techresearcher keep browser denied and use browse_* only.
const BROWSER_CDP_AGENT_ID = process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp';
const LOGIN_HINT_RE =
  /sign in|log in|login|authwall|password|verify you|captcha|challenge/i;
const browserTaskContext = new AsyncLocalStorage();

/** Arbitrary page JavaScript is intentionally not part of the MV3 extension contract. */
export function browserExecutorSupportsEvaluate(node) {
  if (!node || node.driver_mode !== 'chrome_extension') return true;
  return node.capabilities?.evaluate === true || node.capabilities?.actions?.includes?.('evaluate');
}

function currentExecutorSupportsEvaluate(ceoUserId) {
  const pinned = browserTaskContext.getStore();
  if (!pinned?.selected_node_id) return true;
  return browserExecutorSupportsEvaluate(getBrowserExecutorNode(ceoUserId, pinned.selected_node_id));
}

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
  const updated = getTask(ceoUserId, taskId);
  const terminal = new Set(['completed', 'failed']);
  if (updated && terminal.has(String(updated.status || '')) && !terminal.has(String(cur.status || ''))) {
    scheduleTaskTabCleanup(updated);
  }
  return updated;
}

function scheduleTaskTabCleanup(task) {
  if (!task?.selected_node_id || task?.input?.keep_tab_open === true) return;
  const timer = setTimeout(async () => {
    try {
      const node = getBrowserExecutorNode(task.ceo_user_id, task.selected_node_id);
      if (!node?.online) return;
      await invokeViaBrowserWorker(
        task.ceo_user_id,
        'task_cleanup',
        { task_id: task.id },
        { node, timeoutMs: 15000 }
      );
      console.info('[browser-task] cleaned task tab id=%s node=%s', task.id, node.id);
    } catch (error) {
      console.warn('[browser-task] task tab cleanup failed id=%s: %s', task.id, error.message);
    }
  }, TASK_TAB_RETENTION_MS);
  timer.unref?.();
}

export function reapStaleBrowserTasks(ceoUserId) {
  const db = getDb();
  const cutoff = new Date(Date.now() - TASK_STALE_MS).toISOString();
  const stale = db
    .prepare(
      `SELECT id FROM browser_tasks
       WHERE ceo_user_id = ?
         AND status IN ('pending', 'running')
         AND updated_at < ?`
    )
    .all(ceoUserId, cutoff);
  for (const row of stale) {
    updateTask(ceoUserId, row.id, {
      status: 'failed',
      error: 'Browser task expired after the worker stopped reporting progress',
      result: {
        ok: false,
        code: 'TASK_STALE',
        message: 'The browser worker stopped reporting progress. Start a new task to retry.',
      },
    });
  }
  if (stale.length) {
    console.warn('[browser-task] reaped %s stale tasks ceo=%s', stale.length, ceoUserId);
  }
  return { reaped: stale.length };
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
  reapStaleBrowserTasks(ceoUserId);
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
  if (currentExecutorSupportsEvaluate(ceoUserId)) try {
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
  // Prefer owner-scoped local browser worker when online (multi-user Client Chrome).
  const pinned = browserTaskContext.getStore();
  const pinnedNode = pinned?.selected_node_id
    ? getBrowserExecutorNode(ceoUserId, pinned.selected_node_id)
    : null;
  if (pinnedNode || (!pinned && isBrowserWorkerOnline(ceoUserId))) {
    console.info(
      '[browser-task] invoke via desktop_worker ceo=%s action=%s',
      ceoUserId,
      action
    );
    const result = await invokeViaBrowserWorker(
      ceoUserId,
      action,
      { ...extra, task_id: pinned?.id || undefined },
      pinnedNode ? { node: pinnedNode } : {}
    );
    if (!result.ok) {
      const error = new Error(result.text || 'Browser executor action failed');
      error.code = result.failure_code || 'BROWSER_EXECUTOR_FAILED';
      error.status = result.status || 500;
      throw error;
    }
    return result;
  }
  if (pinned?.selected_node_id) {
    const error = new Error('Pinned browser executor is offline');
    error.code = 'EXECUTOR_OFFLINE';
    error.status = 503;
    throw error;
  }
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
  if (!currentExecutorSupportsEvaluate(ceoUserId)) return '';
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
  if (!currentExecutorSupportsEvaluate(ceoUserId)) return '';
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

function goalLooksSocialPublish(goalText) {
  const g = String(goalText || '');
  return (
    goalLooksInteractive(g) &&
    /\b(linkedin|facebook|fb\.com|instagram|twitter|x\.com)\b/i.test(g) &&
    /\b(publish|post|compose|share)\b/i.test(g)
  );
}

function goalLooksGoogleFlow(goalText) {
  const g = String(goalText || '');
  return /google\s*flow|labs\.google\/fx\/tools\/flow|FLOW_PROMPT_START|scene\s+\d+/i.test(g);
}

/** Extract the clip prompt body from a Flow browse goal (between markers or after paste/type line). */
function extractFlowPromptFromGoal(goalText) {
  const g = String(goalText || '');
  const marked = g.match(/<<<FLOW_PROMPT_START>>>\s*([\s\S]*?)\s*<<<FLOW_PROMPT_END>>>/);
  if (marked?.[1]) return marked[1].trim();
  const paste = g.match(
    /paste\/type this prompt exactly[^\n]*:\s*\n([\s\S]*?)\n(?:Click to start|Start generation|Download the resulting)/i
  );
  if (paste?.[1]) return paste[1].trim();
  const paste2 = g.match(/paste this prompt exactly[^\n]*:\s*\n([\s\S]*?)\n(?:Start generation|Download the resulting)/i);
  if (paste2?.[1]) return paste2[1].trim();
  return '';
}

/** Brief action instructions for the decision LLM (omit huge Veo prompt bodies). */
function goalBriefForDecision(goalText) {
  const g = String(goalText || '');
  if (!goalLooksGoogleFlow(g)) return g.slice(0, 2500);
  const prompt = extractFlowPromptFromGoal(g);
  const lines = g
    .split('\n')
    .filter((l) => !prompt || !l.includes(prompt.slice(0, 40)))
    .join('\n');
  return (
    lines.slice(0, 1200) +
    (prompt
      ? `\n[Flow prompt length=${prompt.length} chars — when typing, use action=type with text="__FLOW_PROMPT__" as placeholder; the runtime substitutes the full prompt.]`
      : '')
  );
}

/**
 * Google Flow home → open/create a project, fill the scene prompt, click generate.
 * Flow's a11y tree is sparse; DOM evaluate is more reliable than LLM click refs.
 */
async function tryGoogleFlowBootstrap(ceoUserId, agentId, goal, steps) {
  if (!goalLooksGoogleFlow(goal)) return false;
  if (steps.some((s) => s.action === 'google_flow_bootstrap')) return false;
  const prompt = extractFlowPromptFromGoal(goal);
  const out = { opened: false, filled: false, generate: false, detail: [] };

  const openFn =
    `(() => {` +
    `  const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));` +
    `  const editors = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).filter(visible);` +
    `  if (editors.length) return 'editor_ready';` +
    `  const labelOf = (el) => ((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).trim();` +
    `  const controls = Array.from(document.querySelectorAll('button,a,[role="button"]'));` +
    `  const neu = controls.find((el) => /new project|create project|\\+\\s*new|start new/i.test(labelOf(el)));` +
    `  if (neu && visible(neu)) { neu.click(); return 'clicked_new:' + labelOf(neu).slice(0,60); }` +
    `  const links = Array.from(document.querySelectorAll('a[href]')).filter((a) => /project|flow\\//i.test(a.href) && !/tools\\/flow\\/?$/i.test(a.href) && visible(a));` +
    `  if (links[0]) { links[0].click(); return 'clicked_link:' + String(links[0].href).slice(0,120); }` +
    `  const tiles = Array.from(document.querySelectorAll('button,a,article,[role="listitem"],div[role="button"]'))` +
    `    .filter((el) => visible(el) && /untitled|project|thenali|scene|video|recent/i.test(labelOf(el)) && labelOf(el).length > 2 && labelOf(el).length < 100);` +
    `  if (tiles[0]) { tiles[0].click(); return 'clicked_tile:' + labelOf(tiles[0]).slice(0,60); }` +
    `  return 'no_project_control';` +
    `})()`;
  try {
    const ev = await evaluateInBrowser(ceoUserId, agentId, openFn);
    out.detail.push(String(ev.detail || '').slice(0, 200));
    out.opened = /editor_ready|clicked_/i.test(String(ev.detail || ''));
  } catch (e) {
    out.detail.push('open_err:' + (e.message || e));
  }
  await sleep(2500);

  if (prompt) {
    const fillFn =
      `(() => {` +
      `  const prompt = ${JSON.stringify(prompt)};` +
      `  const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));` +
      `  const editors = Array.from(document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"]')).filter(visible);` +
      `  const el = editors[0];` +
      `  if (!el) return 'no_editor';` +
      `  el.focus();` +
      `  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {` +
      `    el.value = ''; el.value = prompt;` +
      `    el.dispatchEvent(new Event('input', { bubbles: true }));` +
      `    el.dispatchEvent(new Event('change', { bubbles: true }));` +
      `  } else {` +
      `    el.textContent = '';` +
      `    el.textContent = prompt;` +
      `    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: prompt, inputType: 'insertText' }));` +
      `  }` +
      `  return 'filled:' + prompt.length;` +
      `})()`;
    try {
      const ev = await evaluateInBrowser(ceoUserId, agentId, fillFn);
      out.detail.push(String(ev.detail || '').slice(0, 200));
      out.filled = /filled:/i.test(String(ev.detail || ''));
    } catch (e) {
      out.detail.push('fill_err:' + (e.message || e));
    }
    await sleep(800);
  }

  const genFn =
    `(() => {` +
    `  const labelOf = (el) => ((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')).trim();` +
    `  const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));` +
    `  const buttons = Array.from(document.querySelectorAll('button,[role="button"]')).filter(visible);` +
    `  const gen = buttons.find((b) => {` +
    `    const l = labelOf(b);` +
    `    if (/go back|arrow_back|back|cancel|close|dismiss|help/i.test(l)) return false;` +
    `    return /^(generate|create)$|generate video|generate clip|create clip|create video|make video|arrow_forward|send$|start generation/i.test(l);` +
    `  });` +
    `  if (gen) { gen.click(); return 'clicked_generate:' + labelOf(gen).slice(0,60); }` +
    `  return 'no_generate_button';` +
    `})()`;
  try {
    const ev = await evaluateInBrowser(ceoUserId, agentId, genFn);
    out.detail.push(String(ev.detail || '').slice(0, 200));
    out.generate = /clicked_generate/i.test(String(ev.detail || ''));
  } catch (e) {
    out.detail.push('gen_err:' + (e.message || e));
  }

  steps.push({ t: nowIso(), action: 'google_flow_bootstrap', ...out });
  console.info(
    '[browser-task] google flow bootstrap opened=%s filled=%s generate=%s detail=%s',
    out.opened,
    out.filled,
    out.generate,
    out.detail.join(' | ').slice(0, 240)
  );
  return out.opened || out.filled || out.generate;
}

/**
 * After bootstrap (prompt filled), keep clicking generate / download without relying on LLM JSON.
 */
async function runGoogleFlowGenerateDownload(ceoUserId, agentId, goal, steps) {
  if (!goalLooksGoogleFlow(goal)) return null;
  const genFn =
    `(() => {` +
    `  const labelOf = (el) => ((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')+' '+(el.getAttribute('data-tooltip')||'')).trim();` +
    `  const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));` +
    `  const bad = (l) => /go back|arrow_back|back|cancel|close|dismiss|help|settings|subscribe|bonus|menu|more_vert|sign out|delete|remove/i.test(l);` +
    `  const buttons = Array.from(document.querySelectorAll('button,[role="button"],[aria-label]')).filter(visible);` +
    `  const prefer = buttons.find((b) => {` +
    `    const l = labelOf(b);` +
    `    if (!l || bad(l)) return false;` +
    `    return /^(generate|create)$|generate video|generate clip|create clip|create video|make video|arrow_forward|send$|submit|run prompt|start generation/i.test(l);` +
    `  });` +
    `  if (prefer) { prefer.click(); return 'clicked_generate:' + labelOf(prefer).slice(0,80); }` +
    `  return 'no_generate_button labels=' + buttons.slice(0,20).map((b)=>labelOf(b).slice(0,40)).filter(Boolean).join('|');` +
    `})()`;
  const dlFn =
    `(() => {` +
    `  const labelOf = (el) => ((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')+' '+(el.getAttribute('title')||'')).trim();` +
    `  const visible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));` +
    `  const nodes = Array.from(document.querySelectorAll('button,a,[role="button"],[download]')).filter(visible);` +
    `  const dl = nodes.find((el) => /download|save video|export|save as/i.test(labelOf(el)) || el.hasAttribute('download'));` +
    `  if (dl) { dl.click(); return 'clicked_download:' + labelOf(dl).slice(0,80); }` +
    `  return 'no_download';` +
    `})()`;
  const readyFn =
    `(() => {` +
    `  const t = (document.body && document.body.innerText || '').slice(0, 12000);` +
    `  const hasVideo = !!document.querySelector('video');` +
    `  const vid = document.querySelector('video');` +
    `  const dur = vid && Number.isFinite(vid.duration) ? vid.duration : 0;` +
    `  const ready = hasVideo && dur > 0.5;` +
    `  return JSON.stringify({ ready, hasVideo, duration: dur, snippet: t.replace(/\\s+/g,' ').slice(0,240) });` +
    `})()`;

  let generateDetail = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const ev = await evaluateInBrowser(ceoUserId, agentId, genFn);
    generateDetail = String(ev.detail || '');
    steps.push({ t: nowIso(), action: 'google_flow_generate_click', attempt, detail: generateDetail.slice(0, 240) });
    if (/clicked_/i.test(generateDetail)) break;
    await sleep(1500);
  }
  if (!/clicked_/i.test(generateDetail)) {
    return {
      ok: false,
      blocked: true,
      summary:
        'Flow editor prompt was filled, but no Generate control was found. In the Chrome Flow window, click Generate (or the send/arrow control), wait for the clip, download the mp4, then tell CO to ingest — or re-run S4 scene 1.',
      note: 'flow_generate_button_missing',
      generateDetail,
    };
  }

  let ready = null;
  for (let w = 0; w < 24; w += 1) {
    await sleep(5000);
    const ev = await evaluateInBrowser(ceoUserId, agentId, readyFn);
    try {
      ready = JSON.parse(String(ev.detail || '{}'));
    } catch {
      ready = { ready: false, snippet: String(ev.detail || '').slice(0, 200) };
    }
    steps.push({ t: nowIso(), action: 'google_flow_wait', w, ready });
    if (ready?.ready) break;
    // Re-click generate once if still idle after ~30s
    if (w === 5) {
      await evaluateInBrowser(ceoUserId, agentId, genFn).catch(() => {});
    }
  }

  let downloadDetail = 'skipped';
  for (let d = 0; d < 5; d += 1) {
    const ev = await evaluateInBrowser(ceoUserId, agentId, dlFn);
    downloadDetail = String(ev.detail || '');
    steps.push({ t: nowIso(), action: 'google_flow_download_click', d, detail: downloadDetail.slice(0, 200) });
    if (/clicked_download/i.test(downloadDetail)) break;
    await sleep(2000);
  }

  const ok = /clicked_download/i.test(downloadDetail);
  return {
    ok,
    blocked: !ok,
    summary: ok
      ? `Flow generate clicked; download=${downloadDetail}. Check Downloads for the newest mp4 and ingest with video_media_ingest_clip.`
      : `Flow generate may have started (detail=${generateDetail.slice(0, 120)}), but download control was not found. If the clip is ready in Chrome Flow, click Download, then we will ingest the mp4 from Downloads.`,
    note: ok ? 'flow_generate_download' : 'flow_generate_pending_download',
    generateDetail,
    downloadDetail,
    ready,
  };
}

/** Prefer publish body extractor shared with autonomous social module. */
function extractPublishBodyFromGoal(goalText) {
  return extractPublishBody(goalText);
}

async function evaluateInBrowser(ceoUserId, agentId, fnSource) {
  const fn = String(fnSource || '').trim();
  if (!fn) return { ok: false, detail: 'empty_fn' };
  const res = await browserInvoke(
    ceoUserId,
    'act',
    { request: { kind: 'evaluate', fn }, fn, expression: fn },
    agentId
  );
  let detail = String(parseInvokeText(res) || res?.text || '').trim();
  // OpenClaw / relay often wraps as {"ok":true,"result":"<payload>"}
  for (let depth = 0; depth < 3; depth++) {
    try {
      const j = JSON.parse(detail);
      if (j && typeof j.result === 'string') {
        detail = j.result;
        continue;
      }
      if (j && j.result != null && typeof j.result === 'object') {
        detail = JSON.stringify(j.result);
        break;
      }
      if (j && typeof j.result !== 'undefined' && typeof j.result !== 'object') {
        detail = String(j.result);
        break;
      }
      break;
    } catch {
      break;
    }
  }
  return { ok: !invokeLooksFailed(res), detail: String(detail).slice(0, 800), raw: res };
}

/**
 * Detect LinkedIn/Facebook share composer modal (dialog + contenteditable).
 * Returns JSON string: {open, platform, hasEditor, hasPostBtn, editorLabel}
 */
async function detectSocialComposerState(ceoUserId, agentId) {
  const fn = `() => {
    const isEditor = (el) => {
      if (!el) return false;
      if (el.getAttribute('contenteditable') === 'true') return true;
      if (el.getAttribute('role') === 'textbox') return true;
      if (el.classList && (el.classList.contains('ql-editor') || el.classList.contains('share-creation-state__text-editor'))) return true;
      return false;
    };
    const editorSel = [
      '[role="dialog"] [contenteditable="true"]',
      '[role="dialog"] div[role="textbox"]',
      '.artdeco-modal [contenteditable="true"]',
      '.share-creation-state [contenteditable="true"]',
      '.share-creation-state__text-editor',
      '.ql-editor[contenteditable="true"]',
      'div[data-placeholder*="talk about" i]',
      'div[aria-label*="Text editor" i]',
      'div[aria-label*="What do you want to talk about" i]',
      'form [contenteditable="true"]',
      'div[aria-modal="true"] [contenteditable="true"]',
    ].join(',');

    let editor = null;
    try { editor = document.querySelector(editorSel); } catch (_) { editor = null; }
    if (!editor) {
      editor = Array.from(document.querySelectorAll('[contenteditable="true"], div[role="textbox"]')).find((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) return false;
        const ph = (el.getAttribute('data-placeholder') || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').toLowerCase();
        const nearShare = !!(el.closest('[role="dialog"], .artdeco-modal, .share-creation-state, form'));
        return nearShare || /talk about|share|post|on your mind|write something/.test(ph);
      }) || null;
    }

    if (!editor || !isEditor(editor)) {
      return JSON.stringify({
        open: false,
        hostname: location.hostname,
        ce_count: document.querySelectorAll('[contenteditable="true"]').length,
        dialog_count: document.querySelectorAll('[role="dialog"], .artdeco-modal, [aria-modal="true"]').length,
      });
    }

    const root =
      editor.closest('[role="dialog"], .artdeco-modal, .share-creation-state, [aria-modal="true"], form') ||
      editor.parentElement;
    const buttons = Array.from((root || document).querySelectorAll('button, [role="button"]'));
    const postBtn = buttons.find((b) => {
      const lab = (b.innerText || b.getAttribute('aria-label') || '').trim().split('\\n')[0];
      return /^(post|publish|share now)$/i.test(lab);
    });
    return JSON.stringify({
      open: true,
      platform: /facebook/i.test(location.hostname)
        ? 'facebook'
        : /linkedin/i.test(location.hostname)
          ? 'linkedin'
          : 'unknown',
      hasEditor: true,
      hasPostBtn: !!postBtn,
      editorLabel: (
        editor.getAttribute('aria-label') ||
        editor.getAttribute('data-placeholder') ||
        editor.getAttribute('placeholder') ||
        ''
      ).slice(0, 80),
      dialogSnippet: ((root && root.innerText) || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      ce_count: document.querySelectorAll('[contenteditable="true"]').length,
    });
  }`;
  const { ok, detail } = await evaluateInBrowser(ceoUserId, agentId, fn);
  if (!ok) return { open: false, error: detail };
  try {
    return { ...JSON.parse(detail), probe_ok: true };
  } catch {
    return { open: false, error: detail };
  }
}

/** Fill composer contenteditable with exact body and click Post inside the modal only. */
async function trySocialComposerFillAndPost(ceoUserId, agentId, bodyText, steps) {
  const body = String(bodyText || '').trim();
  if (!body) return { ok: false, reason: 'empty_body' };

  const escaped = JSON.stringify(body);
  const fn = `() => {
    const body = ${escaped};
    const editors = Array.from(document.querySelectorAll(
      '[role="dialog"] [contenteditable="true"], [role="dialog"] div[role="textbox"], .artdeco-modal [contenteditable="true"], .share-creation-state [contenteditable="true"], .share-creation-state__text-editor, .ql-editor[contenteditable="true"], div[aria-modal="true"] [contenteditable="true"], form [contenteditable="true"], [contenteditable="true"]'
    ));
    const editor = editors.find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 18;
    }) || null;
    if (!editor) {
      return JSON.stringify({
        ok: false,
        stage: 'no_editor',
        ce_count: document.querySelectorAll('[contenteditable="true"]').length,
        dialog_count: document.querySelectorAll('[role="dialog"], .artdeco-modal').length,
      });
    }

    const root =
      editor.closest('[role="dialog"], .artdeco-modal, .share-creation-state, [aria-modal="true"], form') ||
      document.body;

    try {
      editor.focus();
      editor.click();
      if (document.execCommand) {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      editor.innerHTML = '';
      // Prefer textContent / innerText for LI quill
      if ('innerText' in editor) editor.innerText = body;
      else editor.textContent = body;
      try {
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: body }));
      } catch (_) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      editor.dispatchEvent(new Event('keyup', { bubbles: true }));
    } catch (e) {
      return JSON.stringify({ ok: false, stage: 'type_error', error: String(e && e.message || e) });
    }

    const filled = (editor.innerText || editor.textContent || '').trim();
    if (filled.length < Math.min(12, Math.floor(body.length / 3))) {
      return JSON.stringify({ ok: false, stage: 'fill_mismatch', filled_len: filled.length, body_len: body.length, sample: filled.slice(0, 60) });
    }

    const buttons = Array.from(root.querySelectorAll('button, [role="button"]'));
    let postBtn = buttons.find((b) => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
      const lab = (b.innerText || b.getAttribute('aria-label') || '').trim().split('\\n')[0];
      return /^(post|publish|share now)$/i.test(lab);
    });
    if (!postBtn) {
      postBtn = buttons.find((b) => {
        const lab = (b.innerText || b.getAttribute('aria-label') || '').trim();
        return /^post$/i.test(lab) || (/\\bpost\\b/i.test(lab) && lab.length < 28);
      });
    }
    // Primary Post sits bottom-right; class heuristics used when text is empty
    if (!postBtn) {
      postBtn = root.querySelector('button.share-actions__primary-action, button[class*="share-actions__primary"], button[data-control-name*="share"]');
    }
    if (!postBtn) return JSON.stringify({ ok: false, stage: 'no_post_btn', filled_len: filled.length, btn_count: buttons.length });

    try {
      postBtn.click();
    } catch (e) {
      return JSON.stringify({ ok: false, stage: 'post_click_error', error: String(e && e.message || e) });
    }
    return JSON.stringify({
      ok: true,
      stage: 'posted',
      filled_len: filled.length,
      btn: (postBtn.innerText || postBtn.getAttribute('aria-label') || postBtn.className || '').toString().trim().slice(0, 60),
    });
  }`;

  const { ok, detail } = await evaluateInBrowser(ceoUserId, agentId, fn);
  let parsed = {};
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = { ok: false, stage: 'parse_detail', detail };
  }
  steps.push({
    t: nowIso(),
    action: 'social_composer_fill_post',
    ok: Boolean(ok && parsed.ok),
    detail: String(detail).slice(0, 400),
  });
  if (ok && parsed.ok) {
    console.info('[browser-task] social fill+post ok stage=%s filled=%s', parsed.stage, parsed.filled_len);
    await sleep(3500);
    return { ok: true, ...parsed };
  }
  console.warn('[browser-task] social fill+post failed %s', String(detail).slice(0, 200));
  return { ok: false, ...parsed, detail };
}

/** After fill+post, try to read a post URL or confirm modal closed. */
async function confirmSocialPostResult(ceoUserId, agentId) {
  await sleep(2000);
  const state = await detectSocialComposerState(ceoUserId, agentId);
  const fn = `() => {
    const u = location.href;
    const toast = (document.body.innerText || '').slice(0, 2000);
    const posted =
      /post was successful|your post was|shared successfully|is now live/i.test(toast) ||
      /linkedin\\.com\\/feed\\/update|linkedin\\.com\\/posts\\//i.test(u) ||
      /facebook\\.com\\/[^/]+\\/posts\\//i.test(u);
    return JSON.stringify({ url: u, toast_hit: /post was successful|your post was|shared successfully/i.test(toast), posted_hint: posted });
  }`;
  const { detail } = await evaluateInBrowser(ceoUserId, agentId, fn);
  let info = {};
  try {
    info = JSON.parse(detail);
  } catch {
    info = { url: '', detail };
  }
  return {
    modal_still_open: Boolean(state.open),
    url: info.url || '',
    posted_hint: Boolean(info.posted_hint || info.toast_hit || (!state.open && info.url)),
    toast_hit: Boolean(info.toast_hit),
  };
}

async function decideNextAction({ ceoUserId, goal, snapshot, history, startUrl, modalOpen = false }) {
  const interactive = goalLooksInteractive(goal);
  const flowGoal = goalLooksGoogleFlow(goal);
  const system = `You drive a browser for a CEO. Reply with ONLY one minified JSON object. No markdown fences, no commentary.
Schema: {"action":"click|type|press|scroll|open|screenshot|done|wait_login|wait_approval","ref":"","text":"","url":"","key":"","summary":"","reason":""}
Rules:
- Prefer refs from the CURRENT accessibility snapshot only. Never reuse a ref that just failed.
- If recent steps show act_failed / not found, pick a different control or use text of the control label if the schema allows (put label in reason and leave ref empty to try freeform).
- On flight search results (prices/airlines visible), action=done and put top options in summary (airline, stops, duration, price ascending). Do not book.
- wait_login if a login wall blocks the goal (Sign in / Join / password form).
- wait_approval only for pay, purchase, bank transfer, or sending money — NOT for social post Publish after the goal already says publish/post the copy.
- For publish/post/compose goals: open composer → type the EXACT body from the goal → click Post/Publish. Put the live post URL in summary when done.
- done when the goal is satisfied; put the answer (or post URL / honest blocker) in summary.
- If the goal requests a screenshot or PNG, choose screenshot before done. Never claim a screenshot exists without screenshot artifact evidence in recent steps.
- Never invent credentials or fake post URLs. Keep JSON under 500 characters when possible.
${interactive ? '- This goal is interactive (publish/compose/reply). Do not mark done after only opening the page.' : ''}
${
  flowGoal
    ? `- Google Flow video goal: open/create a project, type the scene prompt into the prompt box (use text="__FLOW_PROMPT__"), click Generate, wait for the clip, then download. done only with download filename/path — never done from the home/projects list alone.`
    : ''
}

${
  modalOpen
    ? `- CRITICAL: A post/share composer MODAL/DIALOG is open. Do NOT scroll the background feed. Do NOT click "Start a post" again.
- Work ONLY inside the dialog: focus the contenteditable / textbox, type the EXACT post body from the goal, then click the enabled Post/Publish button in the dialog.
- Never click Like, Comment, or feed posts while the composer modal is open.`
    : ''
}`;
  const user = `Goal: ${goalBriefForDecision(goal)}
Start URL: ${startUrl || '(current)'}
ComposerModalOpen: ${modalOpen ? 'yes' : 'no'}
Recent steps: ${JSON.stringify(history.slice(-8))}
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
  // Hard guard: never scroll while modal open (LLM often scrolls feed behind dialog)
  if (modalOpen && String(parsed.action || '').toLowerCase() === 'scroll') {
    return {
      action: 'type',
      text: extractPublishBodyFromGoal(goal).slice(0, 500),
      summary: 'Type into modal (scroll blocked)',
      reason: 'modal_open_scroll_suppressed',
    };
  }
  if (String(parsed.text || '') === '__FLOW_PROMPT__') {
    parsed.text = extractFlowPromptFromGoal(goal) || parsed.text;
  }
  return parsed;
}

async function createExecutionPlan(ceoUserId, goal, startUrl) {
  try {
    const { content } = await chatCompletions({
      messages: [
        {
          role: 'system',
          content:
            'Create a compact browser execution plan. Reply with only JSON: ' +
            '{"steps":[{"goal":"","evidence":""}],"completion_evidence":[""]}. ' +
            'Use 2-8 observable checkpoints. Never claim an action or artifact exists before it is observed.',
        },
        { role: 'user', content: `Goal: ${goal}\nStart URL: ${startUrl || '(current page)'}` },
      ],
      maxTokens: 700,
      ownerUserId: ceoUserId,
      toolName: 'browse_task_start',
    });
    const parsed = extractJsonObject(content);
    if (Array.isArray(parsed?.steps) && parsed.steps.length) {
      return {
        steps: parsed.steps.slice(0, 8),
        completion_evidence: Array.isArray(parsed.completion_evidence)
          ? parsed.completion_evidence.slice(0, 8)
          : [],
      };
    }
  } catch (error) {
    console.warn('[browser-task] plan generation failed: %s', error.message);
  }
  return {
    steps: [
      { goal: 'Open the requested page', evidence: 'Observed final URL and title' },
      { goal: 'Perform the requested browser actions', evidence: 'Successful action results' },
      { goal: 'Verify the requested outcome', evidence: 'Current page snapshot supports completion' },
    ],
    completion_evidence: ['Current page state supports the requested goal'],
    fallback: true,
  };
}

async function verifyGoalCompletion({ ceoUserId, goal, plan, snapshot, history, proposedSummary }) {
  const screenshotRequested = /\b(screen\s*shot|png|image capture)\b/i.test(String(goal || ''));
  const screenshotObserved = history.some(
    (entry) => entry?.action === 'screenshot' && (entry?.artifact?.url || entry?.artifact_url)
  );
  if (screenshotRequested && !screenshotObserved) {
    return {
      satisfied: false,
      reason: 'The goal requires a screenshot artifact, but no screenshot evidence was produced.',
      missing_evidence: ['screenshot_artifact'],
      hard_guard: true,
    };
  }
  try {
    const { content } = await chatCompletions({
      messages: [
        {
          role: 'system',
          content:
            'Independently verify whether a browser goal is complete. Reply with only JSON: ' +
            '{"satisfied":true|false,"reason":"","evidence":[""],"missing_evidence":[""]}. ' +
            'Require observable evidence from the snapshot and action history. Reject unsupported success claims.',
        },
        {
          role: 'user',
          content:
            `Goal: ${goal}\nPlan: ${JSON.stringify(plan)}\nProposed summary: ${proposedSummary || ''}\n` +
            `Recent history: ${JSON.stringify(history.slice(-12))}\nSnapshot:\n${String(snapshot || '').slice(0, 12000)}`,
        },
      ],
      maxTokens: 700,
      ownerUserId: ceoUserId,
      toolName: 'browse_task_start',
    });
    const parsed = extractJsonObject(content);
    if (typeof parsed?.satisfied === 'boolean') return parsed;
  } catch (error) {
    console.warn('[browser-task] completion verification failed: %s', error.message);
  }
  return {
    satisfied: false,
    reason: 'Completion could not be independently verified.',
    missing_evidence: ['verification_result'],
  };
}

function invokeLooksFailed(result) {
  if (!result) return true;
  if (result.ok === false) return true;
  const t = parseInvokeText(result) || result.text || '';
  return /not found or not visible|Element ".*" not found|Unknown ref|BrowserServiceError|Target closed|Page closed|no tab|failed|request required|timed out|external to OpenClaw|superseded/i.test(
    String(t)
  );
}

function detailLooksLikeExternalChromeFlake(detail) {
  return /external to OpenClaw|Page closed|Playwright connection attempt was superseded|page enumeration timed out/i.test(
    String(detail || '')
  );
}

async function executeDecision(ceoUserId, decision, agentId) {
  const action = String(decision.action || '').toLowerCase();
  if (action === 'open' && decision.url) {
    return browserInvoke(ceoUserId, 'open', { url: decision.url, targetUrl: decision.url }, agentId);
  }
  if (action === 'click' && decision.ref) {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'click', ref: decision.ref }, ref: decision.ref }, agentId);
  }
  // Label-only click: find control by visible text / aria-label via evaluate (relay freeform string needs structured request).
  if (action === 'click' && !decision.ref && (decision.text || decision.reason || decision.summary)) {
    const label = String(decision.text || decision.summary || decision.reason || '').slice(0, 120);
    const fn =
      `(() => { const target = ${JSON.stringify(label)}; const re = new RegExp(target.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'i');` +
      ` const nodes = Array.from(document.querySelectorAll('button, [role="button"], a, div[role="button"]'));` +
      ` for (const el of nodes) { const t = ((el.innerText||'')+' '+(el.getAttribute('aria-label')||'')).trim();` +
      ` if (re.test(t) || re.test(target)) { el.click(); return 'clicked:' + t.slice(0,80); } }` +
      ` return 'not_found:' + target; })()`;
    return browserInvoke(
      ceoUserId,
      'act',
      { request: { kind: 'evaluate', fn }, fn, expression: fn },
      agentId
    );
  }
  if (action === 'type' && (decision.ref || decision.text != null)) {
    let text = decision.text;
    if (String(text || '') === '__FLOW_PROMPT__') {
      // Caller should have substituted; keep safe no-op if not
      text = decision.text;
    }
    return browserInvoke(
      ceoUserId,
      'act',
      { request: { kind: 'type', ref: decision.ref, text }, ref: decision.ref, text },
      agentId
    );
  }
  if (action === 'press' && decision.key) {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'press', key: decision.key }, key: decision.key }, agentId);
  }
  if (action === 'scroll') {
    return browserInvoke(ceoUserId, 'act', { request: { kind: 'scroll', direction: 'down' } }, agentId);
  }
  if (action === 'screenshot') {
    return browserInvoke(ceoUserId, 'screenshot', { full_page: true }, agentId);
  }
  if (decision.reason || decision.text) {
    // Structured freeform is not supported as raw string by Chrome Relay ("request required").
    // Only type when the model clearly meant a type action with text.
    return { ok: true, text: JSON.stringify({ skipped: true, reason: 'unstructured_act_ignored' }) };
  }
  return { ok: true, text: '{"skipped":true}' };
}

/** Parse Playwright-style a11y snapshot for [ref=eN] near a label. */
function findSnapshotRef(snapshot, labelRe) {
  const t = String(snapshot || '');
  const re =
    labelRe instanceof RegExp
      ? labelRe
      : new RegExp(String(labelRe).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  // Prefer button "Label" [ref=eN]
  const lines = t.split('\n');
  for (const line of lines) {
    if (!re.test(line)) continue;
    const m = line.match(/\[ref=(e\d+)\]/);
    if (m) return m[1];
  }
  // Label then ref on same window
  const windowMatch = t.match(
    new RegExp(
      `(?:button|link|generic|paragraph|textbox)[^\\n]{0,80}${re.source}[^\\n]{0,40}\\[ref=(e\\d+)\\]|\\[ref=(e\\d+)\\][^\\n]{0,80}${re.source}`,
      'i'
    )
  );
  if (windowMatch) return windowMatch[1] || windowMatch[2] || null;
  return null;
}

/** LinkedIn feed → Start a post via a11y CDP click (evaluate .click is not trusted / ignored). */
async function tryLinkedInComposerBootstrap(ceoUserId, agentId, goal, steps) {
  if (!goalLooksInteractive(goal) || !/linkedin|linked\s*in/i.test(String(goal || ''))) return false;
  if (steps.some((s) => s.action === 'linkedin_composer_bootstrap')) return false;

  let opened = false;
  let detail = '';
  try {
    const snap = await takeSnapshot(ceoUserId, agentId, { limit: 20000 });
    const ref =
      findSnapshotRef(snap, /Start a post/i) ||
      findSnapshotRef(snap, /Create a post/i);
    if (ref) {
      const res = await browserInvoke(
        ceoUserId,
        'act',
        { request: { kind: 'click', ref }, ref },
        agentId
      );
      const failed = invokeLooksFailed(res);
      detail = `ref=${ref} ${String(parseInvokeText(res) || '').slice(0, 200)}`;
      opened = !failed;
      // Second click if first "ok" but modal may need reinjection
      if (opened) {
        await sleep(800);
        await browserInvoke(ceoUserId, 'act', { request: { kind: 'click', ref }, ref }, agentId).catch(() => {});
      }
    } else {
      detail = 'no_start_post_ref_in_snapshot';
    }
  } catch (e) {
    detail = String(e?.message || e);
  }

  // Fallback DOM evaluate only if CDP ref path did not run
  if (!opened && detail.includes('no_start_post_ref')) {
    const fn = `() => {
      const nodes = Array.from(document.querySelectorAll('button, [role="button"]'));
      for (const el of nodes) {
        const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
        if (/^start a post$/i.test(t) || (t.length < 40 && /start a post/i.test(t))) {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          return 'clicked_eval:' + t.slice(0, 40);
        }
      }
      return 'not_found';
    }`;
    const ev = await evaluateInBrowser(ceoUserId, agentId, fn);
    detail = `${detail}; eval=${ev.detail}`;
    opened = /clicked/i.test(ev.detail || '');
  }

  steps.push({
    t: nowIso(),
    action: 'linkedin_composer_bootstrap',
    ok: opened,
    detail: String(detail).slice(0, 400),
  });
  if (opened) {
    console.info('[browser-task] linkedin composer bootstrap ok detail=%s', String(detail).slice(0, 120));
    await sleep(3500);
    return true;
  }
  console.warn('[browser-task] linkedin composer bootstrap failed detail=%s', String(detail).slice(0, 180));
  return false;
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

export function assertPreferredBrowserExecutor(selectedExecutor, preferredDriver, allowFallback = true) {
  const preferred = String(preferredDriver || '').trim();
  if (!preferred || allowFallback !== false || selectedExecutor?.driver_mode === preferred) return selectedExecutor;
  const error = new Error(`Required browser executor is offline: ${preferred}`);
  error.code = 'EXECUTOR_OFFLINE';
  error.status = 503;
  throw error;
}

export async function startBrowserTask(ceoUserId, body = {}) {
  reapStaleBrowserTasks(ceoUserId);
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

  const taskInput = mode === 'recipe_replay'
    ? normalizeRecipeInputs(body.inputs ?? body.input ?? {})
    : body.input && typeof body.input === 'object'
      ? body.input
      : {};
  const db = getDb();
  const id = `bt-${randomUUID()}`;
  const agentId = String(body.agent_id || 'workflowbuilder');
  let recipeId = body.recipe_id || null;
  const preferredDriver = String(body.preferred_driver || body.preferredDriver || '').trim() || null;
  const allowFallback = body.allow_fallback !== false && body.allowFallback !== false;
  const excludedDrivers = Array.isArray(body.excluded_drivers || body.excludedDrivers)
    ? (body.excluded_drivers || body.excludedDrivers)
    : [];
  const requiredCapabilities = /\b(screen\s*shot|png|image capture)\b/i.test(goal) ? ['screenshot'] : [];
  const selectedExecutor = selectBrowserExecutor(ceoUserId, {
    preferredDriver,
    requiredCapabilities,
    excludedDrivers,
  });
  assertPreferredBrowserExecutor(selectedExecutor, preferredDriver, allowFallback);
  const traceId = randomUUID();
  const parentGoalRunId = String(body.goal_run_id || body.goalRunId || '').trim() || null;
  const parentGoalStepId = String(body.goal_step_id || body.goalStepId || '').trim() || null;

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
      input_json, steps_json, selected_node_id, selected_driver_mode, protocol_version,
      trace_id, parent_goal_run_id, parent_goal_step_id, restartable, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    ceoUserId,
    agentId,
    recipeId,
    mode,
    mode === 'recorder' ? 'recording' : 'pending',
    goal,
    startUrl,
    JSON.stringify(taskInput),
    selectedExecutor?.id || null,
    selectedExecutor?.driver_mode || 'managed_playwright',
    selectedExecutor?.protocol_version || 1,
    traceId,
    parentGoalRunId,
    parentGoalStepId,
    /publish|send|submit|purchase|delete|apply|generate/i.test(goal) ? 0 : 1,
    nowIso(),
    nowIso()
  );

  console.info('[browser-task] start id=%s ceo=%s mode=%s task_agent=%s', id, ceoUserId, mode, agentId);

  if (mode === 'recorder') {
    if (startUrl) {
      try {
        await browserTaskContext.run(getTask(ceoUserId, id), () => browserInvoke(ceoUserId, 'open', { url: startUrl, targetUrl: startUrl }, agentId));
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
      browserTaskContext.run(getTask(ceoUserId, id), () => runRecipeReplay(ceoUserId, id)).catch((e) => {
        console.error('[browser-task] recipe replay failed id=%s: %s', id, e.message);
        updateTask(ceoUserId, id, { status: 'failed', error: e.message });
      });
    });
    return getTask(ceoUserId, id);
  }

  setImmediate(() => {
    browserTaskContext.run(getTask(ceoUserId, id), () => runAutonomous(ceoUserId, id)).catch((e) => {
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

function browserArtifactsFromSteps(steps) {
  const seen = new Set();
  const artifacts = [];
  for (const entry of steps || []) {
    const artifact = entry?.artifact || entry?.evidence?.artifact;
    const url = artifact?.url || entry?.artifact_url || entry?.evidence?.artifact_url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    artifacts.push(artifact && typeof artifact === 'object' ? artifact : { url, kind: 'other' });
  }
  return artifacts;
}

/**
 * Goals that require click/type/submit (publish, compose, reply) must run the act loop.
 * early_page_summarize only helps pure read/research (and Cheapflights accelerator).
 */
export function goalLooksInteractive(goalText) {
  const g = String(goalText || '');
  return /\b(publish|post|compose|submit|share|create a (new )?(post|tweet|update)|reply|comment|type|fill|click|upload|message|send|like|follow|connect|apply|paste|download|generate|capture|screen\s*shot|png|save (?:an? )?(?:image|screen\s*shot)|prompt box|prompt text|start generation|scene\s+\d+|google flow|labs\.google\/fx\/tools\/flow)\b/i.test(
    g
  );
}

export function snapshotSummaryPrompt(goal, snapshot) {
  const flightGoal = /\b(flights?|airline|airport|nonstop|non-stop|cheapflights)\b/i.test(String(goal || ''));
  return (
    'Goal: ' +
    goal +
    '\nFrom this page text (accessibility + DOM), answer the goal. ' +
    (flightGoal
      ? 'If flights are visible, list the top options sorted by ascending price with airline, stops, duration, and price. Prefer direct/nonstop when the goal asks for that. Do not invent prices or airlines. Prefer the DOM_RESULTS section when present because it has the flight cards. '
      : 'Stay specific to this goal and page. Do not introduce flight-search instructions or unrelated domains. ') +
    '\nSnapshot:\n' +
    String(snapshot || '').slice(0, 20000)
  );
}

async function summarizeGoalFromSnapshot(ceoUserId, goal, snapshot) {
  const { content } = await chatCompletions({
    messages: [
      {
        role: 'user',
        content: snapshotSummaryPrompt(goal, snapshot),
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

export function browserTaskResumeState(task) {
  const prior = Array.isArray(task?.steps) ? task.steps : [];
  const resumed = prior.length > 0;
  return {
    resumed,
    steps: resumed ? [...prior] : [],
    execution_plan: [...prior].reverse().find((entry) => entry.action === 'plan' && entry.plan)?.plan || null,
  };
}

async function runAutonomous(ceoUserId, taskId) {
  const task = getTask(ceoUserId, taskId);
  if (!task) return;
  updateTask(ceoUserId, taskId, { status: 'running', wait_reason: null, error: null });
  const maxSteps = Number(task.input?.max_steps) || MAX_STEPS_DEFAULT;
  const agentId = task.agent_id || 'workflowbuilder';
  const resumeState = browserTaskResumeState(task);
  const resumed = resumeState.resumed;
  const steps = resumeState.steps;
  let parseFallbackStreak = 0;
  let exitNote = 'max_steps_reached';
  const socialPublish = goalLooksSocialPublish(task.goal_text);
  const publishBody = extractPublishBodyFromGoal(task.goal_text);
  const executionPlan = resumeState.execution_plan ||
    await createExecutionPlan(ceoUserId, task.goal_text, task.start_url);
  steps.push(resumed
    ? { t: nowIso(), action: 'resume', from_step_count: task.steps.length, node_id: task.selected_node_id || null }
    : { t: nowIso(), action: 'plan', plan: executionPlan });
  updateTask(ceoUserId, taskId, { steps });

  // Autonomous social publish: tab focus, open composer, shadow fill+Post, recycle tab.
  // No human mid-workflow for tab focus or Start a post (only Client Chrome lease is one-time setup).
  if (socialPublish && publishBody && !resumed) {
    console.info('[browser-task] social autonomous path id=%s body_len=%s', taskId, publishBody.length);
    updateTask(ceoUserId, taskId, { status: 'running', wait_reason: null });
    const pub = await runAutonomousSocialPublish(ceoUserId, {
      goalText: task.goal_text,
      startUrl: task.start_url,
      body: publishBody,
    });
    for (const s of pub.steps || []) steps.push(s);
    updateTask(ceoUserId, taskId, {
      status: pub.ok ? 'completed' : 'failed',
      result: {
        summary: pub.summary,
        note: pub.note,
        platform: pub.platform,
        steps: steps.length,
        fill: pub.fill,
        confirm: pub.confirm,
        tab_close: pub.tab_close,
      },
      steps,
      wait_reason: null,
      error: pub.ok ? null : pub.summary,
    });
    recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
      rating: pub.ok ? 'up' : 'down',
      comment: pub.summary,
      note: pub.note,
    });
    console.info('[browser-task] social autonomous finished id=%s ok=%s note=%s', taskId, pub.ok, pub.note);
    return;
  }

  if (task.start_url && !resumed) {
    await browserInvoke(ceoUserId, 'open', { url: task.start_url, targetUrl: task.start_url }, agentId);
    steps.push({ t: nowIso(), action: 'open', url: task.start_url });
    await sleep(goalLooksInteractive(task.goal_text) ? 5000 : 3500);
  } else if (!resumed) {
    await browserInvoke(ceoUserId, 'start', {}, agentId).catch(() => {});
  }

  if (goalLooksInteractive(task.goal_text) && !resumed) {
    await tryLinkedInComposerBootstrap(ceoUserId, agentId, task.goal_text, steps);
    const flowBoot = await tryGoogleFlowBootstrap(ceoUserId, agentId, task.goal_text, steps);
    updateTask(ceoUserId, taskId, { steps });
    if (flowBoot && goalLooksGoogleFlow(task.goal_text)) {
      const flowRun = await runGoogleFlowGenerateDownload(ceoUserId, agentId, task.goal_text, steps);
      if (flowRun) {
        const blocked = Boolean(flowRun.blocked) && !flowRun.ok;
        updateTask(ceoUserId, taskId, {
          status: blocked ? 'blocked_on_input' : flowRun.ok ? 'completed' : 'completed',
          result: {
            summary: flowRun.summary,
            note: flowRun.note,
            steps: steps.length,
            flow: flowRun,
            needs: blocked ? 'flow_generate_or_download' : undefined,
          },
          steps,
          wait_reason: blocked ? flowRun.summary : null,
          error: flowRun.ok ? null : flowRun.summary,
        });
        recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
          rating: flowRun.ok ? 'up' : 'down',
          comment: flowRun.summary,
          note: flowRun.note,
        });
        console.info('[browser-task] google flow generate/download path id=%s ok=%s', taskId, flowRun.ok);
        return;
      }
    }
  }

  // Read/research goals with a start URL + substantial page text can complete early.
  // Interactive goals (publish/compose/reply/type/click/…) must enter the act loop.
  // Cheapflights retains its stricter priced-results gate below.
  if (
    task.start_url &&
    !/cheapflights\.com\/flight-search\//i.test(String(task.start_url)) &&
    !goalLooksInteractive(task.goal_text)
  ) {
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
  } else if (task.start_url && goalLooksInteractive(task.goal_text)) {
    console.info(
      '[browser-task] skip early summarize (interactive goal) id=%s goal_len=%s',
      taskId,
      String(task.goal_text || '').length
    );
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
    // Prefer deterministic fill+post whenever the modal is open (stops feed scroll thrash).
    if (socialPublish && publishBody && fillPostAttempts < 4) {
      const state = await detectSocialComposerState(ceoUserId, agentId);
      if (state.open && state.hasEditor) {
        fillPostAttempts += 1;
        steps.push({ t: nowIso(), action: 'composer_state_loop', state, attempt: fillPostAttempts });
        const filled = await trySocialComposerFillAndPost(ceoUserId, agentId, publishBody, steps);
        updateTask(ceoUserId, taskId, { steps });
        if (filled.ok) {
          const conf = await confirmSocialPostResult(ceoUserId, agentId);
          steps.push({ t: nowIso(), action: 'post_confirm', conf });
          const summary = conf.posted_hint || !conf.modal_still_open
            ? `Posted (deterministic composer path). ${conf.url ? 'URL: ' + conf.url : 'Modal closed; verify on feed if URL missing.'}`
            : `Composer submit clicked but modal still open. url=${conf.url || 'n/a'}`;
          updateTask(ceoUserId, taskId, {
            status: 'completed',
            result: {
              summary,
              note: conf.posted_hint ? 'social_fill_post_ok' : 'social_fill_post_uncertain',
              steps: steps.length,
              confirm: conf,
              fill: filled,
            },
            steps,
            wait_reason: null,
          });
          recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
            rating: conf.posted_hint || !conf.modal_still_open ? 'up' : 'down',
            comment: summary,
            note: 'social_fill_post_loop',
          });
          console.info('[browser-task] social loop path finished id=%s', taskId);
          return;
        }
      }
    }

    const snapshotA11y = await takeSnapshot(ceoUserId, agentId);
    let snapshot = snapshotA11y;
    if (goalLooksGoogleFlow(task.goal_text)) {
      const domText = await extractVisibleDomText(ceoUserId, agentId).catch(() => '');
      if (domText) {
        snapshot = `DOM_VISIBLE_TEXT:\n${domText.slice(0, 8000)}\n\nA11Y_SNIPPET:\n${String(snapshotA11y || '').slice(0, 6000)}`;
      }
    }
    void LOGIN_HINT_RE;
    const modalState = socialPublish ? await detectSocialComposerState(ceoUserId, agentId) : { open: false };
    const decision = await decideNextAction({
      ceoUserId,
      goal: task.goal_text,
      snapshot,
      history: steps,
      startUrl: task.start_url,
      modalOpen: Boolean(modalState.open),
    });
    steps.push({ t: nowIso(), decision, modalOpen: Boolean(modalState.open) });
    updateTask(ceoUserId, taskId, { steps });

    const act = String(decision.action || '').toLowerCase();
    // Hard block scroll when modal is open
    if (act === 'scroll' && modalState.open) {
      steps.push({ t: nowIso(), action: 'scroll_suppressed_modal_open' });
      updateTask(ceoUserId, taskId, { steps });
      continue;
    }
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
      const verificationSnapshot = await takeSnapshot(ceoUserId, agentId);
      const verification = await verifyGoalCompletion({
        ceoUserId,
        goal: task.goal_text,
        plan: executionPlan,
        snapshot: verificationSnapshot,
        history: steps,
        proposedSummary: summary,
      });
      steps.push({ t: nowIso(), action: 'completion_verification', verification });
      if (!verification.satisfied) {
        const rejected = steps.filter(
          (entry) => entry.action === 'completion_verification' && entry.verification?.satisfied === false
        ).length;
        updateTask(ceoUserId, taskId, { steps });
        if (verification.hard_guard || rejected >= 3) {
          const reason = verification.reason || 'Goal completion could not be verified.';
          updateTask(ceoUserId, taskId, {
            status: 'failed',
            error: reason,
            result: {
              summary: reason,
              note: 'completion_evidence_missing',
              missing_evidence: verification.missing_evidence || [],
              steps: steps.length,
            },
            steps,
          });
          recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
            rating: 'down',
            comment: reason,
            note: 'completion_evidence_missing',
          });
          return;
        }
        await sleep(800);
        continue;
      }
      updateTask(ceoUserId, taskId, {
        status: 'completed',
        result: {
          summary,
          verification,
          artifacts: browserArtifactsFromSteps(steps),
          steps: steps.length,
        },
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

    const execRes = await executeDecision(ceoUserId, decision, agentId);
    if (invokeLooksFailed(execRes)) {
      const detail = String(parseInvokeText(execRes) || execRes?.text || 'act_failed').slice(0, 400);
      steps.push({
        t: nowIso(),
        action: 'act_failed',
        decision: { action: act, ref: decision.ref, text: decision.text },
        detail,
      });
      updateTask(ceoUserId, taskId, { steps });
      console.warn('[browser-task] act_failed id=%s action=%s ref=%s: %s', taskId, act, decision.ref || '', detail.slice(0, 180));
      if (detailLooksLikeExternalChromeFlake(detail)) {
        const flakeCount = steps.filter((s) => detailLooksLikeExternalChromeFlake(s.detail)).length;
        if (flakeCount >= 3) {
          const msg =
            'Client Chrome (extension) connection flaked repeatedly (page closed / external CDP timeout). ' +
            'Re-attach the LinkedIn tab in the OpenClaw extension, keep that tab open, then resume or re-run.';
          updateTask(ceoUserId, taskId, {
            status: 'blocked_on_input',
            wait_reason: msg,
            steps,
            result: { needs: 'chrome_attach', message: msg, note: 'external_chrome_flaky' },
          });
          console.warn('[browser-task] blocked external_chrome_flaky id=%s flakes=%s', taskId, flakeCount);
          return;
        }
      }
      await sleep(1200);
      continue;
    }
    const rawEvidence = String(parseInvokeText(execRes) || execRes?.text || '').slice(0, 4000);
    let evidence = rawEvidence;
    try {
      evidence = JSON.parse(rawEvidence);
    } catch {
      /* retain text evidence */
    }
    steps.push({
      t: nowIso(),
      action: act,
      outcome: 'ok',
      evidence,
      artifact: evidence && typeof evidence === 'object' ? evidence.artifact || null : null,
      artifact_url: evidence && typeof evidence === 'object' ? evidence.artifact_url || null : null,
    });
    updateTask(ceoUserId, taskId, { steps });
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
  const finalVerification = await verifyGoalCompletion({
    ceoUserId,
    goal: task.goal_text,
    plan: executionPlan,
    snapshot: finalSnap,
    history: steps,
    proposedSummary: completedSummary,
  });
  steps.push({ t: nowIso(), action: 'completion_verification', verification: finalVerification });
  const finalStatus = finalVerification.satisfied ? 'completed' : 'failed';
  updateTask(ceoUserId, taskId, {
    status: finalStatus,
    steps,
    error: finalVerification.satisfied ? null : finalVerification.reason || 'Goal incomplete at step limit',
    result: {
      summary: completedSummary,
      note: finalVerification.satisfied ? exitNote : 'completion_evidence_missing',
      verification: finalVerification,
      artifacts: browserArtifactsFromSteps(steps),
      steps: steps.length,
    },
  });
  const rating = finalVerification.satisfied && exitNote !== 'parse_fallback_exhausted' ? 'up' : 'down';
  recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
    rating,
    comment: completedSummary,
    note: exitNote,
  });
}

function parseWorkerEvidence(result) {
  if (!result) return null;
  const raw = result.text ?? result.result ?? result;
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw || '')); } catch { return String(raw || '').slice(0, 4000); }
}

export function verifyRecipeReplayOutcome(recipe, actionResults, snapshot) {
  const results = Array.isArray(actionResults) ? actionResults : [];
  const evidence = [];
  const missing = [];
  const snapshotText = String(snapshot || '');
  const url = snapshotText.match(/^URL:\s*(https?:\/\/\S+)/im)?.[1] || null;
  const title = snapshotText.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || null;
  if (url) evidence.push({ type: 'final_url', value: url }); else missing.push('final_url');
  if (title) evidence.push({ type: 'page_title', value: title });
  for (const result of results) {
    if (!result.ok) missing.push(`action_receipt:${result.action}`);
    else evidence.push({ type: 'action_receipt', action: result.action, result_state: result.evidence?.result_state || null });
    if (result.action === 'screenshot') {
      const artifact = result.evidence?.artifact || result.evidence?.artifact_url;
      if (artifact) evidence.push({ type: 'artifact', value: artifact.url || artifact });
      else missing.push('screenshot_artifact');
    }
  }
  for (const step of recipe?.steps || []) {
    const args = step.args || {};
    if (args.expect_text && !snapshotText.toLowerCase().includes(String(args.expect_text).toLowerCase())) {
      missing.push(`expected_text:${String(args.expect_text).slice(0, 80)}`);
    }
    if (args.expect_url) {
      try { if (!(new RegExp(String(args.expect_url), 'i')).test(url || '')) missing.push(`expected_url:${String(args.expect_url).slice(0, 80)}`); }
      catch { missing.push('invalid_expected_url_pattern'); }
    }
  }
  return {
    satisfied: missing.length === 0,
    reason: missing.length ? `Recipe finished without required evidence: ${missing.join(', ')}` : 'All recipe actions and typed outputs were observed.',
    evidence,
    missing_evidence: missing,
    outputs: { final_url: url, page_title: title, action_receipts: results.length },
  };
}

async function runRecipeReplay(ceoUserId, taskId) {
  const task = getTask(ceoUserId, taskId);
  if (!task?.recipe_id) throw new Error('missing recipe');
  const recipe = getRecipe(ceoUserId, task.recipe_id);
  if (!recipe) throw new Error('recipe not found');
  const inputs = normalizeRecipeInputs(task.input || {});
  const requiredInputs = recipeRequiredInputs(recipe);
  const missingInputs = requiredInputs.filter((name) => !Object.prototype.hasOwnProperty.call(inputs, name));
  if (missingInputs.length) {
    const error = `Missing required recipe input(s): ${missingInputs.join(', ')}`;
    updateTask(ceoUserId, taskId, {
      status: 'failed',
      error,
      result: { summary: error, recipe_id: recipe.id, recipe_name: recipe.name, required_inputs: requiredInputs },
    });
    return;
  }
  updateTask(ceoUserId, taskId, { status: 'running' });
  const agentId = task.agent_id || 'workflowbuilder';
  const actionable = (recipe.steps || []).filter((s) =>
    ['open', 'act', 'click', 'type', 'press', 'scroll', 'screenshot'].includes(String(s.action || '').toLowerCase())
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
  const actionResults = [];
  for (const step of recipe.steps) {
    const args = substituteRecipeInputs(step.args || {}, inputs);
    const act = String(step.action || '').toLowerCase();
    if (act === 'snapshot') {
      // Checkpoints are not replayed as browser actions
      steps.push({ t: nowIso(), step, skipped: true, reason: 'snapshot_checkpoint' });
      updateTask(ceoUserId, taskId, { steps });
      continue;
    }
    let invokeResult = null;
    if (act === 'open' && args.url) {
      invokeResult = await browserInvoke(ceoUserId, 'open', { url: args.url, targetUrl: args.url }, agentId);
    } else if (act === 'act' || act === 'click' || act === 'type') {
      invokeResult = await browserInvoke(ceoUserId, 'act', args, agentId);
    } else if (act === 'press' || act === 'scroll') {
      invokeResult = await browserInvoke(ceoUserId, 'act', { ...args, request: args.request || { kind: act, ...args } }, agentId);
    } else if (act === 'wait') {
      invokeResult = await browserInvoke(ceoUserId, 'wait', args, agentId);
    } else if (act === 'screenshot') {
      invokeResult = await browserInvoke(ceoUserId, 'screenshot', args, agentId);
    } else {
      invokeResult = await browserInvoke(ceoUserId, step.action, args, agentId);
    }
    const evidence = parseWorkerEvidence(invokeResult);
    actionResults.push({ action: act, ok: invokeResult?.ok !== false, evidence });
    steps.push({ t: nowIso(), step, outcome: invokeResult?.ok === false ? 'failed' : 'ok', evidence });
    updateTask(ceoUserId, taskId, { steps });
    await sleep(1500);
  }
  const snap = await takeSnapshot(ceoUserId, agentId);
  const summary = `Replayed ${actionable.length} actionable step(s) from recipe "${recipe.name}"`;
  const verification = verifyRecipeReplayOutcome(recipe, actionResults, snap);
  updateTask(ceoUserId, taskId, {
    status: verification.satisfied ? 'completed' : 'failed',
    steps,
    result: {
      summary,
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      actionable_steps: actionable.length,
      used_inputs: requiredInputs,
      snapshot_excerpt: snap.slice(0, 4000),
      outputs: verification.outputs,
      verification,
    },
    error: verification.satisfied ? null : verification.reason,
  });
  recordBrowserTaskOutcome(ceoUserId, getTask(ceoUserId, taskId), {
    rating: verification.satisfied ? 'up' : 'down',
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
    browserTaskContext.run(task, () => runAutonomous(ceoUserId, taskId)).catch((e) => {
      updateTask(ceoUserId, taskId, { status: 'failed', error: e.message });
    });
  });
  return updateTask(ceoUserId, taskId, { status: 'running', wait_reason: null });
}

async function captureRecorderStepPinned(
  ceoUserId,
  taskId,
  { label = '', action, args = {}, template_args: templateArgs, url, execute = false } = {}
) {
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
  let snap = await takeSnapshot(ceoUserId, agentId);
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
    if (execute) {
      const result = await browserInvoke(ceoUserId, recordedAction, stepArgs, agentId);
      snap = await takeSnapshot(ceoUserId, agentId);
      const storedArgs = templateArgs && typeof templateArgs === 'object' && !Array.isArray(templateArgs)
        ? templateArgs
        : stepArgs;
      stepArgs = { ...storedArgs, recorded_result: result, snapshot_excerpt: String(snap).slice(0, 1500) };
    } else {
      stepArgs = { ...stepArgs, snapshot_excerpt: String(snap).slice(0, 1500) };
    }
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

export async function captureRecorderStep(ceoUserId, taskId, input = {}) {
  const task = getTask(ceoUserId, taskId);
  return browserTaskContext.run(task, () => captureRecorderStepPinned(ceoUserId, taskId, input));
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
