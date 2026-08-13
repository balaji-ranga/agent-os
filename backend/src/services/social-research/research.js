/**
 * Cross-platform brand / handle research. Adapters are swappable;
 * agents and workflows call these stable tool names only.
 */
import { researchInstagram } from './adapters/instagram.js';
import { researchFacebook } from './adapters/facebook.js';
import { searchSite, webSearch, daysToBraveFreshness } from './adapters/web-search.js';

const PLATFORM_SITES = {
  x: 'x.com',
  twitter: 'twitter.com',
  linkedin: 'linkedin.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
};

function parsePlatforms(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((p) => String(p || '').trim().toLowerCase()).filter(Boolean);
  }
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'all') return ['instagram', 'x', 'linkedin', 'facebook'];
  return s.split(/[,+\s]+/).map((p) => p.trim()).filter(Boolean);
}

export async function researchProfile(ownerUserId, opts = {}) {
  const brand = String(opts.brand || opts.query || opts.handle || '').trim();
  if (!brand) {
    const err = new Error('brand or handle is required');
    err.status = 400;
    throw err;
  }
  const days = Math.min(Math.max(Number(opts.days) || 30, 1), 90);
  const platforms = parsePlatforms(opts.platforms || opts.platform);
  const handle = String(opts.handle || '').trim();
  const out = {
    ok: true,
    brand,
    days,
    platforms,
    instagram: null,
    x: null,
    linkedin: null,
    facebook: null,
  };

  const jobs = [];
  if (platforms.includes('instagram') || platforms.includes('insta') || platforms.includes('ig')) {
    jobs.push(
      researchInstagram(ownerUserId, { handle, brand, days }).then((r) => {
        out.instagram = r;
      })
    );
  }
  if (platforms.includes('facebook') || platforms.includes('fb') || platforms.includes('meta')) {
    jobs.push(
      researchFacebook(ownerUserId, { brand, days }).then((r) => {
        out.facebook = r;
      })
    );
  }
  if (platforms.includes('x') || platforms.includes('twitter')) {
    jobs.push(
      (async () => {
        const a = await searchSite(ownerUserId, { query: brand, site: PLATFORM_SITES.x, count: 8, days });
        const b = await searchSite(ownerUserId, {
          query: brand,
          site: PLATFORM_SITES.twitter,
          count: 5,
          days,
        });
        const results = [...(a.results || []), ...(b.results || [])].filter(
          (r, i, arr) => r.url && arr.findIndex((x) => x.url === r.url) === i
        );
        out.x = { ok: results.length > 0, adapter: 'web_search', results };
      })()
    );
  }
  if (platforms.includes('linkedin')) {
    jobs.push(
      searchSite(ownerUserId, { query: brand, site: PLATFORM_SITES.linkedin, count: 8, days }).then((r) => {
        out.linkedin = { ok: r.ok, adapter: 'web_search', results: r.results || [] };
      })
    );
  }

  const settled = await Promise.allSettled(jobs);
  for (const s of settled) {
    if (s.status === 'rejected') {
      console.warn('[social-research] profile adapter failed: %s', s.reason?.message || s.reason);
    }
  }

  const any =
    (out.instagram && (out.instagram.ok || out.instagram.indexed_results?.length)) ||
    (out.facebook && out.facebook.ok) ||
    (out.x && out.x.ok) ||
    (out.linkedin && out.linkedin.ok);
  out.ok = Boolean(any);
  if (!out.ok) {
    const fallback = await webSearch(ownerUserId, { query: `${brand} social media`, count: 8 });
    out.web = fallback;
    out.ok = Boolean(fallback.results?.length);
  }
  console.info('[social-research] profile brand_len=%s platforms=%s ok=%s', brand.length, platforms.join(','), out.ok);
  return out;
}

export async function researchSearch(ownerUserId, opts = {}) {
  const query = String(opts.query || '').trim();
  if (!query) {
    const err = new Error('query is required');
    err.status = 400;
    throw err;
  }
  const site = String(opts.site || '').trim();
  const days = Number(opts.days) || 0;
  const count = Math.min(Math.max(Number(opts.count) || 8, 1), 20);
  if (site) return searchSite(ownerUserId, { query, site, count, days });
  return webSearch(ownerUserId, { query, count, freshness: daysToBraveFreshness(days) });
}
