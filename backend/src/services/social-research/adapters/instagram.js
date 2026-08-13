/**
 * Instagram adapter: public Instaloader sidecar, then Brave/web search fallback.
 * No Instagram login in v1.
 */
import { searchSite, webSearch } from './web-search.js';

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

export async function researchInstagram(ownerUserId, { handle, brand, days = 30, limit = 40 } = {}) {
  const username = normalizeHandle(handle || brand);
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 80);

  let instaloaderError = null;
  if (username) {
    const loaded = await tryInstaloader({ username, days: windowDays, limit: cap });
    if (loaded.ok && (loaded.posts?.length || loaded.followers != null)) {
      return loaded;
    }
    instaloaderError = loaded.error || 'empty';
    console.info(
      '[social-research] instaloader miss username=%s fallback=search err=%s',
      username,
      instaloaderError
    );
  }

  const q = username
    ? `${username} Instagram`
    : `${String(brand || '').trim()} Instagram`;
  const search = await searchSite(ownerUserId, {
    query: q,
    site: 'instagram.com',
    count: 10,
    days: windowDays,
  });
  const extra = await webSearch(ownerUserId, { query: q, count: 5 });
  const results = [...(search.results || []), ...(extra.results || [])].filter(
    (r, i, arr) => r.url && arr.findIndex((x) => x.url === r.url) === i
  );
  return {
    ok: results.length > 0,
    adapter: 'web_search_fallback',
    username: username || null,
    days: windowDays,
    posts: [],
    indexed_results: results,
    fallback: true,
    instaloader_error: instaloaderError,
  };
}

async function tryInstaloader({ username, days, limit }) {
  const base = instaloaderUrl();
  try {
    const res = await fetch(`${base}/profile`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, days, limit }),
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
      '[social-research] instaloader username=%s posts=%s followers=%s',
      username,
      data.count || data.posts?.length || 0,
      data.followers ?? ''
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
