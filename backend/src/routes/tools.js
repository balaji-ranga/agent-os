/**
 * Content tools API: summarize-url (Phase 1). Image and video endpoints in later phases.
 * Kanban tools: move-status, reassign-to-coo, assign-task, intent-classify-and-delegate.
 * Metadata (content_tools_meta), test, invoke, and OpenClaw tools list.
 */
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { join, extname } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { getSummarizeUrlConfig, getToolsApiKey, getOpenAiConfig, getImageConfig, getVideoConfig, getVisionConfig, getBraveSearchConfig, isGptImageModel, mapGptImageQuality } from '../config/tools.js';
import { chatCompletions } from '../config/llm.js';
import { getDb } from '../db/schema.js';
import * as meta from '../services/content-tools-meta.js';
import { assertCallerMayUseTool, getAgentToolGrants } from '../services/openclaw-agent-tools.js';
import { parseTenantOpenClawAgentId, resolveAgentFromOpenClawCallerId } from '../services/openclaw-tenant.js';
import { resolveOwnerFromOpenClawSession, lookupOpenClawSessionActor, lookupActiveDashboardChat, lookupSessionExecutionContext } from '../services/tool-owner-scope.js';
import { resolveChannelActor, loadCompanyActor } from '../services/channel-user-identity.js';
import { executeKanbanUserAction } from '../services/kanban-user-actions.js';
import { withLlmopsContext, getLlmopsContext, inferTraceId } from '../services/llmops-context.js';
import {
  startBrowserTask,
  getBrowserTask,
  waitForBrowserTask,
  listBrowserTasks,
  toolBrowseSnapshot,
  toolBrowseAct,
} from '../services/browser-tasks.js';
import {
  getRecipe,
  getRecipeByName,
  listRecipes,
  prepareRecipeInputs,
} from '../services/browser-recipes.js';
import { getBrowserSessionStatus } from '../services/client-browser-session.js';
import { loadKanbanTaskContent, loadKanbanTaskWithMessages, runKanbanWatchTick } from '../services/kanban-watch.js';
import { executeSpeechSttTool, executeSpeechTtsTool } from '../services/speech-content-tools.js';
import { executeAnalyzeImageTool } from '../services/image-vision-tools.js';
import {
  submitPlatformFeedback,
  enquirePlatformFeedback,
} from '../services/platform-feedback.js';
import { saveInboundAttachment } from '../services/inbound-attachments.js';
import socialResearchTools from './social-research-tools.js';
import webScrapeTools from './web-scrape-tools.js';

function sanitizeTenantId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
import { scheduleCeoRequestViaOpenClawCron, isUsableDelegationWorkOrder } from '../services/delegation-queue.js';
import { getOrCreateDelegationHubStandup } from '../services/standup-hub.js';
import {
  listChatTriggerableWorkflows,
  listWorkflowsForAgent,
  triggerAgentWorkflowForOwner,
  resolveWorkflowOwnerUserId,
  enquireWorkflows,
} from '../services/agent-workflow-chat-tools.js';
import { executeAgentWorkflowRuns } from '../services/agent-workflow-agent-runs.js';
import { executeAgentWorkflowRetry } from '../services/agent-workflow-retry.js';
import {
  registerWorkflowRunWatch,
  runWorkflowWatchTick,
} from '../services/agent-workflow-run-watch.js';
import {
  createAndStartGoalRun,
  planGoalStepsAsync,
  planGoalStepsFromText,
  listGoalRuns,
  getGoalRun,
  completeGoalStepAndContinue,
  bindWorkflowRunToGoalStep,
} from '../services/agent-goal-run.js';
import {
  parseGoalSessionReference,
  buildGoalBoundWorkflowInput,
} from '../services/goal-workflow-context.js';
import { applyWorkflowBuilderActions, getWorkflowDraftForAgent } from '../services/agent-workflow-builder.js';
import { resolveAuthenticatedCeoUserId, attachAuthUser, requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { requireToolsAccess, attachToolsAuth } from '../middleware/tools-auth.js';
import { internalAuthHeaders, isInternalRequest } from '../middleware/internal-auth.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { createVoiceInvite } from '../services/agent-voice-sessions.js';
import { createHumanVoiceInvite, listHumanDirectory, listCompanyCommunicationHistory } from '../services/human-communications.js';
import { listAgentWorkHistory } from '../services/agent-work-history.js';
import { applyPolicyEtaToTask } from '../services/kanban-sla.js';
import {
  fetchValidatedHttps,
  parsePublicHttpsUrl,
  SafeOutboundUrlError,
} from '../lib/ssrf.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import {
  enrichGeneratedOpenClawMedia,
  enrichMediaResult,
  persistGeneratedOpenClawMedia,
  toAbsoluteMediaUrl,
} from '../services/media-url.js';
import { registerOpenClawMediaOwnership } from '../services/openclaw-media-ownership.js';
import { sanitizeContentOwnerPart, getCeoGeneratedMediaDir } from '../services/content-explorer.js';
import { resolveToolOwnerUserId, resolveToolOwnerUserIdOrNull, bodyWithoutSpoofedOwner } from '../services/tool-owner-scope.js';
import {
  listToolModelMappings,
  putToolModelMappings,
} from '../services/tool-model-overrides.js';
import {
  listToolApiRateLimits,
  putToolApiRateLimits,
  resetToolApiRateLimit,
  listToolApiRateLimitResets,
  toolApiRateLimitMiddleware,
} from '../services/tool-api-rate-limits.js';
import {
  actionPolicyMiddleware,
  evaluateActionPolicy,
  issueForwardedActionPolicyPass,
} from '../services/action-policy.js';
import {
  beginToolExecution,
  completeToolExecution,
  listExecutionBehaviours,
  putExecutionBehaviours,
} from '../services/tool-execution-governor.js';
import {
  notifyKanbanTaskCreated,
  clearKanbanTaskNotification,
} from '../services/platform-notifications.js';
import { resolveKanbanTaskOwnerId } from '../services/kanban-user-scope.js';
import jobApplicantTools from './job-applicant-tools.js';
import crmTools from './crm-tools.js';
import erpTools from './erp-tools.js';
import { summarizeLearnings } from '../services/agent-feedback.js';
import { executeEmailSend } from '../services/email-send.js';
import { executeNotifyCeo } from '../services/notify-ceo.js';
import { executeCeoProfile } from '../services/ceo-profile.js';
import { applyProposal, getState as getOnboardingState, saveAgentProposal, saveDraft } from '../services/onboarding-helper.js';
import { runCooStatusChecker } from '../services/coo-status-checker.js';
import { buildThisWeekDigest } from '../services/this-week-digest.js';
import {
  queryCompanyObjectives,
  linkCompanyGoal,
  recordObjectiveDeviation,
} from '../services/objective-agent-tools.js';
import { buildOperationalEffectiveness } from '../services/operational-effectiveness.js';
import { getLlmopsSummary } from '../services/llmops-summary.js';
import {
  executeScheduledGoalCreate,
  executeScheduledGoalList,
  executeScheduledGoalUpdate,
  executeScheduledGoalDelete,
  executeScheduledGoalRunNow,
  requireCoo as requireCooForScheduledGoals,
} from '../services/scheduled-goal-tools.js';
import {
  executeConnectorAction,
  getConnectedConnectorApps,
  getConnectorActionGuide,
  searchConnectorApps,
} from '../services/openconnector.js';
import { assertCallerMayExecuteConnectorAction } from '../services/connector-action-grants.js';
import {
  reviewGmailMailbox,
  executeGmailMailboxCleanup,
  getGmailCleanupPlan,
} from '../services/gmail-mailbox-operations.js';
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
  listInboundAttachmentsForAgent,
  indexDocumentForAgent,
} from '../services/master-data-tools.js';

const router = Router();
const KANBAN_STATUSES = ['open', 'awaiting_confirmation', 'in_progress', 'completed', 'failed'];

function getCallerAgent(req) {
  const id = (
    req.toolsAgentId ||
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

function isVideoContentOrchestratorCaller(caller) {
  if (!caller) return false;
  const id = String(caller.id || '').toLowerCase();
  const name = String(caller.name || '').toLowerCase();
  if (id.startsWith('video-orch-') || id.includes('video-orchestrator')) return true;
  if (name === 'content orchestrator' || /^content\s+orchestrator\b/.test(name)) return true;
  return false;
}

/**
 * COO, Workflow Builder, or Video Content Orchestrator may list/enquire/trigger/runs/watch —
 * always scoped to entitled owner. Goal tools: COO/WFB or any agent granted that tool.
 */
function canAccessWorkflowTools(caller) {
  return !!(
    caller &&
    (caller.is_coo || isWorkflowBuilderCaller(caller) || isVideoContentOrchestratorCaller(caller))
  );
}

function callerHasToolGrant(caller, toolName) {
  if (!caller?.id || !toolName) return false;
  try {
    const grants = getAgentToolGrants(caller.id) || [];
    if (grants.includes(toolName)) return true;
    const id = String(caller.id || '');
    const base = id.includes('--') ? id.split('--').pop() : id;
    if (base && base !== id) {
      const baseGrants = getAgentToolGrants(base) || [];
      if (baseGrants.includes(toolName)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** COO / Workflow Builder, or an agent granted the matching agent_goal_* tool. */
function canAccessGoalTools(caller, toolName = 'agent_goal_create') {
  if (!caller) return false;
  if (caller.is_coo || isWorkflowBuilderCaller(caller)) return true;
  return callerHasToolGrant(caller, toolName);
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
    const ctx = getLlmopsContext() || {};
    const traceId = inferTraceId(ctx);
    db.prepare(
      `INSERT INTO content_tool_logs
       (tool_name, source, request_payload, response_payload, status, owner_user_id, trace_id, goal_step_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      toolName,
      source || ctx.memberKey || ctx.agentId || null,
      typeof requestPayload === 'string'
        ? requestPayload
        : JSON.stringify(requestPayload && typeof requestPayload === 'object'
          ? { ...requestPayload, ...(requestPayload.approval_token ? { approval_token: '[redacted]' } : {}) }
          : {}),
      typeof responsePayload === 'string' ? responsePayload : JSON.stringify(responsePayload || {}),
      status,
      ownerUserId || ctx.ownerUserId || null,
      traceId,
      ctx.goalStepId || null
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

const SUMMARIZE_MAX_REDIRECTS = 5;

async function fetchSummarizeUrlBody(url, { timeoutMs, maxBytes, allowedDomains }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = url;
    const seen = new Set();
    for (let hop = 0; hop <= SUMMARIZE_MAX_REDIRECTS; hop++) {
      if (seen.has(current)) {
        return { ok: false, status: 310, finalUrl: current };
      }
      seen.add(current);
      const response = await fetchValidatedHttps(current, {
        signal: controller.signal,
        headers: SUMMARIZE_FETCH_HEADERS,
        allowedDomains,
      });
      const loc = response.headers.get('location');
      if (loc && [301, 302, 303, 307, 308].includes(response.status)) {
        if (hop === SUMMARIZE_MAX_REDIRECTS) {
          return { ok: false, status: 310, finalUrl: current };
        }
        let next;
        try {
          next = new URL(loc, current).href;
        } catch {
          return { ok: false, status: response.status, finalUrl: current };
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        return { ok: false, status: response.status, finalUrl: current };
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
      return { ok: true, status: response.status, body, finalUrl: current };
    }
    return { ok: false, status: 310, finalUrl: current };
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
 * GET /model-mappings — CEO Tools → model overrides (BYOK-respecting tools only).
 */
router.get('/model-mappings', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    res.json(listToolModelMappings(ownerUserId));
  } catch (e) {
    console.warn('[tools] model-mappings GET failed: %s', e?.message || e);
    const status = Number(e?.status) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: e.message || 'Failed to load tool model mappings',
    });
  }
});

/**
 * PUT /model-mappings — save CEO Tools → model overrides.
 * Body: { mappings: [{ tool_name, llm_model }] } — empty llm_model clears override.
 */
router.put('/model-mappings', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    const mappings = req.body?.mappings ?? req.body?.tools ?? [];
    const result = putToolModelMappings(ownerUserId, mappings);
    res.json(result);
  } catch (e) {
    console.warn('[tools] model-mappings PUT failed: %s', e?.message || e);
    const msg = e?.message || 'Failed to save tool model mappings';
    if (e?.status) {
      return res.status(Number(e.status) || 403).json({ error: msg });
    }
    if (/required|not mappable|invalid|Model/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /rate-limits — CEO Tools → per-user API-key call budgets (owner-scoped).
 */
router.get('/rate-limits', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    res.json(listToolApiRateLimits(ownerUserId));
  } catch (e) {
    console.warn('[tools] rate-limits GET failed: %s', e?.message || e);
    const status = Number(e?.status) || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: e.message || 'Failed to load tool rate limits',
    });
  }
});

/**
 * GET /rate-limits/resets — audit of budget vs actuals at each reset.
 */
router.get('/rate-limits/resets', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    const toolName = typeof req.query.tool === 'string' ? req.query.tool.trim() : null;
    const limit = req.query.limit;
    res.json({ resets: listToolApiRateLimitResets(ownerUserId, { toolName, limit }) });
  } catch (e) {
    console.warn('[tools] rate-limits resets GET failed: %s', e?.message || e);
    res.status(e?.status || 500).json({ error: e.message || 'Failed to load rate-limit resets' });
  }
});

/**
 * PUT /rate-limits — save per-tool daily/monthly call caps.
 * Body: { mappings: [{ tool_name, max_calls_per_day, max_calls_per_month }] }
 * Empty / 0 max clears the limit (unlimited).
 */
router.put('/rate-limits', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    const mappings = req.body?.mappings ?? req.body?.tools ?? [];
    const result = putToolApiRateLimits(ownerUserId, mappings);
    res.json(result);
  } catch (e) {
    console.warn('[tools] rate-limits PUT failed: %s', e?.message || e);
    const msg = e?.message || 'Failed to save tool rate limits';
    if (e?.status) {
      return res.status(Number(e.status) || 403).json({ error: msg });
    }
    if (/required|not rate-limitable|too large|must be/i.test(msg)) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * POST /rate-limits/reset — audit then zero actuals (day, month, or both).
 * Body: { tool_name, period?: 'day'|'month'|'both' }
 */
router.post('/rate-limits/reset', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.body || {});
    if (!ownerUserId) return res.status(403).json({ error: 'CEO owner required' });
    const toolName = String(req.body?.tool_name || req.body?.name || '').trim();
    const period = String(req.body?.period || 'both').trim();
    const result = resetToolApiRateLimit(ownerUserId, toolName, {
      period,
      resetBy: req.authUser?.id || ownerUserId,
    });
    res.json(result);
  } catch (e) {
    console.warn('[tools] rate-limits reset failed: %s', e?.message || e);
    const msg = e?.message || 'Failed to reset tool rate limit';
    if (/required|period must/i.test(msg)) return res.status(400).json({ error: msg });
    res.status(e?.status || 500).json({ error: msg });
  }
});

/**
 * GET /execution-behaviour — owner-scoped execution-governor defaults, overrides and health.
 * Agent grants remain in AI Employees; models/rate limits remain in their existing tabs.
 */
router.get('/execution-behaviour', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    res.json({ ok: true, tools: listExecutionBehaviours(ownerUserId) });
  } catch (e) {
    res.status(e?.status || 500).json({ error: e.message || 'Failed to load execution behaviour' });
  }
});

/** PUT /execution-behaviour — save bounded owner overrides. */
router.put('/execution-behaviour', attachToolsAuth, requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    const tools = putExecutionBehaviours(ownerUserId, req.body?.mappings || []);
    res.json({ ok: true, tools });
  } catch (e) {
    res.status(e?.status || 400).json({ error: e.message || 'Failed to save execution behaviour' });
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
    if (row.auth_header && typeof row.auth_header === 'string' && row.auth_header.trim()) {
      headers.Authorization = row.auth_header.trim();
    }
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
          'SELECT id, tool_name, source, request_payload, response_payload, status, owner_user_id, created_at, trace_id, goal_step_id FROM content_tool_logs WHERE owner_user_id = ? AND tool_name = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        )
        .all(ownerUserId, tool, limit, offset);
    } else {
      total = db.prepare('SELECT COUNT(*) AS n FROM content_tool_logs WHERE owner_user_id = ?').get(ownerUserId).n;
      rows = db
        .prepare(
          'SELECT id, tool_name, source, request_payload, response_payload, status, owner_user_id, created_at, trace_id, goal_step_id FROM content_tool_logs WHERE owner_user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
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
router.use((req, res, next) => {
  const header = String(
    req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || req.headers['x-request-source'] || ''
  ).trim();
  let ownerUserId = null;
  try {
    ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
  } catch (_) {
    ownerUserId = null;
  }
  const parsed = parseTenantOpenClawAgentId(header);
  if (!ownerUserId && parsed?.ceoUserId) ownerUserId = parsed.ceoUserId;
  const agent = header ? resolveAgentFromOpenClawCallerId(header) : null;
  const memberKey = agent?.id || parsed?.baseOpenClawId || null;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const sessionGoal = parseGoalSessionReference(
    req.headers['x-openclaw-session-user'] ||
    req.headers['x-openclaw-session-key'] ||
    req.headers['x-session-key'] ||
    ''
  );
  const incoming = String(
    body.goal_run_id || body.trace_id || req.headers['x-llmops-trace-id'] || sessionGoal?.goal_run_id || ''
  ).trim();
  withLlmopsContext(
    {
      ownerUserId,
      memberKey,
      agentId: memberKey,
      source: 'content_tool',
      sessionId: incoming.startsWith('sess:') ? incoming : null,
      runId: incoming && /^\d+$/.test(incoming) ? incoming : null,
      traceId: incoming || null,
      goalRunId: incoming.startsWith('agr-') ? incoming : null,
      goalStepId: body.goal_step_id || body.step_id || sessionGoal?.goal_step_id || null,
    },
    () => next()
  );
});
router.use(actionPolicyMiddleware);
router.use(toolApiRateLimitMiddleware);

router.use(jobApplicantTools);
router.use(crmTools);
router.use(erpTools);

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
    const { timeoutMs, maxBytes, allowedDomains } = getSummarizeUrlConfig();
    try {
      parsePublicHttpsUrl(url, { httpsOnly: true, allowedDomains });
    } catch (e) {
      const msg = e instanceof SafeOutboundUrlError ? e.message : 'Invalid URL';
      console.warn('[summarize_url] blocked outbound url reason=%s', msg);
      logTool(req, 'summarize_url', requestPayload, { error: msg }, 'error', source);
      return res.status(400).json({ error: msg });
    }

    const candidates = summarizeUrlCandidates(url);
    const tried = [];
    let body = '';
    let usedUrl = url;
    let lastStatus = null;
    let fetchErr = null;

    for (const candidate of candidates) {
      try {
        const got = await fetchSummarizeUrlBody(candidate, { timeoutMs, maxBytes, allowedDomains });
        tried.push({ url: candidate, status: got.status, ok: got.ok });
        if (got.ok && got.body) {
          body = got.body;
          usedUrl = got.finalUrl || candidate;
          lastStatus = got.status;
          break;
        }
        lastStatus = got.status;
      } catch (e) {
        if (e instanceof SafeOutboundUrlError) {
          console.warn('[summarize_url] blocked outbound hop reason=%s', e.message);
          fetchErr = e.message;
          tried.push({ url: candidate, error: e.message });
          continue;
        }
        fetchErr = e.name === 'AbortError' ? 'Request timeout' : 'Failed to fetch URL';
        tried.push({ url: candidate, error: fetchErr });
        if (e.name === 'AbortError') {
          logTool(req, 'summarize_url', requestPayload, { error: 'Request timeout', tried_urls: tried }, 'error', source);
          return res.status(504).json({ error: 'Request timeout', tried_urls: tried });
        }
      }
    }

    if (!body) {
      const blocked = tried.length > 0 && tried.every((t) => /not allowed|Only HTTPS|Invalid URL/i.test(String(t.error || '')));
      if (blocked) {
        const msg = fetchErr || 'URL host is not allowed';
        logTool(req, 'summarize_url', requestPayload, { error: msg, tried_urls: tried }, 'error', source);
        return res.status(400).json({ error: msg });
      }
      const remapped = candidates.find((c) => c !== url);
      const err = {
        error: lastStatus ? `Upstream returned ${lastStatus}` : fetchErr || 'Failed to fetch URL',
        tried_urls: tried,
        hint:
          'This URL may be retired or blocked. Follow suggested_url if present, try one alternate live URL, or use browse_task_start / browser profile="openclaw". Do not invent page content. Still deliver a brief with gaps noted.',
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
          toolName: 'summarize_url',
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

function persistGeneratedImage(b64Json, format = 'png', ownerUserId = null) {
  const ext = String(format || 'png').toLowerCase().replace(/^\./, '') || 'png';
  const leaf = `${randomUUID()}.${ext}`;
  const ownerPart = ownerUserId ? sanitizeContentOwnerPart(ownerUserId) : null;
  const dir = ownerPart ? getCeoGeneratedMediaDir(ownerUserId) : GENERATED_MEDIA_DIR;
  mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(b64Json, 'base64');
  writeFileSync(join(dir, leaf), buf);
  const filename = ownerPart ? `${ownerPart}/${leaf}` : leaf;
  const enriched = enrichGeneratedOpenClawMedia(filename);
  if (ownerUserId) {
    try {
      registerOpenClawMediaOwnership(`generated/${filename}`, ownerUserId, {
        source: 'generate_image',
        bytes: buf.length,
      });
    } catch (e) {
      console.warn('[tools] generate_image ownership register failed', e?.message || e);
    }
  } else {
    console.warn('[tools] generate_image persisted without ownerUserId', { filename });
  }
  return enriched;
}

async function persistRemoteImageUrl(remoteUrl, ownerUserId = null) {
  const url = String(remoteUrl || '').trim();
  if (!url) throw new Error('empty image url');
  if (/^\/api\/media\//i.test(url)) return enrichMediaResult(url);
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
  const leaf = `${randomUUID()}.${ext}`;
  const ownerPart = ownerUserId ? sanitizeContentOwnerPart(ownerUserId) : null;
  const dir = ownerPart ? getCeoGeneratedMediaDir(ownerUserId) : GENERATED_MEDIA_DIR;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, leaf), buf);
  const filename = ownerPart ? `${ownerPart}/${leaf}` : leaf;
  const enriched = enrichGeneratedOpenClawMedia(filename);
  if (ownerUserId) {
    try {
      registerOpenClawMediaOwnership(`generated/${filename}`, ownerUserId, {
        source: 'generate_image_remote',
        bytes: buf.length,
      });
    } catch (e) {
      console.warn('[tools] generate_image remote ownership register failed', e?.message || e);
    }
  }
  return enriched;
}

async function imageResultFromApi(data, ownerUserId = null) {
  const item = data?.data?.[0];
  if (!item) return { error: 'No image in response' };
  if (item.b64_json) {
    const format = data?.output_format || 'png';
    return persistGeneratedImage(item.b64_json, format, ownerUserId);
  }
  if (item.url) {
    try {
      return await persistRemoteImageUrl(item.url, ownerUserId);
    } catch (e) {
      // Fall back to remote URL so the agent still gets something, but prefer local.
      return { url: item.url, absolute_url: item.url, warning: e.message };
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
    const imgCfg = getImageConfig(ownerUserId);
    if (imgCfg.error) {
      logTool(req, 'generate_image', requestPayload, { error: imgCfg.error, code: imgCfg.error_code }, 'error', source);
      return res.status(400).json({ error: imgCfg.error, code: imgCfg.error_code || undefined });
    }
    const { primary, secondary } = imgCfg;
    const endpoints = [primary, secondary].filter((ep) => ep && ep.apiKey);
    if (endpoints.length === 0) {
      logTool(req,'generate_image', requestPayload, { error: 'Image generation not configured (OPENAI_API_KEY or primary/secondary)' }, 'error', source);
      return res.status(503).json({ error: 'Image generation not configured. Set OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY (and optionally OPENAI_SECONDARY_*), or add Platform_BYOK for BYOK Profiles.' });
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
        const result = await imageResultFromApi(data, ownerUserId);
        if (result.error) {
          lastErr = result.error;
          continue;
        }
        // url/paste_exactly = MEDIA:/abs/path (WhatsApp disk attach; web UI rewrites).
        // public_url = signed HTTPS (no Bearer). Never return auth-only HTTPS as url.
        const out = {
          url: result.media_uri || result.url,
          paste_exactly: result.paste_exactly || result.media_uri || result.url,
          media_uri: result.media_uri,
          local_path: result.local_path,
          relative_url: result.relative_url || null,
          absolute_url: result.public_url || result.absolute_url || null,
          public_url: result.public_url || result.absolute_url || null,
          web_markdown: result.web_markdown,
          delivery_hint: result.delivery_hint,
          warning: result.warning,
        };
        logTool(req, 'generate_image', requestPayload, {
          url: out.url,
          media_uri: out.media_uri,
          relative_url: out.relative_url,
          public_url: out.public_url ? '[signed]' : undefined,
          warning: out.warning,
        }, 'ok', source);
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
    const videoCfg = getVideoConfig(ownerUserId);
    if (videoCfg.error) {
      logTool(
        req,
        'generate_video',
        requestPayload,
        { error: videoCfg.error, code: videoCfg.error_code },
        'error',
        source
      );
      return res.status(400).json({
        error: videoCfg.error,
        code: videoCfg.error_code || 'replicate_byok_required',
        replicate_byok_key_name: videoCfg.replicate_byok_key_name,
      });
    }
    const { primary, secondary } = videoCfg;
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
        let out = { job_id: jobId, status, url: url || undefined };
        // When Replicate already has output, mirror into OpenClaw media for WhatsApp MEDIA: attach.
        if (url && /^https?:\/\//i.test(url)) {
          try {
            const mediaRes = await fetch(url, { signal: AbortSignal.timeout(120000) });
            if (mediaRes.ok) {
              const buf = Buffer.from(await mediaRes.arrayBuffer());
              const ct = String(mediaRes.headers.get('content-type') || '').toLowerCase();
              const ext = ct.includes('webm') ? 'webm' : 'mp4';
              const channel = persistGeneratedOpenClawMedia(buf, `generated-video.${ext}`, 'generated', ownerUserId);
              out = {
                ...out,
                ...channel,
                source_url: url,
                url: channel.media_uri,
              };
            }
          } catch (e) {
            console.warn('[tools] generate_video openclaw persist failed', { error: e?.message || String(e) });
          }
        }
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
 * POST /brave-web-search — Brave Search API.
 * Body: { query, count? }. Key from Profile: platform BRAVE_API_KEY vs vault BRAVE_SEARCH_BYOK.
 */
router.post('/brave-web-search', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || req.headers['x-request-source'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    if (source) {
      const grantCheck = assertCallerMayUseTool(source, 'brave_web_search');
      if (!grantCheck.ok) {
        const err = { error: grantCheck.error || 'Tool not allowed for this agent' };
        logTool(req, 'brave_web_search', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
    }
    const query = String(requestPayload.query || requestPayload.q || '').trim();
    if (!query) {
      const err = { error: 'query is required' };
      logTool(req, 'brave_web_search', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, requestPayload, resolveAuthenticatedCeoUserId);
    const cfg = getBraveSearchConfig(ownerUserId);
    if (cfg.error || !cfg.apiKey) {
      logTool(
        req,
        'brave_web_search',
        requestPayload,
        { error: cfg.error, code: cfg.error_code, source: cfg.source },
        'error',
        source
      );
      return res.status(cfg.error_code === 'brave_platform_key_missing' ? 503 : 400).json({
        error: cfg.error || 'Brave Search not configured',
        code: cfg.error_code || 'brave_key_missing',
        brave_search_byok_key_name: cfg.brave_search_byok_key_name,
      });
    }
    const count = Math.min(Math.max(Number(requestPayload.count) || 5, 1), 20);
    const url = new URL(cfg.apiUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': cfg.apiKey,
      },
      signal: AbortSignal.timeout(60000),
    });
    const text = await response.text();
    if (!response.ok) {
      const err = { error: `Brave API HTTP ${response.status}: ${text.slice(0, 400)}` };
      logTool(req, 'brave_web_search', requestPayload, err, 'error', source);
      return res.status(502).json(err);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const err = { error: 'Brave API returned non-JSON' };
      logTool(req, 'brave_web_search', requestPayload, err, 'error', source);
      return res.status(502).json(err);
    }
    const results = (data.web?.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));
    const out = {
      ok: true,
      query,
      count: results.length,
      results,
      key_source: cfg.source,
      using_byok: Boolean(cfg.using_byok),
    };
    logTool(
      req,
      'brave_web_search',
      { query, count, key_source: cfg.source },
      { ok: true, n: results.length },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : e.message || 'Internal error';
    logTool(req, 'brave_web_search', requestPayload, { error: errMsg }, 'error', source);
    res.status(e.status || 500).json({ error: errMsg });
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
    if (task.assigned_user_id) {
      const err = { error: 'Human-owned task actions require kanban_user_action with verified user evidence' };
      logTool(req, 'kanban_move_status', requestPayload, err, 'error', source);
      return res.status(409).json(err);
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

    // Always start as open. Agents move to awaiting_confirmation when they need CEO input;
    // orphan watcher can pick up assigned open cards that never got a delegation run.
    const status = 'open';
    const db = getDb();
    db.prepare(
      `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, due_date, owner_user_id,
        goal_run_id, goal_step_id, trace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      title, description, status, assignedAgentId, caller.id, null, ownerUserId,
      requestPayload.goal_run_id || requestPayload.goalRunId || null,
      requestPayload.goal_step_id || requestPayload.goalStepId || null,
      requestPayload.trace_id || requestPayload.goal_run_id || requestPayload.goalRunId || null
    );
    const row = db.prepare('SELECT * FROM kanban_tasks ORDER BY id DESC LIMIT 1').get();
    const sla = applyPolicyEtaToTask(row.id, ownerUserId, { etaHours: requestPayload.eta_hours, context: `${title}\n${description}` });
    Object.assign(row, sla || {});
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
 * Kanban tool: read one task with full content (status, description, messages,
 * delegation deliverable, agent-chat turns). Owner-scoped. Use for completed-task reviews.
 */
router.post('/kanban-get-task', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const taskId = Number(requestPayload.task_id);
  try {
    if (!taskId) {
      const err = { error: 'task_id required' };
      logTool(req, 'kanban_get_task', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const loaded = loadKanbanTaskContent(taskId, {
      messageLimit: requestPayload.message_limit,
      chatTurnLimit: requestPayload.chat_turn_limit,
      maxFieldChars: requestPayload.max_field_chars,
    });
    if (!loaded) {
      const err = { error: 'Task not found' };
      logTool(req, 'kanban_get_task', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    try {
      assertToolOwnsKanbanTask(req, loaded.task, requestPayload);
    } catch (e) {
      const err = { error: e.message };
      logTool(req, 'kanban_get_task', requestPayload, err, 'error', source);
      return res.status(e.status || 403).json(err);
    }
    const { task } = loaded;
    const out = {
      ok: true,
      task_id: task.id,
      title: task.title,
      description: loaded.description || null,
      status: task.status,
      assigned_agent_id: task.assigned_agent_id || null,
      assigned_agent_name: task.assigned_agent_name || null,
      created_at: task.created_at || null,
      updated_at: task.updated_at || null,
      latest_note: loaded.latest_note || null,
      /** Prefer this for completed work: agent deliverable text. */
      deliverable: loaded.deliverable || null,
      delegation_prompt: loaded.delegation_prompt || null,
      delegation_response: loaded.delegation_response || null,
      messages: loaded.messages,
      chat_context: loaded.chat_context,
      workflow_step_input: loaded.workflow_step_input || null,
      workflow_step_output: loaded.workflow_step_output || null,
      artifacts: loaded.artifacts || [],
      artifact_groups: loaded.artifact_groups || [],
      artifact_count: loaded.artifact_count || 0,
      done: task.status === 'completed' || task.status === 'failed',
    };
    logTool(req, 'kanban_get_task', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'kanban_get_task', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * Kanban watch tick for COO OpenClaw crons: validate status, auto-stop cron when done.
 * Body: { task_id, cron_job_id? }. Reply field is what the cron agent must emit.
 */
router.post('/kanban-watch-tick', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const taskId = Number(requestPayload.task_id);
  const cronJobId = String(requestPayload.cron_job_id || requestPayload.job_id || '').trim() || null;
  try {
    if (!taskId) {
      const err = { error: 'task_id required' };
      logTool(req, 'kanban_watch_tick', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const caller = getCallerAgent(req);
    if (caller && !caller.is_coo) {
      const err = { error: 'Only COO may use kanban_watch_tick' };
      logTool(req, 'kanban_watch_tick', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const loaded = loadKanbanTaskWithMessages(taskId);
    if (!loaded) {
      const err = { error: 'Task not found' };
      logTool(req, 'kanban_watch_tick', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    try {
      assertToolOwnsKanbanTask(req, loaded.task, requestPayload);
    } catch (e) {
      const err = { error: e.message };
      logTool(req, 'kanban_watch_tick', requestPayload, err, 'error', source);
      return res.status(e.status || 403).json(err);
    }
    const out = await runKanbanWatchTick({ taskId, cronJobId });
    if (!out.ok) {
      logTool(req, 'kanban_watch_tick', requestPayload, out, 'error', source);
      return res.status(404).json(out);
    }
    logTool(req, 'kanban_watch_tick', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'kanban_watch_tick', requestPayload, err, 'error', source);
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
    const assignTo = String(
      requestPayload.to_agent_id || requestPayload.agent_id || requestPayload.assign_to || ''
    )
      .trim()
      .toLowerCase();
    try {
    if (!taskId || !assignTo) {
      const err = { error: 'task_id and to_agent_id (or assign_to) required' };
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
    if (assignTo.startsWith('user:')) {
      const userId = String(requestPayload.to_agent_id || requestPayload.assign_to || '')
        .trim()
        .replace(/^user:/i, '');
      const person = db
        .prepare(
          `SELECT id FROM platform_users WHERE id = ? AND (id = ? OR owner_user_id = ?) AND enabled = 1`
        )
        .get(userId, task.owner_user_id, task.owner_user_id);
      if (!person) {
        const err = { error: 'Employee not found in this company' };
        logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
        return res.status(404).json(err);
      }
      db.prepare(
        "UPDATE kanban_tasks SET assigned_user_id = ?, assigned_agent_id = NULL, status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?"
      ).run(person.id, taskId);
      const out = { ok: true, task_id: taskId, assigned_user_id: person.id };
      logTool(req,'kanban_assign_task', requestPayload, out, 'ok', source);
      return res.json(out);
    }
    const agent = db.prepare('SELECT id FROM agents WHERE LOWER(id) = ? OR LOWER(openclaw_agent_id) = ?').get(assignTo, assignTo);
    if (!agent) {
      const err = { error: 'Agent not found' };
      logTool(req,'kanban_assign_task', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    // Keep/open as open so the assignee (or orphan watcher) can start work; agent moves to
    // awaiting_confirmation only when they need CEO confirmation.
    db.prepare("UPDATE kanban_tasks SET assigned_agent_id = ?, assigned_user_id = NULL, status = 'open', updated_at = datetime('now') WHERE id = ?").run(agent.id, taskId);
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
 * speech_tts — free Piper TTS for the entitled CEO. Body: { text, voice?, length_scale? }.
 * Returns media artifact ref + url (same storage as workflow speech_tts).
 */
router.post('/speech-tts', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'speech_tts', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const out = await executeSpeechTtsTool(requestPayload, ownerUserId);
    logTool(req, 'speech_tts', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'speech_tts', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * speech_stt — free Whisper STT for the entitled CEO.
 * Body: { artifact_id|media_ref|audio } or { content_base64, filename?, mime_type? }, optional language/model.
 */
router.post('/speech-stt', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'speech_stt', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const out = await executeSpeechSttTool(requestPayload, ownerUserId);
    logTool(req, 'speech_stt', { ...requestPayload, owner_user_id: ownerUserId }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'speech_stt', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * analyze_image — vision LLM describe / OCR / review for inbound images (WhatsApp + chat paperclip).
 * Body: { path|image|relative_path|MEDIA:… } or content_base64; optional mode (full|describe|ocr|review), prompt.
 */
router.post('/analyze-image', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'analyze_image', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    // Surface clear config errors before reading bytes.
    const visionCfg = getVisionConfig(ownerUserId);
    if (visionCfg.error || !visionCfg.apiKey) {
      const err = {
        error: visionCfg.error || 'Image analysis not configured',
        code: visionCfg.error_code || 'vision_not_configured',
      };
      logTool(req, 'analyze_image', requestPayload, err, 'error', source);
      return res.status(503).json(err);
    }
    const out = await executeAnalyzeImageTool(requestPayload, ownerUserId);
    logTool(
      req,
      'analyze_image',
      {
        ...requestPayload,
        owner_user_id: ownerUserId,
        content_base64: requestPayload.content_base64 ? '[redacted]' : undefined,
        contentBase64: requestPayload.contentBase64 ? '[redacted]' : undefined,
      },
      { ok: out.ok, mode: out.mode, model: out.model, chars: out.text?.length || 0, filename: out.filename },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code || undefined };
    logTool(req, 'analyze_image', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
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

/** Create a short-lived, owner-scoped Voice call link that an agent can share in its current channel. */
router.post('/voice-call-invite', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) return res.status(403).json({ error: 'Could not resolve CEO user for this session' });
    const humanRef = String(requestPayload.user_id || requestPayload.user_name || '').trim();
    if (humanRef) {
      if (caller && !caller.is_coo) return res.status(403).json({ error: 'Only the COO can create a human employee Voice invitation' });
      const people = listHumanDirectory(ownerUserId, ownerUserId).filter((p) => !p.is_self);
      const target = people.find((p) => p.id === humanRef) || people.find((p) => p.name.toLowerCase() === humanRef.toLowerCase());
      if (!target) return res.status(404).json({ error: 'Human employee not found in this company directory' });
      const out = createHumanVoiceInvite(ownerUserId, ownerUserId, target.id, { ttlSeconds: requestPayload.ttl_seconds });
      logTool(req, 'voice_call_invite', { target_user_id: target.id, owner_user_id: ownerUserId }, { ok: true, expires_in_seconds: out.expires_in_seconds }, 'ok', source);
      return res.json({ ok: true, kind: 'human_employee', ...out });
    }
    const agentId = String(requestPayload.agent_id || caller?.id || '').trim();
    if (!agentId) return res.status(400).json({ error: 'agent_id required when the caller cannot be identified' });
    if (caller && !caller.is_coo && String(caller.id) !== agentId) return res.status(403).json({ error: 'Only the COO can create a Voice invitation for another employee' });
    const out = createVoiceInvite(ownerUserId, agentId, { ttlSeconds: requestPayload.ttl_seconds });
    logTool(req, 'voice_call_invite', { agent_id: agentId, owner_user_id: ownerUserId }, { ok: true, expires_at: out.expires_at }, 'ok', source);
    res.json({ ok: true, ...out });
  } catch (e) {
    logTool(req, 'voice_call_invite', requestPayload, { error: e.message }, 'error', source);
    res.status(e.status || 500).json({ error: e.message || 'Voice invitation failed' });
  }
});

/** COO-only proxy for actions explicitly requested by a verified company user. */
router.post('/kanban-user-action', optionalAuth, async (req, res) => {
  const source = String(req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || '').trim();
  try {
    // Human identity headers exist only after /invoke validates the owner+agent token
    // and forwards them over the internal service hop.
    if (!req.isInternalService) return res.status(403).json({ error: 'Internal verified tool hop required' });
    const caller = getCallerAgent(req);
    if (!caller?.is_coo) return res.status(403).json({ error: 'Only the COO may act on behalf of users' });
    const ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
    const actorUserId = String(req.headers['x-flolah-actor-user-id'] || '').trim();
    const channel = String(req.headers['x-openclaw-message-channel'] || req.headers['x-flolah-actor-channel'] || 'web').toLowerCase();
    const actor = actorUserId
      ? loadCompanyActor(ownerUserId, actorUserId)
      : resolveChannelActor({ ownerUserId, senderId: req.headers['x-openclaw-requester-sender-id'], channel });
    if (!actor) return res.status(403).json({ error: 'Verified user is not an active member of this company' });
    const out = await executeKanbanUserAction({
      ownerUserId, actor, proxyAgentId: caller.id, channel,
      senderFingerprint: actor.sender_fingerprint || req.headers['x-openclaw-sender-fingerprint'] || null,
      sessionKey: req.headers['x-openclaw-session-key'] || null,
      taskId: Number(req.body?.task_id) || null, action: req.body?.action,
      evidence: req.body?.evidence, newStatus: req.body?.new_status,
    });
    logTool(req, 'kanban_user_action', req.body || {}, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'kanban_user_action', req.body || {}, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/** COO-only, owner-scoped human communication history. WebRTC signalling is never included. */
router.post('/company-communications-history', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller?.is_coo) return res.status(403).json({ error: 'Only the company COO can read company communication history' });
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const out = listCompanyCommunicationHistory(ownerUserId, {
      limit: requestPayload.limit,
      offset: requestPayload.offset,
      conversationId: requestPayload.conversation_id,
    });
    logTool(req, 'company_communications_history', { owner_user_id: ownerUserId, conversation_id: requestPayload.conversation_id || null },
      { ok: true, conversations: out.conversations.length, messages: out.messages.length, calls: out.calls.length }, 'ok', source);
    res.json({ ok: true, ...out });
  } catch (e) {
    logTool(req, 'company_communications_history', requestPayload, { error: e.message }, 'error', source);
    res.status(e.status || 500).json({ error: e.message || 'Communication history failed' });
  }
});

/** Save an Onboarding Helper proposal for CEO review; owner is session-scoped. */
router.post('/onboarding-save-proposal', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'onboarding_save_proposal', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const out = saveAgentProposal(ownerUserId, requestPayload);
    logTool(req, 'onboarding_save_proposal', { ...requestPayload, owner_user_id: ownerUserId, caller_agent_id: caller?.id || null }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message || 'Failed to save onboarding proposal' };
    logTool(req, 'onboarding_save_proposal', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/** Apply an already reviewed proposal only after explicit CEO confirmation. */
router.post('/onboarding-apply-proposal', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'onboarding_apply_proposal', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    if (requestPayload.confirm_override !== true) {
      const err = { error: 'confirm_override must be true after explicit CEO confirmation' };
      logTool(req, 'onboarding_apply_proposal', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    if (getOnboardingState(ownerUserId).existing_org?.has_custom_agents) {
      saveDraft(ownerUserId, { draft_journey: { override_ack: true } });
    }
    const out = await applyProposal(ownerUserId, {
      confirm_override: true,
      selected: requestPayload.selected,
    });
    logTool(req, 'onboarding_apply_proposal', { ...requestPayload, owner_user_id: ownerUserId, caller_agent_id: caller?.id || null }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message || 'Failed to apply onboarding proposal' };
    logTool(req, 'onboarding_apply_proposal', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
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


/**
 * this_week_digest — COO only. Owner-scoped weekly KPIs + Time Saved / Value methodology.
 * Body: { offset_weeks?: number }
 */
router.post('/this-week-digest', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can use this_week_digest' };
      logTool(req, 'this_week_digest', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'this_week_digest', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const offsetRaw = requestPayload.offset_weeks ?? requestPayload.offsetWeeks ?? 0;
    const offsetWeeks = Number.isFinite(Number(offsetRaw)) ? Math.trunc(Number(offsetRaw)) : 0;
    const digest = await buildThisWeekDigest(ownerUserId, { offsetWeeks });
    const result = {
      ok: true,
      owner_user_id: ownerUserId,
      week: digest.week,
      kpis: digest.kpis,
      estimates: digest.estimates,
      methodology: digest.estimates?.explain || null,
      facts_for_answer: {
        time_saved_hours: digest.estimates?.time_saved_hours,
        value_delivered_usd: digest.estimates?.value_delivered_usd,
        tasks_completed: digest.estimates?.tasks_completed_count,
        minutes_per_task: digest.estimates?.minutes_per_task,
        usd_per_hour: digest.estimates?.usd_per_hour,
        formula_time_saved: digest.estimates?.formula_time_saved,
        formula_value: digest.estimates?.formula_value,
      },
      agent_howto: digest.estimates?.explain?.agent_howto || null,
      performance: digest.performance,
      top_workflows: digest.top_workflows,
    };
    logTool(req, 'this_week_digest', { ...requestPayload, owner_user_id: ownerUserId }, {
      ok: true,
      time_saved_hours: result.facts_for_answer.time_saved_hours,
      value_delivered_usd: result.facts_for_answer.value_delivered_usd,
    }, 'ok', source);
    res.json(result);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'this_week_digest', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * operational_effectiveness — COO only. Owner-scoped OEI score + explainability.
 * Body: { days?: number } (default 14)
 */
router.post('/operational-effectiveness', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can use operational_effectiveness' };
      logTool(req, 'operational_effectiveness', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'operational_effectiveness', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const daysRaw = requestPayload.days ?? requestPayload.window_days;
    const days = daysRaw != null && Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : undefined;
    const oei = await buildOperationalEffectiveness(ownerUserId, { days });
    const result = {
      ok: true,
      owner_user_id: ownerUserId,
      score: oei.score,
      band: oei.band,
      band_label: oei.band_label,
      bands: oei.bands,
      window_days: oei.window_days,
      verdict: oei.verdict,
      domains: oei.domains,
      top_actions: oei.top_actions,
      methodology: oei.methodology,
      facts: oei.facts,
      agent_howto:
        'Explain Green/Amber/Red using bands (Green≥75). Walk domain scores lowest-first and map top_actions to CEO next steps. CRM counts if platform Twenty is bound OR an MCA CRM connector is connected. Do not invent secrets or cross-tenant data. Not the same as this_week_digest Time Saved / Est. Value.',
    };
    logTool(
      req,
      'operational_effectiveness',
      { ...requestPayload, owner_user_id: ownerUserId },
      { ok: true, score: result.score, band: result.band },
      'ok',
      source
    );
    res.json(result);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'operational_effectiveness', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * llmops_summary — COO only. Owner-scoped tokens, estimated $, traces, quality.
 * Body: { days?: number } (default 30)
 */
router.post('/llmops-summary', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller || !caller.is_coo) {
      const err = { error: 'Only COO can use llmops_summary' };
      logTool(req, 'llmops_summary', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'llmops_summary', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const daysRaw = requestPayload.days ?? requestPayload.window_days;
    const days = daysRaw != null && Number.isFinite(Number(daysRaw)) ? Number(daysRaw) : 30;
    const summary = getLlmopsSummary(ownerUserId, { days });
    const result = {
      ok: true,
      owner_user_id: ownerUserId,
      range: summary.range,
      tokens: summary.tokens,
      by_source: summary.by_source,
      by_model: summary.by_model,
      cost: {
        llm_estimated_usd: summary.cost.llm_estimated_usd,
        manual_usd: summary.cost.manual_usd,
        total_estimated_usd: summary.cost.total_estimated_usd,
        payer: summary.cost.payer,
        disclaimer: summary.cost.disclaimer,
      },
      quality: summary.quality,
      traces: (summary.traces || []).slice(0, 12),
      agent_howto:
        'Explain token burn and estimated $ from the price book. Say estimates are not invoices. Point the CEO to Efficiency → LLMOps and Goal plans → Execution trace. Do not mix with Digest Est. Value or Home OEI. Do not invent spend. Operator recovery is Admin-only.',
    };
    logTool(
      req,
      'llmops_summary',
      { ...requestPayload, owner_user_id: ownerUserId },
      { ok: true, tokens: result.tokens?.total_tokens, usd: result.cost.llm_estimated_usd },
      'ok',
      source
    );
    res.json(result);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'llmops_summary', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

function scheduledGoalHandler(toolName, executor, opts = {}) {
  return async (req, res) => {
    const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
    const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
    try {
      if (opts.cooOnly !== false) {
        const caller = getCallerAgent(req);
        requireCooForScheduledGoals(caller);
      }
      const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
      if (!ownerUserId) {
        const err = { error: 'Could not resolve CEO user for this session' };
        logTool(req, toolName, requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
      const result = await executor(ownerUserId, requestPayload);
      logTool(req, toolName, { ...requestPayload, owner_user_id: ownerUserId }, result, 'ok', source);
      res.json(result && typeof result === 'object' ? result : { ok: true, result });
    } catch (e) {
      const err = { error: e.message };
      logTool(req, toolName, requestPayload, err, 'error', source);
      res.status(e.status || 500).json(err);
    }
  };
}

router.post('/scheduled-goal-create', optionalAuth, scheduledGoalHandler('scheduled_goal_create', executeScheduledGoalCreate));
router.post('/scheduled-goal-list', optionalAuth, scheduledGoalHandler('scheduled_goal_list', executeScheduledGoalList));
router.post('/scheduled-goal-update', optionalAuth, scheduledGoalHandler('scheduled_goal_update', executeScheduledGoalUpdate));
router.post('/scheduled-goal-delete', optionalAuth, scheduledGoalHandler('scheduled_goal_delete', executeScheduledGoalDelete));
router.post('/scheduled-goal-run-now', optionalAuth, scheduledGoalHandler('scheduled_goal_run_now', executeScheduledGoalRunNow));

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
 * master_data_list_documents — CEO uploads plus read-only Flolah Help (platformhelp = help only).
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
 * master_data_rag — keyword RAG over CEO docs + Flolah Help (platformhelp = help only).
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
 * list_inbound_attachments — list this CEO's workspace inbound/attachments
 * (chat / WhatsApp / channel uploads). Session-scoped owner only.
 */
router.post('/list-inbound-attachments', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveMasterDataOwnerOr403(
      req,
      res,
      'list_inbound_attachments',
      requestPayload,
      source
    );
    if (!ownerUserId) return;
    const out = listInboundAttachmentsForAgent(ownerUserId);
    logTool(
      req,
      'list_inbound_attachments',
      { ...requestPayload, owner_user_id: ownerUserId },
      { ok: true, count: out.count },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code || undefined };
    logTool(req, 'list_inbound_attachments', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/**
 * master_data_index_document — index a RAG-able file into this CEO's OpenSearch docs indices
 * (same path as Master Data → Documents). Prefer inbound relative_path; rejects media.
 */
router.post('/master-data-index-document', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveMasterDataOwnerOr403(
      req,
      res,
      'master_data_index_document',
      requestPayload,
      source
    );
    if (!ownerUserId) return;
    const out = await indexDocumentForAgent(ownerUserId, {
      ...requestPayload,
      agent_id: source || requestPayload.agent_id || requestPayload.agentId || null,
    });
    logTool(
      req,
      'master_data_index_document',
      {
        ...requestPayload,
        owner_user_id: ownerUserId,
        content_base64: requestPayload.content_base64 || requestPayload.contentBase64 ? '[redacted]' : undefined,
        content_text: requestPayload.content_text || requestPayload.contentText ? '[redacted]' : undefined,
      },
      { ok: true, document_id: out.document?.id, chunks: out.document?.chunk_count },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code || undefined };
    logTool(req, 'master_data_index_document', requestPayload, err, 'error', source);
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
  let message = (requestPayload.message || requestPayload.prompt || '').toString().trim();
  let standupId = requestPayload.standup_id != null ? Number(requestPayload.standup_id) : null;
  try {
    const caller = getCallerAgent(req);
    if (!caller || !(caller.is_coo || caller.is_orchestrator)) {
      const err = { error: 'Only an entitled orchestrator can delegate work' };
      logTool(req,'intent_classify_and_delegate', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const { getAgentsUnderOrchestratorForCeo } = await import('../services/org-context.js');
    const { listOrgAgentMembers } = await import('../services/org-agent-members.js');
    const reports = [
      ...getAgentsUnderOrchestratorForCeo(ownerUserId, caller.id),
      ...listOrgAgentMembers(ownerUserId, { enabledOnly: true }).filter(member => member.parent_id === caller.id),
    ];
    const target = typeof requestPayload.target_agent_id === 'string' ? requestPayload.target_agent_id.trim() : null;
    if (!reports.length || (target && !reports.some(agent => agent.id === target))) {
      return res.status(403).json({ error: 'Delegation target must be an enabled reportee in your company' });
    }
    if (!isUsableDelegationWorkOrder(message)) {
      const trustedTurn = lookupActiveDashboardChat(caller.id, ownerUserId)?.message || '';
      if (isUsableDelegationWorkOrder(trustedTurn)) {
        message = trustedTurn;
      } else {
        const err = { error: 'Delegation requires a self-contained work order; empty, placeholder, or contextless handoffs are rejected.' };
        logTool(req,'intent_classify_and_delegate', { ...requestPayload, message: '[invalid handoff redacted]' }, err, 'error', source);
        return res.status(400).json(err);
      }
    }
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
    const sessionGoal = parseGoalSessionReference(req.headers['x-openclaw-session-key'] || req.headers['x-session-key']);
    if (sessionGoal) {
      const goal = getGoalRun(sessionGoal.goal_run_id, ownerUserId);
      const step = goal?.steps?.find(item => item.id === sessionGoal.goal_step_id);
      if (!step) return res.status(403).json({ error: 'Goal session is not available in your company' });
      message = buildGoalBoundWorkflowInput({ goal, step, suppliedInput: message });
    }
    const result = await scheduleCeoRequestViaOpenClawCron(standupId, message, ownerUserId, {
      parentAgentId: caller.id,
      isolatedContext: true,
      restrictToAgentIds: target ? [target] : reports.map(agent => agent.id),
      ...(target ? { preAllocated: { [target]: message }, maxAgents: 1 } : {}),
    });
    const out = {
      ok: result.count > 0,
      request_id: result.requestId,
      count: result.count,
      agent_names: result.agentNames,
      kanban_task_ids: result.kanbanTaskIds || [],
      ...(result.count > 0 ? {} : { error: 'No eligible delegation was scheduled', blocked: result.internalBlocked || [] }),
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
  const err = { error: e.message, code: e.code || undefined,
    provider_status: e.provider_status || undefined, retry_after_ms: e.retry_after_ms || undefined };
  if (e.retry_after_ms) res.set('Retry-After', String(Math.ceil(e.retry_after_ms / 1000)));
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
    const actionGrant = assertCallerMayExecuteConnectorAction(source, actionId);
    if (!actionGrant.ok) {
      const err = {
        ok: false,
        error: actionGrant.error,
        failure_class: 'connector_action_denial',
        action_id: actionId,
      };
      logTool(req, 'connector_execute_action', requestPayload, err, 'error', source);
      return res.status(403).json(err);
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

/** Self-scoped work ledger; an entitled COO may inspect another entitled company agent. */
router.post('/agent-work-history', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const caller = getCallerAgent(req);
    if (!caller) return res.status(403).json({ error: 'Verified agent caller required' });
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const callerEntitled = getDb().prepare(
      `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
    ).get(ownerUserId, caller.id);
    if (!callerEntitled) return res.status(403).json({ error: 'Agent is not entitled to this company' });
    const requested = String(requestPayload.target_agent_id || '').trim();
    if (requested && !caller.is_coo && requested.toLowerCase() !== String(caller.id).toLowerCase()) {
      return res.status(403).json({ error: 'Agents may read only their own work history' });
    }
    const targetAgentId = requested || caller.id;
    const targetEntitled = getDb().prepare(
      `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
    ).get(ownerUserId, targetAgentId);
    if (!targetEntitled) return res.status(404).json({ error: 'Company agent not found' });
    const sessionGoal = parseGoalSessionReference(
      req.headers['x-openclaw-session-user'] ||
      req.headers['x-openclaw-session-key'] ||
      req.headers['x-session-key'] ||
      ''
    );
    const out = listAgentWorkHistory({
      ownerUserId,
      agentId: targetAgentId,
      days: requestPayload.days,
      limit: requestPayload.limit,
      excludeGoalRunId: sessionGoal?.goal_run_id || null,
    });
    const evidenceId = `aev-${randomUUID()}`;
    const response = { ok: true, evidence_id: evidenceId, captured_at: new Date().toISOString(), ...out };
    logTool(req, 'agent_work_history', { target_agent_id: targetAgentId, days: out.days }, response, 'ok', source);
    res.json(response);
  } catch (e) {
    logTool(req, 'agent_work_history', requestPayload, { error: e.message }, 'error', source);
    res.status(e.status || 500).json({ error: e.message || 'Agent work history failed' });
  }
});

/**
 * Narrow Gmail operations tools. These retain OpenConnector's per-CEO OAuth
 * isolation while avoiding a broad connector_execute_action grant for the
 * mailbox employee. gmail-mailbox-cleanup is classified R3 by Action Control.
 */
router.post('/gmail-mailbox-review', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const out = await reviewGmailMailbox(ownerUserId, requestPayload);
    logTool(req, 'gmail_mailbox_review', requestPayload, { ok: true, plan_id: out.plan_id, report: out.report }, 'ok', source);
    res.json(out);
  } catch (e) {
    connectorToolError(req, 'gmail_mailbox_review', requestPayload, res, e, source);
  }
});

router.post('/gmail-mailbox-cleanup', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const out = await executeGmailMailboxCleanup(ownerUserId, requestPayload);
    logTool(req, 'gmail_mailbox_cleanup', requestPayload, out, out.ok ? 'ok' : 'error', source);
    res.status(out.ok ? 200 : 207).json(out);
  } catch (e) {
    connectorToolError(req, 'gmail_mailbox_cleanup', requestPayload, res, e, source);
  }
});

router.post('/gmail-mailbox-cleanup-status', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveConnectorOwner(req, requestPayload);
    const out = getGmailCleanupPlan(ownerUserId, requestPayload.plan_id || requestPayload.planId);
    if (!out) return res.status(404).json({ error: 'Gmail cleanup plan not found for this company' });
    const safe = {
      ok: true,
      plan_id: out.id,
      status: out.status,
      cutoff_days: out.cutoff_days,
      summary: out.summary,
      report: out.report,
      execution: out.execution,
      created_at: out.created_at,
      expires_at: out.expires_at,
      executed_at: out.executed_at,
    };
    logTool(req, 'gmail_mailbox_cleanup_status', requestPayload, safe, 'ok', source);
    res.json(safe);
  } catch (e) {
    connectorToolError(req, 'gmail_mailbox_cleanup_status', requestPayload, res, e, source);
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
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can enquire about agent workflows' };
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
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can list agent workflow runs' };
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
 * Retry a workflow run from start (new run) or from failed step (same run).
 * COO or Workflow Builder — owner-scoped.
 */
router.post('/agent-workflow-retry', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can retry agent workflow runs' };
      logTool(req, 'agent_workflow_retry', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = await executeAgentWorkflowRetry(bodyWithoutSpoofedOwner(requestPayload), {
      ownerUserId,
    });
    const status = out.ok ? 'ok' : 'error';
    logTool(req, 'agent_workflow_retry', { ...requestPayload, owner_user_id: ownerUserId }, out, status, source);
    if (!out.ok) {
      const code = out.status === 404 ? 404 : out.status === 409 ? 409 : 400;
      return res.status(code).json(out);
    }
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_retry', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
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
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can list agent workflows' };
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
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can trigger agent workflows' };
      logTool(req,'agent_workflow_trigger', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const suppliedInput = requestPayload.input;
    const message = String(
      requestPayload.message ||
      requestPayload.workflow_name ||
      requestPayload.workflowName ||
      (typeof suppliedInput === 'string' ? suppliedInput : '') ||
      ''
    ).trim();
    const workflowId = requestPayload.workflow_id || requestPayload.workflowId || null;
    if (!message && !workflowId) {
      const err = { error: 'message or workflow_id required' };
      logTool(req,'agent_workflow_trigger', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const sessionGoal = parseGoalSessionReference(
      req.headers['x-openclaw-session-user'] ||
      req.headers['x-openclaw-session-key'] ||
      req.headers['x-session-key'] ||
      ''
    );
    const inferredGoalRunId = requestPayload.goal_run_id || requestPayload.goalRunId || sessionGoal?.goal_run_id || null;
    const inferredStepId = requestPayload.step_id || requestPayload.stepId || requestPayload.goal_step_id || requestPayload.goalStepId || sessionGoal?.goal_step_id || null;
    let runInput = suppliedInput !== undefined && suppliedInput !== null && String(suppliedInput).trim() !== ''
      ? suppliedInput
      : message;
    if (inferredGoalRunId && inferredStepId) {
      const goal = getGoalRun(String(inferredGoalRunId), ownerUserId);
      const step = goal?.steps?.find((item) => String(item.id) === String(inferredStepId));
      if (!goal || !step) {
        return res.status(409).json({ error: 'Goal-bound workflow context could not be resolved for this owner' });
      }
      runInput = buildGoalBoundWorkflowInput({ goal, step, suppliedInput: runInput });
    }
    const actor = {
      id: caller?.id || null,
      name: caller?.name || null,
      type: isWorkflowBuilderCaller(caller)
        ? 'workflow_builder'
        : isVideoContentOrchestratorCaller(caller)
          ? 'video_orchestrator'
          : 'coo',
    };
    // Multi-intent freeform: upgrade phrase triggers that describe 2+ workflows into a durable goal plan.
    // Prevents treating a numeric workflow run_id as a goal plan — only agr-… ids track Digest/step ladder.
    const earlyGoalRunId = inferredGoalRunId;
    const forceUpgrade =
      requestPayload.upgrade_to_goal === true ||
      requestPayload.as_goal_plan === true ||
      /\bagent_goal_create\b/i.test(message);
    if (!earlyGoalRunId && !workflowId && message) {
      try {
        // Intent-first plan (LLM); count real workflow legs before freeform multiphase upgrade.
        const planned = await planGoalStepsAsync(message, {
          ownerUserId,
          orchestratorAgentId: caller?.id || null,
        });
        const wfCount = planned.filter((st) => st && st.type === 'workflow_trigger').length;
        if (forceUpgrade || wfCount >= 2) {
          const started = await createAndStartGoalRun({
            ownerUserId,
            agentId: caller?.id || 'balserve',
            title: requestPayload.title || '',
            prompt: message,
            steps: null,
            source: 'tool_upgrade_from_workflow_trigger',
            context: { upgraded_from: 'agent_workflow_trigger' },
            backgroundPlanning: true,
          });
          const goal = started?.goal || null;
          const out = {
            ok: true,
            upgraded_to_goal_plan: true,
            async: true,
            goal_run_id: goal?.id || null,
            goal,
            execution: started?.execution || null,
            ceo_user_id: ownerUserId,
            instruction:
              'ASYNC ACK: Platform created durable multi-intent goal plan (goal_run_id agr-…). Quote id + plan steps to the CEO and END THIS TURN. Do not poll status or chain agent_workflow_trigger for later phases — platform advances steps on child terminals (background). Workflow run ids are not goal plans.',
          };
          logTool(req, 'agent_workflow_trigger', requestPayload, out, 'ok', source);
          logTool(req, 'agent_goal_create', { prompt: message, upgraded_from: 'agent_workflow_trigger' }, out, 'ok', source);
          return res.json(out);
        }
      } catch (upgradeErr) {
        console.warn('[tools] multiphase trigger→goal upgrade skipped', upgradeErr?.message || upgradeErr);
      }
    }
    const run = await triggerAgentWorkflowForOwner(ownerUserId, {
      message,
      workflow_id: workflowId,
      input: runInput,
      actor,
    });
    // Non-blocking: never wait for terminal status in the HTTP tool path.
    const watch = registerWorkflowRunWatch(run.id, {
      ownerUserId,
      actorAgentId: actor.id,
      actorName: actor.name,
    });
    const goalRunId = inferredGoalRunId;
    const stepId = inferredStepId;
    let goal_bind = null;
    if (goalRunId && stepId) {
      try {
        goal_bind = bindWorkflowRunToGoalStep({
          goalRunId: String(goalRunId),
          stepId: String(stepId),
          workflowRunId: run.id,
          ownerUserId,
        });
      } catch (bindErr) {
        console.warn('[tools] goal bind failed', bindErr?.message || bindErr);
        goal_bind = { ok: false, error: bindErr?.message || String(bindErr) };
      }
    }
    const out = {
      ok: true,
      async: true,
      run_id: run.id,
      run_number: run.run_number,
      definition_id: run.definition_id,
      definition_name: run.definition_name,
      status: run.status,
      ceo_user_id: ownerUserId,
      watch: watch?.watch || null,
      goal_bind,
      instruction:
        watch?.instruction ||
        'Workflow started. Confirm run_id to the CEO and end the turn — do not poll or block. If this is part of an agent_goal_run plan, platform advances remaining steps on terminal. Otherwise platform notifies CEO and may re-wake you on terminal.',
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
 * Create a multi-intent goal plan and start executing it (platform advances on child terminals).
 */
router.post('/agent-goal-create', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessGoalTools(caller, 'agent_goal_create')) {
      const err = { error: 'Only COO, Workflow Builder, or an agent granted agent_goal_create can create goal runs' };
      logTool(req, 'agent_goal_create', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const objectiveLinkRequested = Boolean(requestPayload.objective_id || requestPayload.initiative_id || requestPayload.key_result_id || requestPayload.key_result_ids);
    const objectiveLinker = Boolean(caller?.is_coo || caller?.is_orchestrator) || /orchestrator/i.test(String(caller?.name || ''));
    if (objectiveLinkRequested && !objectiveLinker) {
      const err = { error: 'Only COO or orchestrator agents can create an objective-linked goal' };
      logTool(req, 'agent_goal_create', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const prompt = String(requestPayload.prompt || requestPayload.message || requestPayload.input || '').trim();
    if (!prompt && !Array.isArray(requestPayload.steps)) {
      const err = { error: 'prompt or steps required' };
      logTool(req, 'agent_goal_create', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const start = requestPayload.start !== false && requestPayload.execute !== false;
    const base = {
      ownerUserId,
      agentId: caller?.id || 'balserve',
      title: requestPayload.title || '',
      prompt,
      steps: requestPayload.steps || null,
      source: requestPayload.source || 'tool',
      context: {
        ...(requestPayload.context || {}),
        ...(requestPayload.objective_id ? {
          objective_id: requestPayload.objective_id,
          initiative_id: requestPayload.initiative_id || null,
          linked_key_result_ids: requestPayload.key_result_ids || (requestPayload.key_result_id ? [requestPayload.key_result_id] : []),
          objective_link_source: 'agent_goal_create_explicit_request',
        } : {}),
      },
      backgroundPlanning: true,
    };
    let out;
    if (start) {
      out = await createAndStartGoalRun(base);
      out = { ok: true, ...out };
    } else {
      // only plan via createGoalRun then return without execute
      const { createGoalRun } = await import('../services/agent-goal-run.js');
      const goal = createGoalRun(base);
      out = { ok: true, goal, deferred: true };
    }
    const goal = out.goal || null;
    const steps = Array.isArray(goal?.steps)
      ? goal.steps.map((st, i) => ({
          index: st.step_index != null ? st.step_index : i,
          type: st.step_type || st.type || null,
          label: st.label || null,
          status: st.status || null,
        }))
      : [];
    out = {
      ...out,
      async: true,
      goal_run_id: goal?.id || out.goal_run_id || null,
      plan_summary: {
        title: goal?.title || null,
        status: goal?.status || null,
        step_count: steps.length,
        steps,
      },
      instruction:
        out.instruction ||
        'ASYNC ACK: Durable goal plan created (new goal_run_id agr-… every create). CRITICAL: always pass the CEO multiphase message VERBATIM as prompt (keep Platform Help / specialty asks) — do not trim to CRM+ERP only. This is a NEW plan — do not swap to an older agr- from chat/MEMORY. Quote goal_run_id + full plan steps (including specialty_task) to the CEO NOW and END THIS TURN. Do NOT poll status or chain freeform agent_workflow_trigger for later phases. Platform advances remaining steps on child terminals. Workflow run ids are not goal plans.',
    };
    if (out.goal_run_id && requestPayload.objective_id) {
      const linked = linkCompanyGoal(ownerUserId, {
        goal_run_id: out.goal_run_id,
        objective_id: requestPayload.objective_id,
        initiative_id: requestPayload.initiative_id,
        key_result_id: requestPayload.key_result_id,
        key_result_ids: requestPayload.key_result_ids,
        link_source: 'agent_goal_create_explicit_request',
      });
      out.objective_link = {
        objective_id: requestPayload.objective_id,
        initiative_id: requestPayload.initiative_id || null,
        key_result_ids: requestPayload.key_result_ids || (requestPayload.key_result_id ? [requestPayload.key_result_id] : []),
        linked: Boolean(linked),
      };
    }
    logTool(req, 'agent_goal_create', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_goal_create', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/** All agents: owner-scoped objective, KR, initiative and goal discovery. */
router.post('/company-objectives-query', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!caller || !callerHasToolGrant(caller, 'company_objectives_query')) return res.status(403).json({ error: 'Agent is not granted company_objectives_query' });
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = { ok: true, ...queryCompanyObjectives(ownerUserId, requestPayload) };
    logTool(req, 'company_objectives_query', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'company_objectives_query', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/** COO / orchestrator only: explicitly bind an existing Goal Plan to objective structure. */
router.post('/company-goal-link-objective', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    const isOrchestrator = Boolean(caller?.is_coo || caller?.is_orchestrator) || /orchestrator/i.test(String(caller?.name || ''));
    if (!isOrchestrator || !callerHasToolGrant(caller, 'company_goal_link_objective')) return res.status(403).json({ error: 'Only COO or orchestrator agents can link goals to objectives' });
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const objective = linkCompanyGoal(ownerUserId, requestPayload);
    const out = { ok: true, linked: true, goal_run_id: requestPayload.goal_run_id, objective_id: requestPayload.objective_id, initiative_id: requestPayload.initiative_id || null, objective };
    logTool(req, 'company_goal_link_objective', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'company_goal_link_objective', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

/** All agents: non-blocking owner-scoped audit for fundamentally off-objective asks. */
router.post('/objective-deviation-record', optionalAuth, (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!caller || !callerHasToolGrant(caller, 'objective_deviation_record')) return res.status(403).json({ error: 'Agent is not granted objective_deviation_record' });
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = recordObjectiveDeviation(ownerUserId, requestPayload, {
      user_id: req.user?.id || ownerUserId,
      agent_id: caller.id,
      channel: requestPayload.channel || 'agent_tool',
    });
    logTool(req, 'objective_deviation_record', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'objective_deviation_record', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/agent-goal-list', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessGoalTools(caller, 'agent_goal_list')) {
      const err = { error: 'Only COO, Workflow Builder, or an agent granted agent_goal_list can list goal runs' };
      logTool(req, 'agent_goal_list', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const goals = listGoalRuns(ownerUserId, {
      status: requestPayload.status || null,
      limit: requestPayload.limit,
    });
    const out = { ok: true, count: goals.length, goals };
    logTool(req, 'agent_goal_list', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_goal_list', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

router.post('/agent-goal-status', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessGoalTools(caller, 'agent_goal_status')) {
      const err = { error: 'Only COO, Workflow Builder, or an agent granted agent_goal_status can read goal runs' };
      logTool(req, 'agent_goal_status', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const id = String(requestPayload.goal_run_id || requestPayload.id || '').trim();
    if (!id) {
      const err = { error: 'goal_run_id required' };
      logTool(req, 'agent_goal_status', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const goal = getGoalRun(id, ownerUserId);
    if (!goal) {
      const err = { error: 'goal_run not found' };
      logTool(req, 'agent_goal_status', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    const out = { ok: true, goal };
    logTool(req, 'agent_goal_status', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_goal_status', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

router.post('/agent-goal-complete-step', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessGoalTools(caller, 'agent_goal_complete_step')) {
      const err = { error: 'Only COO, Workflow Builder, or an agent granted agent_goal_complete_step can complete goal steps' };
      logTool(req, 'agent_goal_complete_step', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = await completeGoalStepAndContinue({
      goalRunId: requestPayload.goal_run_id || requestPayload.goalRunId,
      stepId: requestPayload.step_id || requestPayload.stepId,
      ownerUserId,
      result: requestPayload.result || null,
      failed: !!requestPayload.failed,
      error: requestPayload.error || null,
    });
    logTool(req, 'agent_goal_complete_step', requestPayload, out, out.ok === false ? 'error' : 'ok', source);
    res.status(out.ok === false ? 400 : 200).json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_goal_complete_step', requestPayload, err, 'error', source);
    res.status(400).json(err);
  }
});

/**
 * Register notify-on-terminal / CEO-wait for a run (COO, Workflow Builder, or Content Orchestrator).
 * Prefer agent_workflow_trigger (auto-registers). Use this if you only have a run_id.
 * Agent wake respects Knowledge agent_workflow_notify_prefs (allowlist when rows exist).
 */
router.post('/agent-workflow-watch', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const caller = getCallerAgent(req);
    if (!canAccessWorkflowTools(caller)) {
      const err = { error: 'Only COO, Workflow Builder, or Content Orchestrator can watch agent workflow runs' };
      logTool(req, 'agent_workflow_watch', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const runId = Number(requestPayload.run_id || requestPayload.runId);
    if (!runId) {
      const err = { error: 'run_id required' };
      logTool(req, 'agent_workflow_watch', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = registerWorkflowRunWatch(runId, {
      ownerUserId,
      actorAgentId: caller?.id || null,
      actorName: caller?.name || null,
      notifyOnWaiting: requestPayload.notify_on_waiting !== false,
      notifyOnTerminal: requestPayload.notify_on_terminal !== false,
    });
    if (!out.ok) {
      logTool(req, 'agent_workflow_watch', requestPayload, out, 'error', source);
      return res.status(404).json(out);
    }
    logTool(req, 'agent_workflow_watch', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_watch', requestPayload, err, 'error', source);
    res.status(500).json(err);
  }
});

/**
 * COO cron poll for one workflow run: NO_REPLY while running; text when waiting/terminal.
 * Body: { run_id, cron_job_id? }. Reply field is what the cron agent must emit.
 */
router.post('/agent-workflow-watch-tick', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  const runId = Number(requestPayload.run_id || requestPayload.runId);
  const cronJobId = String(requestPayload.cron_job_id || requestPayload.job_id || '').trim() || null;
  try {
    if (!runId) {
      const err = { error: 'run_id required' };
      logTool(req, 'agent_workflow_watch_tick', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const caller = getCallerAgent(req);
    if (caller && !caller.is_coo && !isWorkflowBuilderCaller(caller)) {
      const err = { error: 'Only COO or Workflow Builder may use agent_workflow_watch_tick' };
      logTool(req, 'agent_workflow_watch_tick', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const ownerUserId = resolveWorkflowOwner(req, requestPayload);
    const out = await runWorkflowWatchTick({ runId, cronJobId, ownerUserId });
    if (!out.ok) {
      logTool(req, 'agent_workflow_watch_tick', requestPayload, out, 'error', source);
      return res.status(404).json(out);
    }
    logTool(req, 'agent_workflow_watch_tick', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'agent_workflow_watch_tick', requestPayload, err, 'error', source);
    res.status(500).json(err);
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
  let governed = null;
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
    // Channel identity is accepted only on the owner+agent scoped plugin hop and is
    // forwarded to our internal endpoint; model parameters can never supply it.
    if (req.toolsApiAuth && !req.legacyToolsApiAuth) {
      for (const h of ['x-openclaw-requester-sender-id', 'x-openclaw-message-channel', 'x-openclaw-account-id']) {
        if (req.headers[h]) headers[h] = String(req.headers[h]);
      }
    }
    const sessionKey = String(req.headers['x-openclaw-session-key'] || req.headers['x-session-key'] || '');
    const sessionActor = lookupOpenClawSessionActor(sessionKey);
    if (sessionActor && (!ownerUserId || String(sessionActor.ownerUserId) === String(ownerUserId))) {
      headers['x-flolah-actor-user-id'] = sessionActor.actorUserId;
      headers['x-flolah-actor-channel'] = sessionActor.channel || 'web';
    }
    if (ownerUserId) {
      if (!headers['x-ceo-user-id']) headers['x-ceo-user-id'] = ownerUserId;
    }
    const policy = req.actionPolicy || evaluateActionPolicy({
      ownerUserId,
      toolName,
      body: params,
      goalRunId: params.goal_run_id || params.goalRunId || null,
    });
    if (policy?.ok === false) {
      logTool(req, toolName, req.body, policy, 'error', source);
      return res.status(Number(policy.status) || 403).json(policy);
    }
    // Approval grants authorize this hop only. Never forward or persist the bearer token downstream.
    delete params.approval_token;
    // Owner and tenant identity are platform-derived. Never allow the model to forward or
    // vary them as tool arguments; downstream endpoints receive the trusted header above.
    for (const key of ['owner_user_id', 'ownerUserId', 'ceo_user_id', 'ceoUserId', 'user_id', 'userId']) {
      delete params[key];
    }
    governed = ownerUserId
      ? beginToolExecution({
          ownerUserId,
          agentId: source,
          sessionKey:
            req.headers['x-openclaw-session-key'] ||
            req.headers['x-openclaw-session-user'] ||
            req.headers['x-session-key'] ||
            null,
          traceId: inferTraceId(getLlmopsContext() || {}),
          toolName,
          params,
        })
      : null;
    if (governed?.duplicate) {
      const out = { ok: false, error: governed.observation.message, _execution: governed.observation };
      logTool(req, toolName, params, out, 'error', source);
      return res.status(409).json(out);
    }
    if (governed?.id) {
      const { validateRetrievedWrite } = await import('../services/retrieval-write-guard.js');
      const evidence = await validateRetrievedWrite(ownerUserId, governed);
      if (!evidence.ok) {
        const out = {ok:false,code:'EVIDENCE_REQUIRED',error:evidence.reason,evidence};
        completeToolExecution(governed, {httpStatus:422,data:out});
        logTool(req,toolName,params,out,'error',source);
        return res.status(422).json(out);
      }
    }
    if (row.auth_header && typeof row.auth_header === 'string' && row.auth_header.trim()) {
      headers['Authorization'] = row.auth_header.trim();
    }
    if (targetUrl.startsWith(baseUrl)) {
      Object.assign(headers, internalAuthHeaders());
      const policyPass = issueForwardedActionPolicyPass({ ownerUserId, toolName, decision: policy });
      if (policyPass) headers['x-flolah-action-policy-pass'] = policyPass;
    }
    if (governed?.id) headers['x-flolah-execution-action-id'] = governed.id;
    const fetchOpts = {
      method,
      headers,
      signal: AbortSignal.timeout(governed?.behaviour?.timeout_ms || 90000),
    };
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
    const observation = governed
      ? completeToolExecution(governed, { httpStatus: response.status, data })
      : null;
    const governedData = data && typeof data === 'object' && !Array.isArray(data)
      ? { ...data, ...(observation ? { _execution: observation } : {}) }
      : { result: data, ...(observation ? { _execution: observation } : {}) };
    const status = response.ok ? 'ok' : 'error';
    logTool(req,toolName, params, governedData, status, source);
    if (!response.ok) return res.status(response.status).json(governedData);
    res.json(governedData);
  } catch (e) {
    const errMsg = e.name === 'AbortError' ? 'Request timeout' : e.message;
    if (governed?.id) {
      try {
        completeToolExecution(governed, {
          httpStatus: e.name === 'AbortError' ? 408 : 500,
          data: { error: errMsg },
        });
      } catch (_) {}
    }
    logTool(req,req.body?.tool_name || '?', req.body, { error: errMsg }, 'error', source);
    res.status(500).json({ error: errMsg });
  }
});


router.post('/platform-feedback-submit', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const user = req.authUser || null;
    const out = submitPlatformFeedback(requestPayload, {
      ownerUserId,
      userId: user?.id || ownerUserId,
      userName: user?.name || null,
      userEmail: user?.email || null,
      agentId: source,
      initiatorName: user?.name || source || 'agent',
      initiatorEmail: user?.email || null,
    });
    logTool(req, 'platform_feedback_submit', requestPayload, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'platform_feedback_submit', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/platform-feedback-enquire', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const out = enquirePlatformFeedback(requestPayload);
    logTool(req, 'platform_feedback_enquire', requestPayload, { ok: out.ok, count: out.count }, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'platform_feedback_enquire', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/inbound-attachment-save', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = req.body || {};
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    const b64 = requestPayload.content_base64 || requestPayload.contentBase64;
    if (!b64) return res.status(400).json({ error: 'content_base64 required' });
    const buffer = Buffer.from(String(b64), 'base64');
    const out = saveInboundAttachment(ownerUserId, {
      buffer,
      filename: requestPayload.filename || 'upload.bin',
      mimeType: requestPayload.mime_type || requestPayload.mimeType,
    });
    logTool(req, 'inbound_attachment_save', { filename: out.filename, bytes: out.bytes }, out, 'ok', source);
    res.json({ ok: true, ...out });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'inbound_attachment_save', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});
router.post('/browse-session-status', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const out = await getBrowserSessionStatus(ownerUserId);
    logTool(req, 'browse_session_status', requestPayload, { ok: true, mode: out.session?.mode }, 'ok', source);
    res.json({ ok: true, ...out });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_session_status', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-task-start', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    if (source) {
      const grantCheck = assertCallerMayUseTool(source, 'browse_task_start');
      if (!grantCheck.ok) {
        const err = { error: grantCheck.error || 'Tool not allowed for this agent' };
        logTool(req, 'browse_task_start', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
      const mode = String(requestPayload.mode || '').trim();
      if (mode === 'recipe_replay') {
        const runGrant = assertCallerMayUseTool(source, 'browse_recipe_run');
        if (!runGrant.ok) {
          const err = {
            error:
              runGrant.error ||
              'Playing saved recipes requires browse_recipe_run tool access (Agent Workspace → Tool access). Prefer calling browse_recipe_run.',
          };
          logTool(req, 'browse_task_start', requestPayload, err, 'error', source);
          return res.status(403).json(err);
        }
      }
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const executionContext = lookupSessionExecutionContext(
      req.headers['x-openclaw-session-key'] || req.headers['x-session-key'], ownerUserId
    );
    const task = await startBrowserTask(ownerUserId, {
      ...requestPayload,
      ...(executionContext ? {
        input: { ...requestPayload.input, work_unit_id: executionContext.work_unit_id || null },
        goal_run_id: executionContext.goal_run_id || requestPayload.goal_run_id,
        goal_step_id: executionContext.goal_step_id || requestPayload.goal_step_id,
      } : {}),
      ...(executionContext ? { goal: [
        'Original user request (preserve its outcomes and constraints):', executionContext.original_request,
        'Resolved conversation context:', executionContext.resolved_request,
        'Browser-specific assignment:', requestPayload.goal || requestPayload.goal_text || '',
        'Perform only browser work relevant to this assignment. Do not execute unrelated actions from the broader request.',
      ].join('\n') } : {}),
      agent_id: source || requestPayload.agent_id || 'workflowbuilder',
    });
    logTool(req, 'browse_task_start', requestPayload, { ok: true, id: task.id }, 'ok', source);
    res.json({
      ok: true,
      task_id: task.id,
      task,
      agent_hint:
        `Task routed to ${task.selected_driver_mode || 'unknown'}${task.selected_node_id ? ` node ${task.selected_node_id}` : ''}. Do not use the built-in browser tool before or after this task. Immediately tell the CEO this task_id and actual selected_driver_mode. Optionally call browse_task_status once with wait_ms: 90000; if still running, reply with the task_id.`,
    });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_task_start', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-task-status', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    if (source) {
      const grantCheck = assertCallerMayUseTool(source, 'browse_task_status');
      if (!grantCheck.ok) {
        const err = { error: grantCheck.error || 'Tool not allowed for this agent' };
        logTool(req, 'browse_task_status', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    if (requestPayload.task_id) {
      const waitMs = Math.min(90000, Math.max(Number(requestPayload.wait_ms ?? requestPayload.waitMs) || 0, 0));
      const task = waitMs
        ? await waitForBrowserTask(ownerUserId, String(requestPayload.task_id), waitMs)
        : getBrowserTask(ownerUserId, String(requestPayload.task_id));
      if (!task) return res.status(404).json({ error: 'Task not found' });
      logTool(req, 'browse_task_status', requestPayload, { ok: true, status: task.status }, 'ok', source);
      return res.json({ ok: true, task });
    }
    const page = listBrowserTasks(ownerUserId, {
      limit: requestPayload.limit || 10,
      offset: requestPayload.offset || 0,
      days: requestPayload.days,
    });
    logTool(req, 'browse_task_status', requestPayload, { ok: true, n: page.tasks.length }, 'ok', source);
    res.json({ ok: true, ...page });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_task_status', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-snapshot', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const out = await toolBrowseSnapshot(ownerUserId, requestPayload);
    logTool(req, 'browse_snapshot', requestPayload, { ok: true, profile: out.profile }, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_snapshot', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-act', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const out = await toolBrowseAct(ownerUserId, requestPayload);
    logTool(req, 'browse_act', requestPayload, { ok: out.ok }, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_act', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-recipe-list', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    if (source) {
      const grantCheck = assertCallerMayUseTool(source, 'browse_recipe_list');
      if (!grantCheck.ok) {
        const err = { error: grantCheck.error || 'Tool not allowed for this agent' };
        logTool(req, 'browse_recipe_list', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const page = listRecipes(ownerUserId, {
      limit: requestPayload.limit,
      offset: requestPayload.offset,
    });
    logTool(req, 'browse_recipe_list', requestPayload, { ok: true, n: page.recipes.length }, 'ok', source);
    res.json({ ok: true, ...page });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_recipe_list', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});

router.post('/browse-recipe-run', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    if (source) {
      const grantCheck = assertCallerMayUseTool(source, 'browse_recipe_run');
      if (!grantCheck.ok) {
        const err = {
          error:
            grantCheck.error ||
            'Playing saved recipes requires browse_recipe_run tool access (Agent Workspace → Tool access)',
        };
        logTool(req, 'browse_recipe_run', requestPayload, err, 'error', source);
        return res.status(403).json(err);
      }
    }
    const recipeName = String(requestPayload.recipe_name || requestPayload.recipeName || '').trim();
    const recipeId = String(requestPayload.recipe_id || requestPayload.recipeId || '').trim();
    if (!recipeName && !recipeId) {
      const err = { error: 'recipe_name or recipe_id required' };
      logTool(req, 'browse_recipe_run', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload);
    const recipe = recipeId
      ? getRecipe(ownerUserId, recipeId)
      : getRecipeByName(ownerUserId, recipeName);
    if (!recipe) {
      const err = { error: 'Recipe not found for this CEO', code: 'RECIPE_NOT_FOUND' };
      logTool(req, 'browse_recipe_run', requestPayload, err, 'error', source);
      return res.status(404).json(err);
    }
    const prepared = prepareRecipeInputs(recipe, requestPayload.inputs || requestPayload.input || {});
    const preparation = {
      recipe_id: recipe.id,
      recipe_name: recipe.name,
      required_inputs: prepared.required_inputs,
      resolved_inputs: prepared.resolved_inputs,
      missing_inputs: prepared.missing_inputs,
      ready: prepared.ready,
      browser_task_created: false,
    };
    const prepareOnly = requestPayload.prepare_only === true || requestPayload.prepareOnly === true;
    if (prepareOnly) {
      logTool(req, 'browse_recipe_run', requestPayload, { ok: true, prepare_only: true, ready: prepared.ready }, 'ok', source);
      return res.json({
        ok: true,
        prepare_only: true,
        preparation,
        agent_hint: prepared.ready
          ? 'Prepared only; no browser task was created. Execute only when the CEO requested execution.'
          : `Prepared only; ask for missing input(s): ${prepared.missing_inputs.join(', ')}.`,
      });
    }
    if (!prepared.ready) {
      const err = {
        error: `Missing required recipe input(s): ${prepared.missing_inputs.join(', ')}`,
        code: 'RECIPE_INPUTS_MISSING',
        ...preparation,
      };
      logTool(req, 'browse_recipe_run', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const task = await startBrowserTask(ownerUserId, {
      mode: 'recipe_replay',
      recipe_name: recipe.name,
      recipe_id: recipe.id,
      start_url: requestPayload.start_url || requestPayload.startUrl,
      goal: requestPayload.goal || (recipeName ? `Replay recipe: ${recipeName}` : `Replay recipe ${recipeId}`),
      agent_id: source || requestPayload.agent_id || 'workflowbuilder',
      inputs: prepared.resolved_inputs,
    });
    const waitMs = Math.min(90000, Math.max(Number(requestPayload.wait_ms ?? requestPayload.waitMs) || 0, 0));
    const finalTask = waitMs ? await waitForBrowserTask(ownerUserId, String(task.id), waitMs) : task;
    logTool(
      req,
      'browse_recipe_run',
      requestPayload,
      { ok: true, id: finalTask?.id || task.id, status: finalTask?.status || task.status },
      'ok',
      source
    );
    res.json({
      ok: true,
      task_id: finalTask?.id || task.id,
      task: finalTask || task,
      agent_hint:
        'Recipe replay started. Tell the CEO this task_id. If still running, call browse_task_status with wait_ms: 90000 (requires browse_task_status grant).',
    });
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'browse_recipe_run', requestPayload, err, 'error', source);
    res.status(e.status || 400).json(err);
  }
});


/**
 * video_storyboard_export — HTML/PDF/SVG storyboard for entitled CEO (Phase 1 video studio).
 * Body: { storyboard, storyboard_id?, formats?, persist?, workflow_run_id? }
 */
router.post('/video-storyboard-export', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_storyboard_export', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { exportVideoStoryboard } = await import('../services/video-storyboard-export.js');
    const out = await exportVideoStoryboard(ownerUserId, requestPayload);
    logTool(
      req,
      'video_storyboard_export',
      { storyboard_id: out.storyboard_id, title: out.title, scene_count: out.scene_count },
      { ok: true, storyboard_id: out.storyboard_id, media_lines: out.media_lines },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_storyboard_export', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_characters_save — upsert character refs into Master Data video_characters (owner-scoped).
 */
router.post('/video-characters-save', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_characters_save', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { saveVideoCharacters } = await import('../services/video-storyboard-export.js');
    const characters = Array.isArray(requestPayload.characters) ? requestPayload.characters : [];
    if (!characters.length) {
      const err = { error: 'characters array required' };
      logTool(req, 'video_characters_save', requestPayload, err, 'error', source);
      return res.status(400).json(err);
    }
    const out = saveVideoCharacters(ownerUserId, characters);
    logTool(req, 'video_characters_save', { count: characters.length }, out, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_characters_save', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_story_status — list storyboard knowledge rows + pending CEO approval advice.
 */
router.post('/video-story-status', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_story_status', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { listVideoStoryStatuses } = await import('../services/video-storyboard-export.js');
    const out = listVideoStoryStatuses(ownerUserId, {
      title: requestPayload.title || requestPayload.query || '',
      limit: requestPayload.limit,
    });
    logTool(
      req,
      'video_story_status',
      { title: requestPayload.title || null },
      {
        ok: true,
        n: out.stories?.length || 0,
        pending: out.pending_ceo_approval?.length || 0,
      },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_story_status', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_storyboard_attach — paste-ready MEDIA: /api/media lines for PDF/HTML/image exports into chat.
 */
router.post('/video-storyboard-attach', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_storyboard_attach', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { attachVideoStoryboardMedia } = await import('../services/video-storyboard-export.js');
    const out = attachVideoStoryboardMedia(ownerUserId, {
      storyboard_id: requestPayload.storyboard_id || requestPayload.id || '',
      title: requestPayload.title || '',
      workflow_run_id: requestPayload.workflow_run_id || requestPayload.run_id || '',
    });
    logTool(
      req,
      'video_storyboard_attach',
      { storyboard_id: out.storyboard_id, title: out.title },
      { ok: true, lines: out.media_lines?.length || 0 },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_storyboard_attach', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_characters_ensure_refs — generate/reuse portraits → Content Explorer + video_characters.ref_media/image_id.
 */
router.post('/video-characters-ensure-refs', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_characters_ensure_refs', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { ensureVideoCharacterRefs } = await import('../services/video-characters.js');
    const characters = Array.isArray(requestPayload.characters) ? requestPayload.characters : [];
    const out = await ensureVideoCharacterRefs(ownerUserId, {
      characters,
      force_regenerate: Boolean(requestPayload.force_regenerate || requestPayload.force),
      style_hint: requestPayload.style_hint || requestPayload.style || '',
      series: requestPayload.series || '',
    });
    logTool(
      req,
      'video_characters_ensure_refs',
      { n: characters.length },
      { ok: true, results: out.results?.map((r) => ({ id: r.character_id, action: r.action })) },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code };
    logTool(req, 'video_characters_ensure_refs', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_characters_bind_upload — map CEO-uploaded image to character_name in video_characters.
 */
router.post('/video-characters-bind-upload', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_characters_bind_upload', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { bindVideoCharacterUpload } = await import('../services/video-characters.js');
    const out = bindVideoCharacterUpload(ownerUserId, requestPayload);
    if (out?.code === 'character_name_required') {
      logTool(req, 'video_characters_bind_upload', requestPayload, out, 'ok', source);
      return res.status(200).json(out);
    }
    logTool(
      req,
      'video_characters_bind_upload',
      { character_id: out.character_id },
      { ok: true, action: out.action, image_id: out.image_id },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code };
    logTool(req, 'video_characters_bind_upload', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/**
 * video_characters_list — list reusable cast with has_image / missing_images.
 */
router.post('/video-characters-list', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_characters_list', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { listVideoCharacters } = await import('../services/video-characters.js');
    const out = listVideoCharacters(ownerUserId, {
      query: requestPayload.query || requestPayload.title || '',
    });
    logTool(req, 'video_characters_list', requestPayload, { ok: true, n: out.characters?.length || 0 }, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_characters_list', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/** S4 — generate per-scene clips (flow_browser | replicate_api), max 8s each. */
router.post('/video-media-generate', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_media_generate', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { generateVideoMedia } = await import('../services/video-media.js');
    const out = await generateVideoMedia(ownerUserId, requestPayload);
    logTool(
      req,
      'video_media_generate',
      { storyboard_id: out.storyboard_id, provider: out.provider },
      { ok: true, complete: out.manifest?.complete, n: out.results?.length },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code };
    logTool(req, 'video_media_generate', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/** S4 Flavour 1 — bind downloaded Flow clip to a scene. */
router.post('/video-media-ingest-clip', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_media_ingest_clip', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { ingestVideoSceneClip } = await import('../services/video-media.js');
    const out = await ingestVideoSceneClip(ownerUserId, requestPayload);
    logTool(
      req,
      'video_media_ingest_clip',
      { storyboard_id: requestPayload.storyboard_id, scene_index: requestPayload.scene_index },
      { ok: true, job_id: out.job?.job_id },
      'ok',
      source
    );
    res.json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code };
    logTool(req, 'video_media_ingest_clip', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/** S4 — list jobs + manifest. */
router.post('/video-media-jobs', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_media_jobs', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { listVideoJobs, buildAssetManifest, refreshFlowBrowseJobs } = await import(
      '../services/video-media.js'
    );
    const storyboard_id = String(requestPayload.storyboard_id || '').trim();
    const jobs = listVideoJobs(ownerUserId, {
      storyboard_id,
      scene_index: requestPayload.scene_index,
    });
    const manifest = storyboard_id ? buildAssetManifest(ownerUserId, storyboard_id) : null;
    const browse =
      requestPayload.refresh_browse && storyboard_id
        ? await refreshFlowBrowseJobs(ownerUserId, { storyboard_id })
        : null;
    const out = { ok: true, ...jobs, manifest, browse };
    logTool(req, 'video_media_jobs', requestPayload, { ok: true, n: jobs.jobs?.length || 0 }, 'ok', source);
    res.json(out);
  } catch (e) {
    const err = { error: e.message };
    logTool(req, 'video_media_jobs', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

/** S5 — FFmpeg assemble + mark video_generated. */
router.post('/video-assemble', optionalAuth, async (req, res) => {
  const source = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || null;
  const requestPayload = bodyWithoutSpoofedOwner(req.body || {});
  try {
    const ownerUserId = resolveToolOwnerUserId(req, requestPayload, resolveAuthenticatedCeoUserId);
    if (!ownerUserId) {
      const err = { error: 'Could not resolve CEO user for this session' };
      logTool(req, 'video_assemble', requestPayload, err, 'error', source);
      return res.status(403).json(err);
    }
    const { assembleVideoStoryboard } = await import('../services/video-assemble.js');
    const out = await assembleVideoStoryboard(ownerUserId, requestPayload);
    logTool(
      req,
      'video_assemble',
      { storyboard_id: out.storyboard_id },
      { ok: out.ok, status: out.status, code: out.code },
      out.ok ? 'ok' : 'error',
      source
    );
    res.status(out.ok ? 200 : 409).json(out);
  } catch (e) {
    const err = { error: e.message, code: e.code };
    logTool(req, 'video_assemble', requestPayload, err, 'error', source);
    res.status(e.status || 500).json(err);
  }
});

router.use(socialResearchTools);
router.use(webScrapeTools);

export default router;
