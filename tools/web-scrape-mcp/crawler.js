/**
 * Bounded HTTPS crawl with optional phrase scoring (Crawlee Cheerio / Playwright).
 */
import { randomUUID } from 'node:crypto';
import { CheerioCrawler, Configuration, log as crawleeLog } from 'crawlee';
import { MemoryStorage } from '@crawlee/memory-storage';
import { parsePublicHttpsUrl, assertPublicResolvedHost, sameOrigin } from './ssrf.js';

const MAX_PAGES_HARD = 200;
const MAX_DEPTH_HARD = 6;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_MAX_DEPTH = 2;
const PAGE_TEXT_CAP = 8000;
const SNIPPET_CAP = 280;
const CONCURRENCY_HTTP = 4;
const CONCURRENCY_PW = 1;

crawleeLog.setLevel(crawleeLog.LEVELS.WARNING);

let activeJobs = 0;
const waiters = [];
const MAX_JOBS = Math.min(Math.max(Number(process.env.WEB_SCRAPE_MAX_JOBS) || 1, 1), 4);

async function withJobSlot(fn) {
  while (activeJobs >= MAX_JOBS) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  activeJobs += 1;
  try {
    return await fn();
  } finally {
    activeJobs -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function parsePhrases(raw) {
  if (Array.isArray(raw)) {
    return raw.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 40);
  }
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return parsePhrases(arr);
    } catch {
      /* fall through */
    }
  }
  return s
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function parseGlobs(raw) {
  if (Array.isArray(raw)) return raw.map((g) => String(g || '').trim()).filter(Boolean).slice(0, 40);
  const s = String(raw || '').trim();
  if (!s) return [];
  return s.split(/[,;\n]+/).map((g) => g.trim()).filter(Boolean).slice(0, 40);
}

function globToRegExp(glob) {
  const g = String(glob || '').trim();
  if (!g) return null;
  const escaped = g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function matchesGlobs(url, globs) {
  if (!globs.length) return true;
  const regs = globs.map(globToRegExp).filter(Boolean);
  if (!regs.length) return true;
  return regs.some((r) => r.test(url));
}

function scorePhrases(haystack, phrases) {
  const text = String(haystack || '').toLowerCase();
  const hits = [];
  let score = 0;
  for (const p of phrases) {
    const needle = p.toLowerCase();
    if (!needle) continue;
    let idx = 0;
    let n = 0;
    while (n < 50) {
      const found = text.indexOf(needle, idx);
      if (found < 0) break;
      n += 1;
      idx = found + needle.length;
    }
    if (n > 0) {
      hits.push(p);
      score += n;
    }
  }
  return { score, hits };
}

function snippetAround(text, phrases, cap = SNIPPET_CAP) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  for (const p of phrases) {
    const i = lower.indexOf(p.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - 80);
      return raw.slice(start, start + cap);
    }
  }
  return raw.slice(0, cap);
}

function looksLikeLoginWall(title, text) {
  const blob = `${title || ''} ${String(text || '').slice(0, 500)}`.toLowerCase();
  if (String(text || '').trim().length > 800) return false;
  return /\blog\s*in\b|\bsign\s*in\b|\bcreate an account\b|\benable javascript\b/.test(blob);
}

function extractFromCheerio($, pageUrl) {
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDesc = $('meta[property="og:description"]').attr('content') || '';
  const title = String($('title').first().text() || ogTitle || '').replace(/\s+/g, ' ').trim();
  $('script, style, noscript, svg, iframe').remove();
  const text = String($('body').text() || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PAGE_TEXT_CAP);
  const description = String(ogDesc || $('meta[name="description"]').attr('content') || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const links = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const abs = new URL(href, pageUrl).toString();
      if (abs.startsWith('https://') || abs.startsWith('http://')) links.push(abs);
    } catch {
      /* skip */
    }
  });
  return { title, text, description, links: [...new Set(links)].slice(0, 200) };
}

async function playwrightAvailable() {
  try {
    await import('playwright');
    return true;
  } catch {
    return false;
  }
}

function extraHeadersFromInput(input) {
  const headers = {
    'Accept-Language': 'en-US,en;q=0.9',
  };
  const cookie = String(input.cookie || input.cookieHeader || input.cookies || '').trim();
  if (cookie) headers.Cookie = cookie;
  if (input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers)) {
    for (const [k, v] of Object.entries(input.headers)) {
      const name = String(k || '').trim();
      if (!name || /cookie/i.test(name)) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      if (/authorization|api[-_]?key|token|secret|password/i.test(name)) continue;
      headers[name] = val;
    }
  }
  return headers;
}

function summarizeResult({ startUrl, phrases, pages, stats, render }) {
  const matches = pages.filter((p) => !phrases.length || (p.phraseHits || []).length);
  const lines = [
    `${matches.length} matching page(s) of ${stats.visited} visited on ${startUrl} (render=${render}).`,
  ];
  if (phrases.length) lines.push(`Phrases: ${phrases.join(', ')}`);
  for (const m of matches.slice(0, 12)) {
    lines.push(`- ${m.title || '(untitled)'} — ${m.url}`);
    if (m.snippet) lines.push(`  ${m.snippet}`);
  }
  if (stats.login_wall) lines.push('Note: at least one page looked like a login / JS wall.');
  if (stats.errors) lines.push(`Errors: ${stats.errors}`);
  return {
    ok: stats.visited > 0 && stats.errors < stats.visited,
    startUrl,
    phrases,
    matches: matches.map((p) => ({
      url: p.url,
      title: p.title,
      snippet: p.snippet,
      phraseHits: p.phraseHits,
      score: p.score,
    })),
    pages: pages.map((p) => ({
      url: p.url,
      title: p.title,
      text: p.text,
      description: p.description,
      status: p.status,
    })),
    stats,
    text: lines.join('\n'),
  };
}

export async function runScrape(input = {}) {
  const startRaw = String(input.startUrl || input.url || input.domain || '').trim();
  const startUrlObj = parsePublicHttpsUrl(
    /^https?:\/\//i.test(startRaw) ? startRaw : `https://${startRaw.replace(/^\/+/, '')}`
  );
  await assertPublicResolvedHost(startUrlObj);
  const startUrl = startUrlObj.toString();
  const phrases = parsePhrases(input.phrases || input.searchPhrases || input.query);
  const maxPages = clampInt(input.maxPages ?? input.max_pages, 1, MAX_PAGES_HARD, DEFAULT_MAX_PAGES);
  const maxDepth = clampInt(input.maxDepth ?? input.max_depth, 0, MAX_DEPTH_HARD, DEFAULT_MAX_DEPTH);
  const sameOriginOnly = input.sameOriginOnly !== false && input.same_origin_only !== false;
  const includeGlobs = parseGlobs(input.includeGlobs || input.include);
  const excludeGlobs = parseGlobs(input.excludeGlobs || input.exclude);
  let render = String(input.render || 'auto').toLowerCase();
  if (!['auto', 'http', 'playwright'].includes(render)) render = 'auto';
  const timeoutMs = clampInt(input.timeoutMs ?? input.timeout_ms, 5000, 20 * 60 * 1000, 120000);
  const respectRobots =
    input.ignoreRobotsTxt === true || input.respectRobotsTxt === false || input.respect_robots_txt === false
      ? false
      : true;
  const headers = extraHeadersFromInput(input);
  const jobId = randomUUID();

  const hasPw = await playwrightAvailable();
  if (render === 'playwright' && !hasPw) {
    console.warn('[web-scrape] playwright requested but unavailable; using http');
    render = 'http';
  }
  if (render === 'auto') render = hasPw ? 'auto' : 'http';

  return withJobSlot(async () => {
    const pages = [];
    const stats = {
      visited: 0,
      matched: 0,
      skipped: 0,
      errors: 0,
      login_wall: false,
      render,
      job_id: jobId,
      duration_ms: 0,
    };
    const t0 = Date.now();
    const seen = new Set();

    function allowEnqueue(url, depth) {
      if (depth > maxDepth) return false;
      if (seen.has(url)) return false;
      if (sameOriginOnly && !sameOrigin(startUrlObj, url)) return false;
      if (excludeGlobs.length && matchesGlobs(url, excludeGlobs)) return false;
      if (includeGlobs.length && !matchesGlobs(url, includeGlobs)) return false;
      try {
        parsePublicHttpsUrl(url);
      } catch {
        return false;
      }
      return true;
    }

    function recordPage(url, extracted, status) {
      const hay = `${extracted.title}\n${extracted.description}\n${extracted.text}`;
      const { score, hits } = scorePhrases(hay, phrases);
      const page = {
        url,
        title: extracted.title,
        description: extracted.description,
        text: extracted.text,
        snippet: snippetAround(hay, phrases),
        phraseHits: hits,
        score,
        status: status || 200,
      };
      if (looksLikeLoginWall(extracted.title, extracted.text)) stats.login_wall = true;
      pages.push(page);
      if (!phrases.length || hits.length) stats.matched += 1;
      return extracted.links || [];
    }

    async function runCheerio(urls, depth0) {
      const storageClient = new MemoryStorage({ persistStorage: false });
      const config = new Configuration({ persistStorage: false, storageClient, purgeOnStart: true });
      const crawler = new CheerioCrawler(
        {
          maxRequestsPerCrawl: maxPages,
          maxConcurrency: CONCURRENCY_HTTP,
          requestHandlerTimeoutSecs: Math.max(15, Math.ceil(timeoutMs / 1000)),
          navigationTimeoutSecs: 30,
          maxRequestRetries: 1,
          ignoreSslErrors: false,
          respectRobotsTxtFile: respectRobots,
          additionalMimeTypes: ['text/html', 'application/xhtml+xml'],
          preNavigationHooks: [
            async ({ request }) => {
              await assertPublicResolvedHost(new URL(request.url));
            },
          ],
          async requestHandler({ request, $, enqueueLinks, log }) {
            if (pages.length >= maxPages) return;
            stats.visited += 1;
            seen.add(request.loadedUrl || request.url);
            const extracted = extractFromCheerio($, request.loadedUrl || request.url);
            const depth = Number(request.userData?.depth || 0);
            const links = recordPage(request.loadedUrl || request.url, extracted, 200);
            log.info?.('[web-scrape] http page', { host: new URL(request.url).hostname, depth });
            if (depth >= maxDepth || pages.length >= maxPages) return;
            const toAdd = links.filter((u) => allowEnqueue(u, depth + 1)).slice(0, 40);
            for (const u of toAdd) seen.add(u);
            if (toAdd.length) {
              await enqueueLinks({
                urls: toAdd,
                userData: { depth: depth + 1 },
                strategy: 'all',
              });
            }
          },
          async failedRequestHandler({ request }, err) {
            stats.errors += 1;
            stats.visited += 1;
            pages.push({
              url: request.url,
              title: '',
              description: '',
              text: '',
              snippet: String(err?.message || 'request failed').slice(0, SNIPPET_CAP),
              phraseHits: [],
              score: 0,
              status: 0,
            });
            console.warn('[web-scrape] http failed', {
              host: (() => {
                try {
                  return new URL(request.url).hostname;
                } catch {
                  return 'unknown';
                }
              })(),
              error: String(err?.message || err).slice(0, 180),
            });
          },
        },
        config
      );
      await crawler.run(
        urls.map((u) => ({
          url: u,
          userData: { depth: depth0 },
          headers,
        }))
      );
    }

    async function runPlaywright(urls, depth0) {
      const { PlaywrightCrawler } = await import('@crawlee/playwright');
      const storageClient = new MemoryStorage({ persistStorage: false });
      const config = new Configuration({ persistStorage: false, storageClient, purgeOnStart: true });
      const crawler = new PlaywrightCrawler(
        {
          maxRequestsPerCrawl: maxPages,
          maxConcurrency: CONCURRENCY_PW,
          requestHandlerTimeoutSecs: Math.max(20, Math.ceil(timeoutMs / 1000)),
          navigationTimeoutSecs: 45,
          maxRequestRetries: 1,
          headless: true,
          respectRobotsTxtFile: respectRobots,
          launchContext: {
            launchOptions: {
              args: ['--disable-dev-shm-usage', '--no-sandbox'],
            },
          },
          preNavigationHooks: [
            async ({ request, page }) => {
              await assertPublicResolvedHost(new URL(request.url));
              if (headers.Cookie) {
                const u = new URL(request.url);
                const host = u.hostname.toLowerCase();
                const cookieDomain =
                  host === 'instagram.com' || host.endsWith('.instagram.com') ? '.instagram.com' : host;
                const cookies = String(headers.Cookie)
                  .split(';')
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((pair) => {
                    const i = pair.indexOf('=');
                    const name = i >= 0 ? pair.slice(0, i).trim() : pair;
                    const value = i >= 0 ? pair.slice(i + 1).trim() : '';
                    return { name, value, domain: cookieDomain, path: '/' };
                  })
                  .filter((c) => c.name);
                if (cookies.length) await page.context().addCookies(cookies);
              }
            },
          ],
          async requestHandler({ request, page, enqueueLinks }) {
            if (pages.length >= maxPages) return;
            stats.visited += 1;
            const loaded = request.loadedUrl || request.url;
            seen.add(loaded);
            const html = await page.content();
            const { load } = await import('cheerio');
            const $ = load(html);
            const extracted = extractFromCheerio($, loaded);
            const depth = Number(request.userData?.depth || 0);
            const links = recordPage(loaded, extracted, 200);
            if (depth >= maxDepth || pages.length >= maxPages) return;
            const toAdd = links.filter((u) => allowEnqueue(u, depth + 1)).slice(0, 40);
            for (const u of toAdd) seen.add(u);
            if (toAdd.length) {
              await enqueueLinks({
                urls: toAdd,
                userData: { depth: depth + 1 },
                strategy: 'all',
              });
            }
          },
          async failedRequestHandler({ request }, err) {
            stats.errors += 1;
            stats.visited += 1;
            pages.push({
              url: request.url,
              title: '',
              description: '',
              text: '',
              snippet: String(err?.message || 'request failed').slice(0, SNIPPET_CAP),
              phraseHits: [],
              score: 0,
              status: 0,
            });
            console.warn('[web-scrape] playwright failed', {
              host: (() => {
                try {
                  return new URL(request.url).hostname;
                } catch {
                  return 'unknown';
                }
              })(),
              error: String(err?.message || err).slice(0, 180),
            });
          },
        },
        config
      );
      await crawler.run(urls.map((u) => ({ url: u, userData: { depth: depth0 } })));
    }

    seen.add(startUrl);
    if (render === 'playwright') {
      await runPlaywright([startUrl], 0);
    } else {
      await runCheerio([startUrl], 0);
      const thin =
        stats.login_wall ||
        pages.every((p) => String(p.text || '').length < 200) ||
        (stats.visited > 0 && stats.matched === 0 && phrases.length > 0);
      if (render === 'auto' && hasPw && thin) {
        console.info('[web-scrape] auto-upgrade to playwright (thin or login-wall HTML)');
        stats.render = 'playwright';
        pages.length = 0;
        stats.visited = 0;
        stats.matched = 0;
        stats.errors = 0;
        stats.login_wall = false;
        seen.clear();
        seen.add(startUrl);
        await runPlaywright([startUrl], 0);
      }
    }

    stats.duration_ms = Date.now() - t0;
    stats.skipped = Math.max(0, seen.size - stats.visited);
    const out = summarizeResult({
      startUrl,
      phrases,
      pages,
      stats,
      render: stats.render,
    });
    console.info('[web-scrape] done', {
      host: startUrlObj.hostname,
      visited: stats.visited,
      matched: stats.matched,
      errors: stats.errors,
      render: stats.render,
      duration_ms: stats.duration_ms,
      login_wall: stats.login_wall,
    });
    return out;
  });
}
