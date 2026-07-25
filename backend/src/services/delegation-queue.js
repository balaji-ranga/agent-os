/**
 * Delegation: schedule OpenClaw Gateway cron jobs (detailed prompt, agentId, webhook) per agent.
 * Uses OpenAI to classify intent from the COO's AGENTS.md (agents and use cases); no hardcoded agent list.
 * Injects agent MEMORY.md into prompts (OpenClaw does not inject it in isolated cron runs) and appends completions to MEMORY.md.
 */
import { readFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';
import { extractOwnerUserIdFromText } from './agent-chat-scope.js';
import { insertChatTurn } from './chat-history.js';
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
  completeAgentWorkflowKanbanForDelegation,
  isAgentWorkflowPrompt,
} from './agent-workflow-kanban.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { ensureInternalTokenConfigured } from '../middleware/internal-auth.js';
import { maybeAdvanceAgentWorkflow, failAgentWorkflowForDelegation } from './agent-workflow-runner.js';
import { ensureTenantOpenClawAgent, tenantWorkspacePath } from './openclaw-tenant.js';
import { getBalaCeoAuthId } from './job-applicant-ceo.js';
import {
  getAgentsUnderCooForCeo,
  readCooAgentsMdForCeo,
  withOwnerScope,
} from './org-context.js';
import { isUserEnabled } from './user-enabled.js';
import { notifyKanbanTaskCreated } from './platform-notifications.js';
import { meterOpenClawUsage } from './token-usage.js';
import { enforceBudget } from './agent-budgets.js';
import { splitAllocationByKind } from './org-member-keys.js';

const SESSION_USER = 'agent-os-delegation';
const AGENTS_MD_NAME = 'AGENTS.md';
const MEMORY_MD_NAME = 'MEMORY.md';
const MEMORY_MAX_LINES = 35;
const homedir = process.env.USERPROFILE || process.env.HOME || '';

/** Prevent duplicate concurrent runs of the same delegation within this process. */
const runningDelegationIds = new Set();

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
export function appendDelegationResponseToAgentChat(agentId, promptSnippet, responseContent, ownerUserId = null) {
  if (!agentId || responseContent == null) return;
  const owner =
    ownerUserId ||
    extractOwnerUserIdFromText(promptSnippet) ||
    extractOwnerUserIdFromText(typeof responseContent === 'string' ? responseContent : '');
  const userMsg = (promptSnippet || 'Task from COO').trim().slice(0, 4000);
  const assistantMsg = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim().slice(0, 100000);
  try {
    insertChatTurn({ agentId, ownerUserId: owner, role: 'user', content: userMsg });
    insertChatTurn({ agentId, ownerUserId: owner, role: 'assistant', content: assistantMsg });
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
 */
export async function getPromptWithMemoryInjected(agentId, basePrompt) {
  return `Before responding: get your session history for context (use sessions_history with your session key if available) so you have the conversation context. Then read your MEMORY.md file in your workspace. If you have already responded to this request or a very similar one today (check the entries there), reply briefly that you already did so and ask whether to redo or reuse. If not, respond to the request below.

---
${basePrompt.trim()}
---`;
}

/**
 * Build a detailed prompt for an agent from the CEO's request (use filtered context per agent).
 */
function buildDetailedPromptForAgent(relevantMessage, agentName, agentRole) {
  const rolePart = agentRole ? ` You are ${agentName} (${agentRole}).` : ` You are ${agentName}.`;
  return `The CEO has requested the following for this standup (relevant part for you):

---
${relevantMessage.trim()}
---

${rolePart} Please provide a detailed response addressing this request only. Reply with concrete content for the CEO to review.`;
}

/**
 * Get recent standup context for intent classification: last user messages and agent responses.
 * Excludes the current message from lastUserMessages when it matches ceoMessage.
 * @param {number} standupId
 * @param {string} [ceoMessage] - Current message; if provided, the most recent user message matching it is excluded from lastUserMessages
 * @returns {{ lastUserMessages: string[], agentResponses: { agent_id: string, content: string }[] }}
 */
function getStandupContextForIntent(standupId, ceoMessage = '') {
  const currentTrim = (ceoMessage || '').trim();
  const userRows = db()
    .prepare('SELECT content FROM standup_messages WHERE standup_id = ? AND role = ? ORDER BY created_at DESC LIMIT 9')
    .all(standupId, 'user');
  const lastUserMessages = userRows.map((r) => (r.content || '').trim()).filter(Boolean);
  if (lastUserMessages.length && currentTrim && lastUserMessages[0] === currentTrim) {
    lastUserMessages.shift();
  }
  lastUserMessages.reverse();

  const taskRows = db()
    .prepare(
      'SELECT to_agent_id AS agent_id, response_content AS content, completed_at FROM agent_delegation_tasks WHERE standup_id = ? AND status = ? AND response_content IS NOT NULL AND response_content != ? ORDER BY completed_at DESC LIMIT 10'
    )
    .all(standupId, 'completed', '');
  const responseRows = db()
    .prepare('SELECT agent_id, content, submitted_at FROM standup_responses WHERE standup_id = ? ORDER BY submitted_at DESC LIMIT 10')
    .all(standupId);
  const withDate = [
    ...taskRows.map((r) => ({ agent_id: r.agent_id, content: r.content || '', at: r.completed_at })),
    ...responseRows.map((r) => ({ agent_id: r.agent_id, content: r.content || '', at: r.submitted_at })),
  ].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const agentResponses = withDate.slice(0, 10).map((r) => ({ agent_id: r.agent_id, content: r.content }));

  return { lastUserMessages, agentResponses };
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

function enqueueAllocatedTasks({
  agents,
  allocated,
  standupId,
  requestId,
  ownerUserId,
  ins,
  kanbanIns,
}) {
  const taskRows = [];
  for (const a of agents) {
    const query = allocated[a.id?.toLowerCase()] ?? allocated[a.id];
    if (!query || typeof query !== 'string') continue;
    const prompt = buildDetailedPromptForAgent(query, a.name || a.id, a.role);
    const scopedPrompt = withOwnerScope(prompt, ownerUserId);
    ins.run(standupId, requestId, a.id, scopedPrompt, ownerUserId);
    const row = db().prepare('SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1').get();
    if (row) {
      taskRows.push({ taskId: row.id, agent: a, query });
      const title = (query || '').trim().slice(0, 200);
      const desc = ownerUserId ? `owner_user_id: ${ownerUserId}` : '';
      kanbanIns.run(title, desc, a.id, standupId, row.id, ownerUserId || null);
      if (ownerUserId) {
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
export async function scheduleStandupStatusFanout(standupId, ceoUserId = null, contextText = '') {
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
  });
  return { ...out, mode: 'status_fanout', agentsAvailable: agents.length };
}

/**
 * Schedule CEO request via OpenClaw Gateway cron. Reads COO AGENTS.md, uses OpenAI to classify
 * intent and allocate a task query per agent. Never fans out to all agents.
 * @param {number} standupId
 * @param {string} ceoMessage
 * @param {string|null} [ceoUserId]
 * @param {{ restrictToAgentIds?: string[], preAllocated?: Record<string, string>, maxAgents?: number }} [opts]
 */
export async function scheduleCeoRequestViaOpenClawCron(standupId, ceoMessage, ceoUserId = null, opts = {}) {
  const ownerUserId = ceoUserId || getStandupOwnerUserId(standupId);
  let agents = getAgentsUnderCoo(ownerUserId);
  const maxAgents = Math.max(1, Math.min(100, Number(opts.maxAgents) || 2));
  const restrict = (opts.restrictToAgentIds || []).map((id) => String(id).toLowerCase()).filter(Boolean);
  if (restrict.length) {
    const set = new Set(restrict);
    agents = agents.filter((a) => set.has(String(a.id).toLowerCase()));
  }
  const agentsMdContent = await readCooAgentsMd(ownerUserId);
  const scopedMessage = withOwnerScope(ceoMessage, ownerUserId);
  const context = getStandupContextForIntent(standupId, scopedMessage);

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

  // External / published-A2A leaf members are not OpenClaw agents — invoke them directly.
  let externalOutcome = null;
  const { internal: internalAllocated, leaf: leafAllocated } = splitAllocationByKind(allocated);
  if (Object.keys(leafAllocated).length) {
    try {
      // Lazy import: org-member-delegation pulls in the A2A publish service, which transitively
      // imports this module.
      const { delegateToOrgMembers } = await import('./org-member-delegation.js');
      const { getCooAgentRow } = await import('./org-context.js');
      externalOutcome = await delegateToOrgMembers(ownerUserId, leafAllocated, {
        callerAgentId: getCooAgentRow()?.id,
      });
    } catch (e) {
      console.warn('[delegation] external member delegation failed:', e?.message || e);
    }
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

  const requestId = `req-${standupId}-${Date.now()}`;
  const baseUrl = getBaseUrl();
  const ins = db().prepare(
    `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id) VALUES (?, ?, ?, ?, 'pending', ?)`
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
        })
      : [];

  let scheduledCount = 0;
  const cronBlockedIds = new Set();
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
    if (kanbanId) {
      promptWithMemory =
        `FIRST ACTION (before anything else): call the kanban_move_status tool with JSON:\n` +
        `  {\"task_id\": ${kanbanId}, \"new_status\": \"in_progress\"}\n\n` +
        promptWithMemory +
        `\n\n---\nIMPORTANT — Kanban finish:\n` +
        `Do your specialist work and reply with the answer in this run. Do NOT say you are waiting for CEO acknowledgment — this task already runs automatically.\n` +
        `When finished, you may call kanban_move_status with {\"task_id\": ${kanbanId}, \"new_status\": \"completed\"} or \"failed\". ` +
        `The backend also marks the Kanban card completed/failed when this delegation run ends.\n---`;
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
    }
  }
  const pendingCount = taskRows.length - scheduledCount - cronBlockedIds.size;
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
  const context = getStandupContextForIntent(standupId, fullContext);
  let allocated = agentsMdContent && fullContext
    ? await classifyIntentAndAllocate(fullContext, agentsMdContent, { ...context, ownerUserId }, ownerUserId)
    : null;
  allocated = capAllocatedAgents(allocated, 2);

  let count = 0;
  if (allocated && typeof allocated === 'object' && Object.keys(allocated).length > 0) {
    for (const a of agents) {
      const query = allocated[a.id?.toLowerCase()] ?? allocated[a.id];
      if (!query || typeof query !== 'string') continue;
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
export function postCallbackForRequestId(requestId) {
  const alreadyPosted = db().prepare('SELECT 1 FROM delegation_callbacks WHERE request_id = ?').get(requestId);
  if (alreadyPosted) return;

  const tasks = db().prepare('SELECT * FROM agent_delegation_tasks WHERE request_id = ?').all(requestId);
  const anyPending = tasks.some((t) => t.status === 'pending');
  if (anyPending) return;

  const standupId = tasks[0]?.standup_id;
  if (!standupId) return;

  const completed = db().prepare('SELECT t.*, a.name as agent_name FROM agent_delegation_tasks t JOIN agents a ON a.id = t.to_agent_id WHERE t.request_id = ? AND t.status = ?').all(requestId, 'completed');
  const failed = db().prepare('SELECT t.*, a.name as agent_name FROM agent_delegation_tasks t JOIN agents a ON a.id = t.to_agent_id WHERE t.request_id = ? AND t.status = ?').all(requestId, 'failed');

  for (const t of completed) {
    db().prepare('INSERT INTO standup_responses (standup_id, agent_id, content) VALUES (?, ?, ?)').run(standupId, t.to_agent_id, t.response_content || '');
  }

  const lines = completed.map((t) => `**${t.agent_name}:**\n${truncatePreservingImages(t.response_content || '', 2000)}`);
  if (failed.length) lines.push(...failed.map((t) => `**${t.agent_name}:** [Error: ${t.error_message}]`));
  const callbackMessage = lines.length
    ? `Updates from the team (for your review):\n\n${lines.join('\n\n---\n\n')}`
    : 'No responses from the team yet.';

  db().prepare('INSERT INTO standup_messages (standup_id, role, content) VALUES (?, ?, ?)').run(standupId, 'coo', callbackMessage);
  db().prepare('INSERT INTO delegation_callbacks (request_id) VALUES (?)').run(requestId);
}

/**
 * Process pending delegation tasks for a single CEO.
 * Pulls only that CEO's tasks, mirrors the per-CEO standup cron pattern.
 * @param {string} ceoUserId
 */
export async function processPendingDelegationTasksForCeo(ceoUserId) {
  if (!ceoUserId) return;
  if (!isUserEnabled(ceoUserId)) return;
  recoverStaleProcessingDelegations(ceoUserId);
  const allPending = db()
    .prepare(
      `SELECT * FROM agent_delegation_tasks
       WHERE status = ? AND (owner_user_id = ? OR (owner_user_id IS NULL AND standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)))
       ORDER BY created_at LIMIT 20`
    )
    .all('pending', ceoUserId, ceoUserId);
  const pending = filterPipelineDelegationsForProcessing(allPending);
  const now = new Date().toISOString();

  async function runOne(task) {
    if (runningDelegationIds.has(task.id)) return;
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
      extractOwnerUserIdFromText(task.prompt, null) || standupOwner || getBalaCeoAuthId();
    let runtimeOcId = openclawId;
    try {
      runtimeOcId = ensureTenantOpenClawAgent(agent, ownerForTenant).openclawAgentId;
    } catch (e) {
      console.warn('[delegation] tenant openclaw ensure failed:', e?.message || e);
    }
    const sessionUser = `delegation-${task.id}`;
    const sessionKeyLine = `\n\nYour session key for this run is ${openclaw.sessionKeyFor(runtimeOcId, sessionUser)}. Use this exact sessionKey when calling sessions_history. If sessions_history returns empty, the conversation is in the messages above—proceed with those.`;
    let promptWithMemory = await getPromptWithMemoryInjected(task.to_agent_id, task.prompt);
    promptWithMemory = promptWithMemory + sessionKeyLine;
    const kanbanRow = db().prepare('SELECT id FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(task.id);
    if (kanbanRow) {
      promptWithMemory =
        `FIRST ACTION (before anything else): call the kanban_move_status tool with JSON:\n` +
        `  {\"task_id\": ${kanbanRow.id}, \"new_status\": \"in_progress\"}\n\n` +
        promptWithMemory +
        `\n\n---\nIMPORTANT — Kanban finish:\n` +
        `Do your specialist work and reply with the answer in this run. Do NOT say you are waiting for CEO acknowledgment — this task already runs automatically.\n` +
        `When finished, you may call kanban_move_status with {\"task_id\": ${kanbanRow.id}, \"new_status\": \"completed\"} or \"failed\". ` +
        `The backend also marks the Kanban card completed/failed when this delegation run ends.\n---`;
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
      const discoveryTimeout = Number(process.env.OPENCLAW_DISCOVERY_TIMEOUT_MS || 900000);
      const { content, usage } = await openclaw.chatCompletions(
        runtimeOcId,
        [{ role: 'user', content: promptWithMemory }],
        sessionUser,
        false,
        isDiscovery ? { timeoutMs: discoveryTimeout } : {}
      );
      meterOpenClawUsage(ownerForTenant, task.to_agent_id, {
        usage,
        source: 'delegation',
        promptText: promptWithMemory,
        replyText: content,
        sessionId: sessionUser,
      });
      const responseText = normalizeReplyContent(content) || '(no response)';
      db().prepare('UPDATE agent_delegation_tasks SET status = ?, response_content = ?, completed_at = ? WHERE id = ?').run('completed', responseText, now, task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: true });
        try {
          await maybeAdvanceAgentWorkflow({ ...task, status: 'completed', response_content: responseText });
        } catch (wfErr) {
          console.warn('[agent-workflow] advance:', wfErr.message);
        }
      } else {
        completePipelineKanbanForDelegation(task.id, { ok: true });
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
        extractOwnerUserIdFromText(task.prompt)
      );
      const summary = extractTaskSummaryFromPrompt(task.prompt);
      await appendToAgentMemory(
        task.to_agent_id,
        summary,
        extractOwnerUserIdFromText(task.prompt) || standupOwner
      );
    } catch (err) {
      db().prepare('UPDATE agent_delegation_tasks SET status = ?, error_message = ?, completed_at = ? WHERE id = ?').run('failed', err.message, now, task.id);
      if (isAgentWorkflowPrompt(task.prompt)) {
        completeAgentWorkflowKanbanForDelegation(task.id, { ok: false });
        await failAgentWorkflowForDelegation({ ...task, status: 'failed', error_message: err.message });
      } else {
        completePipelineKanbanForDelegation(task.id, { ok: false });
        failPipelineWorkflowForDelegation({ ...task, status: 'failed', error_message: err.message }, { error: err.message });
      }
    } finally {
      runningDelegationIds.delete(task.id);
    }
  }

  await Promise.allSettled(pending.map((task) => runOne(task)));

  // Only scan request_ids that belong to this CEO so callbacks don't mix across tenants
  const requestIds = db()
    .prepare(
      `SELECT DISTINCT request_id FROM agent_delegation_tasks
       WHERE owner_user_id = ? OR (owner_user_id IS NULL AND standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?))`
    )
    .all(ceoUserId, ceoUserId)
    .map((r) => r.request_id);
  for (const requestId of requestIds) {
    postCallbackForRequestId(requestId);
  }
}

/**
 * Process pending delegation tasks for ALL enabled CEOs, one pass each.
 * Called by the delegation cron. Mirrors runScheduledStandup() pattern.
 */
export async function processPendingDelegationTasksForAllCeos() {
  const ceos = db()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  // Also handle orphaned tasks (owner_user_id NULL, not matched to any CEO above)
  const results = await Promise.allSettled(
    ceos.map(({ id }) => processPendingDelegationTasksForCeo(id))
  );
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message);
  if (errors.length) console.warn('[delegation] per-CEO errors:', errors.join('; '));
}

/** Backward-compatible alias — routes/scripts that import the old name continue to work. */
export const processPendingDelegationTasks = processPendingDelegationTasksForAllCeos;
