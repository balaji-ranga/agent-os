/**
 * Facebook adapter: Meta Graph when the CEO has Connectors → MCPs OAuth;
 * otherwise publicly indexed web search (not a crawler).
 */
import { resolveMcpOauthAccessToken } from '../../mcp-oauth.js';
import { searchSite, webSearch } from './web-search.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const META_SERVER_ID = 'mcp-meta-graph';

async function graphGet(token, path, query = {}) {
  const u = new URL(path.startsWith('http') ? path : `${GRAPH}${path.startsWith('/') ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v != null && String(v) !== '') u.searchParams.set(k, String(v));
  }
  u.searchParams.set('access_token', token);
  const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Meta Graph non-JSON');
  }
  if (!res.ok || data.error) {
    throw new Error(data.error?.message || `Meta Graph HTTP ${res.status}`);
  }
  return data;
}

function nameMatches(pageName, brand) {
  const a = String(pageName || '').toLowerCase();
  const b = String(brand || '').toLowerCase().trim();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export async function researchFacebook(ownerUserId, { brand, days = 30, limit = 15 } = {}) {
  const label = String(brand || '').trim();
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
  const cap = Math.min(Math.max(Number(limit) || 15, 1), 50);
  const out = {
    ok: false,
    adapter: 'web_search',
    brand: label,
    days: windowDays,
    meta_connected: false,
    pages: [],
    posts: [],
    indexed_results: [],
  };

  const tokenInfo = ownerUserId ? resolveMcpOauthAccessToken(ownerUserId, META_SERVER_ID) : null;
  const token = tokenInfo?.access_token || '';
  if (token) {
    out.meta_connected = true;
    try {
      const pagesRes = await graphGet(token, '/me/accounts', {
        fields: 'id,name,category,fan_count,link',
        limit: 50,
      });
      const pages = Array.isArray(pagesRes?.data) ? pagesRes.data : [];
      const matched = label ? pages.filter((p) => nameMatches(p.name, label)) : pages.slice(0, 5);
      out.pages = matched.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category || '',
        fan_count: p.fan_count ?? null,
        link: p.link || '',
      }));
      for (const page of matched.slice(0, 3)) {
        try {
          const postsRes = await graphGet(token, `/${page.id}/posts`, {
            fields: 'id,message,created_time,permalink_url',
            limit: cap,
          });
          const posts = Array.isArray(postsRes?.data) ? postsRes.data : [];
          const since = Date.now() - windowDays * 86400000;
          for (const p of posts) {
            const ts = p.created_time ? Date.parse(p.created_time) : 0;
            if (ts && ts < since) continue;
            out.posts.push({
              page_id: page.id,
              page_name: page.name,
              id: p.id,
              message: String(p.message || '').slice(0, 500),
              created_time: p.created_time || '',
              permalink_url: p.permalink_url || '',
            });
          }
        } catch (e) {
          console.warn('[social-research] facebook page posts failed page=%s %s', page.id, e.message || e);
        }
      }
      out.adapter = 'meta_graph';
      out.ok = out.pages.length > 0 || out.posts.length > 0;
      console.info(
        '[social-research] facebook meta pages=%s posts=%s brand_len=%s',
        out.pages.length,
        out.posts.length,
        label.length
      );
    } catch (e) {
      console.warn('[social-research] facebook meta graph failed: %s', e.message || e);
      out.meta_error = String(e.message || e).slice(0, 400);
    }
  }

  if (label) {
    const search = await searchSite(ownerUserId, {
      query: `${label} Facebook`,
      site: 'facebook.com',
      count: 8,
      days: windowDays,
    });
    const extra = await webSearch(ownerUserId, { query: `${label} site:facebook.com`, count: 5 });
    out.indexed_results = [...(search.results || []), ...(extra.results || [])].filter(
      (r, i, arr) => r.url && arr.findIndex((x) => x.url === r.url) === i
    );
    if (out.indexed_results.length) out.ok = true;
    if (!token) out.adapter = 'web_search';
    else if (!out.posts.length) out.adapter = 'meta_graph+web_search';
  }

  if (!token && !label) {
    out.error = 'Connect Facebook on Connectors → MCPs, or pass a brand name for public indexed search.';
  }
  return out;
}
