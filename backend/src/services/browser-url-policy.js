/**
 * Per-CEO browser URL allow/deny lists.
 * Patterns: *, host, *.host, host/*, full http(s) URL, URL/* path prefix.
 * Policy: denylist wins; nonempty allowlist must match; empty both = unrestricted.
 */
import { getDb } from '../db/schema.js';

const URL_POLICY_COLS = [
  { name: 'url_allowlist_json', ddl: "url_allowlist_json TEXT DEFAULT '[]'" },
  { name: 'url_denylist_json', ddl: "url_denylist_json TEXT DEFAULT '[]'" },
];

let _colsEnsured = false;

/**
 * @param {unknown} input
 * @returns {string[]}
 */
export function normalizePatternList(input) {
  if (input == null) return [];
  let list = input;
  if (typeof input === 'string') {
    const t = input.trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try {
        list = JSON.parse(t);
      } catch {
        list = t.split(/[\n,]+/);
      }
    } else {
      list = t.split(/[\n,]+/);
    }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const p = String(raw ?? '').trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function normalizeHost(host) {
  return String(host || '')
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '');
}

/** www.example.com <-> example.com treated as aliases for exact-host patterns. */
function hostsWwwAliasMatch(a, b) {
  const ha = normalizeHost(a);
  const hb = normalizeHost(b);
  if (!ha || !hb) return false;
  if (ha === hb) return true;
  if (ha === `www.${hb}` || hb === `www.${ha}`) return true;
  return false;
}

function hostMatchesStarDomain(starPatternHost, urlHost) {
  // *.example.com -> apex example.com + any subdomain
  const baseHost = starPatternHost.slice(2).toLowerCase().replace(/\.$/, '');
  const h = normalizeHost(urlHost);
  if (!baseHost || !h) return false;
  if (h === baseHost) return true;
  return h.endsWith('.' + baseHost);
}

function stripTrailingSlash(s) {
  if (s.length > 1 && s.endsWith('/')) return s.slice(0, -1);
  return s;
}

/**
 * @param {string} pattern
 * @param {string} urlString
 * @returns {boolean}
 */
export function urlMatchesPattern(pattern, urlString) {
  const pat = String(pattern ?? '').trim();
  const rawUrl = String(urlString ?? '').trim();
  if (!pat || !rawUrl) return false;

  if (pat === '*') return true;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  const isFullUrlPattern = /^https?:\/\//i.test(pat);

  if (isFullUrlPattern) {
    const prefixWild = pat.endsWith('/*');
    if (prefixWild) {
      const prefix = pat.slice(0, -1); // keep trailing /
      const href = url.href;
      if (href.startsWith(prefix)) return true;
      const baseNoStar = pat.slice(0, -2);
      if (stripTrailingSlash(href) === stripTrailingSlash(baseNoStar)) return true;
      return false;
    }
    try {
      const pUrl = new URL(pat);
      return (
        normalizeHost(pUrl.host) === normalizeHost(url.host) &&
        stripTrailingSlash(pUrl.pathname) === stripTrailingSlash(url.pathname) &&
        (pUrl.search || '') === (url.search || '')
      );
    } catch {
      return stripTrailingSlash(url.href) === stripTrailingSlash(pat);
    }
  }

  // Host / host-path patterns (no scheme)
  let hostPart = pat;
  if (pat.endsWith('/*')) {
    hostPart = pat.slice(0, -2);
  } else if (pat.endsWith('/')) {
    hostPart = pat.slice(0, -1);
  }

  if (hostPart.includes('/')) {
    return false;
  }

  if (hostPart.startsWith('*.')) {
    return hostMatchesStarDomain(hostPart, url.hostname);
  }

  return hostsWwwAliasMatch(hostPart, url.hostname);
}

/**
 * @param {{ allowlist?: unknown, denylist?: unknown }} policy
 * @param {string} url
 * @returns {{ ok: boolean, reason: string, matched?: string }}
 */
export function evaluateUrlPolicy(policy, url) {
  const allowlist = normalizePatternList(policy?.allowlist);
  const denylist = normalizePatternList(policy?.denylist);
  const target = String(url ?? '').trim();

  if (!target) {
    return { ok: false, reason: 'empty_url' };
  }

  try {
    // eslint-disable-next-line no-new
    new URL(target);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  for (const p of denylist) {
    if (urlMatchesPattern(p, target)) {
      return { ok: false, reason: 'denylist', matched: p };
    }
  }

  if (allowlist.length === 0 && denylist.length === 0) {
    return { ok: true, reason: 'unrestricted' };
  }

  if (allowlist.length === 0) {
    return { ok: true, reason: 'not_denied' };
  }

  for (const p of allowlist) {
    if (urlMatchesPattern(p, target)) {
      return { ok: true, reason: 'allowlist', matched: p };
    }
  }

  return { ok: false, reason: 'not_in_allowlist' };
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function ensureUrlPolicyColumns(db) {
  if (!db) throw new Error('ensureUrlPolicyColumns: db required');
  const cols = db.prepare('PRAGMA table_info(ceo_browser_session)').all();
  const names = new Set(cols.map((c) => c.name));
  for (const col of URL_POLICY_COLS) {
    if (names.has(col.name)) continue;
    try {
      db.exec('ALTER TABLE ceo_browser_session ADD COLUMN ' + col.ddl);
      console.info('[browser-url-policy] added column ceo_browser_session.%s', col.name);
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) {
        console.warn('[browser-url-policy] ALTER %s failed: %s', col.name, e?.message || e);
        throw e;
      }
    }
  }
  _colsEnsured = true;
}

function ensureCols() {
  const db = getDb();
  if (!_colsEnsured) ensureUrlPolicyColumns(db);
  return db;
}

function parseListCol(raw) {
  return normalizePatternList(raw);
}

/**
 * @param {string} ceoUserId
 * @returns {{ allowlist: string[], denylist: string[] }}
 */
export function getUrlPolicy(ceoUserId) {
  const id = String(ceoUserId || '').trim();
  if (!id) return { allowlist: [], denylist: [] };
  const db = ensureCols();
  const row = db
    .prepare(
      'SELECT url_allowlist_json, url_denylist_json FROM ceo_browser_session WHERE ceo_user_id = ?'
    )
    .get(id);
  if (!row) return { allowlist: [], denylist: [] };
  return {
    allowlist: parseListCol(row.url_allowlist_json),
    denylist: parseListCol(row.url_denylist_json),
  };
}

/**
 * @param {string} ceoUserId
 * @param {{ allowlist?: unknown, denylist?: unknown }} lists
 * @returns {{ allowlist: string[], denylist: string[] }}
 */
export function setUrlPolicy(ceoUserId, { allowlist, denylist } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) {
    const err = new Error('ceoUserId required');
    err.status = 400;
    throw err;
  }
  const db = ensureCols();
  const allow = normalizePatternList(allowlist);
  const deny = normalizePatternList(denylist);
  const allowJson = JSON.stringify(allow);
  const denyJson = JSON.stringify(deny);
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT ceo_user_id FROM ceo_browser_session WHERE ceo_user_id = ?').get(id);
  if (!existing) {
    db.prepare(
      `INSERT INTO ceo_browser_session (
        ceo_user_id, mode, profile, session_ready, relay_notes, pair_hint,
        logged_in_domains_json, url_allowlist_json, url_denylist_json, updated_at
      ) VALUES (?, 'managed', 'openclaw', 0, '', '', '{}', ?, ?, ?)`
    ).run(id, allowJson, denyJson, now);
    console.info('[browser-url-policy] inserted session row ceo=%s allow=%d deny=%d', id, allow.length, deny.length);
  } else {
    db.prepare(
      `UPDATE ceo_browser_session
       SET url_allowlist_json = ?, url_denylist_json = ?, updated_at = ?
       WHERE ceo_user_id = ?`
    ).run(allowJson, denyJson, now, id);
    console.info('[browser-url-policy] updated ceo=%s allow=%d deny=%d', id, allow.length, deny.length);
  }

  return { allowlist: allow, denylist: deny };
}

/**
 * @param {string} ceoUserId
 * @param {string} url
 */
export function assertUrlAllowed(ceoUserId, url) {
  const policy = getUrlPolicy(ceoUserId);
  const result = evaluateUrlPolicy(policy, url);
  if (result.ok) return result;
  const err = new Error(
    result.reason === 'denylist'
      ? `URL blocked by denylist (${result.matched})`
      : result.reason === 'not_in_allowlist'
        ? 'URL not in allowlist'
        : `URL not allowed (${result.reason})`
  );
  err.status = 403;
  err.code = 'url_policy_denied';
  err.detail = result;
  throw err;
}
