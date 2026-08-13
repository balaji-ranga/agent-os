/**
 * Public web/search adapter for social research (Brave Search).
 * Used for LinkedIn, X, public Facebook/Instagram fallback — not a crawler.
 */
import { getBraveSearchConfig } from '../../../config/tools.js';

const BRAVE_WEB_URL = 'https://api.search.brave.com/res/v1/web/search';

/** Brave Search freshness: pd/pw/pm/py (not Google's after: operator). */
export function daysToBraveFreshness(days) {
  const d = Number(days) || 0;
  if (d <= 0) return '';
  if (d <= 1) return 'pd';
  if (d <= 7) return 'pw';
  if (d <= 31) return 'pm';
  return 'py';
}

export async function webSearch(ownerUserId, { query, count = 8, freshness = '' } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'query is required', results: [] };

  const cfg = getBraveSearchConfig(ownerUserId);
  if (cfg.error || !cfg.apiKey) {
    return {
      ok: false,
      error: cfg.error || 'Brave Search not configured',
      code: cfg.error_code,
      results: [],
      adapter: 'brave_web_search',
    };
  }

  const n = Math.min(Math.max(Number(count) || 8, 1), 20);
  const url = new URL(BRAVE_WEB_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('count', String(n));
  const fresh = String(freshness || '').trim();
  if (fresh) url.searchParams.set('freshness', fresh);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': cfg.apiKey,
    },
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.warn('[social-research] brave search HTTP %s', res.status);
    return {
      ok: false,
      error: `Brave API HTTP ${res.status}`,
      results: [],
      adapter: 'brave_web_search',
    };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Brave API returned non-JSON', results: [], adapter: 'brave_web_search' };
  }
  const results = (data.web?.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
  }));
  console.info('[social-research] web_search q_len=%s n=%s source=%s', q.length, results.length, cfg.source);
  return {
    ok: true,
    query: q,
    count: results.length,
    results,
    adapter: 'brave_web_search',
    key_source: cfg.source,
    using_byok: Boolean(cfg.using_byok),
  };
}

export async function searchSite(ownerUserId, { query, site, count = 8, days = 0 } = {}) {
  const q = String(query || '').trim();
  const host = String(site || '').trim();
  if (!q) return { ok: false, error: 'query is required', results: [] };
  const composed = host ? `${q} site:${host}` : q;
  const freshness = daysToBraveFreshness(days);
  const first = await webSearch(ownerUserId, { query: composed, count, freshness });
  if (freshness && first.ok && !(first.results || []).length) {
    console.info('[social-research] freshness empty retry without filter q_len=%s', composed.length);
    return webSearch(ownerUserId, { query: composed, count });
  }
  return first;
}
