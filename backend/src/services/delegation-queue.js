/**
 * Delegation: schedule OpenClaw Gateway cron jobs (detailed prompt, agentId, webhook) per agent.
 * Uses OpenAI to classify intent from the COO's AGENTS.md (agents and use cases); no hardcoded agent list.
 * Injects agent MEMORY.md into prompts (OpenClaw does not inject it in isolated cron runs) and appends completions to MEMORY.md.
 */
import { readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';
import { isPlatformLocalOllama } from './platform-llm-settings.js';
import { hasAnyActiveDashboardChat, registerOpenClawSessionOwner } from './tool-owner-scope.js';
import { extractOwnerUserIdFromText } from './agent-chat-scope.js';
import { insertChatTurn } from './chat-history.js';
import { getActiveLearningPrompt, recordExecutionLearningVersions } from './agent-learning-rollout.js';
import { cronAddOneShotWebhook } from '../gateway/openclaw-cron.js';
import { classifyIntentAndAllocate } from './intent-classifier.js';
import {
  maybeHandoffJobPipeline,
  filterPipelineDelegationsForProcessing,
  failPipelineWorkflowForDelegation,
  recoverStaleProcessingDelegations,
} from './job-applicant-pipeline.js';
import {
  completePipelineKanbanForDelegation,
  markKanbanInProgressForDelegation,
} from './kanban-workflow-stage.js';
import {
  buildDelegationKanbanFinishPrompt,
  nudgeIfStatusOnlyReply,
} from './kanban-reply-enrich.js';
import {
  requeueKanbanAfterStatusOnlyReply,
  requeueStuckStatusOnlyKanbanCards,
  rependInfraFailedStatusOnlyRetries,
  isTransientOpenClawError,
  getTransientAttempt,
  maxGatewayTransientRetries,
} from './delegation-status-only-retry.js';
import {
  completeAgentWorkflowKanbanForDelegation,
  isAgentWorkflowPrompt,
  isAvatarAgentWorkflowPrompt,
} from './agent-workflow-kanban.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { ensureInternalTokenConfigured } from '../middleware/internal-auth.js';
import { maybeAdvanceAgentWorkflow, failAgentWorkflowForDelegation } from './agent-workflow-runner.js';
import { ensureTenantOpenClawAgent, tenantWorkspacePath } from './openclaw-tenant.js';
import { getBalaCeoAuthId } from './job-applicant-ceo.js';
import {
  getAgentsUnderCooForCeo,
  getCooAgentRow,
  readCooAgentsMdForCeo,
  withOwnerScope,
} from './org-context.js';
import { bindWorkUnitExecution, getWorkUnit } from './agent-turn-router.js';
import { isUserEnabled } from './user-enabled.js';
import { notifyKanbanTaskCreated } from './platform-notifications.js';
import { meterOpenClawUsage } from './token-usage.js';
import { enforceBudget } from './agent-budgets.js';
import { splitAllocationByKind } from './org-member-keys.js';
import { listNativeOpenClawToolCalls, persistNativeToolCallsToLogs } from './openclaw-session-tools.js';

const SESSION_USER = 'agent-os-delegation';
const AGENTS_MD_NAME = 'AGENTS.md';
const MEMORY_MD_NAME = 'MEMORY.md';
const MEMORY_MAX_LINES = 35;
const homedir = process.env.USERPROFILE || process.env.HOME || '';

/** Prevent duplicate concurrent runs of the same delegation within this process. */
const runningDelegationIds = new Set();

/** Clear in-memory run lock (orphan watcher re-pend / stuck processing recovery). */
export function releaseDelegationRunLock(delegationId) {
  const id = Number(delegationId);
  if (!Number.isFinite(id) || id <= 0) return false;
  return runningDelegationIds.delete(id);
}

export function isDelegationRunLocked(delegationId) {
  return runningDelegationIds.has(Number(delegationId));
}

function db() {
  return getDb();
}

/** Normalize OpenClaw/OpenAI reply to a single string (so standup and agent chat store same shape). */
export function normalizeReplyContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content.map((p) => {
      if (!p || typeof p !== 'object') return '';
      if (p.type === 'text' && p.text) return p.text;
      if ((p.type === 'image_url' || p.type === 'image') && (p.image_url?.url || p.image_url)) {
        const url = typeof p.image_url === 'string' ? p.image_url : p.image_url?.url;
        return url ? `\n![image](${url})\n` : '';
      }
      return '';
    });
    return parts.join('');
  }
  return String(content);
}

/** Truncate to maxLen but don't cut in the middle of a markdown image or http URL (so frontend can still render). */
function truncatePreservingImages(text, maxLen = 2000) {
  const s = (text || '').trim();
  if (s.length <= maxLen) return s;
  let cut = s.slice(0, maxLen);
  const rest = s.slice(maxLen);
  // If we cut inside ![ or ](http, extend to include the full image
  const mdImgStart = cut.lastIndexOf('![');
  const mdImgParen = rest.indexOf(')');
  if (mdImgStart !== -1 && cut.indexOf('](', mdImgStart) === -1 && mdImgParen !== -1) {
    cut = cut + rest.slice(0, mdImgParen + 1);
  } else {
    const lastOpen = cut.lastIndexOf('](http');
    if (lastOpen !== -1) {
      const close = rest.indexOf(')');
      if (close !== -1) cut = cut + rest.slice(0, close + 1);
    }
  }
  return cut;
}

function getBaseUrl() {
  return getPublicBaseUrl();
}

function getStandupOwnerUserId(standupId) {
  const row = db().prepare('SELECT owner_user_id FROM standups WHERE id = ?').get(standupId);
  return row?.owner_user_id || getBalaCeoAuthId();
}

function getAgentsUnderCoo(ceoUserId) {
  return getAgentsUnderCooForCeo(ceoUserId);
}

/**
 * Read the COO workspace AGENTS.md (lists agents and use cases). Used by the intent classifier.
 * @returns {Promise<string>} File content or empty string if missing/unreadable
 */
async function readCooAgentsMd(ceoUserId) {
  if (ceoUserId) return readCooAgentsMdForCeo(ceoUserId);
  const coo = db().prepare('SELECT workspace_path FROM agents WHERE is_coo = 1 LIMIT 1').get();
  if (!coo?.workspace_path) return '';
  const path = join(coo.workspace_path, AGENTS_MD_NAME);
  try {
    return await readFile(path, 'utf8');
  } catch (_) {
    return '';
  }
}

/**
 * Get workspace path for an agent (tenant when ceoUserId known, else legacy DB path).
 */
function getAgentWorkspacePath(agentId, ceoUserId = null) {
  if (ceoUserId) {
    const agent = db().prepare('SELECT openclaw_agent_id, id FROM agents WHERE id = ?').get(agentId);
    if (agent) {
      const baseId = String(agent.openclaw_agent_id || agent.id).toLowerCase();
      return tenantWorkspacePath(ceoUserId, baseId);
    }
  }
  const row = db().prepare('SELECT workspace_path FROM agents WHERE id = ?').get(agentId);
  if (row?.workspace_path) return row.workspace_path;
  const dir = agentId === 'bala' ? 'workspace' : `workspace-${agentId}`;
  return join(homedir, '.openclaw', dir);
}

/**
 * Read agent's MEMORY.md (recent completions). Returns content to inject into prompt, or empty string.
 */
async function readAgentMemory(agentId, ceoUserId = null) {
  const workspacePath = getAgentWorkspacePath(agentId, ceoUserId);
  const memoryPath = join(workspacePath, MEMORY_MD_NAME);
  try {
    const raw = await readFile(memoryPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const bulletLines = lines.filter((l) => /^\s*[-*]/.test(l) || /^\d+\./.test(l));
    const recent = bulletLines.slice(-MEMORY_MAX_LINES);
    if (recent.length === 0) return '';
    return recent.join('\n').slice(0, 2500);
  } catch (_) {
    return '';
  }
}

/**
 * Extract task body between --- markers (innermost non-empty block wins for wrapped prompts).
 */
export function extractTaskContentFromPrompt(prompt, maxLen = 4000) {
  if (!prompt || typeof prompt !== 'string') return '';
  const trimmed = prompt.trim();
  const markers = [...trimmed.matchAll(/---\s*\n([\s\S]*?)\n\s*---/g)];
  const parts = markers.map((m) => m[1].trim()).filter(Boolean);
  if (parts.length) return parts[parts.length - 1].slice(0, maxLen);
  if (trimmed.includes('New request:')) {
    const after = trimmed.split('New request:')[1];
    if (after) return after.trim().slice(0, maxLen);
  }
  return trimmed.slice(0, maxLen);
}

/**
 * Extract the actual task content from a delegation prompt for use as a memory summary.
 * Prompt format: "... ---\n<task content>\n---\n..." or "New request:\n\n<base prompt>".
 * Returns a short string (max 120 chars) describing what was done, not the generic intro.
 */
export function extractTaskSummaryFromPrompt(prompt) {
  const content = extractTaskContentFromPrompt(prompt, 500);
  if (!content) return 'Task completed';
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.slice(0, 120) || 'Task completed';
}

/**
 * Append delegation task request and response to agent's chat_turns so Agent Chat page shows it.
 */
export function appendDelegationResponseToAgentChat(agentId, promptSnippet, responseContent, ownerUserId = null, sessionId = null) {
  if (!agentId || responseContent == null) return;
  const owner =
    ownerUserId ||
    extractOwnerUserIdFromText(promptSnippet) ||
    extractOwnerUserIdFromText(typeof responseContent === 'string' ? responseContent : '');
  const userMsg = (promptSnippet || 'Task from COO').trim().slice(0, 4000);
  const assistantMsg = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim().slice(0, 100000);
  try {
    insertChatTurn({ agentId, ownerUserId: owner, role: 'user', content: userMsg, sessionId });
    insertChatTurn({ agentId, ownerUserId: owner, role: 'assistant', content: assistantMsg, sessionId });
  } catch (_) {}
}

/**
 * Append a completion line to the agent's MEMORY.md. Call when a delegation task completes.
 */
export async function appendToAgentMemory(agentId, summaryLine, ceoUserId = null) {
  const workspacePath = getAgentWorkspacePath(agentId, ceoUserId);
  const memoryPath = join(workspacePath, MEMORY_MD_NAME);
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${summaryLine} – ${date}\n`;
  try {
    await appendFile(memoryPath, line, 'utf8');
  } catch (_) {
    // workspace or file may not exist; ignore
  }
}

/**
 * Build prompt instructing the agent to get session history for context, read MEMORY.md, and only respond if not already done today.
 * We do not inject memory content here (it was truncated); the agent reads MEMORY.md from its workspace.
 * Exported for use by standup-delegate and cron/standup so all COO-sent instructions include this.
 *
 * Do NOT use for scheduled goals or goal-plan agent_continue — those must run fresh every fire;
 * the "already done today?" hint causes the agent to reuse yesterday's outcome / invent short
 * summaries instead of executing the current run's tools and prior-step artifacts.
 */
export async function getPromptWithMemoryInjected(agentId, basePrompt) {
  return `Before responding: get your session history for context (use sessions_history with your session key if available) so you have the conversation context. Then read your MEMORY.md file in your workspace. If you have already responded to this request or a very similar one today (check the entries there), reply briefly that you already did so and ask whether to redo or reuse. If not, respond to the request below.

---
${basePrompt.trim()}
---`;
}

/**
 * Scheduled / goal-plan turns: execute this run only — no MEMORY / sessions_history dedupe.
 */
export function getPromptForFreshGoalRun(basePrompt) {
  return (
    `Execute this goal run now using the CEO instructions and any prior steps of THIS run only. ` +
    `Do not skip because a similar scheduled goal ran earlier today. Do not reuse or paraphrase prior emails/digests from memory — use fresh tool outputs for this run.\n\n` +
    `---\n${String(basePrompt || '').trim()}\n---`
  );
}

/**
 * Build a detailed prompt for an agent from the CEO's request (use filtered context per agent).
 */
function buildDetailedPromptForAgent(relevantMessage, agentName, agentRole) {
  const rolePart = agentRole ? ` You are ${agentName} (${agentRole}).` : ` You are ${agentName}.`;
  return `The originating orchestrator has delegated this owner-scoped work order to you:

---
${relevantMessage.trim()}
---

${rolePart} Execute only this work order. Return concrete evidence and the completed deliverable to the originating orchestrator.`;
}

/**
 * Structural handoff contract. This deliberately does not inspect business
 * keywords: a delegated work order must contain enough human-readable content
 * to stand alone instead of punctuation, a tool placeholder, or a bare label.
 */
export function isUsableDelegationWorkOrder(value) {
  const text = String(value || '')
    .replace(/\[(?:ceo|owner)_user_id:[^\]]+\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const alphaNumericCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return words.length >= 3 && alphaNumericCount >= 12;
}

/**
 * Get recent standup + CEO Dashboard chat context for intent classification.
 * Dashboard chats use chat_turns, not standup_messages — so without chat_turns
 * "delegate to MarketWatcher" loses Mag7 from the prior turn.
 * Excludes the current message from lastUserMessages when it matches ceoMessage.
 * @param {number} standupId
 * @param {string} [ceoMessage]
 * @param {string|null} [ownerUserId]
 * @returns {{ lastUserMessages: string[], agentResponses: { agent_id: string, content: string }[] }}
 */
function getStandupContextForIntent(standupId, ceoMessage = '', ownerUserId = null) {
  const currentTrim = (ceoMessage || '').trim().replace(/\[(ceo|owner)_user_id:[^\]]+\]/gi, '').trim();
  const seen = new Set();
  const lastUserMessages = [];

  const pushMsg = (raw) => {
    const m = String(raw || '')
      .trim()
      .replace(/\[(ceo|owner)_user_id:[^\]]+\]/gi, '')
      .trim();
    if (!m || m.length < 3) return;
    const key = m.toLowerCase().slice(0, 240);
    if (seen.has(key)) return;
    // skip pure COO digests
    if (/^updates from the team|^##\s*coo status report/i.test(m)) return;
    seen.add(key);
    lastUserMessages.push(m);
  };

  const userRows = db()
    .prepare(
      'SELECT content FROM standup_messages WHERE standup_id = ? AND role = ? ORDER BY created_at DESC LIMIT 9'
    )
    .all(standupId, 'user');
  for (const r of userRows) pushMsg(r.content);

  // Dashboard COO chat (primary for CEO conversations)
  if (ownerUserId) {
    try {
      const chatRows = db()
        .prepare(
          `SELECT ct.content FROM chat_turns ct
           JOIN chat_sessions cs ON cs.id = ct.session_id
           WHERE ct.owner_user_id = ?
             AND ct.role = 'user'
             AND cs.status = 'active'
             AND cs.owner_user_id = ct.owner_user_id
             AND cs.agent_id = ct.agent_id
             AND (ct.agent_id = 'balserve' OR ct.agent_id LIKE '%balserve%' OR ct.agent_id LIKE '%coo%')
           ORDER BY ct.id DESC LIMIT 6`
        )
        .all(String(ownerUserId));
      for (const r of chatRows) pushMsg(r.content);
    } catch (e) {
      console.warn('[delegation] chat_turns context load failed:', e?.message || e);
    }
  }

  // chronological oldest→newest for classifiers (we pushed newest-first)
  lastUserMessages.reverse();
  // drop current message if it appears as last
  if (lastUserMessages.length && currentTrim) {
    const last = lastUserMessages[lastUserMessages.length - 1];
    if (last === currentTrim || last.toLowerCase() === currentTrim.toLowerCase()) {
      lastUserMessages.pop();
    }
  }

  const taskRows = db()
    .prepare(
      'SELECT to_agent_id AS agent_id, response_content AS content, completed_at FROM agent_delegation_tasks WHERE standup_id = ? AND status = ? AND response_content IS NOT NULL AND response_content != ? ORDER BY completed_at DESC LIMIT 10'
    )
    .all(standupId, 'completed', '');
  const responseRows = db()
    .prepare(
      'SELECT agent_id, content, submitted_at FROM standup_responses WHERE standup_id = ? ORDER BY submitted_at DESC LIMIT 10'
    )
    .all(standupId);
  const withDate = [
    ...taskRows.map((r) => ({ agent_id: r.agent_id, content: r.content || '', at: r.completed_at })),
    ...responseRows.map((r) => ({ agent_id: r.agent_id, content: r.content || '', at: r.submitted_at })),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const agentResponses = withDate.slice(0, 10).map((r) => ({ agent_id: r.agent_id, content: r.content }));

  return { lastUserMessages, agentResponses };
}

/** True when query is handoff-routing only or a rewrite of the specialty purpose (no CEO deliverable). */
function isContextThinOrMetaHandoff(query) {
  const q = String(query || '').trim();
  if (!q) return true;
  if (
    /^(why not|why didn'?t|should( have)? (have )?(used|delegated)|please (delegate|assign)|ok( go)? ahead|go ahead|do it|delegate that)\b/i.test(
      q
    )
  ) {
    return true;
  }
  if (
    /^(?:please\s+)?(?:generate|create|write|do|run|send|post|publish|complete|continue|retry)\s+(?:the\s+)?(?:requested|above|previous|same|that|it)\b/i.test(q)
  ) {
    return true;
  }
  if (/^delegate to\b/i.test(q) || /^hand\s*off to\b/i.test(q) || /^assign (to|this)\b/i.test(q)) {
    return true;
  }
  if (/\bdelegate\s+(this\s+)?to\s+\w+/i.test(q) && q.length < 220) return true;
  // Role/purpose paraphrases (MarketWatcher-style) without a concrete CEO ask
  if (
    /monitor the configured|configurable equity\/crypto|watchlist and alert|dip by the configured/i.test(q) &&
    !/\b(mag\s*7|magnificent|aapl|msft|nvda|voog|insights for)\b/i.test(q)
  ) {
    return true;
  }
  if (q.length < 48 && /marketwatcher|techresearcher|market researcher|why not/i.test(q)) return true;
  return false;
}

/**
 * Cap an allocation map to at most maxAgents entries (prefer fewer specialists).
 * @returns {Record<string, string>}
 */
function capAllocatedAgents(allocated, maxAgents = 2) {
  if (!allocated || typeof allocated !== 'object') return {};
  const entries = Object.entries(allocated).filter(([, v]) => typeof v === 'string' && v.trim());
  if (entries.length <= maxAgents) {
    return Object.fromEntries(entries.map(([k, v]) => [String(k).toLowerCase(), v.trim()]));
  }
  console.warn(
    '[delegation] capping intent allocation',
    entries.map(([k]) => k),
    '→',
    entries.slice(0, maxAgents).map(([k]) => k)
  );
  return Object.fromEntries(
    entries.slice(0, maxAgents).map(([k, v]) => [String(k).toLowerCase(), v.trim()])
  );
}

/** Meta / role-echo handoffs lose Mag7-style work unit — stitch prior CEO lines into the specialist query. */
export function enrichTaskQueryWithPriorThread(query, lastUserMessages = [], currentCeoMessage = '') {
  const q = String(query || '').trim();
  if (!q) return q;
  const prior = (Array.isArray(lastUserMessages) ? lastUserMessages : [])
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  const current = String(currentCeoMessage || '')
    .trim()
    .replace(/\[(ceo|owner)_user_id:[^\]]+\]/gi, '')
    .trim();
  const queryThin = isContextThinOrMetaHandoff(q);
  const currentThin = isContextThinOrMetaHandoff(current);
  // A substantive current CEO message is the complete handoff boundary. Never blend
  // unrelated earlier chats or Kanban titles into it merely because the classifier
  // returned a short routing phrase.
  if (!currentThin) return queryThin ? current : q;
  const thin = queryThin || currentThin;
  const alreadyHasWork =
    !thin &&
    (q.length > 120 ||
      prior.some((p) => p.length > 24 && q.toLowerCase().includes(p.slice(0, 40).toLowerCase())));

  if (!prior.length && !current) return q;
  if (alreadyHasWork) return q;

  const thread = [];
  // A genuinely referential command ("delegate that") may use only the immediately
  // preceding active-chat turns. Older same-day topics are not part of this task.
  for (const p of prior.slice(-2)) {
    if (!thread.includes(p)) thread.push(p);
  }
  if (current && !thread.some((t) => t.toLowerCase() === current.toLowerCase()) && !/owner_user_id:/.test(current)) {
    // Prefer not treating "delegate to X: role prose" as the work unit
    if (!isContextThinOrMetaHandoff(current)) thread.push(current);
  }
  if (!thread.length) return q;

  const substantive = [...thread]
    .reverse()
    .find((m) => m.length > 12 && !isContextThinOrMetaHandoff(m));
  if (!substantive && !thin) return q;
  if (!substantive) return q;

  return [
    'CEO thread (include this whole unit of work):',
    ...thread.map((m, i) => `${i + 1}. ${m}`),
    '',
    `Primary deliverable:\n${substantive}`,
    thin || q !== substantive ? `Routing / current instruction:\n${q}` : `Task:\n${q}`,
    '',
    'Execute the primary deliverable (not only routing/meta text or a generic role description). Include tickers/themes named by the CEO (e.g. Mag7, VOOG).',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function enqueueAllocatedTasks({
  agents,
  allocated,
  standupId,
  requestId,
  ownerUserId,
  ins,
  kanbanIns,
  priorUserMessages = [],
  currentCeoMessage = '',
  notify = true,
  parentWorkUnitId = null,
  parentAgentId = null,
  reuseKanbanTaskId = null,
}) {
  const taskRows = [];
  for (const a of agents) {
    const rawQuery = allocated[a.id?.toLowerCase()] ?? allocated[a.id];
    if (!rawQuery || typeof rawQuery !== 'string') continue;
    const query = enrichTaskQueryWithPriorThread(rawQuery, priorUserMessages, currentCeoMessage);
    const prompt = buildDetailedPromptForAgent(query, a.name || a.id, a.role);
    const scopedPrompt = withOwnerScope(prompt, ownerUserId);
    ins.run(
      standupId,
      requestId,
      a.id,
      scopedPrompt,
      ownerUserId,
      parentWorkUnitId || null,
      parentAgentId || null
    );
    const row = db().prepare('SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1').get();
    if (row) {
      taskRows.push({ taskId: row.id, agent: a, query });
      // Prefer a CEO-facing title from primary deliverable when query is multi-line enriched
      const titleMatch = /Primary deliverable:\n([\s\S]+?)(?:\nRouting|\nTask:|\nExecute|$)/i.exec(query);
      const titleSource = (titleMatch?.[1] || query || '').trim().slice(0, 200).replace(/\s+/g, ' ');
      const descParts = [
        ownerUserId ? `owner_user_id: ${ownerUserId}` : '',
        (query || '').trim().slice(0, 4000),
      ].filter(Boolean);
      const reusable = Number(reuseKanbanTaskId || 0);
      if (reusable > 0 && taskRows.length === 1) {
        const updated = db().prepare(
          `UPDATE kanban_tasks
              SET title=?, description=?, status='in_progress', assigned_agent_id=?, standup_id=?,
                  agent_delegation_task_id=?,
                  updated_at=datetime('now')
            WHERE id=? AND owner_user_id=?`
        ).run(titleSource, descParts.join('\n\n'), a.id, standupId, row.id, reusable, ownerUserId || null);
        if (!updated.changes) kanbanIns.run(titleSource, descParts.join('\n\n'), a.id, standupId, row.id, ownerUserId || null);
      } else {
        kanbanIns.run(titleSource, descParts.join('\n\n'), a.id, standupId, row.id, ownerUserId || null);
      }
      if (notify && ownerUserId) {
        const krow = db()
          .prepare('SELECT * FROM kanban_tasks WHERE agent_delegation_task_id = ?')
          .get(row.id);
        if (krow) notifyKanbanTaskCreated({ userId: ownerUserId, task: krow });
      }
    }
  }
  return taskRows;
}

/**
 * Collect status from every agent under the COO (standup "Get work from team").
 * Does not use specialty intent classification — that path incorrectly returns zero
 * agents for the literal button text "Get work from team."
 */
export async function scheduleStandupStatusFanout(standupId, ceoUserId = null, contextText = '', opts = {}) {
  const ownerUserId = ceoUserId || getStandupOwnerUserId(standupId);
  // Status fan-out targets operating specialists — skip meta/platform helper agents.
  const SKIP = /^(platformhelp|workflowbuilder|demo|notify-delegate-test|test-)/i;
  const agents = getAgentsUnderCoo(ownerUserId).filter((a) => !SKIP.test(String(a.id || '')));
  const statusPrompt = String(
    contextText ||
      'Provide your status and deliverables for the CEO standup. Summarize what you completed recently, what is in progress, blockers, and anything the CEO should decide.'
  )
    .trim()
    .slice(0, 2000);
  if (!agents.length) {
    return {
      requestId: null,
      count: 0,
      scheduledCount: 0,
      pendingCount: 0,
      agentNames: [],
      kanbanTaskIds: [],
      internalBlocked: [],
      mode: 'status_fanout',
      agentsAvailable: 0,
    };
  }
  const preAllocated = Object.fromEntries(agents.map((a) => [a.id, statusPrompt]));
  const out = await scheduleCeoRequestViaOpenClawCron(standupId, statusPrompt, ownerUserId, {
    preAllocated,
    maxAgents: Math.max(agents.length, 1),
    persist: opts.persist,
    notify: opts.notify,
    scheduleOpenClaw: opts.scheduleOpenClaw,
  });
  return { ...out, mode: 'status_fanout', agentsAvailable: agents.length };
}

/**
 * Schedule CEO request via OpenClaw Gateway cron. Reads COO AGENTS.md, uses OpenAI to classify
 * intent and allocate a task query per agent. Never fans out to all agents.
 * @param {number} standupId
 * @param {string} ceoMessage
 * @param {string|null} [ceoUserId]
 * @param {{ restrictToAgentIds?: string[], preAllocated?: Record<string, string>, maxAgents?: number, persist?: boolean, notify?: boolean, scheduleOpenClaw?: boolean }} [opts]
 * persist/notify/scheduleOpenClaw default true. Deploy/CI probes must pass persist:false so a live
 * CEO is never Kanban-notified or OpenClaw-scheduled.
 */

async function maybeAdvanceGoalRunFromDelegation(taskId) {
  try {
    const { findGoalStepByDelegationTask, onDelegationTerminalForGoalRun } = await import('./agent-goal-run.js');
    if (!findGoalStepByDelegationTask(taskId)) return { handled: false };
    return { handled: true, result: await onDelegationTerminalForGoalRun(taskId) };
  } catch (e) {
    console.warn('[goal-run] delegation terminal advance failed', e?.message || e);
    return { handled: true, error: e?.message || String(e) };
  }
}

export async function scheduleCeoRequestViaOpenClawCron(standupId, ceoMessage, ceoUserId = null, opts = {}) {
  const persist = opts.persist !== false;
  const notify = persist && opts.notify !== false;
  const scheduleOpenClaw = persist && opts.scheduleOpenClaw !== false;
  const ownerUserId = ceoUserId || getStandupOwnerUserId(standupId);
  const { getAgentsUnderOrchestratorForCeo } = await import('./org-context.js');
  let agents = opts.parentAgentId
    ? getAgentsUnderOrchestratorForCeo(ownerUserId, opts.parentAgentId)
    : getAgentsUnderCoo(ownerUserId);
  const maxAgents = Math.max(1, Math.min(100, Number(opts.maxAgents) || 2));
  const restrict = (opts.restrictToAgentIds || []).map((id) => String(id).toLowerCase()).filter(Boolean);
  if (restrict.length) {
    const set = new Set(restrict);
    agents = agents.filter((a) => set.has(String(a.id).toLowerCase()));
  }
  const agentsMdContent = await readCooAgentsMd(ownerUserId);
  const scopedMessage = withOwnerScope(ceoMessage, ownerUserId);
  const context = opts.isolatedContext
    ? { lastUserMessages: [], agentResponses: [] }
    : getStandupContextForIntent(standupId, scopedMessage, ownerUserId);

  let allocated =
    opts.preAllocated && typeof opts.preAllocated === 'object' && Object.keys(opts.preAllocated).length
      ? { ...opts.preAllocated }
      : await classifyIntentAndAllocate(scopedMessage, agentsMdContent || '', { ...context, ownerUserId }, ownerUserId);

  if (!allocated || typeof allocated !== 'object') allocated = {};
  allocated = capAllocatedAgents(allocated, maxAgents);

  // When restrictToAgentIds is set, keep only those keys (or fill single restrict from message).
  if (restrict.length && allocated && typeof allocated === 'object') {
    const filtered = {};
    for (const id of restrict) {
      const q = allocated[id] || allocated[String(id).toLowerCase()];
      if (q && typeof q === 'string') filtered[id] = q;
    }
    if (Object.keys(filtered).length) {
      allocated = filtered;
    } else if (restrict.length <= 2) {
      allocated = Object.fromEntries(restrict.map((id) => [id, scopedMessage.trim()]));
    } else {
      allocated = {};
    }
  }

  allocated = capAllocatedAgents(allocated, maxAgents);

  // Repair only from the trusted current work order. If neither the allocator
  // value nor current request is substantive, fail closed before persistence.
  if (allocated && typeof allocated === 'object') {
    const repaired = {};
    for (const [id, query] of Object.entries(allocated)) {
      if (isUsableDelegationWorkOrder(query)) repaired[id] = query;
      else if (isUsableDelegationWorkOrder(scopedMessage)) repaired[id] = scopedMessage;
      else console.warn('[delegation] rejected contextless allocated work order', { agent_id: id });
    }
    allocated = repaired;
  }

  // Stitch prior standup thread into thin/meta task queries before external split or enqueue.
  if (allocated && typeof allocated === 'object' && context?.lastUserMessages?.length) {
    const enriched = {};
    for (const [id, q] of Object.entries(allocated)) {
      if (typeof q !== 'string') continue;
      enriched[id] = enrichTaskQueryWithPriorThread(q, context.lastUserMessages, scopedMessage);
    }
    allocated = enriched;
  }

  // External / published-A2A leaf members are not OpenClaw agents — invoke them directly.
  let externalOutcome = null;
  const { internal: internalAllocated, leaf: leafAllocated } = splitAllocationByKind(allocated);
  if (persist && Object.keys(leafAllocated).length) {
    try {
      // Lazy import: org-member-delegation pulls in the A2A publish service, which transitively
      // imports this module.
      const { delegateToOrgMembers } = await import('./org-member-delegation.js');
      const { getCooAgentRow } = await import('./org-context.js');
      externalOutcome = await delegateToOrgMembers(ownerUserId, leafAllocated, {
        callerAgentId: opts.parentAgentId || getCooAgentRow()?.id,
      });
    } catch (e) {
      console.warn('[delegation] external member delegation failed:', e?.message || e);
    }
    allocated = internalAllocated;
  } else if (!persist) {
    allocated = internalAllocated;
  }

  // Drop internal agents that are over token / error budget before enqueue or OpenClaw cron.
  const internalBlocked = [];
  if (allocated && Object.keys(allocated).length) {
    const allowed = {};
    for (const [id, query] of Object.entries(allocated)) {
      const agent =
        agents.find((a) => String(a.id).toLowerCase() === String(id).toLowerCase()) || null;
      const label = agent?.name || id;
      const budget = enforceBudget(ownerUserId, id, {
        action: 'delegation',
        memberLabel: label,
        throwOnBlock: false,
      });
      if (budget?.state === 'blocked') {
        internalBlocked.push({ id, name: label, reasons: budget.reasons || [] });
        console.warn(
          `[delegation] budget blocked member=${id} owner=${ownerUserId} reasons="${(budget.reasons || []).join('; ')}"`
        );
        continue;
      }
      allowed[id] = query;
    }
    allocated = allowed;
    // Also drop blocked agents from the enqueue list so we never create Kanban/cron for them.
    if (internalBlocked.length) {
      const blockedIds = new Set(internalBlocked.map((b) => String(b.id).toLowerCase()));
      agents = agents.filter((a) => !blockedIds.has(String(a.id).toLowerCase()));
    }
  }

  if (!persist) {
    const wouldEnqueue = (agents || []).filter((a) => {
      const q = allocated?.[a.id?.toLowerCase()] ?? allocated?.[a.id];
      return typeof q === 'string' && q.trim();
    });
    const leafNames = Object.keys(leafAllocated || {});
    console.log(
      `[delegation] dry-run fanout persist=false owner=${ownerUserId} would_enqueue=${wouldEnqueue.length} leaves=${leafNames.length}`
    );
    return {
      requestId: null,
      count: wouldEnqueue.length + leafNames.length,
      scheduledCount: 0,
      pendingCount: wouldEnqueue.length,
      agentNames: [
        ...wouldEnqueue.map((a) => a.name || a.id),
        ...leafNames,
      ],
      kanbanTaskIds: [],
      internalBlocked,
      persist: false,
    };
  }

  const requestId = `req-${standupId}-${Date.now()}`;
  const baseUrl = getBaseUrl();
  const ins = db().prepare(
    `INSERT INTO agent_delegation_tasks
      (standup_id, request_id, to_agent_id, prompt, status, owner_user_id, parent_work_unit_id, parent_agent_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`
  );
  const kanbanIns = db().prepare(
    `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, standup_id, agent_delegation_task_id, owner_user_id)
     VALUES (?, ?, 'in_progress', ?, 'coo', ?, ?, ?)`
  );

  const taskRows =
    allocated && Object.keys(allocated).length > 0
      ? enqueueAllocatedTasks({
          agents,
          allocated,
          standupId,
          requestId,
          ownerUserId,
          ins,
          kanbanIns,
          priorUserMessages: context.lastUserMessages || [],
          currentCeoMessage: scopedMessage,
          notify,
          parentWorkUnitId: opts.parentWorkUnitId || null,
          parentAgentId: opts.parentAgentId || null,
          reuseKanbanTaskId: opts.reuseKanbanTaskId || null,
        })
      : [];

  let scheduledCount = 0;
  let cronScheduleFailures = 0;
  const cronBlockedIds = new Set();
  if (scheduleOpenClaw) {
    for (const { taskId, agent } of taskRows) {
    const task = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(taskId);
    if (!task) continue;
    // Re-check just before starting OpenClaw so a race with another run cannot spend past budget.
    const preCronBudget = enforceBudget(ownerUserId, agent.id, {
      action: 'delegation',
      memberLabel: agent.name || agent.id,
      throwOnBlock: false,
    });
    if (preCronBudget?.state === 'blocked') {
      const reason = `Budget exceeded for ${agent.name || agent.id}: ${(preCronBudget.reasons || []).join('; ')}`;
      db()
        .prepare(
          `UPDATE agent_delegation_tasks SET status = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?`
        )
        .run('failed', reason, taskId);
      completePipelineKanbanForDelegation(taskId, { ok: false });
      cronBlockedIds.add(String(agent.id).toLowerCase());
      internalBlocked.push({
        id: agent.id,
        name: agent.name || agent.id,
        reasons: preCronBudget.reasons || [],
      });
      console.warn(`[delegation] cron skipped — budget blocked agent=${agent.id} task=${taskId}`);
      continue;
    }
    const kanbanRow = db().prepare('SELECT id FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(taskId);
    const kanbanId = kanbanRow ? kanbanRow.id : null;
    let promptWithMemory = await getPromptWithMemoryInjected(agent.id, task.prompt);
    if (kanbanId && !isAvatarAgentWorkflowPrompt(task.prompt)) {
      promptWithMemory =
        `FIRST ACTION (before anything else): call the kanban_move_status tool with JSON:\n` +
        `  {\"task_id\": ${kanbanId}, \"new_status\": \"in_progress\"}\n\n` +
        promptWithMemory +
        buildDelegationKanbanFinishPrompt(kanbanId);
    }
    const internalToken = ensureInternalTokenConfigured();
    const webhookUrl = `${baseUrl}/api/standups/cron-callback?standup_id=${standupId}&request_id=${encodeURIComponent(requestId)}&agent_id=${encodeURIComponent(agent.id)}&task_id=${taskId}&internal_token=${encodeURIComponent(internalToken)}`;
    const ownerForTenant =
      extractOwnerUserIdFromText(promptWithMemory, null) || ownerUserId || getBalaCeoAuthId();
    let openclawAgentId = agent.openclaw_agent_id || agent.id;
    try {
      openclawAgentId = ensureTenantOpenClawAgent(agent, ownerForTenant).openclawAgentId;
    } catch (_) {}
    const result = await cronAddOneShotWebhook({
      name: `standup-${standupId}-${agent.id}-${taskId}`,
      agentId: openclawAgentId,
      message: promptWithMemory,
      webhookUrl,
    });
    if (result.ok) {
      scheduledCount++;
      markKanbanInProgressForDelegation(taskId);
    } else {
      console.warn('[delegation] cron_add failed for', agent.id, result.error);
      cronScheduleFailures++;
    }
    }
  }
  const pendingCount = taskRows.length - scheduledCount - cronBlockedIds.size;
  // cron_add is an acceleration path, not the only execution path. If the
  // Gateway has no cron tool (or rejects scheduling), immediately wake the
  // durable per-CEO queue that owns the same task rows. The atomic pending →
  // processing claim prevents duplicate execution if a normal worker tick races.
  if (cronScheduleFailures > 0) {
    setTimeout(() => {
      void processPendingDelegationTasksForCeo(ownerUserId, { skipOrphanWatcher: true })
        .catch((error) => console.warn('[delegation] direct queue wake failed', error?.message || error));
    }, 0);
  }
  const externalNames = (externalOutcome?.delegated || []).map((d) => d.member.display_name);
  const startedRows = taskRows.filter(
    (r) => !cronBlockedIds.has(String(r.agent.id).toLowerCase())
  );
  const startedNames = startedRows.map((r) => r.agent.name || r.agent.id);
  const startedKanbanIds = [];
  for (const r of startedRows) {
    const k = db().prepare('SELECT id FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(r.taskId);
    if (k) startedKanbanIds.push(k.id);
  }
  return {
    requestId,
    count: startedRows.length + externalNames.length,
    scheduledCount,
    pendingCount: Math.max(0, pendingCount),
    agentNames: [...startedNames, ...externalNames],
    kanbanTaskIds: [
      ...startedKanbanIds,
      ...(externalOutcome?.delegated || []).map((d) => d.taskId).filter(Boolean),
    ],
    externalBlocked: (externalOutcome?.blocked || []).map((b) => b.member.id),
    externalFailed: (externalOutcome?.failed || []).map((f) => f.member.id),
    internalBlocked,
  };
}

/**
 * Enqueue delegation tasks only (no Gateway cron). Uses COO AGENTS.md + OpenAI to allocate per agent.
 */
export async function enqueueGetWorkFromTeam(standupId, contextFromConversation = '', ceoUserId = null) {
  const ownerUserId = ceoUserId || getStandupOwnerUserId(standupId);
  const agents = getAgentsUnderCoo(ownerUserId);
  const requestId = `req-${standupId}-${Date.now()}`;
  const ins = db().prepare(
    `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id) VALUES (?, ?, ?, ?, 'pending', ?)`
  );
  const fullContext = withOwnerScope(
    contextFromConversation.trim() || 'Provide your status and deliverables for the CEO standup.',
    ownerUserId
  );
  const agentsMdContent = await readCooAgentsMd(ownerUserId);
  const context = getStandupContextForIntent(standupId, fullContext, ownerUserId);
  let allocated = agentsMdContent && fullContext
    ? await classifyIntentAndAllocate(fullContext, agentsMdContent, { ...context, ownerUserId }, ownerUserId)
    : null;
  allocated = capAllocatedAgents(allocated, 2);

  let count = 0;
  if (allocated && typeof allocated === 'object' && Object.keys(allocated).length > 0) {
    for (const a of agents) {
      const rawQuery = allocated[a.id?.toLowerCase()] ?? allocated[a.id];
      if (!rawQuery || typeof rawQuery !== 'string') continue;
      const query = enrichTaskQueryWithPriorThread(
        rawQuery,
        context.lastUserMessages || [],
        fullContext
      );
      const prompt = buildDetailedPromptForAgent(query, a.name || a.id, a.role);
      ins.run(standupId, requestId, a.id, withOwnerScope(prompt, ownerUserId), ownerUserId);
      count++;
    }
  }
  return { requestId, count };
}

/**
 * Enqueue a single task (e.g. deep research to one agent). Returns request_id.
 * ownerUserId is required so the per-CEO delegation worker can claim it.
 */
export function enqueueDelegationTask(standupId, toAgentId, prompt, requestId = null, ownerUserId = null) {
  const rid = requestId || `req-${standupId}-${Date.now()}`;
  const owner = ownerUserId || getStandupOwnerUserId(standupId);
  db().prepare(
    `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id) VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(standupId, rid, toAgentId, prompt, owner);
  return rid;
}

/**
 * Post COO callback message for a request_id when all its tasks are done (completed or failed).
 * Idempotent: skips if callback already posted.
 */
export async function postCallbackForRequestId(requestId, { summarize = null } = {}) {
  const alreadyPosted = db().prepare('SELECT 1 FROM delegation_callbacks WHERE request_id = ?').get(requestId);

  const tasks = db().prepare('SELECT * FROM agent_delegation_tasks WHERE request_id = ?').all(requestId);
  const allTerminal = tasks.length > 0 && tasks.every((t) => ['completed', 'failed'].includes(String(t.status)));
  if (!allTerminal) return;

  const standupId = tasks[0]?.standup_id;
  if (!standupId) return;

  const completed = db().prepare('SELECT t.*, a.name as agent_name FROM agent_delegation_tasks t JOIN agents a ON a.id = t.to_agent_id WHERE t.request_id = ? AND t.status = ?').all(requestId, 'completed');
  const failed = db().prepare('SELECT t.*, a.name as agent_name FROM agent_delegation_tasks t JOIN agents a ON a.id = t.to_agent_id WHERE t.request_id = ? AND t.status = ?').all(requestId, 'failed');

  const lines = completed.map((t) => `**${t.agent_name}:**\n${truncatePreservingImages(t.response_content || '', 2000)}`);
  if (failed.length) lines.push(...failed.map((t) => `**${t.agent_name}:** [Error: ${t.error_message}]`));
  const callbackMessage = lines.length
    ? `Updates from the team (for your review):\n\n${lines.join('\n\n---\n\n')}`
    : 'No responses from the team yet.';

  if (!alreadyPosted) {
    for (const t of completed) {
      db().prepare('INSERT INTO standup_responses (standup_id, agent_id, content) VALUES (?, ?, ?)').run(standupId, t.to_agent_id, t.response_content || '');
    }
    db().prepare('INSERT INTO standup_messages (standup_id, role, content) VALUES (?, ?, ?)').run(standupId, 'coo', callbackMessage);
    db().prepare('INSERT INTO delegation_callbacks (request_id) VALUES (?)').run(requestId);
  }

  // Dashboard COO delegation: deliver the actual specialist outcome back into
  // the parent work unit once. Standup callbacks remain supported above.
  const parent = tasks.find((t) => t.parent_work_unit_id);
  if (parent?.parent_work_unit_id && !tasks.some((t) => t.callback_delivered_at)) {
    const ownerUserId = parent.owner_user_id || getStandupOwnerUserId(standupId);
    const coo = db().prepare('SELECT * FROM agents WHERE id=?').get(parent.parent_agent_id)
      || getCooAgentRow();
    // The specialist result is already the authoritative deliverable. Production
    // callback delivery is deterministic so a second model cannot invent actions
    // (for example, claiming the CEO was notified when no notify tool ran).
    let cooReply = callbackMessage;
    try {
      const workUnit = getWorkUnit(parent.parent_work_unit_id);
      const resultPrompt = [
        'A specialist delegation for the CEO has reached a terminal state.',
        `Original CEO request:\n${workUnit?.resolved_request || 'Unavailable'}`,
        `Actual specialist outcomes:\n${callbackMessage}`,
        'Report the actual outcome concisely to the CEO. Do not start tools, create another delegation, or claim unfinished work succeeded.',
      ].join('\n\n');
      if (summarize) {
        cooReply = String(await summarize({ requestId, resultPrompt, callbackMessage, tasks })).trim() || callbackMessage;
      }
    } catch (e) {
      console.warn('[delegation-callback] COO summary failed; storing factual callback', e?.message || e);
    }
    insertChatTurn({
      agentId: coo.id,
      ownerUserId,
      role: 'assistant',
      content: cooReply,
      workUnitId: parent.parent_work_unit_id,
    });
    db().prepare(`UPDATE agent_delegation_tasks SET callback_delivered_at=datetime('now') WHERE request_id=?`).run(requestId);
    bindWorkUnitExecution(
      parent.parent_work_unit_id,
      requestId,
      failed.length ? 'failed' : 'completed'
    );
  }
}

export function goalExecutionIdentity(prompt) {
  const text = String(prompt || '');
  const goalRunId = text.match(/\[goal_run_id:\s*([^\]\s]+)\]/i)?.[1] || '';
  const goalStepId = text.match(/\[goal_step_id:\s*([^\]\s]+)\]/i)?.[1] || '';
  return goalRunId && goalStepId ? { goalRunId, goalStepId } : null;
}

export function delegationSessionUserForPrompt(prompt, taskId) {
  const identity = goalExecutionIdentity(prompt);
  return identity
    ? `goal-${identity.goalRunId}-${identity.goalStepId}`
    : `delegation-${taskId}`;
}

/**
 * Process pending delegation tasks for a single CEO.
 * Pulls only that CEO's tasks, mirrors the per-CEO standup cron pattern.
 * @param {string} ceoUserId
 * @param {{ skipOrphanWatcher?: boolean }} [opts]
 */
export async function processPendingDelegationTasksForCeo(ceoUserId, opts = {}) {
  if (!ceoUserId) return;
  if (!isUserEnabled(ceoUserId)) return;
  recoverStaleProcessingDelegations(ceoUserId);
  // Specialty processing / orphan cards (job-pipeline recovery above only covers pipeline prompts).
  // Skip when kicked FROM the orphan watcher to avoid recursive processPending ↔ orphan loops.
  if (!opts.skipOrphanWatcher) {
    try {
      const { runKanbanOrphanWatcher } = await import('./kanban-orphan-watcher.js');
      void runKanbanOrphanWatcher({ ownerUserId: ceoUserId, limit: 10 });
    } catch (e) {
      console.warn('[delegation] orphan watcher:', e?.message || e);
      try {
        requeueStuckStatusOnlyKanbanCards({ ownerUserId: ceoUserId, limit: 10 });
        rependInfraFailedStatusOnlyRetries({ ownerUserId: ceoUserId, limit: 10 });
      } catch (e2) {
        console.warn('[delegation] status-only stuck requeue:', e2?.message || e2);
      }
    }
  }
  const allPending = db()
    .prepare(
      `SELECT * FROM agent_delegation_tasks
       WHERE status = ? AND (owner_user_id = ? OR (owner_user_id IS NULL AND standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)))
       ORDER BY created_at LIMIT 20`
    )
    .all('pending', ceoUserId, ceoUserId);
  let pending = filterPipelineDelegationsForProcessing(allPending);
  if (isPlatformLocalOllama()) {
    if (hasAnyActiveDashboardChat()) {
      console.info('[delegation] skip ceo=%s: dashboard chat owns local Ollama', ceoUserId);
      return 0;
    }
    if (pending.length > 1) {
      console.info(
        '[delegation] local Ollama: running 1 of %s pending for ceo=%s',
        pending.length,
        ceoUserId
      );
      pending = pending.slice(0, 1);
    }
  }
  const now = new Date().toISOString();

  async function runOne(task) {
    if (runningDelegationIds.has(task.id)) {
      // Orphan watcher may have re-pended while a hung OpenClaw call still holds the lock.
      // If DB says pending again, drop the stale lock so this process can reclaim the work.
      const live = db().prepare('SELECT status FROM agent_delegation_tasks WHERE id = ?').get(task.id);
      if (live?.status === 'pending') {
        runningDelegationIds.delete(task.id);
        console.warn(
          `[delegation] cleared stale run lock for pending task=${task.id} agent=${task.to_agent_id}`
        );
      } else {
        return;
      }
    }
    const claim = db()
      .prepare(`UPDATE agent_delegation_tasks SET status = 'processing' WHERE id = ? AND status = 'pending'`)
      .run(task.id);
    if (!claim.changes) return;

    runningDelegationIds.add(task.id);
    task = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(task.id);
    markKanbanInProgressForDelegation(task.id);

    const agent = db().prepare('SELECT id, name, openclaw_agent_id FROM agents WHERE id = ?').get(task.to_agent_id);
    if (!agent) {
      db().prepare('UPDATE agent_delegation_tasks SET status = ?, error_message = ?, completed_at = ? WHERE id = ?').run('failed', 'Agent not found', now, task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: false });
        failAgentWorkflowForDelegation({ ...task, status: 'failed', error_message: 'Agent not found' }).catch(() => {});
      } else {
        completePipelineKanbanForDelegation(task.id, { ok: false });
        failPipelineWorkflowForDelegation({ ...task, status: 'failed', error_message: 'Agent not found' });
      }
      runningDelegationIds.delete(task.id);
      return;
    }
    const openclawId = agent.openclaw_agent_id || agent.id;
    const standupOwner = db()
      .prepare('SELECT owner_user_id FROM standups WHERE id = ?')
      .get(task.standup_id)?.owner_user_id;
    const ownerForTenant =
      extractOwnerUserIdFromText(task.prompt, null) ||
      task.owner_user_id ||
      standupOwner ||
      getBalaCeoAuthId();
    let runtimeOcId = openclawId;
    try {
      runtimeOcId = ensureTenantOpenClawAgent(agent, ownerForTenant).openclawAgentId;
    } catch (e) {
      console.warn('[delegation] tenant openclaw ensure failed:', e?.message || e);
    }
    const goalIdentity = goalExecutionIdentity(task.prompt);
    // Goal steps have a stable, isolated execution identity. They must never
    // share the agent's conversational or memory-aware delegation session.
    const sessionUser = delegationSessionUserForPrompt(task.prompt, task.id);
    const avatarVr = isAvatarAgentWorkflowPrompt(task.prompt);
    let promptWithMemory;
    if (avatarVr) {
      // Virtual Room avatar chat: do not inject MEMORY or sessions_history instructions —
      // those cause specialists to open browse tasks / narrate ops instead of answering.
      promptWithMemory =
        `${task.prompt}\n\n` +
        `VIRTUAL ROOM RULES (override other tool habits for this turn):\n` +
        `- Answer only the CEO's user message in the task above.\n` +
        `- Do NOT call sessions_history, browse_*, learnings_summary, kanban_*, or agent_workflow_*.\n` +
        `- Greets (hi/hello/hey): reply warmly in 1–2 sentences + Short spoken line. No tools.\n` +
        `- Use tools only when the CEO asks for research, image, video, chart, or similar deliverables.`;
      console.info('[delegation] avatar VR prompt (no memory/sessions_history inject)', {
        taskId: task.id,
        agent: task.to_agent_id,
      });
    } else if (goalIdentity) {
      promptWithMemory = getPromptForFreshGoalRun(task.prompt);
      console.info('[delegation] isolated goal-step session', {
        taskId: task.id,
        goalRunId: goalIdentity.goalRunId,
        goalStepId: goalIdentity.goalStepId,
        sessionUser,
      });
    } else {
      const sessionKeyLine = `\n\nYour session key for this run is ${openclaw.sessionKeyFor(runtimeOcId, sessionUser)}. Use this exact sessionKey when calling sessions_history. If sessions_history returns empty, the conversation is in the messages above—proceed with those.`;
      promptWithMemory = await getPromptWithMemoryInjected(task.to_agent_id, task.prompt);
      promptWithMemory = promptWithMemory + sessionKeyLine;
    }
    const kanbanRow = db().prepare('SELECT id FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(task.id);
    if (kanbanRow && !avatarVr) {
      promptWithMemory =
        `FIRST ACTION (before anything else): call the kanban_move_status tool with JSON:\n` +
        `  {\"task_id\": ${kanbanRow.id}, \"new_status\": \"in_progress\"}\n\n` +
        promptWithMemory +
        buildDelegationKanbanFinishPrompt(kanbanRow.id);
    }
    if (!avatarVr) {
      try {
        const governed = getActiveLearningPrompt({ ownerUserId: ownerForTenant, agentId: task.to_agent_id, goalRunId: goalIdentity?.goalRunId || '', sessionId: sessionUser, topic: task.prompt });
        promptWithMemory += governed.text;
        recordExecutionLearningVersions({ ownerUserId: ownerForTenant, agentId: task.to_agent_id, executionType: goalIdentity ? 'goal_step' : 'delegation', executionId: goalIdentity?.goalStepId || task.id, sessionId: sessionUser, learningVersionIds: governed.version_ids });
      } catch (e) {
        console.warn('[delegation] governed learning injection skipped:', e?.message || e);
      }
    }
    const budgetState = enforceBudget(ownerForTenant, task.to_agent_id, {
      action: 'delegation',
      memberLabel: agent.name,
      throwOnBlock: false,
    });
    if (budgetState?.state === 'blocked') {
      const reason = `Budget exceeded for ${agent.name}: ${budgetState.reasons.join('; ')}`;
      db()
        .prepare(
          'UPDATE agent_delegation_tasks SET status = ?, error_message = ?, completed_at = ? WHERE id = ?'
        )
        .run('failed', reason, now, task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: false });
        failAgentWorkflowForDelegation({ ...task, status: 'failed', error_message: reason }).catch(() => {});
      } else {
        completePipelineKanbanForDelegation(task.id, { ok: false });
        failPipelineWorkflowForDelegation({ ...task, status: 'failed', error_message: reason });
      }
      console.warn(`[delegation] task ${task.id} blocked by budget for agent=${task.to_agent_id}`);
      runningDelegationIds.delete(task.id);
      return;
    }

    try {
      const isDiscovery = String(task.to_agent_id).toLowerCase() === 'jobdiscovery';
      const agentExecutionStartedAt = new Date().toISOString();
      registerOpenClawSessionOwner(openclaw.sessionKeyFor(runtimeOcId, sessionUser), ownerForTenant, null, 'delegation', {
        original_request: task.prompt, resolved_request: task.prompt, delegation_task_id: task.id,
        goal_run_id: goalIdentity?.goalRunId, goal_step_id: goalIdentity?.goalStepId,
      });
      const discoveryTimeout = Number(process.env.OPENCLAW_DISCOVERY_TIMEOUT_MS || 900000);
      const { content, usage } = await openclaw.chatCompletions(
        runtimeOcId,
        [{ role: 'user', content: promptWithMemory }],
        sessionUser,
        false,
        isDiscovery
          ? { timeoutMs: discoveryTimeout, injectLearningsInstruction: false, injectSessionHistoryInstruction: false }
          : { injectLearningsInstruction: false, injectSessionHistoryInstruction: false }
      );
      if (goalIdentity) {
        try {
          const nativeCalls = listNativeOpenClawToolCalls(
            task.to_agent_id,
            ownerForTenant,
            agentExecutionStartedAt,
            new Date().toISOString()
          );
          persistNativeToolCallsToLogs(nativeCalls, ownerForTenant, {
            traceId: goalIdentity.goalRunId,
            goalRunId: goalIdentity.goalRunId,
            goalStepId: goalIdentity.goalStepId,
          });
        } catch (e) {
          console.warn('[delegation] native goal-step evidence capture skipped:', e?.message || e);
        }
      }
      meterOpenClawUsage(ownerForTenant, task.to_agent_id, {
        usage,
        source: 'delegation',
        promptText: promptWithMemory,
        replyText: content,
        sessionId: sessionUser,
      });
      let responseText = normalizeReplyContent(content) || '(no response)';
      // Same guard as Kanban task-chat: status-only "marked completed" is not a deliverable.
      let stillStatusOnly = false;
      if (kanbanRow) {
        const nudged = await nudgeIfStatusOnlyReply({
          chatCompletions: openclaw.chatCompletions.bind(openclaw),
          openclawAgentId: runtimeOcId,
          sessionUser,
          priorMessages: [{ role: 'user', content: promptWithMemory }],
          reply: responseText,
        });
        responseText = nudged.reply;
        stillStatusOnly = !!nudged.stillStatusOnly;
        if (stillStatusOnly) {
          console.warn(
            `[delegation] status-only reply after nudge task=${task.id} agent=${task.to_agent_id}`
          );
        }
      }
      db()
        .prepare(
          `UPDATE agent_delegation_tasks
           SET status = ?, response_content = ?, error_message = NULL, completed_at = ?
           WHERE id = ?`
        )
        .run('completed', responseText, now, task.id);
      const goalAdvance = await maybeAdvanceGoalRunFromDelegation(task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: true });
        try {
          await maybeAdvanceAgentWorkflow({ ...task, status: 'completed', response_content: responseText });
        } catch (wfErr) {
          console.warn('[agent-workflow] advance:', wfErr.message);
        }
      } else if (!goalAdvance?.handled) {
        const kanbanResult = completePipelineKanbanForDelegation(task.id, {
          ok: true,
          replyText: responseText,
        });
        // Auto-retry so the CEO does not have to nudge — requeues same agent (capped).
        if (kanbanResult?.skipped_status_only || stillStatusOnly) {
          try {
            requeueKanbanAfterStatusOnlyReply({
              kanbanId: kanbanRow?.id || kanbanResult?.id,
              delegationTaskId: task.id,
            });
          } catch (retryErr) {
            console.warn('[delegation] status-only requeue failed:', retryErr?.message || retryErr);
          }
        }
        try {
          await maybeHandoffJobPipeline({ ...task, status: 'completed', response_content: responseText });
        } catch (handoffErr) {
          console.warn('[job-pipeline] handoff:', handoffErr.message);
        }
      }
      appendDelegationResponseToAgentChat(
        task.to_agent_id,
        isAgentWorkflowPrompt(task.prompt)
          ? extractTaskContentFromPrompt(task.prompt)
          : extractTaskSummaryFromPrompt(task.prompt),
        responseText,
        extractOwnerUserIdFromText(task.prompt),
        sessionUser
      );
      // Goal outputs are persisted on the goal step and supplied explicitly to
      // later steps. Do not leak them into cross-task agent memory.
      if (!goalIdentity) {
        const summary = extractTaskSummaryFromPrompt(task.prompt);
        await appendToAgentMemory(
          task.to_agent_id,
          summary,
          extractOwnerUserIdFromText(task.prompt) || standupOwner
        );
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      // During OpenClaw restarts, leave the task pending so status-only auto-retries
      // (and normal delegations) are not burned by a transient gateway outage.
      if (isTransientOpenClawError(err)) {
        const attempt = getTransientAttempt(task.error_message) + 1;
        const maxT = maxGatewayTransientRetries();
        if (attempt <= maxT) {
          db()
            .prepare(
              `UPDATE agent_delegation_tasks
               SET status = 'pending', error_message = ?, completed_at = NULL
               WHERE id = ?`
            )
            .run(`[transient:${attempt}] ${errMsg}`, task.id);
          console.warn(
            `[delegation] task ${task.id} gateway transient — re-pending (${attempt}/${maxT}): ${errMsg}`
          );
          return;
        }
      }
      db().prepare('UPDATE agent_delegation_tasks SET status = ?, error_message = ?, completed_at = ? WHERE id = ?').run('failed', errMsg, now, task.id);
      const goalAdvance = await maybeAdvanceGoalRunFromDelegation(task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: false });
        await failAgentWorkflowForDelegation({ ...task, status: 'failed', error_message: errMsg });
      } else if (!goalAdvance?.handled) {
        completePipelineKanbanForDelegation(task.id, { ok: false });
        failPipelineWorkflowForDelegation({ ...task, status: 'failed', error_message: errMsg }, { error: errMsg });
      }
    } finally {
      runningDelegationIds.delete(task.id);
    }
  }

  if (isPlatformLocalOllama()) {
    for (const task of pending) await runOne(task);
  } else {
    await Promise.allSettled(pending.map((task) => runOne(task)));
  }

  // Only scan request_ids that belong to this CEO so callbacks don't mix across tenants
  const requestIds = db()
    .prepare(
      `SELECT DISTINCT request_id FROM agent_delegation_tasks
       WHERE owner_user_id = ? OR (owner_user_id IS NULL AND standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?))`
    )
    .all(ceoUserId, ceoUserId)
    .map((r) => r.request_id);
  for (const requestId of requestIds) {
    await postCallbackForRequestId(requestId);
  }
  return pending.length;
}

/**
 * Process pending delegation tasks for ALL enabled CEOs, one pass each.
 * Called by the delegation cron. Mirrors runScheduledStandup() pattern.
 */
export async function processPendingDelegationTasksForAllCeos() {
  const ceos = db()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  if (isPlatformLocalOllama()) {
    if (hasAnyActiveDashboardChat()) {
      console.info('[delegation] skip all-CEO tick: dashboard chat owns local Ollama');
      return;
    }
    for (const { id } of ceos) {
      const n = await processPendingDelegationTasksForCeo(id);
      if (n > 0) {
        console.info('[delegation] local Ollama: stopped after ceo=%s processed=%s', id, n);
        return;
      }
    }
    return;
  }
  // Also handle orphaned tasks (owner_user_id NULL, not matched to any CEO above)
  const results = await Promise.allSettled(
    ceos.map(({ id }) => processPendingDelegationTasksForCeo(id))
  );
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  if (errors.length) console.warn('[delegation] per-CEO errors:', errors.join('; '));
}

/** Backward-compatible alias — routes/scripts that import the old name continue to work. */
export const processPendingDelegationTasks = processPendingDelegationTasksForAllCeos;
