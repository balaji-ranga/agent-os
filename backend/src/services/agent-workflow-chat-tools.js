/**
 * Chat-triggerable agent workflows — list/trigger helpers for COO tools and CEO chat.
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { tryTriggerWorkflowFromChat, startAgentWorkflowRun } from './agent-workflow-runner.js';
import { resolveToolOwnerUserId, bodyWithoutSpoofedOwner } from './tool-owner-scope.js';

export function resolveWorkflowOwnerUserId(req, body = {}, resolveAuthenticatedCeoUserId) {
  return resolveToolOwnerUserId(req, bodyWithoutSpoofedOwner(body), resolveAuthenticatedCeoUserId);
}

export function listChatTriggerableWorkflows(ownerUserId) {
  return listPublishedWorkflows(ownerUserId, { chatOnly: true });
}

function formatWorkflowForAgent(w) {
  const chatTriggerable =
    Array.isArray(w.trigger_modes) &&
    w.trigger_modes.includes('chat') &&
    String(w.chat_trigger_phrase || '').trim();
  return {
    id: w.id,
    name: w.name,
    description: w.description || '',
    chat_trigger_phrase: w.chat_trigger_phrase || '',
    trigger_modes: w.trigger_modes || [],
    schedule_cron: w.schedule_cron || '',
    status: w.status,
    paused: !!w.paused,
    chat_triggerable: !!chatTriggerable,
    trigger_hint: chatTriggerable
      ? `Use agent_workflow_trigger with message "${w.chat_trigger_phrase}" or workflow_id "${w.id}"`
      : `Use agent_workflow_trigger with workflow_id "${w.id}"`,
  };
}

/** List published workflows for COO tools. Default: all published; chatOnly limits to chat phrase triggers. */
export function listPublishedWorkflows(ownerUserId, { chatOnly = false } = {}) {
  return listWorkflowsForAgent(ownerUserId, { chatOnly, includeDrafts: false });
}

/**
 * List workflows for entitled owner.
 * Workflow Builder may include drafts; COO tools stay published-only by default.
 */
export function listWorkflowsForAgent(ownerUserId, { chatOnly = false, includeDrafts = false } = {}) {
  let workflows = store.listDefinitions(ownerUserId);
  if (!includeDrafts) {
    workflows = workflows.filter((w) => w.status === 'published' && !w.paused);
  }
  if (chatOnly) {
    workflows = workflows.filter(
      (w) =>
        Array.isArray(w.trigger_modes) &&
        w.trigger_modes.includes('chat') &&
        String(w.chat_trigger_phrase || '').trim()
    );
  }
  return workflows.map(formatWorkflowForAgent);
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

function tokenize(s) {
  return normText(s)
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** User wants to send email/invite directly — not look up a workflow. */
function looksLikeDirectEmailSend(queryNorm) {
  if (!queryNorm) return false;
  const patterns = [
    /\bsend\s+(an?\s+)?email\b/,
    /\bsend\s+as\s+email\b/,
    /\bemail\s+(with|and)\s+(a\s+)?calendar\b/,
    /\bcalendar\s+invite\b/,
    /\bmeeting\s+invite\b/,
    /\bsend\s+(a\s+)?calendar\b/,
    /\bemail\s+invite\b/,
    /\binvite\s+via\s+email\b/,
    /\bdinner\s+with\b.*\b(email|invite|calendar)\b/,
  ];
  if (patterns.some((p) => p.test(queryNorm))) return true;
  // Short generic "email" query without "workflow" — prefer email_send over workflow search
  if (!/\bworkflow\b/.test(queryNorm) && /^((send|email|mail)\b|email\b)/.test(queryNorm)) return true;
  if (queryNorm === 'email' || queryNorm === 'send email') return true;
  return false;
}

/** Score how well a workflow matches a natural-language enquiry. */
function scoreWorkflowMatch(w, queryNorm, tokens) {
  const hay = normText([w.id, w.name, w.description, w.chat_trigger_phrase].join(' '));
  if (!queryNorm) return 0;
  let score = 0;
  if (hay.includes(queryNorm)) score += 10;
  if (normText(w.name).includes(queryNorm) || normText(w.id).includes(queryNorm)) score += 8;
  if (normText(w.description).includes(queryNorm)) score += 6;
  if (normText(w.chat_trigger_phrase).includes(queryNorm)) score += 5;
  for (const t of tokens) {
    if (hay.includes(t)) score += 2;
  }
  // Demo/sample email workflows should not win on generic "email" alone
  const idNorm = normText(w.id);
  const isSampleEmailWorkflow =
    /sample|demo|job.discovery/.test(idNorm) || /job discovery.*email/i.test(String(w.name || ''));
  const hasWorkflowContext = /\b(workflow|job|discovery|pipeline)\b/.test(queryNorm);
  if (isSampleEmailWorkflow && !hasWorkflowContext && tokens.includes('email') && tokens.length <= 4) {
    score = Math.max(0, score - 20);
  }
  return score;
}

/**
 * Find workflows matching a natural-language enquiry (owner-scoped).
 */
export function enquireWorkflows(ownerUserId, query, { limit = 10, all = false, includeDrafts = false } = {}) {
  const q = String(query || '').trim();
  const queryNorm = normText(q);
  const tokens = tokenize(q);

  if (all || queryNorm === 'all' || queryNorm === '*') {
    const matches = listWorkflowsForAgent(ownerUserId, { includeDrafts }).slice(0, Math.min(limit, 50));
    return { query: q || 'all', matches, count: matches.length, include_drafts: !!includeDrafts };
  }

  if (!queryNorm) {
    return { query: q, matches: [], count: 0, include_drafts: !!includeDrafts };
  }

  if (looksLikeDirectEmailSend(queryNorm)) {
    return {
      query: q,
      matches: [],
      count: 0,
      include_drafts: !!includeDrafts,
      hint: 'Use email_send for direct email or calendar invites (to, subject, body, optional calendar object). Do not trigger workflows for one-off email/invite requests.',
      use_email_send: true,
    };
  }

  let pool = store.listDefinitions(ownerUserId);
  if (!includeDrafts) {
    pool = pool.filter((w) => w.status === 'published' && !w.paused);
  }

  const matches = pool
    .map((w) => {
      const score = scoreWorkflowMatch(w, queryNorm, tokens);
      const formatted = formatWorkflowForAgent(w);
      return { ...formatted, score };
    })
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(limit, 25));

  return { query: q, matches, count: matches.length, include_drafts: !!includeDrafts };
}

/** Resolve a workflow by id, name (fuzzy), or chat phrase (prefer phrase at start of message). */
export function resolveWorkflowForTrigger(ownerUserId, { workflow_id, workflow_name, name, message } = {}) {
  const id = String(workflow_id || '').trim();
  if (id) {
    const byId = store.getDefinition(id, ownerUserId);
    if (byId) return byId;
  }

  const nameQuery = String(workflow_name || name || '')
    .trim()
    .toLowerCase();
  if (nameQuery) {
    const all = store.listDefinitions(ownerUserId);
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s_-]+/g, '');
    const nq = norm(nameQuery);
    let match =
      all.find((w) => w.id.toLowerCase() === nameQuery) ||
      all.find((w) => w.name.toLowerCase() === nameQuery) ||
      all.find((w) => norm(w.name) === nq) ||
      all.find((w) => norm(w.id) === nq) ||
      all.find((w) => w.name.toLowerCase().includes(nameQuery) || w.id.toLowerCase().includes(nameQuery));
    if (match) return match;
  }

  const msg = String(message || '').trim();
  if (msg) {
    const byPhrase = store.findPublishedByChatPhrase(ownerUserId, msg);
    if (byPhrase) return byPhrase;
    const lower = msg.toLowerCase();
    const firstLine = lower.split(/\r?\n/)[0].trim();
    // Prefer chat phrase at the start of the message (goal plans embed multiple phrases in the body).
    let bestStart = null;
    let bestStartLen = -1;
    for (const w of listChatTriggerableWorkflows(ownerUserId)) {
      const phrase = String(w.chat_trigger_phrase || '').toLowerCase().trim();
      if (!phrase) continue;
      const atStart =
        lower === phrase ||
        lower.startsWith(phrase + '\n') ||
        lower.startsWith(phrase + '\r') ||
        lower.startsWith(phrase + ' ') ||
        firstLine === phrase ||
        firstLine.startsWith(phrase + ' ');
      if (atStart && phrase.length > bestStartLen) {
        bestStart = w;
        bestStartLen = phrase.length;
      }
    }
    if (bestStart) return store.getDefinition(bestStart.id, ownerUserId);

    // Fallback: longest phrase contained in the message.
    let bestContains = null;
    let bestContainsLen = -1;
    for (const w of listChatTriggerableWorkflows(ownerUserId)) {
      const phrase = String(w.chat_trigger_phrase || '').toLowerCase().trim();
      if (phrase && lower.includes(phrase) && phrase.length > bestContainsLen) {
        bestContains = w;
        bestContainsLen = phrase.length;
      }
    }
    if (bestContains) return store.getDefinition(bestContains.id, ownerUserId);
  }

  return null;
}

export function parseRunWorkflowIntent(message) {
  const trimmed = String(message || '').trim();
  const m = trimmed.match(
    /^(?:please\s+)?(?:run|start|trigger|execute)\s+(?:the\s+)?(?:workflow\s+)?["']?(.+?)["']?\s*$/i
  );
  return m ? m[1].trim() : null;
}

export function findLatestFailedRun(ownerUserId, { workflow_id, workflow_name, workflow_query, limit = 50 } = {}) {
  const query = workflow_name || workflow_query;
  let def = null;
  if (workflow_id) {
    def = store.getDefinition(workflow_id, ownerUserId);
  }
  if (!def && query) {
    def = resolveWorkflowForTrigger(ownerUserId, {
      workflow_id: query,
      workflow_name: query,
      message: query,
    });
  }
  if (!def) return { def: null, run: null, runs: [] };

  const runs = store.listRuns(def.id, ownerUserId, limit);
  const failed = runs.find((r) => r.status === 'failed');
  if (!failed) return { def, run: null, runs };

  const full = store.getRun(failed.id, ownerUserId);
  return { def, run: full, runs };
}

/** Resolve a run by numeric id or run_number within a workflow. */
export function resolveRunForOwner(
  ownerUserId,
  { run_id, runId, run_number, runNumber, workflow_id, workflowId, definition_id, workflow_name, latest_failed } = {}
) {
  const explicitId = Number(run_id ?? runId);
  if (explicitId) return store.getRun(explicitId, ownerUserId);

  let defId = String(workflow_id || workflowId || definition_id || '').trim();
  const num = Number(run_number ?? runNumber);

  if (latest_failed) {
    const { run } = findLatestFailedRun(ownerUserId, {
      workflow_id: defId || undefined,
      workflow_name,
    });
    return run || null;
  }

  if (defId && num) {
    const row = getDb()
      .prepare(
        `SELECT id FROM agent_workflow_runs
         WHERE definition_id = ? AND owner_user_id = ? AND run_number = ?`
      )
      .get(defId, ownerUserId, num);
    if (row) return store.getRun(row.id, ownerUserId);
  }
  if (defId) {
    const runs = store.listRuns(defId, ownerUserId, 1);
    if (runs[0]) return store.getRun(runs[0].id, ownerUserId);
  }
  return null;
}

export function summarizeRunForAgent(run) {
  if (!run) return null;
  return {
    run_id: run.id,
    run_number: run.run_number,
    definition_id: run.definition_id,
    definition_name: run.definition_name,
    status: run.status,
    progress_pct: run.progress_pct,
    error_message: run.error_message,
    started_at: run.started_at,
    completed_at: run.completed_at,
    steps: (run.steps || []).map((s) => ({
      node_id: s.node_id,
      node_label: s.node_label,
      node_type: s.node_type,
      status: s.status,
      error_message: s.error_message,
      output_preview:
        (typeof s.output?.text === 'string' && s.output.text.slice(0, 300)) ||
        (s.output_json && String(s.output_json).slice(0, 300)) ||
        null,
    })),
  };
}

export async function waitForRunTerminal(ownerUserId, runId, maxMs = 45000, pollMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const run = store.getRun(runId, ownerUserId);
    if (!run) return null;
    if (['completed', 'failed', 'paused', 'cancelled'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return store.getRun(runId, ownerUserId);
}

/**
 * Fast-path natural-language commands for the Workflow Builder chat (no LLM).
 */
export function extractWorkflowIdFromText(message) {
  const t = String(message || '');
  const patterns = [
    /\bid\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]*)["']?/i,
    /\bworkflow\s+id\s*[:=]?\s*["']?([a-z0-9][a-z0-9_-]*)["']?/i,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function parseStatusChangeIntent(t, workflowId) {
  const toDraft =
    /(?:change|set)\s+(?:the\s+)?status(?:\s+of)?(?:\s+(?:workflow\s+)?(?:id\s*[:=]\s*)?["']?([^"'\n]+?)["']?)?\s+to\s+draft/i.test(
      t
    ) ||
    /(?:make|set)\s+(?:workflow\s+)?(?:id\s*[:=]\s*)?["']?([^"'\n]+?)["']?\s+(?:a\s+)?draft/i.test(t) ||
    /(?:unpublish|revert)\s+(?:workflow\s+)?(?:id\s*[:=]\s*)?["']?([^"'\n]+?)["']?/i.test(t);

  if (!toDraft && !/draft/i.test(t)) return null;
  if (!/(?:draft|unpublish|revert)/i.test(t)) return null;

  const explicitId = extractWorkflowIdFromText(t);
  let m = t.match(
    /(?:change|set)\s+(?:the\s+)?status\s+of\s+(?:id\s*[:=]\s*)?["']?([a-z0-9][a-z0-9_-]*)["']?\s+to\s+draft/i
  );
  if (m) {
    return { cmd: 'unpublish_workflow', workflow_id: m[1].trim() };
  }

  m = t.match(/(?:change|set)\s+(?:the\s+)?status\s+(?:of\s+)?["']?([^"'\n]+?)["']?\s+to\s+draft/i);
  if (m) {
    const target = m[1].trim();
    const id = explicitId || (/^[a-z0-9][a-z0-9_-]*$/i.test(target) ? target : null);
    return {
      cmd: 'unpublish_workflow',
      workflow_id: id || workflowId || undefined,
      workflow_name: id ? undefined : target,
    };
  }

  m = t.match(/(?:make|set)\s+(?:workflow\s+)?["']?([^"'\n]+?)["']?\s+(?:to\s+)?draft/i);
  if (m) {
    const target = m[1].trim();
    const id = explicitId || (/^[a-z0-9][a-z0-9_-]*$/i.test(target) ? target : null);
    return {
      cmd: 'unpublish_workflow',
      workflow_id: id || workflowId || undefined,
      workflow_name: id ? undefined : target,
    };
  }

  if (explicitId && /draft|unpublish|revert/i.test(t)) {
    return { cmd: 'unpublish_workflow', workflow_id: explicitId };
  }

  return null;
}

export function parseWorkflowAgentCommand(message, { workflowId = null } = {}) {
  const t = String(message || '').trim();
  if (!t) return null;

  const statusIntent = parseStatusChangeIntent(t, workflowId);
  if (statusIntent) return statusIntent;

  // clone / copy / duplicate workflow X as Y
  let cloneAs = t.match(/^(?:clone|copy|duplicate)\s+(?:workflow\s+)?(.+?)\s+(?:as|to)\s+(.+?)\s*$/i);
  if (cloneAs) {
    return {
      cmd: 'clone_workflow',
      workflow_name: cloneAs[1].replace(/^["'`]+|["'`]+$/g, '').trim(),
      new_name: cloneAs[2].replace(/^["'`]+|["'`]+$/g, '').trim(),
      workflow_id: workflowId || undefined,
    };
  }
  let cloneOne = t.match(/^(?:clone|copy|duplicate)\s+(?:workflow\s+)?(.+?)\s*$/i);
  if (cloneOne && !/^(?:this\s+)?workflow$/i.test(cloneOne[1].trim())) {
    return {
      cmd: 'clone_workflow',
      workflow_name: cloneOne[1].replace(/^["'`]+|["'`]+$/g, '').trim(),
      workflow_id: workflowId || undefined,
    };
  }
  if (/^(?:clone|copy|duplicate)\s+(?:this\s+)?workflow\s*$/i.test(t) && workflowId) {
    return { cmd: 'clone_workflow', workflow_id: workflowId };
  }

  if (
    /(?:recent|latest|last|most recent)\s+failed\s+run/i.test(t) ||
    /failed\s+run\s+of/i.test(t) ||
    /(?:why|how)\s+(?:did|does|was)\s+.+\s+fail/i.test(t) ||
    /\b(?:rca|root\s*cause)\b/i.test(t) ||
    /(?:analyze|analysis)\s+(?:the\s+)?(?:failed\s+)?(?:run|failure|error)/i.test(t)
  ) {
    const nameMatch =
      t.match(/(?:failed\s+run\s+of|failure\s+of)\s+(?:the\s+)?(?:workflow\s+)?[`"']?([a-zA-Z0-9_-]+)[`"']?/i) ||
      t.match(/`([^`]+)`/);
    const workflow_name = nameMatch?.[1]?.trim();
    return {
      cmd: 'inspect_run',
      workflow_name: workflow_name || undefined,
      workflow_id: workflowId || undefined,
      latest_failed: true,
    };
  }

  const runTarget = parseRunWorkflowIntent(t);
  if (runTarget) return { cmd: 'trigger_workflow', workflow_name: runTarget, workflow_id: workflowId };

  let m = t.match(/^(?:test|debug)\s+(?:workflow\s+)?["']?(.+?)["']?\s*$/i);
  if (m) return { cmd: 'test_workflow', workflow_name: m[1].trim(), workflow_id: workflowId };

  m = t.match(/^(?:reload|refresh|open)\s+(?:workflow\s+)?["']?(.+?)["']?\s*$/i);
  if (m) return { cmd: 'open_workflow', workflow_name: m[1].trim() };

  if (/^(?:reload|refresh)\s*(?:workflow|graph)?\s*$/i.test(t)) {
    return { cmd: 'reload_workflow', workflow_id: workflowId };
  }

  m = t.match(/^(?:pause)\s+(?:workflow\s+)?["']?(.+?)["']?\s*$/i);
  if (m) return { cmd: 'pause_workflow', workflow_name: m[1].trim(), workflow_id: workflowId };

  m = t.match(/^(?:resume|unpause)\s+(?:workflow\s+)?["']?(.+?)["']?\s*$/i);
  if (m) return { cmd: 'resume_workflow', workflow_name: m[1].trim(), workflow_id: workflowId };

  m = t.match(/^(?:pause)\s+(?:all\s+)?runs?\s*$/i);
  if (m) return { cmd: 'pause_all_runs', workflow_id: workflowId };

  m = t.match(/^(?:pause)\s+run\s+#?(\d+)\s*$/i);
  if (m) return { cmd: 'pause_run', run_number: Number(m[1]), workflow_id: workflowId };

  m = t.match(/^(?:stop|cancel|delete)\s+run\s+#?(\d+)\s*$/i);
  if (m) return { cmd: 'stop_run', run_number: Number(m[1]), workflow_id: workflowId };

  m = t.match(/^(?:inspect|status|show|check)\s+run\s+#?(\d+)\s*$/i);
  if (m) return { cmd: 'inspect_run', run_number: Number(m[1]), workflow_id: workflowId };

  m = t.match(/^(?:inspect|status)\s+(?:latest|last)\s+failed\s+run(?:\s+(?:of|for)\s+["']?(.+?)["']?)?\s*$/i);
  if (m) {
    return {
      cmd: 'inspect_run',
      workflow_name: m[1]?.trim() || undefined,
      workflow_id: workflowId,
      latest_failed: true,
    };
  }

  m = t.match(/^(?:inspect|status)\s+(?:latest|last)\s+run\s*$/i);
  if (m) return { cmd: 'inspect_run', workflow_id: workflowId };

  m = t.match(/^(?:unpublish|revert\s+to\s+draft|make\s+draft|set\s+to\s+draft)(?:\s+(?:workflow\s+)?)?["']?(.+?)["']?\s*$/i);
  if (m) {
    const name = (m[1] || '').trim();
    return { cmd: 'unpublish_workflow', workflow_name: name || undefined, workflow_id: workflowId };
  }
  if (/^(?:unpublish|revert\s+to\s+draft|make\s+draft)\s*$/i.test(t)) {
    return { cmd: 'unpublish_workflow', workflow_id: workflowId };
  }

  return null;
}

/**
 * Start a workflow by chat phrase match, name, or explicit workflow_id.
 * `message` is used for phrase matching (prefer short phrase); `input` is the run payload when set.
 */
export async function triggerAgentWorkflowForOwner(
  ownerUserId,
  { message = '', workflow_id, workflow_name, name, input, actor } = {}
) {
  const matchText = String(message || input || '').trim();
  const runInput =
    input !== undefined && input !== null && String(input).trim() !== ''
      ? input
      : matchText;
  const def = resolveWorkflowForTrigger(ownerUserId, {
    workflow_id,
    workflow_name: workflow_name || name,
    message: matchText,
  });

  if (def) {
    if (!store.isWorkflowTriggerable(def)) {
      throw new Error(`Workflow "${def.name}" (${def.id}) is not runnable (draft, paused, or unpublished)`);
    }
    return startAgentWorkflowRun(def.id, ownerUserId, {
      trigger: 'chat',
      input: runInput || `Triggered: ${def.name}`,
      actor,
    });
  }

  if (!matchText) throw new Error('message, workflow name, or workflow_id required');

  const run = await tryTriggerWorkflowFromChat(ownerUserId, matchText, actor);
  if (!run) {
    const available = listChatTriggerableWorkflows(ownerUserId);
    const all = store.listDefinitions(ownerUserId).filter((w) => w.status === 'published');
    const hints = all
      .map((w) => `"${w.name}" (id: ${w.id}${w.chat_trigger_phrase ? `, chat: "${w.chat_trigger_phrase}"` : ''})`)
      .join('; ');
    throw new Error(
      hints
        ? `No workflow matched. Published workflows: ${hints}`
        : 'No published workflows found for this CEO'
    );
  }
  return run;
}
