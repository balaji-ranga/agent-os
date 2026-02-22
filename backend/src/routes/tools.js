/**
 * Content tools API: summarize-url (Phase 1). Image and video endpoints in later phases.
 * Metadata (content_tools_meta), test, invoke, and OpenClaw tools list.
 */
import { Router } from 'express';
import { getSummarizeUrlConfig, getToolsApiKey, getOpenAiConfig, getImageConfig, getVideoConfig } from '../config/tools.js';
import { chatCompletions } from '../config/llm.js';
import { getDb } from '../db/schema.js';
import * as meta from '../services/content-tools-meta.js';

const router = Router();
const PORT = Number(process.env.PORT) || 3001;
function getBackendBaseUrl() {
  const base = process.env.AGENT_OS_PUBLIC_URL || process.env.TOOLS_BASE_URL || `http://127.0.0.1:${PORT}`;
  return base.replace(/\/$/, '');
}

function logContentTool(toolName, requestPayload, responsePayload, status, source = null) {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status) VALUES (?, ?, ?, ?, ?)`
    ).run(
      toolName,
      source || null,
      typeof requestPayload === 'string' ? requestPayload : JSON.stringify(requestPayload || {}),
      typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload || {}),
      status
    );
  } catch (_) {}
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

function optionalAuth(req, res, next) {
  if (req.headers['x-internal-test'] === '1') return next();
  const apiKey = getToolsApiKey();
  if (!apiKey) return next();
  const auth = req.headers.authorization;
  const token = auth && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== apiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

/**
 * GET /meta — list all content tools metadata (no auth for dashboard).
 */
router.get('/meta', (req, res) => {
  try {
    const list = meta.listToolsMeta();
    res.json({ tools: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PATCH /meta/:name — update tool metadata (e.g. enabled, purpose). No auth so dashboard can manage.
 */
router.patch('/meta/:name', (req, res) => {
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
 * POST /meta — onboard new tool. Body: { name, display_name, endpoint, method?, purpose?, model_used? }.
 */
router.post('/meta', (req, res) => {
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
 * POST /test/:name — test a tool with given body. No auth for dashboard.
 */
router.post('/test/:name', async (req, res) => {
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
    const headers = { 'Content-Type': 'application/json' };
    if (targetUrl.startsWith(baseUrl)) headers['x-internal-test'] = '1';
    const response = await fetch(targetUrl, {
      method: row.method || 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.name === 'AbortError' ? 'Request timeout' : e.message });
  }
});

/**
 * GET /logs — no auth so the dashboard can fetch.
 * Query: limit (default 50), offset (default 0), tool (optional filter by tool_name)
 * Returns: { logs: [...], total: number }
 */
router.get('/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const tool = typeof req.query.tool === 'string' ? req.query.tool.trim() : null;
    const db = getDb();
    let rows;
    let total;
    if (tool) {
      total = db.prepare('SELECT COUNT(*) AS n FROM content_tool_logs WHERE tool_name = ?').get(tool).n;
      rows = db.prepare(
        'SELECT id, tool_name, source, request_payload, response_payload, status, created_at FROM content_tool_logs WHERE tool_name = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(tool, limit, offset);
    } else {
      total = db.prepare('SELECT COUNT(*) AS n FROM content_tool_logs').get().n;
      rows = db.prepare(
        'SELECT id, tool_name, source, request_payload, response_payload, status, created_at FROM content_tool_logs ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(limit, offset);
    }
    res.json({ logs: rows, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.use(optionalAuth);

/**
 * POST /summarize-url
 * Body: { url: string }
 * Returns: { summary: string, title?: string } or { error: string }
 */
router.post('/summarize-url', async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = { url: req.body?.url };
  try {
    const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
    if (!url) {
      logContentTool('summarize_url', requestPayload, { error: 'url is required' }, 'error', source);
      return res.status(400).json({ error: 'url is required' });
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      logContentTool('summarize_url', requestPayload, { error: 'Invalid URL' }, 'error', source);
      return res.status(400).json({ error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:') {
      logContentTool('summarize_url', requestPayload, { error: 'Only HTTPS URLs are allowed' }, 'error', source);
      return res.status(400).json({ error: 'Only HTTPS URLs are allowed' });
    }

    const { timeoutMs, maxBytes, allowedDomains } = getSummarizeUrlConfig();
    if (allowedDomains && allowedDomains.length > 0) {
      const host = parsed.hostname.toLowerCase();
      if (!allowedDomains.some((d) => host === d || host.endsWith('.' + d))) {
        logContentTool('summarize_url', requestPayload, { error: 'URL domain not allowed' }, 'error', source);
        return res.status(400).json({ error: 'URL domain not allowed' });
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let body = '';
    let contentLength = 0;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'AgentOS-ContentTools/1.0' },
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        logContentTool('summarize_url', requestPayload, { error: `Upstream returned ${response.status}` }, 'error', source);
        return res.status(502).json({ error: `Upstream returned ${response.status}` });
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: false });
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        contentLength += value.length;
        if (contentLength > maxBytes) break;
        body += decoder.decode(value, { stream: true });
      }
      if (contentLength > maxBytes) {
        body = body.slice(0, maxBytes);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      const errMsg = e.name === 'AbortError' ? 'Request timeout' : 'Failed to fetch URL';
      logContentTool('summarize_url', requestPayload, { error: errMsg }, 'error', source);
      if (e.name === 'AbortError') {
        return res.status(504).json({ error: 'Request timeout' });
      }
      return res.status(502).json({ error: 'Failed to fetch URL' });
    }

    const title = extractTitle(body);
    const rawText = stripHtml(body).slice(0, 50000);

    const openai = getOpenAiConfig();
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
        });
        const summary = (summaryText && summaryText.trim()) || rawText.slice(0, 500);
        const out = { summary, title: title || undefined };
        logContentTool('summarize_url', requestPayload, out, 'ok', source);
        return res.json(out);
      } catch (_) {
        // fall through to raw extract
      }
    }

    const summary = rawText.slice(0, 1500).trim() || 'No text content could be extracted.';
    const out = { summary, title: title || undefined };
    logContentTool('summarize_url', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    logContentTool('summarize_url', requestPayload, { error: 'Internal error' }, 'error', source);
    res.status(500).json({ error: 'Internal error' });
  }
});

/**
 * Phase 2: POST /generate-image — OpenAI-compatible (DALL·E). Primary then secondary endpoint/key/model.
 * Body: { prompt, style_hint? }. Returns: { url } or { error }.
 */
router.post('/generate-image', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-request-source'] || null;
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  const styleHint = typeof req.body?.style_hint === 'string' ? req.body.style_hint.trim() : '';
  const requestPayload = { prompt, style_hint: styleHint || undefined };
  try {
    if (!prompt) {
      logContentTool('generate_image', requestPayload, { error: 'prompt is required' }, 'error', source);
      return res.status(400).json({ error: 'prompt is required' });
    }
    const { primary, secondary } = getImageConfig();
    const endpoints = [primary, secondary].filter((ep) => ep && ep.apiKey);
    if (endpoints.length === 0) {
      logContentTool('generate_image', requestPayload, { error: 'Image generation not configured (OPENAI_API_KEY or primary/secondary)' }, 'error', source);
      return res.status(503).json({ error: 'Image generation not configured. Set OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY (and optionally OPENAI_SECONDARY_*).' });
    }
    let lastErr;
    for (const img of endpoints) {
      const cappedPrompt = prompt.slice(0, img.maxPromptChars);
      const body = {
        model: img.model,
        prompt: cappedPrompt,
        n: 1,
        size: img.size,
        response_format: 'url',
        quality: img.quality,
      };
      if (img.model === 'dall-e-3') body.style = img.style;
      try {
        const imgRes = await fetch(`${img.apiUrl.replace(/\/$/, '')}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${img.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60000),
        });
        const data = await imgRes.json().catch(() => ({}));
        if (!imgRes.ok) {
          lastErr = data?.error?.message || data?.error || imgRes.statusText;
          continue;
        }
        const url = data?.data?.[0]?.url;
        if (!url) {
          lastErr = 'No image URL in response';
          continue;
        }
        const out = { url };
        logContentTool('generate_image', requestPayload, out, 'ok', source);
        return res.json(out);
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
      }
    }
    logContentTool('generate_image', requestPayload, { error: lastErr }, 'error', source);
    return res.status(502).json({ error: lastErr || 'Image API error' });
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
    logContentTool('generate_image', requestPayload, { error: errMsg }, 'error', source);
    return res.status(500).json({ error: errMsg });
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
      logContentTool('generate_video', requestPayload, { error: 'prompt is required' }, 'error', source);
      return res.status(400).json({ error: 'prompt is required' });
    }
    const { primary, secondary } = getVideoConfig();
    const endpoints = [primary, secondary].filter((ep) => ep && ep.apiToken && ep.modelVersion);
    if (endpoints.length === 0) {
      logContentTool('generate_video', requestPayload, { error: 'Video generation not configured (REPLICATE_API_TOKEN or primary/secondary)' }, 'error', source);
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
        logContentTool('generate_video', requestPayload, out, 'ok', source);
        return res.json(out);
      } catch (e) {
        lastErr = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
      }
    }
    logContentTool('generate_video', requestPayload, { error: lastErr }, 'error', source);
    return res.status(502).json({ error: lastErr || 'Replicate API error' });
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : (e.message || 'Internal error');
    logContentTool('generate_video', requestPayload, { error: errMsg }, 'error', source);
    return res.status(500).json({ error: errMsg });
  }
});

/**
 * POST /invoke — invoke a tool by name (used by OpenClaw plugin). Body: { tool_name, ...params }.
 */
router.post('/invoke', async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  try {
    const toolName = (req.body?.tool_name || req.body?.toolName || '').trim();
    if (!toolName) return res.status(400).json({ error: 'tool_name required' });
    const row = meta.getToolMeta(toolName);
    if (!row) return res.status(404).json({ error: 'Tool not found' });
    if (!row.enabled) {
      logContentTool(toolName, req.body, { error: 'Tool is disabled' }, 'error', source);
      return res.status(403).json({ error: 'Tool is disabled' });
    }
    const params = { ...req.body };
    delete params.tool_name;
    delete params.toolName;
    const baseUrl = getBackendBaseUrl();
    let targetUrl = row.endpoint;
    if (targetUrl.startsWith('/')) targetUrl = baseUrl + targetUrl;
    const response = await fetch(targetUrl, {
      method: row.method || 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(90000),
    });
    const data = await response.json().catch(() => ({}));
    const status = response.ok ? 'ok' : 'error';
    logContentTool(toolName, params, data, status, source);
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : e.message;
    logContentTool(req.body?.tool_name || '?', req.body, { error: errMsg }, 'error', source);
    res.status(500).json({ error: errMsg });
  }
});

export default router;
