/**
 * Public web/search adapter for social research (Brave Search).
 * Used for LinkedIn, X, public Facebook/Instagram fallback — not a crawler.
 */
import { getBraveSearchConfig } from '../../../config/tools.js';

const BRAVE_WEB_URL = 'https://api.search.brave.com/res/v1/web/search';

export async function webSearch(ownerUserId, { query, count = 8 } = {}) {
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
  let composed = host ? `${q} site:${host}` : q;
  const d = Number(days) || 0;
  if (d > 0) composed += ` after:${isoDateDaysAgo(d)}`;
  return webSearch(ownerUserId, { query: composed, count });
}

function isoDateDaysAgo(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - Math.max(1, Number(days) || 30));
  return d.toISOString().slice(0, 10);
}
