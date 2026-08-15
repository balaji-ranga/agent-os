/**
 * Web scrape content tools — owner-scoped; sidecar does the crawl.
 */
import { Router } from 'express';
import { getDb } from '../db/schema.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { assertCallerMayUseTool } from '../services/openclaw-agent-tools.js';
import {
  resolveToolOwnerUserIdOrNull,
  bodyWithoutSpoofedOwner,
} from '../services/tool-owner-scope.js';
import { executeWebScrapeForOwner } from '../services/agent-workflow-web-scrape.js';

const router = Router();

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (/key|token|secret|password|authorization|sessionid|session_id|cookie/i.test(k)) out[k] = '[redacted]';
  }
  return out;
}

function logTool(req, toolName, requestPayload, responsePayload, status, source = null) {
  try {
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, requestPayload, resolveAuthenticatedCeoUserId);
    getDb()
      .prepare(
        `INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        toolName,
        source || null,
        JSON.stringify(redact(requestPayload) || {}),
        JSON.stringify(redact(responsePayload) || {}),
        status,
        ownerUserId || null
      );
  } catch (_) {
    /* ignore log failures */
  }
}

function callerSource(req) {
  return req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || req.headers['x-request-source'] || null;
}

function wrap(toolName) {
  return async (req, res) => {
    const source = callerSource(req);
    const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
    try {
      if (source) {
        const grantCheck = assertCallerMayUseTool(source, toolName);
        if (!grantCheck.ok) {
          const err = new Error(grantCheck.error || 'Tool not allowed for this agent');
          err.status = 403;
          throw err;
        }
      }
      const ownerUserId = resolveToolOwnerUserIdOrNull(req, requestPayload, resolveAuthenticatedCeoUserId);
      if (!ownerUserId) {
        const err = new Error('Could not resolve entitled CEO for this session');
        err.status = 403;
        throw err;
      }
      const out = await executeWebScrapeForOwner(ownerUserId, requestPayload, { toolName });
      logTool(req, toolName, requestPayload, { ok: out.ok, stats: out.stats }, 'ok', source);
      res.json(out);
    } catch (e) {
      const status = e.status || 500;
      const err = { error: e.message || 'Internal error', ok: false };
      logTool(req, toolName, requestPayload, err, 'error', source);
      res.status(status).json(err);
    }
  };
}

router.post('/web-scrape-url', wrap('web_scrape_url'));
router.post('/web-scrape-domain', wrap('web_scrape_domain'));

export default router;
