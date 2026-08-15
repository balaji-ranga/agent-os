/**
 * Workflow Web Scrape node — calls the Crawlee sidecar (not in-process).
 * Owner is always the workflow run owner. Never trust body ceo_user_id.
 */
import { getToolsApiKey, getInstagramSessionConfig } from '../config/tools.js';
import { getInternalToken } from '../middleware/internal-auth.js';
import { assertAndConsumeToolRateLimit } from './tool-api-rate-limits.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';

function sidecarBase() {
  return String(process.env.WEB_SCRAPE_MCP_URL || 'http://web-scrape-mcp:8085/mcp')
    .trim()
    .replace(/\/mcp\/?$/i, '')
    .replace(/\/+$/, '');
}

function parsePhrases(raw) {
  if (Array.isArray(raw)) return raw.map((p) => String(p || '').trim()).filter(Boolean).slice(0, 40);
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

function maybeInstagramCookie(startUrl, existingCookie, ownerUserId) {
  if (existingCookie) return existingCookie;
  try {
    const host = new URL(/^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`).hostname.toLowerCase();
    if (!/(^|\.)instagram\.com$/.test(host)) return '';
  } catch {
    return '';
  }
  try {
    const sess = getInstagramSessionConfig(ownerUserId);
    if (sess?.configured && sess.sessionid) return `sessionid=${sess.sessionid}`;
  } catch (e) {
    console.warn('[web-scrape] vault session lookup failed', e?.message || e);
  }
  return '';
}

export function buildWebScrapePayload(resolvedInputs = {}, nodeConfig = {}, context = null) {
  const cfg = nodeConfig || {};
  const pick = (key, ...alts) => {
    for (const k of [key, ...alts]) {
      if (resolvedInputs[k] != null && String(resolvedInputs[k]).trim() !== '') return resolvedInputs[k];
    }
    return cfg[key] ?? cfg[alts[0]];
  };
  let startUrl = String(pick('startUrl', 'url', 'domain') || '').trim();
  let phrases = pick('phrases', 'searchPhrases');
  if (context) {
    startUrl = renderWorkflowTemplates(startUrl, context);
    if (typeof phrases === 'string') phrases = renderWorkflowTemplates(phrases, context);
  }
  const cookie = String(pick('cookie', 'cookieHeader') || '').trim();
  return {
    startUrl,
    phrases: parsePhrases(phrases),
    maxPages: Number(pick('maxPages', 'max_pages')) || Number(cfg.maxPages) || 25,
    maxDepth: cfg.maxDepth != null ? Number(cfg.maxDepth) : Number(pick('maxDepth', 'max_depth') ?? 2),
    render: String(cfg.render || pick('render') || 'auto').toLowerCase(),
    includeGlobs: cfg.includeGlobs || pick('includeGlobs'),
    excludeGlobs: cfg.excludeGlobs || pick('excludeGlobs'),
    sameOriginOnly: cfg.sameOriginOnly !== false,
    respectRobotsTxt: cfg.respectRobotsTxt !== false && cfg.ignoreRobotsTxt !== true,
    cookie,
    timeoutMs: Number(cfg.timeoutMs || cfg.timeout_ms) || 120000,
  };
}

export async function executeWebScrapeTask(resolvedInputs = {}, nodeConfig = {}, context = null) {
  const ownerUserId = context?.owner_user_id || context?.actor?.id || null;
  if (!ownerUserId) throw new Error('Web scrape node requires workflow owner');

  const payload = buildWebScrapePayload(resolvedInputs, nodeConfig, context);
  if (!payload.startUrl) throw new Error('startUrl is required');
  payload.cookie = maybeInstagramCookie(payload.startUrl, payload.cookie, ownerUserId);

  if (!context?.skipToolRateLimit) {
    const limit = assertAndConsumeToolRateLimit({
      ownerUserId,
      toolName: payload.maxPages <= 1 ? 'web_scrape_url' : 'web_scrape_domain',
      actor: 'workflow',
    });
    if (limit?.ok === false) {
      const err = new Error(limit.error || 'Tool API rate limit reached');
      err.status = Number(limit.status) || 429;
      throw err;
    }
  }

  const headers = { 'Content-Type': 'application/json', 'x-ceo-user-id': String(ownerUserId) };
  const toolsKey = getToolsApiKey();
  const internal = getInternalToken();
  if (toolsKey) headers.Authorization = `Bearer ${toolsKey}`;
  else if (internal) headers['x-agent-os-internal-token'] = internal;

  const url = `${sidecarBase()}/v1/scrape`;
  const timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 120000, 5000), 20 * 60 * 1000);
  console.info('[web-scrape] sidecar call', {
    owner: ownerUserId,
    host: (() => {
      try {
        const raw = payload.startUrl;
        return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
      } catch {
        return 'invalid';
      }
    })(),
    render: payload.render,
    maxPages: payload.maxPages,
    has_cookie: Boolean(payload.cookie),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `Web scrape sidecar HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return {
    ok: data.ok !== false,
    text: data.text || '',
    matches: data.matches || [],
    pages: data.pages || [],
    stats: data.stats || {},
    result: data,
  };
}

export async function executeWebScrapeForOwner(ownerUserId, body = {}, { toolName = 'web_scrape_domain' } = {}) {
  if (!ownerUserId) {
    const err = new Error('Could not resolve entitled CEO for this session');
    err.status = 403;
    throw err;
  }
  const cfg = {
    maxPages: body.maxPages ?? body.max_pages,
    maxDepth: body.maxDepth ?? body.max_depth,
    render: body.render,
    includeGlobs: body.includeGlobs || body.include,
    excludeGlobs: body.excludeGlobs || body.exclude,
    sameOriginOnly: body.sameOriginOnly,
    respectRobotsTxt: body.respectRobotsTxt,
    timeoutMs: body.timeoutMs || body.timeout_ms,
  };
  if (toolName === 'web_scrape_url') {
    cfg.maxPages = 1;
    cfg.maxDepth = 0;
  }
  return executeWebScrapeTask(
    {
      startUrl: body.startUrl || body.url || body.domain,
      phrases: body.phrases || body.searchPhrases || body.query,
      cookie: body.cookie || body.cookieHeader,
    },
    cfg,
    { owner_user_id: ownerUserId, skipToolRateLimit: true }
  );
}
