/**
 * Autonomous social publish for Browser Session (Client Chrome).
 *
 * CODIFIED SPECIALIZATION (not a recorded Browser Recipe).
 * - Generic path: browser-tasks autonomous loop + optional recipes (recorded steps).
 * - This module: site-specific publish engines (LinkedIn / Facebook / …) for
 *   reliability where a11y + scroll loops thrash share composers.
 * - Called from browser-tasks.js only when goalLooksSocialPublish + EXACT body present.
 *
 * Adding a new site tomorrow:
 * 1) Add entry to PLATFORM_REGISTRY below (host regex + start URLs).
 * 2) Implement openComposer / fillAndPost (or reuse a11y patterns) keyed by platform id.
 * 3) Wire confirm rules (dialog closed + brand on feed or toast).
 * 4) On terminal task: closePlatformTabsAfterTask (never leave platform tab open).
 * Recipes remain available for less sensitive sites via browse_recipe_run.
 */
import {
  invokeBrowserAction,
  parseInvokeText,
  sleep,
} from './job-browser-auth.js';
import { resolveBrowserProfile } from './client-browser-session.js';
import {
  isBrowserWorkerOnline,
  invokeViaBrowserWorker,
} from './browser-worker-dispatch.js';

const BROWSER_CDP_AGENT_ID = process.env.BROWSER_TASK_CDP_AGENT_ID || 'browser-cdp';

/** Registry: extend this map to add websites without touching the act loop core. */
export const PLATFORM_REGISTRY = {
  linkedin: {
    id: 'linkedin',
    hostRe: /linkedin\.com/i,
    startUrl: 'https://www.linkedin.com/feed/',
    matches: (g) => /linkedin|linked\s*in/i.test(g),
  },
  facebook: {
    id: 'facebook',
    hostRe: /facebook\.com|fb\.com/i,
    startUrl: 'https://www.facebook.com/',
    matches: (g) => /facebook|fb\.com/i.test(g),
  },
  instagram: {
    id: 'instagram',
    hostRe: /instagram\.com/i,
    startUrl: 'https://www.instagram.com/',
    matches: (g) => /instagram|insta\b/i.test(g),
  },
};

const PLATFORM_URLS = Object.fromEntries(
  Object.entries(PLATFORM_REGISTRY).map(([k, v]) => [k, v.startUrl])
);

function nowIso() {
  return new Date().toISOString();
}

async function cdp(action, extra = {}) {
  let timer;
  const ownerId = String(extra.ceoUserId || extra.ownerUserId || '').trim();
  try {
    return await Promise.race([
      (async () => {
        if (ownerId && isBrowserWorkerOnline(ownerId)) {
          return invokeViaBrowserWorker(ownerId, action, extra);
        }
        return invokeBrowserAction(action, BROWSER_CDP_AGENT_ID, extra);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('cdp_timeout_' + action)), 30000);
      }),
    ]);
  } catch (e) {
    console.warn('[browser-social] cdp %s failed/timeout: %s', action, e.message);
    return { ok: false, text: String(e.message || e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Attach owner so cdp can route to desktop_worker when online. */
function withOwner(ceoUserId, extra = {}) {
  const { profile } = resolveBrowserProfile(ceoUserId);
  return { ...extra, profile, ceoUserId };
}


function unwrapEvalText(text) {
  let t = String(text || '').trim();
  for (let depth = 0; depth < 3; depth++) {
    try {
      const j = JSON.parse(t);
      if (j && typeof j.result === 'string') {
        t = j.result;
        continue;
      }
      if (j && j.result != null && typeof j.result === 'object') {
        t = JSON.stringify(j.result);
        break;
      }
      if (j && typeof j.result !== 'undefined' && typeof j.result !== 'object') {
        t = String(j.result);
        break;
      }
      break;
    } catch {
      break;
    }
  }
  return t;
}

function looksFailed(result) {
  if (!result) return true;
  if (result.ok === false) return true;
  const t = parseInvokeText(result) || result.text || '';
  return /not found or not visible|Element ".*" not found|Unknown ref|BrowserServiceError|Target closed|Page closed|timed out|external to OpenClaw|superseded|tool execution failed/i.test(
    String(t)
  );
}

export function inferSocialPlatform(goalText, startUrl = '') {
  const g = `${goalText || ''} ${startUrl || ''}`.toLowerCase();
  for (const p of Object.values(PLATFORM_REGISTRY)) {
    if (p.matches(g) || p.hostRe.test(g)) return p.id;
  }
  return null;
}

export function extractPublishBody(goalText) {
  const g = String(goalText || '').replace(/\r\n/g, '\n').trim();
  if (!g) return '';
  const patterns = [
    /EXACT text[:\s]*\n+([\s\S]+?)(?:\n\nWhen published|\n\nFingerprint:|\n\nstart_url:|\n\nFACEBOOK|\n\nLINKEDIN|$)/i,
    /Body(?:\s*\(post this EXACT text[^)]*\))?[:\s]*\n+([\s\S]+?)(?:\n\nWhen published|\n\nFingerprint:|\n\nstart_url:|$)/i,
    /post this EXACT text as the (?:LinkedIn|Facebook) post\)?:\s*\n+([\s\S]+?)(?:\n\nWhen published|\n\nFingerprint:|$)/i,
  ];
  for (const re of patterns) {
    const m = g.match(re);
    if (m?.[1]?.trim()?.length > 20) return m[1].trim();
  }
  const oneLine = g.match(
    /EXACT text:\s*([\s\S]+?)(?:\n\nWhen published|\s+When published|\n\nFingerprint:|\s+Fingerprint:|$)/i
  );
  if (oneLine?.[1]?.trim()?.length > 20) return oneLine[1].trim();
  return '';
}

function parseTabsPayload(raw) {
  let s = String(raw || '');
  // OpenClaw wraps untrusted browser JSON in EXTERNAL_UNTRUSTED_CONTENT fences
  const fence = s.match(/---\s*(\{[\s\S]*\})\s*<<<END_EXTERNAL/i) || s.match(/(\{[\s\S]*"tabs"[\s\S]*\})/);
  if (fence?.[1]) s = fence[1];
  const m = s.match(/\{[\s\S]*"tabs"[\s\S]*\}/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed.tabs) ? parsed.tabs : [];
  } catch {
    return [];
  }
}

function tabIds(t) {
  return {
    targetId: t?.targetId || t?.suggestedTargetId || t?.id || t?.target_id || null,
    // OpenClaw client chrome often exposes synthetic tabId like "t53"
    tabId: t?.tabId || t?.tab_id || t?.id || null,
    url: String(t?.url || ''),
    title: String(t?.title || ''),
  };
}

export async function listChromeTabs(ceoUserId) {
  const res = await cdp('tabs', withOwner(ceoUserId));
  if (looksFailed(res)) return [];
  return parseTabsPayload(parseInvokeText(res)).map((t) => ({ ...t, ...tabIds(t) }));
}

export async function focusChromeTab(ceoUserId, targetId) {
  if (!targetId) return { ok: false };
  const res = await cdp('focus', withOwner(ceoUserId, { targetId }));
  if (!looksFailed(res)) return { ok: true, raw: parseInvokeText(res) };
  // Extension path may use tabId
  const res2 = await cdp('focus', withOwner(ceoUserId, { tabId: targetId, targetId }));
  return { ok: !looksFailed(res2), raw: parseInvokeText(res2) };
}

/**
 * Clear unload/discard blockers so tab close does not hang on browser/site confirm dialogs.
 * Facebook: "Discard post?" / "Leave Page?" when composer has draft.
 * Chromium: beforeunload "Leave site?"
 */
async function dismissUnloadAndDiscardDialogs(ceoUserId) {
  const { profile } = resolveBrowserProfile(ceoUserId);
  // Try CDP dialog accept if gateway supports it (beforeunload / alert)
  for (const action of ['dialog', 'handle_dialog', 'accept_dialog']) {
    try {
      await cdp(action, { profile, accept: true });
    } catch {
      /* optional */
    }
  }
  const dom = await evaluateJson(
    ceoUserId,
    `() => {
      try { window.onbeforeunload = null; } catch (e) {}
      try {
        window.addEventListener('beforeunload', (e) => {
          e.stopImmediatePropagation();
          e.preventDefault = () => {};
          delete e.returnValue;
        }, true);
      } catch (e) {}

      const clicked = [];
      // Facebook / LinkedIn discard composition dialogs
      const roots = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[role="alertdialog"]'));
      roots.push(document.body);
      const buttons = [];
      for (const root of roots) {
        for (const el of root.querySelectorAll('button, [role="button"], a, div[tabindex="0"]')) {
          buttons.push(el);
        }
      }
      const prefer = [
        /^(discard|leave page|leave|don't save|dont save|close without saving|confirm)$/i,
        /discard (post|draft)/i,
        /leave page/i,
        /leave without posting/i,
        /^ok$/i,
      ];
      // Prefer specific destructive buttons inside "Leave Page?" / "Discard post?" only
      for (const re of prefer) {
        for (const el of buttons) {
          const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
          const primary = t.split('\\n')[0].trim();
          if (!re.test(primary) && !re.test(t)) continue;
          if (t.length > 90) continue;
          // Never click Post / Share while dismissing
          if (/^(post|publish|share now|save draft)$/i.test(primary)) continue;
          try { el.click(); clicked.push(primary.slice(0, 40)); } catch (e) {}
        }
      }
      // Escape compose
      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      } catch (e) {}

      // Null out loaders; force clean location when possible without leaving
      return JSON.stringify({ ok: true, clicked, dialogs: roots.length - 1 });
    }`
  );
  await sleep(600);
  // Soft-navigate to blank within page so unload fires while hooks are neutralized
  await evaluateJson(
    ceoUserId,
    `() => {
      try { window.onbeforeunload = null; } catch (e) {}
      try {
        // Drop draft so FB won't block
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          /create post|discard/i.test(d.innerText || '')
        );
        if (dialog) {
          const disc = Array.from(dialog.querySelectorAll('button, [role="button"]')).find((b) =>
            /discard|leave/i.test((b.innerText || b.getAttribute('aria-label') || ''))
          );
          if (disc) disc.click();
        }
      } catch (e) {}
      try {
        // Stay on site but clear history state that might hold dirty form
        if (location.pathname && !/about:blank/i.test(location.href)) {
          /* no-op hard nav from evaluate is often blocked; open action used below */
        }
      } catch (e) {}
      return JSON.stringify({ ok: true, href: location.href });
    }`
  );
  return dom;
}

/**
 * Close a Client Chrome / OpenClaw tab without hanging on confirm dialogs.
 * Important: do NOT open about:blank (Client Chrome "open" often creates a NEW tab).
 */
export async function closeChromeTab(ceoUserId, targetId, tabId = null) {
  if (!targetId && !tabId) return { ok: false, note: 'no_id' };
  const { profile } = resolveBrowserProfile(ceoUserId);
  const tid = targetId || tabId;
  const tnum = tabId || tid;

  if (targetId) await focusChromeTab(ceoUserId, targetId).catch(() => {});
  // First: clear page-level discard popups / beforeunload
  for (let i = 0; i < 3; i++) {
    await dismissUnloadAndDiscardDialogs(ceoUserId);
    await sleep(400);
  }

  const attempts = [
    { action: 'close', extra: { profile, targetId: tid } },
    { action: 'close', extra: { profile, targetId: tid, tabId: tnum } },
    { action: 'closeTab', extra: { profile, tabId: tnum, targetId: tid } },
    { action: 'close_tab', extra: { profile, targetId: tid, tabId: tnum } },
    { action: 'tab_close', extra: { profile, targetId: tid } },
  ];
  for (const a of attempts) {
    try {
      const res = await cdp(a.action, a.extra);
      const text = parseInvokeText(res) || '';
      if (/dialog|confirm|leave site|leave page|discard/i.test(text) || looksFailed(res)) {
        await dismissUnloadAndDiscardDialogs(ceoUserId);
        try {
          await cdp('dialog', { profile, accept: true });
        } catch {
          /* optional */
        }
        try {
          await cdp('act', {
            profile,
            request: { kind: 'press', key: 'Escape' },
            key: 'Escape',
          });
        } catch {
          /* optional */
        }
      }
      if (!looksFailed(res) && !/unknown action|unknown command|not supported/i.test(text)) {
        console.info('[browser-social] close tab ok action=%s id=%s', a.action, String(tid).slice(0, 12));
        return { ok: true, action: a.action, targetId: tid };
      }
    } catch (e) {
      console.warn('[browser-social] close attempt %s: %s', a.action, e.message);
    }
  }

  // Soft: keep tab but leave clean feed (no composer) so user isn't stuck on confirm sheet
  try {
    if (targetId) await focusChromeTab(ceoUserId, targetId);
    await dismissUnloadAndDiscardDialogs(ceoUserId);
    console.warn('[browser-social] close fallback: tab left open but dialogs dismissed id=%s', String(tid).slice(0, 16));
    return { ok: false, note: 'close_failed_dialogs_cleared', targetId: tid };
  } catch (e) {
    return { ok: false, note: 'close_unsupported', targetId: tid, error: e.message };
  }
}

/**
 * After publish workflow completes (success or fail): close all tabs for that platform.
 * Dismisses FB discard / leave-page confirms first so close never hangs.
 */
export async function closePlatformTabsAfterTask(ceoUserId, platform, preferredTargetId = null) {
  const reg = PLATFORM_REGISTRY[platform] || PLATFORM_REGISTRY.linkedin;
  const steps = [];
  let tabsBefore = await listChromeTabs(ceoUserId);
  const matching = tabsBefore.filter(
    (t) => reg.hostRe.test(String(t.url || t.title || '')) || t.targetId === preferredTargetId
  );
  steps.push({
    action: 'tabs_before_close',
    count: tabsBefore.length,
    matching: matching.map((t) => ({
      targetId: t.targetId,
      tabId: t.tabId,
      url: String(t.url || '').slice(0, 80),
    })),
  });

  const toClose = [];
  const seen = new Set();
  if (preferredTargetId) {
    toClose.push({ targetId: preferredTargetId, tabId: preferredTargetId });
    seen.add(String(preferredTargetId));
  }
  for (const t of matching) {
    const id = String(t.targetId || t.tabId || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    toClose.push({ targetId: t.targetId, tabId: t.tabId });
  }

  for (const t of toClose) {
    if (t.targetId) await focusChromeTab(ceoUserId, t.targetId).catch(() => {});
    const discarded = await dismissUnloadAndDiscardDialogs(ceoUserId);
    steps.push({ action: 'dismiss_before_close', targetId: t.targetId, discarded });
    const closed = await closeChromeTab(ceoUserId, t.targetId, t.tabId);
    steps.push({ action: 'close_tab', ...t, ...closed });
    await sleep(700);
    // If native confirm still visible (another tab context), dismiss again
    await dismissUnloadAndDiscardDialogs(ceoUserId);
  }

  await sleep(900);
  let tabsAfter = await listChromeTabs(ceoUserId);
  let remaining = tabsAfter.filter((t) => reg.hostRe.test(String(t.url || t.title || '')));
  if (remaining.length) {
    for (const t of remaining) {
      await focusChromeTab(ceoUserId, t.targetId).catch(() => {});
      await dismissUnloadAndDiscardDialogs(ceoUserId);
      const closed = await closeChromeTab(ceoUserId, t.targetId, t.tabId);
      steps.push({ action: 'close_tab_retry', targetId: t.targetId, tabId: t.tabId, ...closed });
      await sleep(500);
    }
    await sleep(700);
    tabsAfter = await listChromeTabs(ceoUserId);
    remaining = tabsAfter.filter((t) =>
      reg.hostRe.test(String(t.url || t.title || '')) && !/about:blank/i.test(String(t.url || ''))
    );
  }

  // Treat about:blank leftovers as closed for host match purposes if already blanked
  const hostStillOpen = remaining.filter((t) => reg.hostRe.test(String(t.url || '')));
  const ok = hostStillOpen.length === 0;
  steps.push({
    action: 'tabs_after_close',
    count: tabsAfter.length,
    remaining: hostStillOpen.map((t) => ({ targetId: t.targetId, url: String(t.url || '').slice(0, 80) })),
    closed_ok: ok,
  });
  console.info(
    '[browser-social] close after task platform=%s closed=%s remaining=%s',
    platform,
    toClose.length,
    hostStillOpen.length
  );
  return { ok, steps, closed: toClose.length, remaining: hostStillOpen.length, tabsAfter };
}

/** @deprecated use closePlatformTabsAfterTask */
export async function recyclePlatformTab(ceoUserId, platform, targetId) {
  return closePlatformTabsAfterTask(ceoUserId, platform, targetId);
}

export async function evaluateJs(ceoUserId, fnSource) {
  const fn = String(fnSource || '').trim();
  const res = await cdp('act', {
    ...withOwner(ceoUserId),
    request: { kind: 'evaluate', fn },
    fn,
    expression: fn,
  });
  return {
    ok: !looksFailed(res),
    detail: unwrapEvalText(parseInvokeText(res) || res?.text || ''),
    raw: res,
  };
}

async function withTimeout(promise, ms, label = 'timeout') {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function evaluateJson(ceoUserId, fnSource) {
  try {
    return await withTimeout(
      (async () => {
        const { ok, detail } = await evaluateJs(ceoUserId, fnSource);
        if (!ok) return { ok: false, error: detail };
        try {
          return { ok: true, ...JSON.parse(detail) };
        } catch {
          return { ok: false, error: detail, raw: detail };
        }
      })(),
      25000,
      'evaluate_timeout'
    );
  } catch (e) {
    console.warn('[browser-social] evaluateJson timed out: %s', e.message);
    return { ok: false, error: e.message, stage: 'evaluate_timeout' };
  }
}

export async function openChromeUrl(ceoUserId, url) {
  const { profile } = resolveBrowserProfile(ceoUserId);
  const res = await cdp('open', { profile, url, targetUrl: url });
  const text = parseInvokeText(res);
  let targetId = null;
  try {
    const j = JSON.parse(text);
    targetId = j.targetId || j.result?.targetId || null;
  } catch {
    /* ignore */
  }
  return { ok: !looksFailed(res), targetId, raw: text };
}

/**
 * Prefer an existing platform tab; else open a fresh URL.
 * Always focus before acting so agents never drive FB while goal is LI.
 */
export async function ensurePlatformTab(ceoUserId, platform, { preferFresh = false } = {}) {
  const reg = PLATFORM_REGISTRY[platform] || PLATFORM_REGISTRY.linkedin;
  const url = reg.startUrl || PLATFORM_URLS[platform] || PLATFORM_URLS.linkedin;
  const hostRe = reg.hostRe || /linkedin\.com/i;

  let tabs = await listChromeTabs(ceoUserId);
  let match = tabs.find((t) => hostRe.test(String(t.url || t.title || '')));

  if (preferFresh && match?.targetId) {
    await closeChromeTab(ceoUserId, match.targetId, match.tabId);
    await sleep(800);
    match = null;
  }

  if (match?.targetId) {
    await focusChromeTab(ceoUserId, match.targetId);
    await sleep(600);
    return { ok: true, targetId: match.targetId, url: match.url, recycled: false };
  }

  const opened = await openChromeUrl(ceoUserId, url);
  await sleep(3500);
  tabs = await listChromeTabs(ceoUserId);
  match = tabs.find((t) => hostRe.test(String(t.url || ''))) || tabs[tabs.length - 1];
  if (match?.targetId) await focusChromeTab(ceoUserId, match.targetId);
  return {
    ok: Boolean(match?.targetId || opened.ok),
    targetId: match?.targetId || opened.targetId,
    url,
    recycled: false,
    opened: true,
  };
}

/**
 * Open Start a post / compose control without human intervention.
 */
async function openComposer(ceoUserId, platform) {
  const { profile } = resolveBrowserProfile(ceoUserId);
  const snapRes = await cdp('snapshot', { profile, limit: 28000 });
  const snap = parseInvokeText(snapRes) || '';

  const refPatterns =
    platform === 'facebook'
      ? [
          /(?:button|link|generic) "What.?s on your mind[^\"]*" \[ref=(e\d+)\]/i,
          /What.?s on your mind[^\n]*\[ref=(e\d+)\]/i,
          /Create a post[^\n]*\[ref=(e\d+)\]/i,
        ]
      : [
          /button "Start a post" \[ref=(e\d+)\]/i,
          /Start a post"[^\n]*\[ref=(e\d+)\]/i,
          /Create a post[^\n]*\[ref=(e\d+)\]/i,
        ];
  for (const re of refPatterns) {
    const refMatch = snap.match(re);
    const ref = refMatch?.[1];
    if (!ref) continue;
    const click = await cdp('act', { profile, request: { kind: 'click', ref }, ref });
    if (!looksFailed(click)) {
      await sleep(3200);
      return { ok: true, method: 'a11y_ref', ref, platform };
    }
  }

  const fn = `() => {
    function deepQueryAll(root, selector, out = []) {
      try { root.querySelectorAll(selector).forEach((el) => out.push(el)); } catch (e) {}
      const walk = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of walk) if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
      return out;
    }
    const nodes = deepQueryAll(document, 'button, [role="button"], div[role="button"], span[role="button"], a, div[tabindex="0"]');
    const prefer =
      ${JSON.stringify(platform)} === 'facebook'
        ? [/what.?s on your mind/i, /create a post/i, /write something/i]
        : [/^start a post$/i, /create a post/i, /start a post/i];
    for (const re of prefer) {
      for (const el of nodes) {
        const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '')).trim();
        if (!re.test(t) || t.length > 120) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 20 && b.height < 20) continue;
        el.click();
        return JSON.stringify({ ok: true, label: t.slice(0, 80), method: 'dom' });
      }
    }
    return JSON.stringify({ ok: false, stage: 'not_found' });
  }`;
  const out = await evaluateJson(ceoUserId, fn);
  await sleep(3200);
  return out;
}

function findSnapshotRef(snapshot, labelRe) {
  for (const line of String(snapshot || '').split('\n')) {
    if (!labelRe.test(line)) continue;
    const m = line.match(/\[ref=(e\d+)\]/);
    if (m) return { ref: m[1], line: line.trim().slice(0, 160) };
  }
  return null;
}

function findFacebookPostButtonRef(snapshot) {
  const lines = String(snapshot || '').split('\n');
  // Prefer exact composer primary Post near bottom of a11y tree.
  const candidates = [];
  for (const line of lines) {
    if (!/\[ref=(e\d+)\]/.test(line)) continue;
    if (!/\bPost\b/i.test(line)) continue;
    if (/post by|Actions for this post|posts by|comment|react|share now from/i.test(line)) continue;
    // FB uses button "Post" or generic/div labelled Post
    if (!/(button|role=button|"Post"|Post \[ref)/i.test(line) && !/name: Post/i.test(line)) {
      if (!/^(?:\s*)(?:- )?button "Post"/i.test(line) && !/button "Post"/i.test(line)) continue;
    }
    const m = line.match(/\[ref=(e\d+)\]/);
    if (!m) continue;
    const score =
      (/button "Post"/i.test(line) ? 20 : 0) +
      (/^Post$/i.test(line.trim()) ? 10 : 0) +
      (/disabled|dimmed/i.test(line) ? -30 : 0);
    candidates.push({ ref: m[1], line: line.trim().slice(0, 140), score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

/**
 * Facebook Create post — Lexical.
 * Never use multi-attempt execCommand insertText (stacks body N×).
 * Flow: open composer → a11y Ctrl+A + type once → wait Post enabled → click → wait dialog close.
 */
async function fillAndPostFacebook(ceoUserId, bodyText) {
  const body = String(bodyText || '').trim();
  if (!body) return { ok: false, stage: 'empty_body' };
  const { profile } = resolveBrowserProfile(ceoUserId);
  const needle = body.replace(/\s+/g, ' ').trim().slice(0, 28);
  const maxLen = Math.max(body.length + 40, Math.ceil(body.length * 1.5));
  const deadline = Date.now() + 120000;
  function guard() {
    if (Date.now() > deadline) throw new Error('facebook_fill_timeout');
  }

  async function dialogOpen() {
    return evaluateJson(
      ceoUserId,
      `() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          /create post/i.test(d.innerText || '') && /what.?s on your mind|add to your post/i.test(d.innerText || '')
        );
        return JSON.stringify({ open: !!dialog });
      }`
    );
  }

  async function openCreate() {
    guard();
    const probe = await dialogOpen();
    if (probe.open) return { ok: true, already: true };
    const snap = parseInvokeText(await cdp('snapshot', { profile, limit: 30000 })) || '';
    const mind =
      findSnapshotRef(snap, /button "What.?s on your mind/i) ||
      findSnapshotRef(snap, /What.?s on your mind,/i) ||
      findSnapshotRef(snap, /Create a post/i);
    if (mind?.ref) {
      await cdp('act', { profile, request: { kind: 'click', ref: mind.ref }, ref: mind.ref });
    } else {
      await evaluateJson(
        ceoUserId,
        `() => {
          const mind = Array.from(document.querySelectorAll('[role="button"], button')).find((el) =>
            /what.?s on your mind/i.test((el.innerText || el.getAttribute('aria-label') || '').trim()) &&
            ((el.innerText || '').trim().length < 80)
          );
          if (mind) mind.click();
          return JSON.stringify({ ok: !!mind });
        }`
      );
    }
    await sleep(3200);
    return dialogOpen();
  }

  async function discardComposer() {
    await evaluateJson(
      ceoUserId,
      `() => {
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        } catch (e) {}
        const roots = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"]'));
        const clicked = [];
        for (const root of roots) {
          for (const el of root.querySelectorAll('button, [role="button"]')) {
            const t = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')).trim().split('\\n')[0];
            if (/^(discard|leave page|leave|don't save|dont save)$/i.test(t) || /discard (post|draft)/i.test(t)) {
              try { el.click(); clicked.push(t.slice(0, 40)); } catch (e) {}
            }
          }
        }
        return JSON.stringify({ ok: true, clicked });
      }`
    );
    try {
      await cdp('act', { profile, request: { kind: 'press', key: 'Escape' }, key: 'Escape' });
    } catch (e) {}
    await sleep(700);
  }

  async function measureEditor() {
    guard();
    return evaluateJson(
      ceoUserId,
      `() => {
        const body = ${JSON.stringify(body)};
        const needle = ${JSON.stringify(needle)};
        const maxLen = ${maxLen};
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          /create post/i.test(d.innerText || '')
        );
        if (!dialog) return JSON.stringify({ ok: false, stage: 'no_create_dialog' });
        const editor =
          dialog.querySelector('[contenteditable="true"][role="textbox"]') ||
          dialog.querySelector('[contenteditable="true"]') ||
          dialog.querySelector('[role="textbox"]');
        if (!editor) return JSON.stringify({ ok: false, stage: 'no_editor' });
        let leaf = '';
        try {
          const nodes = editor.querySelectorAll('span[data-lexical-text="true"], [data-lexical-text], p');
          leaf = Array.from(nodes).map((n) => (n.innerText || n.textContent || '').trim()).filter(Boolean).join(' ').trim();
        } catch (e) {}
        const raw = (editor.innerText || editor.textContent || '').replace(/\u00a0/g, ' ').trim();
        const stacked = body ? Math.max(0, raw.split(body).length - 1) : 0;
        let effective = leaf || raw;
        if (stacked >= 2) effective = body;
        const hasNeedle =
          raw.includes(needle.slice(0, Math.min(16, needle.length))) ||
          leaf.includes(needle.slice(0, Math.min(16, needle.length)));
        const posts = Array.from(dialog.querySelectorAll('[role="button"], button'))
          .map((el) => {
            const t = (el.innerText || el.getAttribute('aria-label') || '').trim().split('\\n')[0];
            const b = el.getBoundingClientRect();
            const disabled = el.getAttribute('aria-disabled') === 'true' || !!el.disabled;
            return { t, disabled, y: b.y, w: b.width };
          })
          .filter((x) => /^post$/i.test(x.t) && x.w > 24);
        posts.sort((a, b) => (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) || b.y - a.y);
        const post = posts[0];
        const lenOk = stacked <= 1 && (effective.length <= maxLen * 2 || raw.length <= body.length + 80);
        return JSON.stringify({
          ok: Boolean(hasNeedle && lenOk),
          stage: !hasNeedle ? 'missing_brand' : (stacked > 1 ? 'stacked' : 'filled'),
          filled_len: stacked > 1 ? raw.length : (effective.length || raw.length),
          raw_len: raw.length,
          stacked,
          filled_sample: (effective || raw).slice(0, 56),
          post_disabled: post ? post.disabled : true,
          post_missing: !post,
          platform: 'facebook',
        });
      }`
    );
  }

  async function fillA11yOnce() {
    guard();
    const snap = parseInvokeText(await cdp('snapshot', { profile, limit: 36000 })) || '';
    let ref = null;
    const preferred =
      findSnapshotRef(snap, /textbox .*What.?s on your mind/i) ||
      findSnapshotRef(snap, /What.?s on your mind/i) ||
      findSnapshotRef(snap, /textbox/i);
    ref = preferred?.ref || null;
    if (!ref) {
      for (const line of snap.split('\n')) {
        if (!/textbox|contenteditable|combobox/i.test(line)) continue;
        if (/comment|search|message/i.test(line) && !/mind/i.test(line)) continue;
        const m = line.match(/\[ref=(e\d+)\]/);
        if (m) { ref = m[1]; break; }
      }
    }
    if (!ref) return { ok: false, stage: 'no_textbox_ref' };
    await cdp('act', { profile, request: { kind: 'click', ref }, ref });
    await sleep(400);
    for (const key of ['Control+a', 'Meta+a', 'ControlOrMeta+a']) {
      try { await cdp('act', { profile, request: { kind: 'press', key }, key }); } catch (e) {}
    }
    await sleep(150);
    try { await cdp('act', { profile, request: { kind: 'press', key: 'Backspace' }, key: 'Backspace' }); } catch (e) {}
    await sleep(150);
    let typed = await cdp('act', {
      profile,
      request: { kind: 'type', ref, text: body },
      ref,
      text: body,
    });
    if (looksFailed(typed)) {
      typed = await cdp('act', { profile, request: { kind: 'type', text: body }, text: body });
    }
    if (looksFailed(typed)) return { ok: false, stage: 'a11y_type_failed', raw: parseInvokeText(typed) };
    await sleep(1100);
    const m = await measureEditor();
    return { ...m, method: 'a11y_type', ref };
  }

  try {
  await openCreate();
  await sleep(800);
  let pre = await measureEditor();
  if (pre.stage !== 'no_create_dialog' && (pre.raw_len || 0) > 5) {
    await discardComposer();
    await openCreate();
    await sleep(1000);
  }

  let filled = await fillA11yOnce();
  if (!filled.ok || (filled.stacked || 0) > 1) {
    console.warn('[browser-social] fb fill retry after discard stacked=%s len=%s', filled.stacked, filled.filled_len);
    await discardComposer();
    await openCreate();
    await sleep(1500);
    filled = await fillA11yOnce();
  }

  if (!filled.ok) {
    return { ok: false, stage: filled.stage || 'fill_failed', ...filled };
  }

  let posted = { ok: false };
  for (let i = 0; i < 16; i++) {
    const status = await measureEditor();
    if (status.stage === 'no_create_dialog') {
      posted = { ok: true, stage: 'posted', method: 'dialog_already_gone', platform: 'facebook' };
      break;
    }
    if ((status.stacked || 0) > 1) {
      return { ok: false, stage: 'editor_still_stacked', ...status };
    }
    if (status.post_missing) { await sleep(700); continue; }
    if (status.post_disabled) {
      await evaluateJson(
        ceoUserId,
        `() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) => /create post/i.test(d.innerText || ''));
          const editor = dialog && dialog.querySelector('[contenteditable="true"]');
          if (!editor) return JSON.stringify({ ok: false });
          editor.focus();
          try { document.execCommand('insertText', false, ' '); document.execCommand('delete', false, null); } catch (e) {}
          return JSON.stringify({ ok: true });
        }`
      );
      await sleep(700);
      continue;
    }
    const snap = parseInvokeText(await cdp('snapshot', { profile, limit: 32000 })) || '';
    const postRef = findFacebookPostButtonRef(snap);
    let clickMethod = 'dom';
    if (postRef?.ref) {
      const a11y = await cdp('act', { profile, request: { kind: 'click', ref: postRef.ref }, ref: postRef.ref });
      if (!looksFailed(a11y)) clickMethod = 'a11y_post';
    }
    if (clickMethod === 'dom') {
      await evaluateJson(
        ceoUserId,
        `() => {
          const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
            /create post/i.test(d.innerText || '')
          );
          if (!dialog) return JSON.stringify({ ok: false });
          const posts = Array.from(dialog.querySelectorAll('[role="button"], button'))
            .map((el) => {
              const t = (el.innerText || el.getAttribute('aria-label') || '').trim().split('\\n')[0];
              const b = el.getBoundingClientRect();
              const disabled = el.getAttribute('aria-disabled') === 'true' || !!el.disabled;
              return { el, t, disabled, y: b.y, w: b.width };
            })
            .filter((x) => /^post$/i.test(x.t) && x.w > 24 && !x.disabled);
          posts.sort((a, b) => b.y - a.y);
          const post = posts[0];
          if (!post) return JSON.stringify({ ok: false });
          const el = post.el;
          const opts = { bubbles: true, composed: true, cancelable: true, view: window };
          try {
            el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
          } catch (e) {}
          el.click();
          return JSON.stringify({ ok: true, btn: post.t });
        }`
      );
    }
    posted = {
      ok: true,
      stage: 'posted',
      method: clickMethod === 'a11y_post' ? 'a11y_post_enabled' : 'dom_dialog_post_enabled',
      filled_len: status.filled_len || body.length,
      filled_sample: status.filled_sample,
      btn: 'Post',
      platform: 'facebook',
      wasDisabled: false,
      stacked: status.stacked,
    };
    break;
  }

  let dialogClosed = false;
  for (let w = 0; w < 20; w++) {
    const st = await evaluateJson(
      ceoUserId,
      `() => {
        const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((d) =>
          /create post/i.test(d.innerText || '') && /add to your post|what.?s on your mind/i.test(d.innerText || '')
        );
        const toast = (document.body.innerText || '').slice(0, 5000);
        return JSON.stringify({
          ok: true,
          dialog_open: !!dialog,
          toast_hit: /post was successful|your post|shared successfully|is now live|published/i.test(toast),
        });
      }`
    );
    if (st.ok && !st.dialog_open) {
      dialogClosed = true;
      if (st.toast_hit) posted = { ...posted, toast_hit: true };
      break;
    }
    await sleep(900);
  }

  if (dialogClosed || (posted.ok && posted.stage === 'posted')) {
    await evaluateJson(
      ceoUserId,
      `() => {
        try {
          if (/facebook\\.com/i.test(location.hostname)) location.href = 'https://www.facebook.com/';
        } catch (e) {}
        return JSON.stringify({ ok: true });
      }`
    );
    await sleep(5000);
  }

  if (!posted.ok || posted.stage !== 'posted') {
    return {
      ok: false,
      stage: posted.stage || 'post_click_failed',
      fill: filled,
      post: posted,
      dialog_closed: dialogClosed,
    };
  }
  return {
    ok: true,
    stage: 'posted',
    method: posted.method || 'facebook_a11y',
    filled_len: posted.filled_len || filled.filled_len || body.length,
    filled_sample: posted.filled_sample || filled.filled_sample,
    btn: posted.btn || 'Post',
    platform: 'facebook',
    wasDisabled: false,
    dialog_closed: dialogClosed,
    toast_hit: !!posted.toast_hit,
    stacked: filled.stacked,
  };
  } catch (e) {
    console.warn('[browser-social] facebook fill aborted: %s', e.message);
    return {
      ok: false,
      stage: /timeout/i.test(String(e.message)) ? 'fill_timeout' : 'fill_exception',
      error: e.message,
    };
  }
}

/**
 * Shadow-aware fill + Post (LinkedIn). Facebook uses fillAndPostFacebook.
 */
async function fillAndPostBody(ceoUserId, bodyText, platform) {
  if (platform === 'facebook') {
    return fillAndPostFacebook(ceoUserId, bodyText);
  }

  const body = String(bodyText || '').trim();
  if (!body) return { ok: false, stage: 'empty_body' };

  const fn = `() => {
    const body = ${JSON.stringify(body)};
    const platform = ${JSON.stringify(platform || '')};
    function deepQueryAll(root, selector, out = []) {
      try { root.querySelectorAll(selector).forEach((el) => out.push(el)); } catch (e) {}
      const walk = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of walk) if (el.shadowRoot) deepQueryAll(el.shadowRoot, selector, out);
      return out;
    }
    function deepAll(root, out = []) {
      const walk = root.querySelectorAll ? root.querySelectorAll('*') : [];
      for (const el of walk) {
        out.push(el);
        if (el.shadowRoot) deepAll(el.shadowRoot, out);
      }
      return out;
    }
    function scoreEditor(el) {
      const b = el.getBoundingClientRect();
      const area = Math.max(0, b.width) * Math.max(0, b.height);
      const inDialog = !!(el.closest('[role="dialog"], [aria-modal="true"], .artdeco-modal, .share-creation-state, form[method="POST"]'));
      const ph = ((el.getAttribute('data-placeholder') || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('aria-placeholder') || '')).toLowerCase();
      const looksCompose = /talk about|on your mind|text editor|write something|create a post|what do you want/i.test(ph);
      if (b.width < 30 || b.height < 10) return -1;
      return area + (inDialog ? 50000 : 0) + (looksCompose ? 30000 : 0);
    }

    const dialog =
      document.querySelector('[role="dialog"][aria-modal="true"]') ||
      document.querySelector('[role="dialog"]') ||
      document.querySelector('[aria-modal="true"]') ||
      document.querySelector('.artdeco-modal') ||
      document.querySelector('.share-creation-state');
    const roots = dialog ? [dialog, document] : [document];
    let editors = [];
    for (const root of roots) {
      editors = deepQueryAll(root, '[contenteditable="true"], [role="textbox"], .ql-editor, [data-lexical-editor="true"]');
      if (editors.length) break;
    }
    editors = editors
      .map((el) => ({ el, s: scoreEditor(el) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    const editor = editors[0]?.el || null;
    if (!editor) {
      return JSON.stringify({
        ok: false,
        stage: 'no_editor',
        ce: deepQueryAll(document, '[contenteditable="true"]').length,
        host: location.hostname,
        has_dialog: !!dialog
      });
    }

    editor.scrollIntoView({ block: 'center', inline: 'nearest' });
    editor.focus();
    editor.click();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (e) {}
    try { document.execCommand('selectAll', false, null); } catch (e) {}
    try { document.execCommand('delete', false, null); } catch (e) {}
    editor.innerHTML = '';
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, body);
    } catch (e) {
      inserted = false;
    }
    if (!inserted || !(editor.innerText || '').trim()) {
      editor.innerText = body;
    }
    try {
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: body, inputType: 'insertText' }));
    } catch (e) {
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    const filled = (editor.innerText || editor.textContent || '').trim();
    if (filled.length < Math.min(12, Math.floor(body.length / 4))) {
      return JSON.stringify({
        ok: false,
        stage: 'fill_short',
        filled_len: filled.length,
        sample: filled.slice(0, 80)
      });
    }

    const searchRoot = editor.closest('[role="dialog"], [aria-modal="true"], .artdeco-modal, .share-creation-state') || document;
    const all = deepAll(searchRoot);
    const rank = [];
    for (const el of all) {
      const tag = (el.tagName || '').toLowerCase();
      const text = (el.innerText || '').trim().split('\\n')[0];
      const aria = (el.getAttribute('aria-label') || '').trim();
      const cls = String(el.className || '');
      const b = el.getBoundingClientRect();
      if (b.width < 20 || b.height < 14 || b.height > 120 || b.width > 520) continue;
      const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true');
      const isPost = /^(post|publish|share now|share)$/i.test(text) || /^(post|publish|share now)$/i.test(aria);
      const primary = /share-actions__primary|artdeco-button--primary|primary-action|__submit/i.test(cls);
      if (!isPost && !primary) continue;
      if (tag !== 'button' && el.getAttribute('role') !== 'button') continue;
      if (/share-creation-state__footer/i.test(cls) && !/button/i.test(tag)) continue;
      rank.push({ el, tag, text, aria, cls, disabled, isPost, primary, w: Math.round(b.width), h: Math.round(b.height) });
    }
    rank.sort((a, b) => {
      const score = (x) =>
        (x.tag === 'button' ? 10 : 0) +
        (x.isPost ? 8 : 0) +
        (x.primary ? 6 : 0) +
        (x.disabled ? -20 : 0) +
        (/share-actions__primary/i.test(x.cls) ? 12 : 0);
      return score(b) - score(a);
    });
    let postBtn = rank[0]?.el || null;
    if (!postBtn) {
      postBtn =
        searchRoot.querySelector('button.share-actions__primary-action') ||
        searchRoot.querySelector('[aria-label="Post"]') ||
        searchRoot.querySelector('[aria-label="Publish"]');
    }
    if (!postBtn) {
      return JSON.stringify({
        ok: false,
        stage: 'no_post_btn',
        filled_len: filled.length,
        sample: filled.slice(0, 60),
        candidate_count: rank.length
      });
    }

    for (let i = 0; i < 10; i++) {
      if (!(postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true')) break;
      try {
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: ' ', inputType: 'insertText' }));
      } catch (e) {
        editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      }
    }

    const wasDisabled = !!(postBtn.disabled || postBtn.getAttribute('aria-disabled') === 'true');
    postBtn.focus && postBtn.focus();
    postBtn.click();
    try {
      postBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, view: window }));
    } catch (e) {}

    return JSON.stringify({
      ok: true,
      stage: wasDisabled ? 'posted_while_disabled' : 'posted',
      filled_len: filled.length,
      filled_sample: filled.slice(0, 40),
      btn: (postBtn.innerText || postBtn.getAttribute('aria-label') || '').trim().slice(0, 40),
      cls: String(postBtn.className || '').slice(0, 100),
      platform,
      wasDisabled
    });
  }`;

  return evaluateJson(ceoUserId, fn);
}

async function confirmPosted(ceoUserId, platform, bodySnippet = '') {
  const needle = String(bodySnippet || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  // Prefer unique automation brand tokens when present
  const uniq =
    (needle.match(/CMS-[A-Z0-9._T:-]+/i) || needle.match(/CMS[A-Z0-9_-]{6,}/i) || [])[0] ||
    needle.slice(0, Math.min(32, needle.length));

  // Facebook feed is virtualized — poll + scroll; mid-run hit profile for own posts
  const rounds = platform === 'facebook' ? 3 : 2;
  let last = { ok: false };
  for (let r = 0; r < rounds; r++) {
    if (platform === 'facebook' && r === 3) {
      // Own timeline often surfaces the new post faster than algorithmic home feed
      await evaluateJson(
        ceoUserId,
        `() => {
          try { location.href = 'https://www.facebook.com/me'; } catch (e) {}
          return JSON.stringify({ ok: true });
        }`
      );
      await sleep(5000);
    } else if (platform === 'facebook' && r > 0) {
      await evaluateJson(
        ceoUserId,
        `() => { window.scrollBy(0, 900); return JSON.stringify({ ok: true, y: window.scrollY }); }`
      );
      await sleep(1800);
    } else {
      await sleep(platform === 'facebook' ? 3500 : 2500);
    }

    const fn = `() => {
      const uniq = ${JSON.stringify(uniq)};
      const needle = ${JSON.stringify(needle)};
      const platform = ${JSON.stringify(platform)};
      const composeDialog = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], .artdeco-modal, .share-creation-state')).find((d) => {
        const t = (d.innerText || '').slice(0, 500);
        return /create post|what.?s on your mind|talk about|share-creation|photo\\/video|add to your post/i.test(t);
      }) || null;
      const dialogText = composeDialog ? (composeDialog.innerText || '') : '';
      const primaryOpen = !!document.querySelector('button.share-actions__primary-action');
      let feedText = '';
      try {
        const clone = document.body.cloneNode(true);
        clone.querySelectorAll('[role="dialog"], [aria-modal="true"], .artdeco-modal, .share-creation-state').forEach((n) => n.remove());
        feedText = (clone.innerText || '').slice(0, 60000);
      } catch (e) {
        feedText = (document.body.innerText || '').slice(0, 60000);
      }
      // FB often puts post copy in aria/label attributes rather than visible text
      let attrHay = '';
      try {
        document.querySelectorAll('[aria-label], [data-ad-preview], span, div').forEach((el, i) => {
          if (i > 4000) return;
          const a = el.getAttribute('aria-label') || '';
          if (a && a.length < 500) attrHay += ' ' + a;
        });
      } catch (e) {}
      const full = (document.body.innerText || '') + '\\n' + feedText + '\\n' + attrHay;
      const toast = full.slice(0, 8000);
      const postedToast = /post was successful|your post was|shared successfully|is now live|posted to facebook|your post is now published|post shared|just now/i.test(toast) &&
        !!(uniq && full.includes(uniq));
      const brandOnFeed = !!(uniq && (feedText.includes(uniq) || full.includes(uniq)));
      const brandInDialog = !!(composeDialog && uniq && dialogText.includes(uniq));
      return JSON.stringify({
        host: location.hostname,
        href: location.href,
        dialog_open: !!composeDialog,
        primary_open: primaryOpen,
        toast_hit: postedToast,
        brand_on_feed: brandOnFeed,
        brand_in_dialog: brandInDialog,
        brand_on_page: brandOnFeed,
        dialog_gone: !composeDialog,
        posted_hint: postedToast || (brandOnFeed && !composeDialog),
        editor_still_open: !!composeDialog,
        uniq_len: uniq.length,
        feed_has_facebook_live: /Facebook live fix/i.test(feedText),
        round: ${r}
      });
    }`;
    last = await evaluateJson(ceoUserId, fn);
    if (platform === 'facebook') {
      if (last.ok && !last.dialog_open && (last.toast_hit || last.brand_on_feed)) {
        return { ok: true, success: true, conf: last, platform };
      }
    } else if (
      last.ok &&
      (last.toast_hit || last.brand_on_feed || (!last.dialog_open && !last.primary_open) || (last.posted_hint && !last.editor_still_open))
    ) {
      return { ok: true, success: true, conf: last, platform };
    }
  }

  const c = last || {};
  let success = false;
  if (platform === 'facebook') {
    success = Boolean(c.ok && !c.dialog_open && (c.toast_hit || c.brand_on_feed));
  } else {
    success = Boolean(
      c.ok &&
        (c.toast_hit ||
          c.brand_on_feed ||
          (!c.dialog_open && !c.primary_open) ||
          (c.posted_hint && !c.editor_still_open))
    );
  }
  return {
    ok: !!c.ok,
    success,
    conf: c,
    platform,
  };
}

/**
 * Full autonomous publish: focus platform tab → open composer → fill → post → recycle tab.
 * @returns {{ ok: boolean, summary: string, steps: any[], note: string }}
 */
export async function runAutonomousSocialPublish(ceoUserId, { goalText, startUrl, body }) {
  const steps = [];
  const platform = inferSocialPlatform(goalText, startUrl);
  const publishBody = String(body || extractPublishBody(goalText) || '').trim();
  if (!platform) {
    return { ok: false, note: 'no_platform', summary: 'Could not infer LinkedIn/Facebook/Instagram from goal.', steps };
  }
  if (publishBody.length < 20) {
    return { ok: false, note: 'no_body', summary: 'Publish body missing from goal (need EXACT text / Body).', steps };
  }

  const feedUrl = startUrl || PLATFORM_URLS[platform];
  let tab = { ok: false, targetId: null };
  let filled = { ok: false };
  let confirm = null;
  let closeout = { ok: true, remaining: 0, closed: 0, steps: [] };

  let earlyExit = null;
  try {
    tab = await ensurePlatformTab(ceoUserId, platform, { preferFresh: false });
    steps.push({ t: nowIso(), action: 'ensure_platform_tab', platform, tab });

    // When tabs API is empty (relay flake), still force-open feed URL
    const openFeed = await openChromeUrl(ceoUserId, feedUrl);
    steps.push({ t: nowIso(), action: 'open_feed', url: feedUrl, openFeed });
    await sleep(4500);
    if (!tab.ok && openFeed.ok) {
      tab = { ok: true, targetId: openFeed.targetId || null, url: feedUrl, opened: true };
    }
    if (!tab.ok && !openFeed.ok) {
      earlyExit = {
        ok: false,
        note: 'tab_unavailable',
        summary:
          'No Client Chrome tab for ' +
          platform +
          '. CEO must reconnect Client Chrome (Mark ready + attach tab). Agents will not ask mid-workflow for tab focus after that.',
      };
    } else {
    if (tab.targetId) await focusChromeTab(ceoUserId, tab.targetId);

    const maxAttempts = platform === 'facebook' ? 2 : 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (tab.targetId) await focusChromeTab(ceoUserId, tab.targetId);
      if (platform === 'facebook' && filled.ok && confirm && !confirm.conf?.dialog_open) {
        // wait only
      } else {
        const opened = await openComposer(ceoUserId, platform);
        steps.push({ t: nowIso(), action: 'open_composer', attempt, opened });
        await sleep(2500);
        filled = await fillAndPostBody(ceoUserId, publishBody, platform);
        steps.push({ t: nowIso(), action: 'fill_and_post', attempt, filled });
        if (!filled.ok) {
          const fatal =
            platform === 'facebook' &&
            /fill_timeout|fill_exception|evaluate_timeout|cdp_timeout|editor_still_stacked/i.test(
              String(filled.stage || filled.error || '')
            );
          if (fatal) {
            steps.push({ t: nowIso(), action: 'fb_fill_fatal', filled });
            break;
          }
          await sleep(1500);
          continue;
        }
        if (filled.wasDisabled || filled.stage === 'posted_while_disabled') {
          await sleep(1500);
          const retry = await fillAndPostBody(ceoUserId, publishBody, platform);
          steps.push({ t: nowIso(), action: 'fill_and_post_retry_enable', attempt, retry });
          if (retry.ok) filled = retry;
        }
      }
      confirm = await confirmPosted(ceoUserId, platform, publishBody);
      steps.push({ t: nowIso(), action: 'post_confirm', attempt, confirm });
      if (confirm.success) break;
      if (confirm.conf?.primary_open || confirm.conf?.dialog_open) {
        const reClick = await evaluateJson(
          ceoUserId,
          `() => {
          const btn = document.querySelector('button.share-actions__primary-action') ||
            Array.from(document.querySelectorAll('button,[role="button"]')).find((b) => /^(post|publish)$/i.test((b.innerText||'').trim().split('\\n')[0]));
          if (!btn) return JSON.stringify({ ok: false, stage: 'no_btn' });
          if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return JSON.stringify({ ok: false, stage: 'still_disabled' });
          btn.click();
          return JSON.stringify({ ok: true, stage: 'reclicked', btn: (btn.innerText||'').slice(0,30) });
        }`
        );
        steps.push({ t: nowIso(), action: 'post_reclick', attempt, reClick });
        confirm = await confirmPosted(ceoUserId, platform, publishBody);
        steps.push({ t: nowIso(), action: 'post_confirm_after_reclick', attempt, confirm });
        if (confirm.success) break;
      }
      if (platform === 'facebook' && filled.ok && confirm && !confirm.conf?.dialog_open) {
        steps.push({ t: nowIso(), action: 'fb_stop_retry', note: 'dialog closed; waiting final confirm only' });
        await sleep(5000);
        confirm = await confirmPosted(ceoUserId, platform, publishBody);
        steps.push({ t: nowIso(), action: 'post_confirm_final', confirm });
        break;
      }
      await sleep(1200);
    }

    if (!confirm?.success && platform === 'linkedin' && filled.ok && /share-actions__primary/i.test(String(filled.cls || ''))) {
      await sleep(3000);
      confirm = await confirmPosted(ceoUserId, platform, publishBody);
      steps.push({ t: nowIso(), action: 'post_confirm_soft', confirm });
    }
    } // end else tab available
  } finally {
    // Always close platform tabs after the workflow ends (success, fail, or exception).
    try {
      closeout = await closePlatformTabsAfterTask(ceoUserId, platform, tab?.targetId || null);
      steps.push({ t: nowIso(), action: 'close_tabs_after_task', closeout });
    } catch (e) {
      steps.push({ t: nowIso(), action: 'close_tabs_after_task', error: e.message });
      console.warn('[browser-social] close after task failed: %s', e.message);
    }
  }

  if (earlyExit) {
    return {
      ...earlyExit,
      platform,
      steps,
      tab_close: closeout,
    };
  }

  const success =
    platform === 'facebook'
      ? Boolean(filled.ok && confirm?.success === true)
      : Boolean(filled.ok && (confirm?.success || (filled.ok && !confirm?.conf?.dialog_open && filled.filled_len > 20)));
  const failStage =
    filled.stage ||
    (confirm?.conf?.dialog_open ? 'dialog_still_open' : null) ||
    (confirm && !confirm.success ? 'confirm_failed' : null) ||
    'unknown';
  const failHint =
    filled.error ||
    filled.detail ||
    (confirm?.conf?.brand_in_dialog ? 'brand still in composer dialog' : '') ||
    (confirm?.conf?.dialog_open ? 'composer dialog still open' : '');
  const summary = success
    ? `Autonomous ${platform} publish completed. Platform tabs closed after task (remaining=${closeout.remaining}).`
    : `Autonomous ${platform} publish failed at stage=${failStage}: ${String(failHint).slice(0, 160)} (tabs closed remaining=${closeout.remaining})`;

  console.info(
    '[browser-social] done ceo=%s platform=%s success=%s stage=%s confirm=%s tabs_remaining=%s',
    ceoUserId,
    platform,
    success,
    filled.stage || (success ? 'ok' : 'fail'),
    confirm?.success,
    closeout.remaining
  );

  return {
    ok: success,
    note: success ? 'social_autonomous_ok' : 'social_autonomous_fail',
    summary,
    platform,
    steps,
    fill: filled,
    confirm,
    tab_close: closeout,
  };
}
