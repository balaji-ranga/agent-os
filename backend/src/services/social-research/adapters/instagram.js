/**
 * Instagram adapter: self-hosted Instaloader sidecar (optional session cookie),
 * then hydrate /p/{shortcode}/ URLs (media redirect or Graph oEmbed).
 *
 * The sidecar is local Docker. It is not a SaaS "Instaconnect". Anonymous calls
 * still hit instagram.com, which rate-limits datacenter IPs with HTTP 429
 * (agents sometimes mislabel this as 409). Skip anonymous Instaloader by default.
 */
import { getInstagramSessionConfig, getMetaAppAccessToken } from '../../../config/tools.js';
import { searchSite, webSearch } from './web-search.js';
import { hydrateInstagramFromSearch } from './post-hydrate.js';

const INSTALOADER_COOLDOWN_MS = 15 * 60 * 1000;
/** @type {Map<string, number>} */
const instaloaderCooldownUntil = new Map();

function instaloaderUrl() {
  return String(process.env.INSTALOADER_URL || '').trim().replace(/\/+$/, '') || 'http://instaloader-sidecar:8083';
}

function allowAnonymousInstaloader() {
  const v = String(process.env.INSTALOADER_ALLOW_ANONYMOUS || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9._]/g, '');
}

function isInstagramRateLimit(err) {
  return /\b(429|403)\b|Too Many Requests|rate.?limit|please wait/i.test(String(err || ''));
}

function parseInstagramHttp(err) {
  const m = String(err || '').match(/\b(429|403|401|409|400)\b/);
  return m ? Number(m[1]) : null;
}

function sidecarMeta(extra = {}) {
  return {
    self_hosted: true,
    sidecar: 'instaloader-sidecar',
    upstream: 'instagram.com',
    ...extra,
  };
}

function sessionNextStep() {
  return 'Instaloader sidecar is self-hosted on this VPS; Instagram.com still rate-limits anonymous datacenter IPs (HTTP 429, not 409 / not a SaaS Instaconnect). Add vault INSTAGRAM_SESSIONID for captions and timestamps.';
}

export async function researchInstagram(ownerUserId, { handle, brand, days = 30, limit = 40 } = {}) {
  const username = normalizeHandle(handle || brand);
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const session = getInstagramSessionConfig(ownerUserId);
  const cooldownKey = session.configured ? `sess:${ownerUserId || 'anon'}` : 'anonymous';

  let instaloaderError = null;
  let instaloaderMeta = sidecarMeta({ skipped: false, used_session: session.configured });

  const coolUntil = instaloaderCooldownUntil.get(cooldownKey) || 0;
  const cooling = Date.now() < coolUntil;
  const skipAnonymous = !session.configured && !allowAnonymousInstaloader();

  if (username && !skipAnonymous && !cooling) {
    const loaded = await tryInstaloader({
      username,
      days: windowDays,
      limit: cap,
      sessionid: session.sessionid,
    });
    if (loaded.ok && loaded.posts?.length) {
      return {
        ...loaded,
        has_session: session.configured,
        session_source: session.source,
        instaloader: sidecarMeta({
          skipped: false,
          used_session: session.configured,
          instagram_http: null,
        }),
      };
    }
    instaloaderError = loaded.error || loaded.instagram_error || 'empty';
    const igHttp = loaded.instagram_http || parseInstagramHttp(instaloaderError);
    instaloaderMeta = sidecarMeta({
      skipped: false,
      used_session: session.configured,
      instagram_http: igHttp,
      rate_limited: loaded.rate_limited || isInstagramRateLimit(instaloaderError),
    });
    if (instaloaderMeta.rate_limited) {
      instaloaderCooldownUntil.set(cooldownKey, Date.now() + INSTALOADER_COOLDOWN_MS);
      console.info(
        '[social-research] instaloader cooldown 15m key=%s instagram_http=%s (upstream instagram.com, sidecar self-hosted)',
        cooldownKey,
        igHttp || 'unknown'
      );
    } else {
      console.info(
        '[social-research] instaloader miss username=%s has_session=%s fallback=hydrate err=%s',
        username,
        session.configured,
        instaloaderError
      );
    }
  } else if (username) {
    instaloaderMeta = sidecarMeta({
      skipped: true,
      reason: cooling ? 'instagram_rate_limit_cooldown' : 'no_session',
      used_session: session.configured,
      instagram_http: cooling ? 429 : null,
    });
    instaloaderError = skipAnonymous
      ? 'skipped_anonymous: sidecar is self-hosted; instagram.com returns 429 to this VPS IP without INSTAGRAM_SESSIONID'
      : 'skipped_cooldown: instagram.com rate-limited this sidecar recently (HTTP 429)';
    console.info(
      '[social-research] instaloader skip username=%s reason=%s self_hosted=true upstream=instagram.com',
      username,
      instaloaderMeta.reason
    );
  }

  const q = username ? `${username} Instagram` : `${String(brand || '').trim()} Instagram`;
  const searchPosts = username
    ? await searchSite(ownerUserId, {
        query: username,
        site: 'instagram.com/p',
        count: 10,
        days: windowDays,
      })
    : { results: [] };
  const search = await searchSite(ownerUserId, {
    query: q,
    site: 'instagram.com',
    count: 10,
    days: windowDays,
  });
  const extra = await webSearch(ownerUserId, { query: q, count: 5 });
  const results = [
    ...(searchPosts.results || []),
    ...(search.results || []),
    ...(extra.results || []),
  ].filter((r, i, arr) => r.url && arr.findIndex((x) => x.url === r.url) === i);

  const appToken = getMetaAppAccessToken(ownerUserId);
  const posts = await hydrateInstagramFromSearch(results, {
    appToken,
    limit: Math.min(cap, 10),
  });

  return {
    ok: posts.length > 0 || results.length > 0,
    adapter: posts.length ? 'instagram_media' : 'web_search_fallback',
    username: username || null,
    days: windowDays,
    posts,
    count: posts.length,
    indexed_results: results,
    fallback: posts.length === 0,
    has_session: session.configured,
    session_source: session.source,
    instaloader: instaloaderMeta,
    instaloader_error: instaloaderError,
    next_step: posts.length
      ? posts.some((p) => p.caption_source === 'search_hint')
        ? 'Images are real CDN thumbnails. Captions are search hints unless INSTAGRAM_SESSIONID is set. Instaloader sidecar is self-hosted; 429s come from instagram.com (not HTTP 409, not a SaaS Instaconnect).'
        : null
      : sessionNextStep(),
  };
}

async function tryInstaloader({ username, days, limit, sessionid }) {
  const base = instaloaderUrl();
  try {
    const body = { username, days, limit };
    if (sessionid) body.sessionid = sessionid;
    const res = await fetch(`${base}/profile`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { ok: false, error: 'Instaloader returned non-JSON', fallback: true, adapter: 'instaloader' };
    }
    if (!data.ok) {
      const err = String(data.error || `Instaloader HTTP ${res.status}`).slice(0, 400);
      return {
        ok: false,
        error: err,
        fallback: true,
        adapter: 'instaloader',
        instagram_http: data.instagram_http || parseInstagramHttp(err),
        rate_limited: Boolean(data.rate_limited) || isInstagramRateLimit(err),
        self_hosted: data.self_hosted !== false,
      };
    }
    console.info(
      '[social-research] instaloader username=%s posts=%s followers=%s session=%s',
      username,
      data.count || data.posts?.length || 0,
      data.followers ?? '',
      sessionid ? 'yes' : 'no'
    );
    return {
      ok: true,
      adapter: 'instaloader',
      username,
      full_name: data.full_name || '',
      followers: data.followers ?? null,
      biography: data.biography || '',
      days,
      posts: Array.isArray(data.posts) ? data.posts : [],
      count: data.count || (data.posts || []).length,
      fallback: false,
    };
  } catch (e) {
    console.warn('[social-research] instaloader sidecar unreachable: %s', e.message || e);
    return {
      ok: false,
      error: String(e.message || e).slice(0, 400),
      fallback: true,
      adapter: 'instaloader',
      self_hosted: true,
    };
  }
}
