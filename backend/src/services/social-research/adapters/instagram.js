/**
 * Instagram adapter: Instaloader (optional session cookie), then hydrate
 * /p/{shortcode}/ URLs from indexed search (media redirect or Graph oEmbed).
 */
import { getInstagramSessionConfig, getMetaAppAccessToken } from '../../../config/tools.js';
import { searchSite, webSearch } from './web-search.js';
import { hydrateInstagramFromSearch } from './post-hydrate.js';

function instaloaderUrl() {
  return String(process.env.INSTALOADER_URL || '').trim().replace(/\/+$/, '') || 'http://instaloader-sidecar:8083';
}

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9._]/g, '');
}

function sessionNextStep() {
  return 'Anonymous Instaloader is rate-limited from datacenter IPs. Add vault INSTAGRAM_SESSIONID (browser cookie from instagram.com while logged in) under Settings → API Keys for a real caption/timestamp feed. Graph cannot query arbitrary brand accounts.';
}

export async function researchInstagram(ownerUserId, { handle, brand, days = 30, limit = 40 } = {}) {
  const username = normalizeHandle(handle || brand);
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 80);
  const session = getInstagramSessionConfig(ownerUserId);

  let instaloaderError = null;
  if (username) {
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
      };
    }
    instaloaderError = loaded.error || 'empty';
    console.info(
      '[social-research] instaloader miss username=%s has_session=%s fallback=hydrate err=%s',
      username,
      session.configured,
      instaloaderError
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
    instaloader_error: instaloaderError,
    next_step: posts.length
      ? posts.some((p) => p.caption_source === 'search_hint')
        ? 'Images are real CDN thumbnails. Captions are search hints unless INSTAGRAM_SESSIONID is set for Instaloader.'
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
      return {
        ok: false,
        error: String(data.error || `Instaloader HTTP ${res.status}`).slice(0, 400),
        fallback: true,
        adapter: 'instaloader',
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
    console.warn('[social-research] instaloader unreachable: %s', e.message || e);
    return {
      ok: false,
      error: String(e.message || e).slice(0, 400),
      fallback: true,
      adapter: 'instaloader',
    };
  }
}
