/**
 * Content tools API: summarize-url (Phase 1). Image and video endpoints in later phases.
 * Kanban tools: move-status, reassign-to-coo, assign-task, intent-classify-and-delegate.
 * Metadata (content_tools_meta), test, invoke, and OpenClaw tools list.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getSummarizeUrlConfig, getToolsApiKey, getOpenAiConfig, getImageConfig, getVideoConfig, isGptImageModel, mapGptImageQuality } from '../config/tools.js';
import { chatCompletions } from '../config/llm.js';
import { getDb } from '../db/schema.js';
import * as meta from '../services/content-tools-meta.js';
import { assertCallerMayUseTool } from '../services/openclaw-agent-tools.js';
import { parseTenantOpenClawAgentId, resolveAgentFromOpenClawCallerId } from '../services/openclaw-tenant.js';
import { resolveOwnerFromOpenClawSession } from '../services/tool-owner-scope.js';

function sanitizeTenantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
import { scheduleCeoRequestViaOpenClawCron } from '../services/delegation-queue.js';
import { getOrCreateDelegationHubStandup } from '../services/standup-hub.js';
import {
  listChatTriggerableWorkflows,
  listWorkflowsForAgent,
  triggerAgentWorkflowForOwner,
  resolveWorkflowOwnerUserId,
  enquireWorkflows,
} from '../services/agent-workflow-chat-tools.js';
import { executeAgentWorkflowRuns } from '../services/agent-workflow-agent-runs.js';
import { applyWorkflowBuilderActions, getWorkflowDraftForAgent } from '../services/agent-workflow-builder.js';
import { resolveAuthenticatedCeoUserId, attachAuthUser, requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { requireToolsAccess, attachToolsAuth } from '../middleware/tools-auth.js';
import { internalAuthHeaders, isInternalRequest } from '../middleware/internal-auth.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { resolveToolOwnerUserId, resolveToolOwnerUserIdOrNull, bodyWithoutSpoofedOwner } from '../services/tool-owner-scope.js';
import {
  notifyKanbanTaskCreated,
  clearKanbanTaskNotification,
} from '../services/platform-notifications.js';
import { resolveKanbanTaskOwnerId } from '../services/kanban-user-scope.js';
import jobApplicantTools from './job-applicant-tools.js';
import { summarizeLearnings } from '../services/agent-feedback.js';
import { executeEmailSend } from '../services/email-send.js';
import { executeNotifyCeo } from '../services/notify-ceo.js';
import { executeCeoProfile } from '../services/ceo-profile.js';
import { runCooStatusChecker } from '../services/coo-status-checker.js';
import {
  executeConnectorAction,
  getConnectedConnectorApps,
  getConnectorActionGuide,
  searchConnectorApps,
} from '../services/openconnector.js';
import { tryRewriteCooNotifyAsSpecialist } from '../services/reach-me-delegation.js';
import {
  assertNoSchemaMutation,
  listTablesForAgent,
  listRowsForAgent,
  insertRowForAgent,
  updateRowForAgent,
  deleteRowForAgent,
  listDocumentsForAgent,
  ragDocumentsForAgent,
} from '../services/master-data-tools.js';

const router = Router();
const KANBAN_STATUSES = ['open', 'awaiting_confirmation', 'in_progress', 'completed', 'failed'];

function getCallerAgent(req) {
  const id = (
    req.headers['x-openclaw-agent-id'] ||
    req.headers['x-agent-id'] ||
    req.body?.caller_agent_id ||
    req.body?.x_openclaw_agent_id ||
    ''
  )
    .toString()
    .trim();
  if (!id) return null;
  const row = resolveAgentFromOpenClawCallerId(id);
  if (!row) return null;
  return { id: row.id, name: row.name, is_coo: row.is_coo };
}

function getCooAgentId() {
  const row = getDb().prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
  return row ? row.id : null;
}

function isWorkflowBuilderCaller(caller) {
  if (!caller) return false;
  const id = String(caller.id || '').toLowerCase();
  return id === 'workflowbuilder';
}

/** COO or Workflow Builder may list/enquire/trigger — always scoped to entitled owner. */
function canAccessWorkflowTools(caller) {
  return !!(caller && (caller.is_coo || isWorkflowBuilderCaller(caller)));
}
function getBackendBaseUrl() {
  // Prefer explicit internal URL for tool self-dispatch. Public HTTPS often fails inside
  // the container (self-signed cert / hairpin NAT) and surfaces as "fetch failed".
  const override =
    process.env.TOOLS_BASE_URL ||
    process.env.AGENT_OS_INTERNAL_URL ||
    process.env.AGENT_OS_INTERNAL_API_URL;
  if (override) return String(override).replace(/\/$/, '');
  const port = process.env.PORT || '3001';
  return `http://127.0.0.1:${port}`;
}

function logContentTool(toolName, requestPayload, responsePayload, status, source = null, ownerUserId = null) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      toolName,
      source || null,
      typeof requestPayload === 'string' ? requestPayload : JSON.stringify(requestPayload || {}),
      typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload || {}),
      status,
      ownerUserId || null
    );
  } catch (_) {}
}

function ownerForToolLog(req, body = {}) {
  return resolveToolOwnerUserIdOrNull(req, body, resolveAuthenticatedCeoUserId);
}

function logTool(req, toolName, requestPayload, responsePayload, status, source = null) {
  logContentTool(toolName, requestPayload, responsePayload, status, source, ownerForToolLog(req, requestPayload));
}

/** Ensure tool caller may mutate this Kanban task (owner must match resolved CEO). */
function assertToolOwnsKanbanTask(req, task, body = {}) {
  const ownerUserId =
    resolveToolOwnerUserIdOrNull(req, body, resolveAuthenticatedCeoUserId) ||
    parseTenantOpenClawAgentId(req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || '')?.ceoUserId ||
    null;
  const taskOwner = resolveKanbanTaskOwnerId(task);
  if (!taskOwner) {
    const err = new Error('Task has no owner — refuse cross-tenant mutation');
    err.status = 403;
    throw err;
  }
  if (!ownerUserId || ownerUserId !== taskOwner) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  return ownerUserId;
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function extractTitle(html) {
  const match = html && typeof html === 'string' ? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) : null;
  return match ? stripHtml(match[1]).slice(0, 300) : '';
}

/** Known moved/retired pages → current equivalents (summarize_url remaps). */
const SUMMARIZE_URL_REMAPS = [
  {
    test: (u) => /nasa\.gov$/i.test(u.hostname) && /\/mission_pages\/planets\b/i.test(u.pathname),
    to: 'https://science.nasa.gov/solar-system/planets/',
  },
  {
    test: (u) => /nasa\.gov$/i.test(u.hostname) && /\/mission_pages\//i.test(u.pathname),
    to: 'https://science.nasa.gov/',
  },
];

function summarizeUrlCandidates(rawUrl) {
  const out = [];
  const seen = new Set();
  const push = (u) => {
    const s = String(u || '').trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  push(rawUrl);
  try {
    const u = new URL(rawUrl);
    for (const rule of SUMMARIZE_URL_REMAPS) {
      if (rule.test(u)) push(rule.to);
    }
    // Variant paths for dead index pages
    if (/\/index\.html?$/i.test(u.pathname)) {
      const stripped = new URL(u.href);
      stripped.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
      push(stripped.href);
      stripped.pathname = u.pathname.replace(/\/index\.html?$/i, '');
      push(stripped.href);
    }
    if (u.pathname.endsWith('/')) {
      const noSlash = new URL(u.href);
      noSlash.pathname = u.pathname.replace(/\/+$/, '') || '/';
      push(noSlash.href);
    }
  } catch {
    /* ignore */
  }
  return out.slice(0, 6);
}

const SUMMARIZE_FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 AgentOS-ContentTools/1.1',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function fetchSummarizeUrlBody(url, { timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: SUMMARIZE_FETCH_HEADERS,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, finalUrl: response.url || url };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let body = '';
    let contentLength = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      contentLength += value.length;
      if (contentLength > maxBytes) break;
      body += decoder.decode(value, { stream: true });
    }
    if (contentLength > maxBytes) body = body.slice(0, maxBytes);
    return { ok: true, status: response.status, body, finalUrl: response.url || url };
  } finally {
    clearTimeout(timeoutId);
  }
}

function optionalAuth(req, res, next) {
  return requireToolsAccess(req, res, next);
}

function resolveWorkflowOwner(req, body = {}) {
  return resolveWorkflowOwnerUserId(req, bodyWithoutSpoofedOwner(body), resolveAuthenticatedCeoUserId);
}

/**
 * GET /meta — list content tools metadata (authenticated CEO/admin).
 */
router.get('/meta', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const list = meta.listToolsMeta();
    res.json({ tools: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /meta/:name — update tool metadata.
 */
router.patch('/meta/:name', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const name = req.params.name?.trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const row = meta.getToolMeta(name);
    if (!row) return res.status(404).json({ error: 'Tool not found' });
    const updated = meta.updateToolMeta(name, req.body || {});
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /meta — onboard new tool.
 */
router.post('/meta', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const record = meta.createToolMeta(req.body || {});
    res.status(201).json(record);
  } catch (e) {
    if (e.message.includes('required')) return res.status(400).json({ error: e.message });
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Tool name already exists' });
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /test/:name — test a tool with given body.
 */
router.post('/test/:name', attachToolsAuth, requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const name = req.params.name?.trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const row = meta.getToolMeta(name);
    if (!row) return res.status(404).json({ error: 'Tool not found' });
    if (!row.enabled) return res.status(403).json({ error: 'Tool is disabled' });
    const body = req.body || {};
    const baseUrl = getBackendBaseUrl();
    let targetUrl = row.endpoint;
    if (targetUrl.startsWith('/')) targetUrl = baseUrl + targetUrl;
    const method = String(row.method || 'POST').toUpperCase();
    const headers = { 'Content-Type': 'application/json' };
    if (targetUrl.startsWith(baseUrl)) {
      Object.assign(headers, internalAuthHeaders());
      try {
        const ownerUserId = resolveAuthenticatedCeoUserId(req, body);
        if (ownerUserId) headers['x-ceo-user-id'] = ownerUserId;
      } catch (_) {
        /* admin without impersonation — leave unset; target may fall back */
      }
    }

    const fetchOpts = {
      method,
      headers,
      // LLM summarize paths (brain_history / ibkr_order_learnings) can exceed 60s
      signal: AbortSignal.timeout(120000),
    };
    if (method === 'GET' || method === 'HEAD') {
      if (body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length) {
        const u = new URL(targetUrl);
        for (const [k, v] of Object.entries(body)) {
          if (v == null) continue;
          u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        targetUrl = u.toString();
      }
    } else {
      fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(targetUrl, fetchOpts);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.name === 'AbortError' ? 'Request timeout' : e.message });
  }
});

/**
 * GET /logs — scoped to signed-in CEO (admin must impersonate).
 */
router.get('/logs', attachAuthUser, requireAuth, (req, res) => {
  try {
    if (req.authUser.role === 'admin' && !req.authUser.impersonation) {
      return res.json({ logs: [], total: 0 });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const tool = typeof req.query.tool === 'string' ? req.query.tool.trim() : null;
    const db = getDb();
    let rows;
    let total;
    if (tool) {
      total = db
        .prepare('SELECT COUNT(*) AS n FROM content_tool_logs WHERE owner_user_id = ? AND tool_name = ?')
        .get(ownerUserId, tool).n;
      rows = db
        .prepare(
          'SELECT id, tool_name, source, request_payload, response_payload, status, owner_user_id, created_at FROM content_tool_logs WHERE owner_user_id = ? AND tool_name = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .all(ownerUserId, tool, limit, offset);
    } else {
      total = db.prepare('SELECT COUNT(*) AS n FROM content_tool_logs WHERE owner_user_id = ?').get(ownerUserId).n;
      rows = db
        .prepare(
          'SELECT id, tool_name, source, request_payload, response_payload, status, owner_user_id, created_at FROM content_tool_logs WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .all(ownerUserId, limit, offset);
    }
    res.json({ logs: rows, total, owner_user_id: ownerUserId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * DELETE /logs — cleanup content_tool_logs for signed-in CEO only.
 */
router.delete('/logs', attachAuthUser, requireAuth, (req, res) => {
  try {
    if (req.authUser.role === 'admin' && !req.authUser.impersonation) {
      return res.status(403).json({ error: 'Admin must impersonate a user to manage tool logs' });
    }
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    const db = getDb();
    const all = req.query.all === '1' || req.query.all === 'true';
    let deleted = 0;
    if (all) {
      const result = db.prepare('DELETE FROM content_tool_logs WHERE owner_user_id = ?').run(ownerUserId);
      deleted = result.changes;
    } else {
      const days = Math.max(0, parseInt(req.query.older_than_days, 10) || 7);
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const result = db
        .prepare('DELETE FROM content_tool_logs WHERE owner_user_id = ? AND created_at < ?')
        .run(ownerUserId, cutoff);
      deleted = result.changes;
    }
    res.json({ deleted, owner_user_id: ownerUserId });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.use(optionalAuth);

router.use(jobApplicantTools);

/**
 * POST /summarize-url
 * Body: { url: string }
 * Returns: { summary: string, title?: string, url?: string } or { error, hint?, tried_urls? }
 */
router.post('/summarize-url', async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = { url: req.body?.url };
  try {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) {
      logTool(req, 'summarize_url', requestPayload, { error: 'url is required' }, 'error', source);
      return res.status(400).json({ error: 'url is required' });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      logTool(req, 'summarize_url', requestPayload, { error: 'Invalid URL' }, 'error', source);
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:') {
      logTool(req, 'summarize_url', requestPayload, { error: 'Only HTTPS URLs are allowed' }, 'error', source);
      return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
    }

    const { timeoutMs, maxBytes, allowedDomains } = getSummarizeUrlConfig();
    if (allowedDomains && allowedDomains.length > 0) {
      const host = parsed.hostname.toLowerCase();
      if (!allowedDomains.some((d) => host === d || host.endsWith('.' + d))) {
        logTool(req, 'summarize_url', requestPayload, { error: 'URL domain not allowed' }, 'error', source);
        return res.status(400).json({ error: 'URL domain not allowed' });
      }
    }

    const candidates = summarizeUrlCandidates(url);
    const tried = [];
    let body = '';
    let usedUrl = url;
    let lastStatus = null;
    let fetchErr = null;

    for (const candidate of candidates) {
      try {
        const got = await fetchSummarizeUrlBody(candidate, { timeoutMs, maxBytes });
        tried.push({ url: candidate, status: got.status, ok: got.ok });
        if (got.ok && got.body) {
          body = got.body;
          usedUrl = got.finalUrl || candidate;
          lastStatus = got.status;
          break;
        }
        lastStatus = got.status;
      } catch (e) {
        fetchErr = e.name === 'AbortError' ? 'Request timeout' : 'Failed to fetch URL';
        tried.push({ url: candidate, error: fetchErr });
        if (e.name === 'AbortError') {
          logTool(req, 'summarize_url', requestPayload, { error: 'Request timeout', tried_urls: tried }, 'error', source);
          return res.status(504).json({ error: 'Request timeout', tried_urls: tried });
        }
      }
    }

    if (!body) {
      const remapped = candidates.find((c) => c !== url);
      const err = {
        error: lastStatus ? `Upstream returned ${lastStatus}` : fetchErr || 'Failed to fetch URL',
        tried_urls: tried,
        hint:
          'This URL may be retired or blocked. Try ≥3 other live domains (en.wikipedia.org, bbc.com, reuters.com, relevant *.gov.in), follow suggested_url if present, or use browser with profile="openclaw". Do not invent page content. Still deliver a brief with gaps noted if some sources work.',
        suggested_url: remapped || undefined,
      };
      logTool(req, 'summarize_url', requestPayload, err, 'error', source);
      return res.status(502).json(err);
    }

    const title = extractTitle(body);
    const rawText = stripHtml(body).slice(0, 50000);

    const ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
    const openai = getOpenAiConfig(ownerUserId);
    if (openai.apiKey && rawText.length > 100) {
      try {
        const { content: summaryText } = await chatCompletions({
          messages: [
            {
              role: 'user',
              content: `Summarize the following web page content in 2-4 concise sentences. Preserve key facts and links to the topic.\n\n${rawText.slice(0, 12000)}`,
            },
          ],
          modelOverride: openai.summaryModel || undefined,
          maxTokens: 300,
          ownerUserId,
        });
        const summary = (summaryText && summaryText.trim()) || rawText.slice(0, 500);
        const out = {
          summary,
          title: title || undefined,
          url: usedUrl,
          remapped: usedUrl !== url ? true : undefined,
        };
        logTool(req, 'summarize_url', { ...requestPayload, resolved_url: usedUrl }, out, 'ok', source);
        return res.json(out);
      } catch (_) {
        // fall through to raw extract
      }
    }

    const summary = rawText.slice(0, 1500).trim() || 'No text content could be extracted.';
    const out = {
      summary,
      title: title || undefined,
      url: usedUrl,
      remapped: usedUrl !== url ? true : undefined,
    };
    logTool(req, 'summarize_url', { ...requestPayload, resolved_url: usedUrl }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    logTool(req, 'summarize_url', requestPayload, { error: 'Internal error' }, 'error', source);
    res.status(500).json({ error: 'Internal error' });
  }
});

const GENERATED_MEDIA_DIR = getOpenClawMediaDir('generated');

function resolveImagePrompt(body) {
  const candidates = [body?.prompt, body?.description, body?.text, body?.image_prompt];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function buildImageApiBody(img, prompt) {
  const body = { model: img.model, prompt, n: 1, size: img.size };
  if (isGptImageModel(img.model)) {
    body.quality = mapGptImageQuality(img.quality);
    return body;
  }
  if (img.model === 'dall-e-3') {
    body.quality = img.quality;
    body.style = img.style;
    body.response_format = 'url';
    return body;
  }
  if (img.model === 'dall-e-2') {
    body.response_format = 'url';
    return body;
  }
  body.response_format = 'url';
  return body;
}

function persistGeneratedImage(b64Json, format = 'png') {
  const ext = String(format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(GENERATED_MEDIA_DIR, filename), Buffer.from(b64Json, 'base64'));
  return `/api/media/openclaw/generated/${filename}`;
}

async function persistRemoteImageUrl(remoteUrl) {
  const url = String(remoteUrl || '').trim();
  if (!url) throw new Error('empty image url');
  if (/^\/api\/media\//i.test(url)) return url;
  const imgRes = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!imgRes.ok) throw new Error(`Failed to download image (${imgRes.status})`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const ct = String(imgRes.headers.get('content-type') || '').toLowerCase();
  let ext = 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) ext = 'jpg';
  else if (ct.includes('webp')) ext = 'webp';
  else if (ct.includes('gif')) ext = 'gif';
  else {
    const fromPath = extname(new URL(url).pathname || '').replace('.', '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(fromPath)) {
      ext = fromPath === 'jpeg' ? 'jpg' : fromPath;
    }
  }
  mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(GENERATED_MEDIA_DIR, filename), buf);
  return `/api/media/openclaw/generated/${filename}`;
}

async function imageResultFromApi(data) {
  const item = data?.data?.[0];
  if (!item) return { error: 'No image in response' };
  if (item.b64_json) {
    const format = data?.output_format || 'png';
    return { url: persistGeneratedImage(item.b64_json, format) };
  }
  if (item.url) {
    try {
      return { url: await persistRemoteImageUrl(item.url) };
    } catch (e) {
      // Fall back to remote URL so the agent still gets something, but prefer local.
      return { url: item.url, warning: e.message };
    }
  }
  return { error: 'No image URL in response' };
}

/**
 * Phase 2: POST /generate-image — OpenAI-compatible (GPT-image / DALL·E). Primary then secondary endpoint/key/model.
 * Body: { prompt, style_hint? }. Returns: { url } or { error }.
 */
router.post('/generate-image', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-request-source'] || null;
  const prompt = resolveImagePrompt(req.body);
  const styleHint = typeof req.body?.style_hint === 'string' ? req.body.style_hint.trim() : '';
  const requestPayload = { prompt, style_hint: styleHint || undefined };
  try {
    if (!prompt) {
      logTool(req,'generate_image', requestPayload, { error: 'prompt is required' }, 'error', source);
      return res.status(400).json({ error: 'prompt is required' });
    }
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
    const { primary, secondary } = getImageConfig(ownerUserId);
    const endpoints = [primary, secondary].filter((ep) => ep && ep.apiKey);
    if (endpoints.length === 0) {
      logTool(req,'generate_image', requestPayload, { error: 'Image generation not configured (OPENAI_API_KEY or primary/secondary)' }, 'error', source);
      return res.status(503).json({ error: 'Image generation not configured. Set OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY (and optionally OPENAI_SECONDARY_*).' });
    }
    let fullPrompt = prompt;
    if (styleHint) fullPrompt = `${prompt}. Style: ${styleHint}`;
    let lastErr;
    for (const img of endpoints) {
      const cappedPrompt = fullPrompt.slice(0, img.maxPromptChars);
      const body = buildImageApiBody(img, cappedPrompt);
      try {
        const imgRes = await fetch(`${img.apiUrl.replace(/\/$/, '')}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${img.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120000),
        });
        const data = await imgRes.json().catch(() => ({}));
        if (!imgRes.ok) {
          lastErr = data?.error?.message || data?.error || imgRes.statusText;
          continue;
        }
        const result = await imageResultFromApi(data);
        if (result.error) {
          lastErr = result.error;
          continue;
        }
        const out = { url: result.url };
        logTool(req,'generate_image', requestPayload, out, 'ok', source);
        return res.json(out);
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
      }
    }
    logTool(req,'generate_image', requestPayload, { error: lastErr }, 'error', source);
    return res.status(502).json({ error: lastErr || 'Image API error' });
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
    logTool(req,'generate_image', requestPayload, { error: errMsg }, 'error', source);
    return res.status(500).json({ error: errMsg });
  }
});

/**
 * Vedic / Jyotish ephemeris: sidereal positions + suggested chart_spec for generate_chart.
 * Body: birth_date, birth_time, timezone_offset_hours, latitude, longitude, place_name?,
 *       ayanamsa?, chart_style?, include_navamsa?, include_dasha?
 */
router.post('/vedic-compute-chart', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-request-source'] || null;
  const requestPayload = req.body || {};
  try {
    const { computeVedicChart } = await import('../services/vedic-chart.js');
    mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
    const out = computeVedicChart(req.body || {}, { mediaDir: GENERATED_MEDIA_DIR });
    logTool(req, 'vedic_compute_chart', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const errMsg = e.message || 'Chart computation failed';
    logTool(req, 'vedic_compute_chart', requestPayload, { error: errMsg }, 'error', source);
    res.status(400).json({ error: errMsg });
  }
});

/**
 * Generic chart renderer from chart_spec JSON (schema_version 1.0).
 * Body: { spec: { schema_version, charts: [...] } } or the spec object itself.
 * Pass return_schema: true to receive the JSON schema without rendering.
 */
router.post('/generate-chart', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-request-source'] || null;
  const requestPayload = req.body || {};
  try {
    const {
      generateChartsFromSpec,
      chartSpecSchemaSummary,
    } = await import('../services/chart-spec.js');
    if (req.body?.return_schema === true || req.body?.schema_only === true) {
      const out = chartSpecSchemaSummary();
      logTool(req, 'generate_chart', requestPayload, { schema_only: true }, 'ok', source);
      return res.json(out);
    }
    mkdirSync(GENERATED_MEDIA_DIR, { recursive: true });
    const out = generateChartsFromSpec(req.body || {}, { mediaDir: GENERATED_MEDIA_DIR });
    logTool(req, 'generate_chart', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const errMsg = e.message || 'Chart generation failed';
    logTool(req, 'generate_chart', requestPayload, { error: errMsg }, 'error', source);
    res.status(400).json({ error: errMsg });
  }
});

/**
 * Phase 3: POST /generate-video — Replicate (async). Primary then secondary endpoint/token/model.
 * Body: { prompt, duration_sec? }. Returns: { job_id, status, url? } or { error }.
 */
router.post('/generate-video', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-request-source'] || null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const requestPayload = req.body || {};
  try {
    if (!prompt) {
      logTool(req,'generate_video', requestPayload, { error: 'prompt is required' }, 'error', source);
      return res.status(400).json({ error: 'prompt is required' });
    }
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
    const { primary, secondary } = getVideoConfig(ownerUserId);
    const endpoints = [primary, secondary].filter((ep) => ep && ep.apiToken && ep.modelVersion);
    if (endpoints.length === 0) {
      logTool(req,'generate_video', requestPayload, { error: 'Video generation not configured (REPLICATE_API_TOKEN or primary/secondary)' }, 'error', source);
      return res.status(503).json({ error: 'Video generation not configured. Set REPLICATE_API_TOKEN (and optionally REPLICATE_SECONDARY_*).' });
    }
    let lastErr;
    for (const vid of endpoints) {
      const cappedPrompt = prompt.slice(0, vid.maxPromptChars);
      try {
        const createRes = await fetch(`${vid.apiUrl.replace(/\/$/, '')}/predictions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${vid.apiToken}`,
          },
          body: JSON.stringify({
            version: vid.modelVersion,
            input: { prompt: cappedPrompt },
          }),
          signal: AbortSignal.timeout(15000),
        });
        const pred = await createRes.json().catch(() => ({}));
        if (!createRes.ok) {
          lastErr = pred?.detail || pred?.error || createRes.statusText || 'Replicate API error';
          continue;
        }
        const jobId = pred.id;
        const status = pred.status || 'starting';
        let url = null;
        if (pred.output && (Array.isArray(pred.output) ? pred.output[0] : pred.output)) {
          const outVal = Array.isArray(pred.output) ? pred.output[0] : pred.output;
          url = typeof outVal === 'string' ? outVal : outVal?.url || null;
        }
        const out = { job_id: jobId, status, url: url || undefined };
        logTool(req,'generate_video', requestPayload, out, 'ok', source);
        return res.json(out);
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
      }
    }
    logTool(req,'generate_video', requestPayload, { error: lastErr }, 'error', source);
    return res.status(502).json({ error: lastErr || 'Replicate API error' });
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
    logTool(req,'generate_video', requestPayload, { error: errMsg }, 'error', source);
    return res.status(500).json({ error: errMsg });
  }
});

/**
 * Kanban tool: move task status. Any agent can move status of a task they are assigned to; COO can move any task.
 * Logged to content_tool_logs.
 */
router.post('/kanban-move-status', optionalAuth, (req, res) => {
  let source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const taskId = Number(requestPayload.task_id);
  const newStatus = (requestPayload.new_status || requestPayload.status || '').toString().trim();
  try {
    if (!taskId || !KANBAN_STATUSES.includes(newStatus)) {
      const err = { error: 'task_id and new_status required; new_status one of: ' + KANBAN_STATUSES.join(', ') };
      logTool(req,'kanban_move_status', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const db = getDb();
    const task = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    if (!task) {
      const err = { error: 'Task not found' };
      logTool(req,'kanban_move_status', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    try {
      assertToolOwnsKanbanTask(req, task, requestPayload);
    } catch (e) {
      const err = { error: e.message };
      logTool(req, 'kanban_move_status', requestPayload, err, 'error', source);
      return res.status(e.status || 403).json(err);
    }
    let caller = getCallerAgent(req);
    // When invoked from gateway plugin without agent id: allow move if request is internal (from our /invoke) and task has assigned agent
    if (!caller && task.assigned_agent_id && isInternalRequest(req)) {
      caller = db.prepare('SELECT id, name, is_coo FROM agents WHERE LOWER(id) = LOWER(?) OR LOWER(openclaw_agent_id) = LOWER(?)').get(task.assigned_agent_id, task.assigned_agent_id) || null;
      if (caller) source = caller.id;
    }
    const cooId = getCooAgentId();
    const isCoo = caller && caller.is_coo;
    const isAssigned = task.assigned_agent_id && caller && (task.assigned_agent_id === caller.id || task.assigned_agent_id === caller.name);
    if (!isCoo && !isAssigned) {
      const err = { error: 'Only COO or the assigned agent can move this task status' };
      logTool(req,'kanban_move_status', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    db.prepare("UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, taskId);
    if (newStatus === 'completed' || newStatus === 'failed') {
      clearKanbanTaskNotification(taskId);
    }
    const out = { ok: true, task_id: taskId, status: newStatus };
    logTool(req,'kanban_move_status', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'kanban_move_status', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Kanban tool: reassign task to COO. Only non-COO agents (assigned agent can hand back to COO).
 */
router.post('/kanban-reassign-to-coo', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const taskId = Number(requestPayload.task_id);
  try {
    if (!taskId) {
      const err = { error: 'task_id required' };
      logTool(req,'kanban_reassign_to_coo', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const caller = getCallerAgent(req);
    if (caller && caller.is_coo) {
      const err = { error: 'COO cannot use reassign-to-coo; use assign-task to assign to another agent' };
      logTool(req,'kanban_reassign_to_coo', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const cooId = getCooAgentId();
    if (!cooId) {
      const err = { error: 'No COO agent in system' };
      logTool(req,'kanban_reassign_to_coo', requestPayload, err, 'error', source);
      return res.status(502).json(err);
    }
    const db = getDb();
    const task = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    if (!task) {
      const err = { error: 'Task not found' };
      logTool(req,'kanban_reassign_to_coo', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    try {
      assertToolOwnsKanbanTask(req, task, requestPayload);
    } catch (e) {
      const err = { error: e.message };
      logTool(req, 'kanban_reassign_to_coo', requestPayload, err, 'error', source);
      return res.status(e.status || 403).json(err);
    }
    db.prepare("UPDATE kanban_tasks SET assigned_agent_id = ?, status = 'open', updated_at = datetime('now') WHERE id = ?").run(cooId, taskId);
    const out = { ok: true, task_id: taskId, assigned_agent_id: cooId };
    logTool(req,'kanban_reassign_to_coo', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'kanban_reassign_to_coo', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Kanban tool: create a task for the CEO (any granted agent may use if tool is granted).
 * Body: title (required), description?, assign_to? (agent id | "coo" | omit for CEO inbox).
 */
router.post('/kanban-create-task', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!caller) {
      const err = { error: 'Calling agent required (x-openclaw-agent-id)' };
      logTool(req, 'kanban_create_task', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const title = String(requestPayload.title || '').trim();
    if (!title) {
      const err = { error: 'title required' };
      logTool(req, 'kanban_create_task', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId =
      resolveToolOwnerUserIdOrNull(req, requestPayload, resolveAuthenticatedCeoUserId) ||
      parseTenantOpenClawAgentId(source)?.ceoUserId ||
      null;
    if (!ownerUserId) {
      const err = { error: 'ceo_user_id could not be resolved for Kanban task' };
      logTool(req, 'kanban_create_task', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const descriptionRaw = String(requestPayload.description || '').trim();
    const description = [
      descriptionRaw,
      '',
      `owner_user_id: ${ownerUserId}`,
      `created_by_agent: ${caller.id}`,
    ]
      .filter((line, i, arr) => !(line === '' && i === 0))
      .join('\n')
      .trim();

    let assignedAgentId = null;
    const assignTo = String(requestPayload.assign_to || requestPayload.assigned_agent_id || '')
      .trim()
      .toLowerCase();
    if (assignTo && assignTo !== 'coo' && assignTo !== 'ceo') {
      const db = getDb();
      const agent = db
        .prepare('SELECT id FROM agents WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?')
        .get(assignTo, assignTo);
      if (!agent) {
        const err = { error: `assign_to agent not found: ${assignTo}` };
        logTool(req, 'kanban_create_task', requestPayload, err, 'error', source);
        return res.status(404).json(err);
      }
      assignedAgentId = agent.id;
    }

    const status = assignedAgentId ? 'awaiting_confirmation' : 'open';
    const db = getDb();
    db.prepare(
      `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, due_date, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(title, description, status, assignedAgentId, caller.id, null, ownerUserId);
    const row = db.prepare('SELECT * FROM kanban_tasks ORDER BY id DESC LIMIT 1').get();
    notifyKanbanTaskCreated({ userId: ownerUserId, task: row });
    const out = {
      ok: true,
      task_id: row.id,
      title: row.title,
      status: row.status,
      assigned_agent_id: row.assigned_agent_id,
      owner_user_id: ownerUserId,
      created_by: row.created_by,
    };
    logTool(req, 'kanban_create_task', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'kanban_create_task', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Kanban tool: assign task to an agent. Only COO can assign to another agent.
 */
router.post('/kanban-assign-task', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const taskId = Number(requestPayload.task_id);
  const toAgentId = (requestPayload.to_agent_id || requestPayload.agent_id || '').toString().trim().toLowerCase();
  try {
    if (!taskId || !toAgentId) {
      const err = { error: 'task_id and to_agent_id required' };
      logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can assign a task to another agent' };
      logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const db = getDb();
    const agent = db.prepare('SELECT id FROM agents WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?').get(toAgentId, toAgentId);
    if (!agent) {
      const err = { error: 'Agent not found' };
      logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    const task = db.prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
    if (!task) {
      const err = { error: 'Task not found' };
      logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    try {
      assertToolOwnsKanbanTask(req, task, requestPayload);
    } catch (e) {
      const err = { error: e.message };
      logTool(req, 'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(e.status || 403).json(err);
    }
    db.prepare("UPDATE kanban_tasks SET assigned_agent_id = ?, status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?").run(agent.id, taskId);
    const out = { ok: true, task_id: taskId, assigned_agent_id: agent.id };
    logTool(req,'kanban_assign_task', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * emailSend — send email and optional calendar/meeting invites to one or many recipients.
 * Body: { to, cc?, bcc?, subject, body, calendar?: { title, start, end, location?, description?, organizer?, attendees? } }
 */
router.post('/email-send', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const out = await executeEmailSend(requestPayload);
    const status = out.sent ? 'ok' : out.attempted ? 'error' : 'error';
    logTool(req, 'email_send', requestPayload, out, status, source);
    if (!out.sent && out.error) return res.status(out.attempted ? 502 : 400).json(out);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'email_send', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * notifyCeo — in-app push notification to the entitled CEO user for this session.
 * Body: { title, body?, link_url?, source_key? }. Never accepts target user_id (owner from session).
 */
router.post('/notify-ceo', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'notify_ceo', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    // COO must not notify "on behalf of" a specialist — re-attribute to the specialist.
    let out = null;
    if (caller?.is_coo) {
      out = tryRewriteCooNotifyAsSpecialist(ownerUserId, requestPayload, caller);
      if (out?.sent) {
        logTool(
          req,
          'notify_ceo',
          { ...requestPayload, owner_user_id: ownerUserId, rewritten_from_coo: true },
          out,
          'ok',
          source
        );
        return res.json({ ...out, rewritten_from_coo: true });
      }
    }
    out = executeNotifyCeo(requestPayload, {
      ownerUserId,
      callerAgentId: caller?.id || source || null,
      callerAgentName: caller?.name || null,
    });
    const status = out.sent ? 'ok' : 'error';
    logTool(req, 'notify_ceo', { ...requestPayload, owner_user_id: ownerUserId }, out, status, source);
    if (!out.sent) return res.status(400).json(out);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'notify_ceo', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * ceo_profile — entitled CEO platform account fields (name, email, mobile, …).
 * Body: { fields?: string[] }. Never accepts target user_id (owner from session).
 */
router.post('/ceo-profile', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'ceo_profile', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const out = executeCeoProfile(requestPayload, { ownerUserId });
    const status = out.ok ? 'ok' : 'error';
    logTool(req, 'ceo_profile', { ...requestPayload, owner_user_id: ownerUserId }, out, status, source);
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'ceo_profile', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * status_checker — COO only. Reconcile A2A Kanban, post digest to standup, return HTML/markdown.
 * Does NOT email — email is reserved for the daily batch cron (`COO_STATUS_CHECKER_CRON`).
 * Body: { post_standup?: boolean }
 */
router.post('/status-checker', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can use status_checker' };
      logTool(req, 'status_checker', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'status_checker', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const postStandup = requestPayload.post_standup !== false && requestPayload.postStandup !== false;
    // Force email off even if the caller passes email:true — batch cron only.
    const out = await runCooStatusChecker(ownerUserId, { email: false, postStandup });
    const result = {
      ok: true,
      owner_user_id: ownerUserId,
      standup_id: out.standup_id,
      counts: out.digest.counts,
      digest: out.digest,
      html: out.html,
      markdown: out.markdown,
      sync_changes: out.digest.sync_changes?.length || 0,
      email: { skipped: true, reason: 'batch_only' },
    };
    logTool(req, 'status_checker', { ...requestPayload, owner_user_id: ownerUserId }, result, 'ok', source);
    res.json(result);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'status_checker', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

function resolveMasterDataOwnerOr403(req, res, toolName, requestPayload, source) {
  const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
  if (!ownerUserId) {
    const err = { error: 'Could not resolve CEO user for master data (session-scoped only)' };
    logTool(req, toolName, requestPayload, err, 'error', source);
    res.status(403).json(err);
    return null;
  }
  return ownerUserId;
}

/**
 * master_data_list_tables — list this CEO's master tables with purpose/description + columns.
 * Agents must not create/alter/drop tables via tools.
 */
router.post('/master-data-list-tables', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    assertNoSchemaMutation(requestPayload.action);
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_list_tables', requestPayload, source);
    if (!ownerUserId) return;
    const out = listTablesForAgent(ownerUserId);
    logTool(req, 'master_data_list_tables', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'master_data_list_tables', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * master_data_list_rows — list or keyword-query rows in a master table (table_name or table_id).
 */
router.post('/master-data-list-rows', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    assertNoSchemaMutation(requestPayload.action);
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_list_rows', requestPayload, source);
    if (!ownerUserId) return;
    const out = listRowsForAgent(ownerUserId, requestPayload);
    logTool(req, 'master_data_list_rows', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'master_data_list_rows', requestPayload, err, 'error', source);
    const status = /not found/i.test(e.message) ? 404 : 400;
    res.status(status).json(err);
  }
});

/**
 * master_data_insert_row — insert a row into an existing master table (no schema change).
 */
router.post('/master-data-insert-row', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    assertNoSchemaMutation(requestPayload.action);
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_insert_row', requestPayload, source);
    if (!ownerUserId) return;
    const out = insertRowForAgent(ownerUserId, requestPayload);
    logTool(req, 'master_data_insert_row', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.status(201).json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'master_data_insert_row', requestPayload, err, 'error', source);
    const status = /not found/i.test(e.message) ? 404 : 400;
    res.status(status).json(err);
  }
});

/**
 * master_data_update_row — update a row by row_id in an existing master table.
 */
router.post('/master-data-update-row', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    assertNoSchemaMutation(requestPayload.action);
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_update_row', requestPayload, source);
    if (!ownerUserId) return;
    const out = updateRowForAgent(ownerUserId, requestPayload);
    logTool(req, 'master_data_update_row', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'master_data_update_row', requestPayload, err, 'error', source);
    const status = /not found/i.test(e.message) ? 404 : 400;
    res.status(status).json(err);
  }
});

/**
 * master_data_delete_row — delete a row by row_id (never drops the table).
 */
router.post('/master-data-delete-row', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    assertNoSchemaMutation(requestPayload.action);
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_delete_row', requestPayload, source);
    if (!ownerUserId) return;
    const out = deleteRowForAgent(ownerUserId, requestPayload);
    logTool(req, 'master_data_delete_row', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'master_data_delete_row', requestPayload, err, 'error', source);
    const status = /not found/i.test(e.message) ? 404 : 400;
    res.status(status).json(err);
  }
});

/**
 * master_data_list_documents — list this CEO's uploaded master-data documents.
 */
router.post('/master-data-list-documents', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_list_documents', requestPayload, source);
    if (!ownerUserId) return;
    const out = await listDocumentsForAgent(ownerUserId, {
      source,
      agentId: source || requestPayload.agent_id || requestPayload.agentId || null,
    });
    logTool(req, 'master_data_list_documents', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code || undefined };
    logTool(req, 'master_data_list_documents', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/**
 * master_data_rag — keyword RAG over this CEO's documents (+ optional LLM summary).
 */
router.post('/master-data-rag', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveMasterDataOwnerOr403(req, res, 'master_data_rag', requestPayload, source);
    if (!ownerUserId) return;
    const out = await ragDocumentsForAgent(ownerUserId, {
      ...requestPayload,
      source,
      agentId: source || requestPayload.agent_id || requestPayload.agentId || null,
    });
    logTool(req, 'master_data_rag', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code || undefined };
    logTool(req, 'master_data_rag', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/**
 * Learnings summary: summarize past user feedback + Kanban approve/reject/comments for this owner+agent.
 * Body: topic (optional), days (default 30), agent_id (optional — defaults to caller).
 * Owner always from session/tenant — never body spoof.
 */
router.post('/learnings-summary', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve owner user for learnings summary' };
      logTool(req, 'learnings_summary', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const topic = (requestPayload.topic || requestPayload.prompt || requestPayload.query || '').toString().trim();
    const days = requestPayload.days != null ? Number(requestPayload.days) : 30;
    let agentId =
      (requestPayload.agent_id || requestPayload.agentId || '').toString().trim() ||
      (caller?.id ? String(caller.id) : null);
    const force =
      requestPayload.force === true ||
      requestPayload.refresh === true ||
      String(requestPayload.force || requestPayload.refresh || '').toLowerCase() === 'true';
    const out = await summarizeLearnings({
      ownerUserId,
      agentId,
      topic,
      days,
      force,
    });
    logTool(req, 'learnings_summary', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'learnings_summary', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Intent classify and delegate: COO only. Runs intent classification and creates delegation + kanban tasks.
 * Body: message (required), standup_id (optional; if omitted, creates a new standup).
 */
router.post('/intent-classify-and-delegate', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const message = (requestPayload.message || requestPayload.prompt || '').toString().trim();
  let standupId = requestPayload.standup_id != null ? Number(requestPayload.standup_id) : null;
  try {
    if (!message) {
      const err = { error: 'message required' };
      logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can use intent-classify-and-delegate' };
      logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (standupId == null) {
      standupId = getOrCreateDelegationHubStandup(ownerUserId);
    } else {
      const db = getDb();
      const standup = db.prepare('SELECT id, owner_user_id, source FROM standups WHERE id = ?').get(standupId);
      if (!standup) {
        const err = { error: 'Standup not found' };
        logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
        return res.status(404).json(err);
      }
      if (standup.owner_user_id && standup.owner_user_id !== ownerUserId) {
        const err = { error: 'Standup belongs to another CEO' };
        logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
    }
    const result = await scheduleCeoRequestViaOpenClawCron(standupId, message, ownerUserId);
    const out = {
      ok: true,
      request_id: result.requestId,
      count: result.count,
      agent_names: result.agentNames,
      kanban_task_ids: result.kanbanTaskIds || [],
    };
    logTool(req,'intent_classify_and_delegate', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Enquire / list content tools by purpose (Workflow Builder).
 * Helps recommend which registered tool fits a user intent when building tool nodes.
 */
router.post('/content-tools-enquire', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller) && !(caller && caller.is_coo)) {
      const err = { error: 'Only Workflow Builder (or COO) can enquire content tools via this tool' };
      logTool(req, 'content_tools_enquire', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const query =
      requestPayload.query ||
      requestPayload.description ||
      requestPayload.message ||
      requestPayload.q ||
      requestPayload.purpose ||
      '';
    if (!String(query).trim() && !requestPayload.all) {
      const err = { error: 'query required (or pass all: true to list every enabled content tool)' };
      logTool(req, 'content_tools_enquire', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ranked = meta.enquireContentTools(query, {
      all: requestPayload.all === true,
      limit: requestPayload.limit,
    });
    const out = { ok: true, ...ranked };
    logTool(req, 'content_tools_enquire', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'content_tools_enquire', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

function resolveConnectorOwner(req, body = {}) {
  return resolveAuthenticatedCeoUserId(req, bodyWithoutSpoofedOwner(body));
}

function connectorToolError(req, toolName, requestPayload, res, e, source) {
  const err = { error: e.message };
  logTool(req, toolName, requestPayload, err, 'error', source);
  res.status(e.status || 400).json(err);
}

/**
 * OpenConnector content tools — same façade as workflow connector nodes.
 * Owner is always the entitled CEO from session (never spoof ceo_user_id).
 */
router.post('/connector-list-apps', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const out = { ok: true, ...(await getConnectedConnectorApps(ownerUserId)) };
    logTool(req, 'connector_list_apps', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    connectorToolError(req, 'connector_list_apps', requestPayload, res, e, source);
  }
});

router.post('/connector-search-actions', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const query =
      requestPayload.query ||
      requestPayload.q ||
      requestPayload.description ||
      requestPayload.message ||
      '';
    const out = {
      ok: true,
      ...(await searchConnectorApps(ownerUserId, query)),
    };
    logTool(req, 'connector_search_actions', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    connectorToolError(req, 'connector_search_actions', requestPayload, res, e, source);
  }
});

router.post('/connector-get-action-guide', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const actionId = String(
      requestPayload.action_id || requestPayload.actionId || requestPayload.id || ''
    ).trim();
    if (!actionId) {
      const err = { error: 'action_id required' };
      logTool(req, 'connector_get_action_guide', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const out = { ok: true, ...(await getConnectorActionGuide(ownerUserId, actionId)) };
    logTool(req, 'connector_get_action_guide', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    connectorToolError(req, 'connector_get_action_guide', requestPayload, res, e, source);
  }
});

router.post('/connector-execute-action', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const actionId = String(
      requestPayload.action_id || requestPayload.actionId || requestPayload.id || ''
    ).trim();
    if (!actionId) {
      const err = { error: 'action_id required' };
      logTool(req, 'connector_execute_action', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const input =
      requestPayload.input && typeof requestPayload.input === 'object' ? requestPayload.input : {};
    const out = {
      ok: true,
      ...(await executeConnectorAction(ownerUserId, actionId, input, {
        connectionName: requestPayload.connection_name || requestPayload.connectionName || '',
      })),
    };
    logTool(req, 'connector_execute_action', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    connectorToolError(req, 'connector_execute_action', requestPayload, res, e, source);
  }
});

/**
 * Enquire about workflows by description or natural-language query (COO or Workflow Builder).
 * Owner is always the entitled CEO from session — never body spoof fields.
 */
router.post('/agent-workflow-enquire', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO or Workflow Builder can enquire about agent workflows' };
      logTool(req,'agent_workflow_enquire', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const query =
      requestPayload.query ||
      requestPayload.description ||
      requestPayload.message ||
      requestPayload.q ||
      '';
    if (!String(query).trim() && !requestPayload.all) {
      const err = { error: 'query or description required (or pass all: true to list every published workflow)' };
      logTool(req,'agent_workflow_enquire', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const includeDrafts = isWorkflowBuilderCaller(caller) && requestPayload.include_drafts !== false;
    const out = {
      ok: true,
      ceo_user_id: ownerUserId,
      ...enquireWorkflows(ownerUserId, query, {
        limit: requestPayload.limit,
        all: requestPayload.all === true,
        includeDrafts,
      }),
    };
    logTool(req,'agent_workflow_enquire', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'agent_workflow_enquire', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * List or inspect recent agent workflow runs (COO or Workflow Builder).
 * Owner-scoped via session entitlements — never use IBKR tools for workflow run status.
 */
router.post('/agent-workflow-runs', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO or Workflow Builder can list agent workflow runs' };
      logTool(req, 'agent_workflow_runs', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = executeAgentWorkflowRuns(bodyWithoutSpoofedOwner(requestPayload), { ownerUserId });
    const status = out.ok ? 'ok' : 'error';
    logTool(req, 'agent_workflow_runs', { ...requestPayload, owner_user_id: ownerUserId }, out, status, source);
    if (!out.ok) return res.status(out.error?.includes('not found') ? 404 : 400).json(out);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_runs', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * List agent workflows (COO or Workflow Builder). Owner-scoped via session entitlements.
 * Workflow Builder includes drafts by default; COO sees published (non-paused) only.
 */
router.post('/agent-workflow-list', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO or Workflow Builder can list agent workflows' };
      logTool(req,'agent_workflow_list', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const chatOnly = requestPayload.chat_only === true || requestPayload.chatOnly === true;
    const includeDrafts =
      isWorkflowBuilderCaller(caller) &&
      requestPayload.include_drafts !== false &&
      requestPayload.includeDrafts !== false;
    const workflows = listWorkflowsForAgent(ownerUserId, { chatOnly, includeDrafts });
    const out = {
      ok: true,
      ceo_user_id: ownerUserId,
      chat_only: chatOnly,
      include_drafts: includeDrafts,
      workflows,
      count: workflows.length,
    };
    logTool(req,'agent_workflow_list', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'agent_workflow_list', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Trigger a published agent workflow by chat phrase or workflow_id (COO or Workflow Builder).
 */
router.post('/agent-workflow-trigger', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO or Workflow Builder can trigger agent workflows' };
      logTool(req,'agent_workflow_trigger', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const message = (requestPayload.message || requestPayload.input || '').toString().trim();
    const workflowId = requestPayload.workflow_id || requestPayload.workflowId || null;
    if (!message && !workflowId) {
      const err = { error: 'message or workflow_id required' };
      logTool(req,'agent_workflow_trigger', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const run = await triggerAgentWorkflowForOwner(ownerUserId, {
      message,
      workflow_id: workflowId,
      input: message,
      actor: {
        id: caller.id,
        name: caller.name,
        type: isWorkflowBuilderCaller(caller) ? 'workflow_builder' : 'coo',
      },
    });
    const out = {
      ok: true,
      run_id: run.id,
      run_number: run.run_number,
      definition_id: run.definition_id,
      definition_name: run.definition_name,
      status: run.status,
      ceo_user_id: ownerUserId,
    };
    logTool(req,'agent_workflow_trigger', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message, details: e.details || undefined };
    logTool(req,'agent_workflow_trigger', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Get workflow draft graph (Workflow Builder agent only).
 */
router.post('/agent-workflow-get-draft', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller)) {
      const err = { error: 'Only Workflow Builder agent can get workflow drafts via this tool' };
      logTool(req,'agent_workflow_get_draft', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const workflowId = requestPayload.workflow_id || requestPayload.workflowId;
    if (!workflowId) {
      const err = { error: 'workflow_id required' };
      logTool(req,'agent_workflow_get_draft', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = { ok: true, ...getWorkflowDraftForAgent(ownerUserId, workflowId) };
    logTool(req,'agent_workflow_get_draft', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'agent_workflow_get_draft', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Mutate workflow draft (Workflow Builder agent only).
 */
router.post('/agent-workflow-mutate', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller)) {
      const err = { error: 'Only Workflow Builder agent can mutate workflows via this tool' };
      logTool(req,'agent_workflow_mutate', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const actions = requestPayload.actions;
    if (!Array.isArray(actions) || !actions.length) {
      const err = { error: 'actions array required' };
      logTool(req,'agent_workflow_mutate', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const result = await applyWorkflowBuilderActions(
      ownerUserId,
      requestPayload.workflow_id || requestPayload.workflowId || null,
      actions,
      { id: caller.id, name: caller.name, type: 'workflow_builder' }
    );
    const out = { ok: true, ...result };
    logTool(req,'agent_workflow_mutate', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req,'agent_workflow_mutate', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Start autonomous certify job (Workflow Builder). Async Maker/Checker loop.
 */
router.post('/agent-workflow-certify-start', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller)) {
      const err = { error: 'Only Workflow Builder agent can start certify jobs' };
      logTool(req, 'agent_workflow_certify_start', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const { startCertifyJob } = await import('../services/agent-workflow-certify.js');
    const out = startCertifyJob({
      ownerUserId,
      message: requestPayload.message || requestPayload.intent || requestPayload.prompt || '',
      workflowId: requestPayload.workflow_id || requestPayload.workflowId || null,
      goal: requestPayload.goal || null,
      actor: { id: caller.id, name: caller.name, type: 'workflow_builder' },
      async: requestPayload.async !== false,
      maxAttempts: requestPayload.max_attempts || requestPayload.maxAttempts || null,
    });
    logTool(req, 'agent_workflow_certify_start', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_certify_start', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Poll certify job status (Workflow Builder). Pull-on-request updates.
 */
router.post('/agent-workflow-certify-status', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller) && !caller?.is_coo) {
      const err = { error: 'Workflow Builder or COO required for certify status' };
      logTool(req, 'agent_workflow_certify_status', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const { getCertifyStatusForOwner, formatCertifyReply, getCertifyJob } = await import(
      '../services/agent-workflow-certify.js'
    );
    const status = getCertifyStatusForOwner(ownerUserId, {
      jobId: requestPayload.job_id || requestPayload.jobId || null,
      workflowId: requestPayload.workflow_id || requestPayload.workflowId || null,
      query: requestPayload.query || requestPayload.message || null,
    });
    if (!status.ok) {
      logTool(req, 'agent_workflow_certify_status', requestPayload, status, 'error', source);
      return res.status(404).json(status);
    }
    const job = getCertifyJob(status.job_id, ownerUserId);
    const out = { ...status, reply: formatCertifyReply(job) };
    logTool(req, 'agent_workflow_certify_status', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_certify_status', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Resume blocked certify job after providing inputs (Workflow Builder).
 */
router.post('/agent-workflow-certify-resume', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!isWorkflowBuilderCaller(caller)) {
      const err = { error: 'Only Workflow Builder agent can resume certify jobs' };
      logTool(req, 'agent_workflow_certify_resume', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const jobId = requestPayload.job_id || requestPayload.jobId;
    if (!jobId) {
      const err = { error: 'job_id required' };
      logTool(req, 'agent_workflow_certify_resume', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const { resumeCertifyJob } = await import('../services/agent-workflow-certify.js');
    const out = await resumeCertifyJob({
      ownerUserId,
      jobId,
      inputs: requestPayload.inputs || requestPayload.input || {},
      actor: { id: caller.id, name: caller.name, type: 'workflow_builder' },
    });
    logTool(req, 'agent_workflow_certify_resume', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_certify_resume', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * POST /invoke — invoke a tool by name (used by OpenClaw plugin). Body: { tool_name, caller_agent_id?, ...params }.
 * Uses x-openclaw-agent-id header or body.caller_agent_id so Kanban tools can authorize the calling agent.
 */
router.post('/invoke', requireToolsAccess, async (req, res) => {
  let source = (req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || '').toString().trim() || null;
  if (!source && req.body && (req.body.caller_agent_id != null || req.body.x_openclaw_agent_id != null)) {
    source = String(req.body.caller_agent_id ?? req.body.x_openclaw_agent_id).trim() || null;
  }
  try {
    const toolName = (req.body?.tool_name || req.body?.toolName || '').trim();
    if (!toolName) return res.status(400).json({ error: 'tool_name required' });
    const row = meta.getToolMeta(toolName);
    if (!row) return res.status(404).json({ error: 'Tool not found' });
    if (!row.enabled) {
      logTool(req,toolName, req.body, { error: 'Tool is disabled' }, 'error', source);
      return res.status(403).json({ error: 'Tool is disabled' });
    }
    const grantCheck = assertCallerMayUseTool(source, toolName);
    if (!grantCheck.ok) {
      logTool(req,toolName, req.body, { error: grantCheck.error }, 'error', source);
      return res.status(403).json({ error: grantCheck.error });
    }
    const tenant = source ? parseTenantOpenClawAgentId(source) : null;
    if (tenant) {
      const sessionOwner = resolveOwnerFromOpenClawSession(req);
      if (sessionOwner && sanitizeTenantId(sessionOwner) !== sanitizeTenantId(tenant.ceoUserId)) {
        const err = `Tenant mismatch: session owner ${sessionOwner} vs agent ${source}`;
        logTool(req, toolName, req.body, { error: err }, 'error', source);
        return res.status(403).json({ error: err });
      }
    }
    const params = { ...req.body };
    delete params.tool_name;
    delete params.toolName;
    delete params.caller_agent_id;
    delete params.x_openclaw_agent_id;
    const baseUrl = getBackendBaseUrl();
    let targetUrl = row.endpoint;
    if (targetUrl.startsWith('/')) targetUrl = baseUrl + targetUrl;
    const method = (row.method || 'POST').toUpperCase();
    // Default base=USD for Frankfurter API when agent omits it
    if (method === 'GET' && targetUrl.includes('frankfurter') && (params.base == null || params.base === '')) {
      params.base = 'USD';
    }
    const headers = { 'Content-Type': 'application/json' };
    if (source) headers['x-openclaw-agent-id'] = source;
    for (const h of ['x-ceo-user-id', 'x-agent-os-user-id', 'x-openclaw-session-key', 'x-openclaw-session-user', 'x-session-key']) {
      if (req.headers[h]) headers[h] = String(req.headers[h]);
    }
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, params, resolveAuthenticatedCeoUserId);
    if (ownerUserId) {
      if (!params.ceo_user_id && !params.ceoUserId && !params.owner_user_id) {
        params.ceo_user_id = ownerUserId;
      }
      if (!headers['x-ceo-user-id']) headers['x-ceo-user-id'] = ownerUserId;
    }
    if (row.auth_header && typeof row.auth_header === 'string' && row.auth_header.trim()) {
      headers['Authorization'] = row.auth_header.trim();
    }
    if (targetUrl.startsWith(baseUrl)) Object.assign(headers, internalAuthHeaders());
    const fetchOpts = { method, headers, signal: AbortSignal.timeout(90000) };
    if (method === 'GET') {
      const url = new URL(targetUrl);
      for (const [k, v] of Object.entries(params)) {
        if (v != null && v !== '') url.searchParams.set(k, String(v));
      }
      targetUrl = url.toString();
    } else {
      fetchOpts.body = JSON.stringify(params);
    }
    const response = await fetch(targetUrl, fetchOpts);
    const data = await response.json().catch(() => ({}));
    const status = response.ok ? 'ok' : 'error';
    logTool(req,toolName, params, data, status, source);
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : e.message;
    logTool(req,req.body?.tool_name || '?', req.body, { error: errMsg }, 'error', source);
    res.status(500).json({ error: errMsg });
  }
});

export default router;
