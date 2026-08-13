/**
 * X / Twitter adapter: official API v2 when a bearer is configured,
 * otherwise Brave status URLs hydrated via fxtwitter (text + media).
 */
import { getXApiConfig } from '../../../config/tools.js';
import { searchSite } from './web-search.js';
import { hydrateTweet, hydrateTweetsFromUrls, extractTweetIds } from './post-hydrate.js';

function normalizeHandle(raw) {
  return String(raw || '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '');
}

async function twitterGet(token, path, query = {}) {
  const u = new URL(`https://api.twitter.com/2${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && String(v) !== '') u.searchParams.set(k, String(v));
  }
  const res = await fetch(u, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('X API non-JSON');
  }
  if (!res.ok || data.errors) {
    const msg = data.errors?.[0]?.message || data.title || `X API HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

function mediaByKey(includes) {
  const map = new Map();
  for (const m of includes?.media || []) {
    if (m.media_key) map.set(m.media_key, m);
  }
  return map;
}

async function tryOfficialApi(token, username, { days, limit }) {
  const user = await twitterGet(token, `/users/by/username/${encodeURIComponent(username)}`, {
    'user.fields': 'name,description,public_metrics',
  });
  const uid = user?.data?.id;
  if (!uid) return { ok: false, error: 'X user not found' };
  const tweets = await twitterGet(token, `/users/${uid}/tweets`, {
    max_results: String(Math.min(Math.max(limit, 5), 20)),
    'tweet.fields': 'created_at,text,attachments',
    expansions: 'attachments.media_keys',
    'media.fields': 'url,preview_image_url,type',
    exclude: 'retweets,replies',
  });
  const mediaMap = mediaByKey(tweets.includes);
  const since = Date.now() - days * 86400000;
  const posts = [];
  for (const t of tweets.data || []) {
    const ts = t.created_at ? Date.parse(t.created_at) : 0;
    if (ts && ts < since) continue;
    const keys = t.attachments?.media_keys || [];
    const first = keys.map((k) => mediaMap.get(k)).find(Boolean);
    posts.push({
      id: t.id,
      url: `https://x.com/${username}/status/${t.id}`,
      text: String(t.text || '').slice(0, 800),
      timestamp: t.created_at || '',
      image_url: first?.url || first?.preview_image_url || '',
      handle: username,
      adapter: 'x_api',
      hydrated: true,
    });
    if (posts.length >= limit) break;
  }
  return {
    ok: posts.length > 0,
    adapter: 'x_api',
    username,
    name: user.data?.name || '',
    followers: user.data?.public_metrics?.followers_count ?? null,
    posts,
    count: posts.length,
    fallback: false,
  };
}

export async function researchX(ownerUserId, { handle, brand, days = 30, limit = 8 } = {}) {
  const username = normalizeHandle(handle || brand);
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
  const cap = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const label = String(brand || handle || username).trim();
  const out = {
    ok: false,
    adapter: 'web_search',
    username: username || null,
    days: windowDays,
    posts: [],
    indexed_results: [],
    fallback: true,
  };

  const cfg = getXApiConfig(ownerUserId);
  if (username && cfg.apiKey) {
    try {
      const official = await tryOfficialApi(cfg.apiKey, username, { days: windowDays, limit: cap });
      if (official.ok && official.posts.length) {
        console.info('[social-research] x_api username=%s posts=%s', username, official.posts.length);
        return official;
      }
      out.x_api_error = official.error || 'empty';
    } catch (e) {
      out.x_api_error = String(e.message || e).slice(0, 400);
      console.warn('[social-research] x_api miss username=%s %s', username, out.x_api_error);
    }
  } else if (!cfg.apiKey) {
    out.x_api_configured = false;
    out.x_api_next_step = cfg.error || null;
  }

  const queries = [];
  if (username) {
    queries.push({ query: username, site: `x.com/${username}/status` });
    queries.push({ query: username, site: 'x.com' });
    queries.push({ query: username, site: 'twitter.com' });
  } else if (label) {
    queries.push({ query: label, site: 'x.com' });
    queries.push({ query: label, site: 'twitter.com' });
  }

  const indexed = [];
  for (const q of queries) {
    const r = await searchSite(ownerUserId, { query: q.query, site: q.site, count: 8, days: windowDays });
    for (const hit of r.results || []) {
      if (hit.url && !indexed.some((x) => x.url === hit.url)) indexed.push(hit);
    }
    if (extractTweetIds(indexed.map((x) => x.url)).length >= cap) break;
  }
  if (!extractTweetIds(indexed.map((x) => x.url)).length && username) {
    const loose = await searchSite(ownerUserId, {
      query: `${username} /status/`,
      site: 'x.com',
      count: 10,
      days: 0,
    });
    for (const hit of loose.results || []) {
      if (hit.url && !indexed.some((x) => x.url === hit.url)) indexed.push(hit);
    }
  }
  out.indexed_results = indexed;

  let posts = await hydrateTweetsFromUrls(
    indexed.map((x) => x.url),
    { limit: cap }
  );

  if (!posts.length && username) {
    const probe = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(username)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 AgentOS-SocialResearch/1.0' },
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => r.json())
      .catch(() => null);
    const latestId = probe?.user?.pinned_tweet_id || probe?.tweet?.id;
    if (latestId) {
      const one = await hydrateTweet(String(latestId));
      if (one) posts = [one];
    }
  }

  const since = Date.now() - windowDays * 86400000;
  const inWindow = posts.filter((p) => {
    const ts = Date.parse(p.timestamp);
    return Number.isFinite(ts) && ts >= since;
  });
  if (inWindow.length) {
    posts = inWindow;
  } else if (posts.length) {
    out.outside_window = true;
    out.next_step =
      'Hydrated tweets are older than the requested window. Brave indexed older /status/ URLs. Add vault X_API_BYOK (or platform X_BEARER_TOKEN) for an official recent timeline.';
  }

  out.posts = posts;
  out.count = posts.length;
  out.ok = posts.length > 0 || indexed.length > 0;
  out.adapter = posts.length ? 'fxtwitter' : 'web_search';
  out.fallback = !posts.length;
  if (!posts.length) {
    out.next_step =
      'Indexed X URLs were found but tweet hydration returned no posts. Add vault X_API_BYOK (or platform X_BEARER_TOKEN) for official timelines. Indexed hits are not a tweet feed.';
  }
  console.info(
    '[social-research] x username=%s posts=%s indexed=%s adapter=%s',
    username || '',
    posts.length,
    indexed.length,
    out.adapter
  );
  return out;
}
