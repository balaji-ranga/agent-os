/**
 * Per-CEO client vs managed browser session preferences.
 * Client Chrome uses a shared OpenClaw relay — exclusive lease so only one CEO
 * may drive profile=chrome at a time (prevents cross-user tab control).
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { getBrowserAuthStatus, isGatewayReachable } from './job-browser-auth.js';
import { getChromeExtensionDownloadInfo } from './chrome-extension-pack.js';
import { getUrlPolicy } from './browser-url-policy.js';

const EXTENSION_STORE =
  'https://chromewebstore.google.com/detail/openclaw-browser-relay/dkgjpblchidfgejbnmelnldfdohihbof';
const EXTENSION_DOCS = 'https://docs.openclaw.ai/tools/chrome-extension';

function openclawDir() {
  return process.env.OPENCLAW_DIR || join(process.env.HOME || process.env.USERPROFILE || '', '.openclaw');
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * OpenClaw Browser Relay pairing string for remote Chrome.
 * Token is per OpenClaw gateway install (shared by all CEOs on this host) — not per Flolah user.
 */
export function getExtensionPairingInfo() {
  const publicUrl = String(process.env.AGENT_OS_PUBLIC_URL || '').replace(/\/$/, '');
  let host = '';
  try {
    if (publicUrl) host = new URL(publicUrl).host;
  } catch {
    host = '';
  }
  const secretPath = join(openclawDir(), 'credentials', 'browser-extension-relay.secret');
  let token = '';
  let tokenSource = 'missing';
  try {
    if (existsSync(secretPath)) {
      token = readFileSync(secretPath, 'utf8').trim();
      tokenSource = 'openclaw_credentials';
    }
  } catch (e) {
    console.warn('[browser-session] read relay secret failed: %s', e.message);
  }
  const pairingString =
    token && host ? `wss://${host}/browser/extension#${token}` : token ? `wss://<host>/browser/extension#${token}` : '';
  return {
    pairing_string: pairingString || null,
    gateway_host: host || null,
    token_present: Boolean(token),
    token_source: tokenSource,
    /** False: one relay secret per OpenClaw gateway, shared across entitled CEOs on this deploy. */
    unique_per_user: false,
    uniqueness_note:
      'The pairing WSS URL uses the OpenClaw gateway relay token for this server — it is shared by all users on this Flolah instance, not unique per CEO. Only one CEO may Mark client session ready at a time (exclusive chrome lease); others use managed Playwright until the lease is released.',
  };
}

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw || '') ?? fallback;
  } catch {
    return fallback;
  }
}

function leaseLabelForCeo(ceoUserId) {
  if (!ceoUserId) return null;
  try {
    const row = getDb()
      .prepare('SELECT name, email FROM platform_users WHERE id = ?')
      .get(ceoUserId);
    if (!row) return ceoUserId;
    const name = String(row.name || '').trim();
    const email = String(row.email || '').trim();
    if (name && email) return `${name} (${email})`;
    return name || email || ceoUserId;
  } catch {
    return ceoUserId;
  }
}

/**
 * If multiple CEOs are client+ready (legacy), keep the earliest updated_at and demote the rest.
 * @returns {string|null} holder ceo_user_id
 */
export function reconcileChromeLeases() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT ceo_user_id, updated_at FROM ceo_browser_session
       WHERE mode = 'client' AND session_ready = 1
       ORDER BY updated_at ASC, ceo_user_id ASC`
    )
    .all();
  if (rows.length <= 1) return rows[0]?.ceo_user_id || null;
  const keeper = rows[0].ceo_user_id;
  const demote = db.prepare(
    `UPDATE ceo_browser_session
     SET session_ready = 0, updated_at = ?
     WHERE ceo_user_id = ? AND mode = 'client' AND session_ready = 1`
  );
  const ts = nowIso();
  for (const row of rows.slice(1)) {
    demote.run(ts, row.ceo_user_id);
    console.warn(
      '[browser-session] chrome lease reconcile demoted ceo=%s keeper=%s',
      row.ceo_user_id,
      keeper
    );
  }
  return keeper;
}

/** CEO currently holding exclusive Client Chrome (profile=chrome). */
export function getChromeLeaseHolder() {
  return reconcileChromeLeases();
}

export function getChromeLeaseInfo(ceoUserId) {
  const holder = getChromeLeaseHolder();
  const id = String(ceoUserId || '').trim();
  return {
    holder_ceo_user_id: holder || null,
    holder_label: holder ? leaseLabelForCeo(holder) : null,
    is_holder: Boolean(holder && id && holder === id),
    unique_per_user: false,
    note: holder
      ? holder === id
        ? 'You hold the exclusive Client Chrome lease. Agents for your workspace use your attached Chrome.'
        : `Another user holds Client Chrome (${leaseLabelForCeo(holder)}). Your agents use managed Playwright until they release the lease (Opt out or clear ready).`
      : 'No one holds Client Chrome. Mark ready after attaching your Chrome tab to claim the lease.',
  };
}

/**
 * Claim exclusive Client Chrome. Fails with 409 if another CEO already holds it.
 */
export function claimChromeLease(ceoUserId, { domains = null } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) {
    const err = new Error('ceo_user_id required');
    err.status = 400;
    throw err;
  }
  const holder = getChromeLeaseHolder();
  if (holder && holder !== id) {
    const label = leaseLabelForCeo(holder);
    const err = new Error(
      `Client Chrome is already in use by ${label}. Only one user can drive the shared browser relay at a time. Ask them to Opt out (or clear ready), or use managed Playwright.`
    );
    err.status = 409;
    err.code = 'chrome_lease_held';
    err.holder_ceo_user_id = holder;
    err.holder_label = label;
    console.info('[browser-session] chrome lease claim denied ceo=%s holder=%s', id, holder);
    throw err;
  }
  const session = upsertCeoBrowserSession(id, {
    mode: 'client',
    session_ready: true,
    last_attached_at: nowIso(),
    ...(domains ? { logged_in_domains: domains } : {}),
  });
  console.info('[browser-session] chrome lease claimed ceo=%s', id);
  return session;
}

export function releaseChromeLease(ceoUserId, { keepClientMode = false } = {}) {
  const id = String(ceoUserId || '').trim();
  if (!id) return getCeoBrowserSession(id);
  const holder = getChromeLeaseHolder();
  if (holder && holder !== id) {
    // Not the holder — nothing to release for chrome pool; still clear local ready if set.
    return upsertCeoBrowserSession(id, {
      mode: keepClientMode ? 'client' : 'managed',
      session_ready: false,
      last_attached_at: null,
    });
  }
  const session = upsertCeoBrowserSession(id, {
    mode: keepClientMode ? 'client' : 'managed',
    session_ready: false,
    last_attached_at: null,
  });
  if (holder === id) {
    console.info('[browser-session] chrome lease released ceo=%s', id);
  }
  return session;
}

export function getCeoBrowserSession(ceoUserId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ceo_browser_session WHERE ceo_user_id = ?').get(ceoUserId);
  if (row) {
    return {
      ...row,
      session_ready: Boolean(row.session_ready),
      logged_in_domains: parseJson(row.logged_in_domains_json, {}),
      url_policy: getUrlPolicy(ceoUserId),
    };
  }
  return {
    ceo_user_id: ceoUserId,
    mode: 'managed',
    profile: 'openclaw',
    session_ready: false,
    relay_notes: '',
    pair_hint: '',
    logged_in_domains: {},
    url_policy: getUrlPolicy(ceoUserId),
    last_attached_at: null,
    updated_at: null,
  };
}

export function upsertCeoBrowserSession(ceoUserId, patch = {}) {
  const db = getDb();
  const cur = getCeoBrowserSession(ceoUserId);
  const mode = patch.mode === 'client' ? 'client' : patch.mode === 'managed' ? 'managed' : cur.mode;
  const profile = mode === 'client' ? 'chrome' : 'openclaw';
  const domains =
    patch.logged_in_domains != null
      ? patch.logged_in_domains
      : cur.logged_in_domains || {};
  const sessionReady =
    patch.session_ready != null ? (patch.session_ready ? 1 : 0) : cur.session_ready ? 1 : 0;
  const relayNotes = patch.relay_notes != null ? String(patch.relay_notes) : cur.relay_notes || '';
  const pairHint = patch.pair_hint != null ? String(patch.pair_hint) : cur.pair_hint || '';
  const lastAttached =
    patch.last_attached_at != null ? patch.last_attached_at : cur.last_attached_at || null;

  db.prepare(
    `INSERT INTO ceo_browser_session (
      ceo_user_id, mode, profile, session_ready, relay_notes, pair_hint,
      logged_in_domains_json, last_attached_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ceo_user_id) DO UPDATE SET
      mode = excluded.mode,
      profile = excluded.profile,
      session_ready = excluded.session_ready,
      relay_notes = excluded.relay_notes,
      pair_hint = excluded.pair_hint,
      logged_in_domains_json = excluded.logged_in_domains_json,
      last_attached_at = excluded.last_attached_at,
      updated_at = excluded.updated_at`
  ).run(
    ceoUserId,
    mode,
    profile,
    sessionReady,
    relayNotes,
    pairHint,
    JSON.stringify(domains),
    lastAttached,
    nowIso()
  );
  console.info(
    '[browser-session] upsert ceo=%s mode=%s profile=%s ready=%s',
    ceoUserId,
    mode,
    profile,
    sessionReady
  );
  return getCeoBrowserSession(ceoUserId);
}

/**
 * Effective OpenClaw browser profile for this CEO.
 * profile=chrome only when this CEO holds the exclusive Client Chrome lease.
 */
export function resolveBrowserProfile(ceoUserId) {
  const sess = getCeoBrowserSession(ceoUserId);
  const holder = getChromeLeaseHolder();
  const id = String(ceoUserId || '').trim();

  if (sess.mode === 'client' && sess.session_ready) {
    if (holder && holder === id) {
      return { profile: 'chrome', mode: 'client', fallback: false, session: sess };
    }
    // Stale ready flag or lost lease — never drive another user's Chrome.
    return {
      profile: 'openclaw',
      mode: 'client',
      fallback: true,
      reason: holder && holder !== id ? 'chrome_lease_held_by_other' : 'chrome_lease_required',
      session: sess,
      chrome_lease_holder: holder || null,
    };
  }
  if (sess.mode === 'client' && !sess.session_ready) {
    const reason =
      holder && holder !== id ? 'chrome_lease_held_by_other' : 'client_mode_not_ready';
    return {
      profile: 'openclaw',
      mode: 'client',
      fallback: true,
      reason,
      session: sess,
      chrome_lease_holder: holder || null,
    };
  }
  return { profile: 'openclaw', mode: 'managed', fallback: false, session: sess };
}

export async function getBrowserSessionStatus(ceoUserId) {
  reconcileChromeLeases();
  const session = getCeoBrowserSession(ceoUserId);
  const resolved = resolveBrowserProfile(ceoUserId);
  const managed = getBrowserAuthStatus();
  const gatewayOk = await isGatewayReachable(5000);
  const pairing = getExtensionPairingInfo();
  const chromeLease = getChromeLeaseInfo(ceoUserId);
  return {
    session,
    url_policy: getUrlPolicy(ceoUserId),
    resolved_profile: resolved.profile,
    resolved_mode: resolved.mode,
    using_fallback: Boolean(resolved.fallback),
    fallback_reason: resolved.reason || null,
    chrome_lease: chromeLease,
    managed_browser: {
      session_ready: managed.session_ready,
      persistent_profile_exists: managed.persistent_profile_exists,
      linkedin_logged_in: managed.linkedin_logged_in,
      jobstreet_logged_in: managed.jobstreet_logged_in,
      last_login_in: managed.last_login_at,
    },
    gateway_reachable: gatewayOk,
    client_setup: {
      extension_store_url: EXTENSION_STORE,
      docs: EXTENSION_DOCS,
      /** Prefer Load unpacked — Chrome Web Store build only targets local 127.0.0.1:18792. */
      prefer_load_unpacked: true,
      extension_download: getChromeExtensionDownloadInfo(),
      steps: [
        'Download the OpenClaw chrome-extension zip from this page, unzip it, then Load unpacked (do not use the Chrome Web Store build for remote/VPS — it only talks to localhost).',
        'Open chrome://extensions → turn on Developer mode → Load unpacked → select the unzipped chrome-extension folder.',
        'Open the extension popup. Paste the pairing WSS string shown on this page (Copy button).',
        'Open the site tab you want agents to control → click the extension icon → share/attach that tab (look for the OpenClaw tab group).',
        'Back here: Use my Chrome (opt in) → Mark client session ready (only one user on this server can hold Client Chrome at a time).',
      ],
      pairing_string: pairing.pairing_string || session.pair_hint || null,
      unique_per_user: pairing.unique_per_user,
      uniqueness_note: pairing.uniqueness_note,
      token_present: pairing.token_present,
      pair_hint: pairing.pairing_string || session.pair_hint || null,
    },
  };
}

export function optInClientBrowser(ceoUserId, { pair_hint, relay_notes } = {}) {
  return upsertCeoBrowserSession(ceoUserId, {
    mode: 'client',
    session_ready: false,
    ...(pair_hint != null ? { pair_hint } : {}),
    ...(relay_notes != null ? { relay_notes } : {}),
  });
}

export function optOutClientBrowser(ceoUserId) {
  return releaseChromeLease(ceoUserId, { keepClientMode: false });
}

export function markClientSessionReady(ceoUserId, ready = true, domains = null) {
  if (ready) {
    return claimChromeLease(ceoUserId, { domains });
  }
  return releaseChromeLease(ceoUserId, { keepClientMode: true });
}
