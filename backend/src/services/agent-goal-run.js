/**
 * Generic multi-intent goal runs: plan steps, execute, advance on async child terminal.
 * Not CRM/ERP-specific - workflow_trigger / agent_continue / notify steps work for any owner/agent.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions as platformChatCompletions } from '../config/llm.js';
import { clearKanbanTaskNotification, notifyKanbanTaskCreated, sendPlatformNotifications } from './platform-notifications.js';
import { isPlatformCronActive } from './platform-cron-registry.js';
import * as openclaw from '../gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getPromptForFreshGoalRun } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';
import { triggerAgentWorkflowForOwner } from './agent-workflow-chat-tools.js';
import { registerWorkflowRunWatch } from './agent-workflow-run-watch.js';
import {
  stripWorkflowPhrasesFromPrompt,
  classifySpecialtyIntentsForPlan,
  specialtyIntentsToSteps,
  residualIsLetteredOrNumbered,
  GOAL_PLAN_MAX_SPECIALTY,
} from './goal-plan-specialty.js';
import {
  classifyGoalPlanIntents,
  listOrchestratorToolsForGoalPlan,
  matchWorkflowStepsFromCatalog,
  resolveCeoEmail,
  isCooStyleOrchestrator,
  applyHumanAssignmentPolicy,
} from './goal-plan-intent.js';
import { invokeContentToolHttp } from './content-tool-http-invoke.js';
import { listPublishedWorkflows } from './agent-workflow-chat-tools.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { withLlmopsContext } from './llmops-context.js';
import { deliverScheduledGoalOutcome } from './agent-channel-announce.js';
import { scheduleCeoRequestViaOpenClawCron } from './delegation-queue.js';
import {
  resolveAgentToolArgsForGoal,
  isCompositionalTool,
  toolNeedsAgentInterpretation,
  goalWantsChatSynthesis,
} from './goal-plan-tool-args.js';
import { mergeCapabilitySteps, resolveCapabilitiesFromPrompt } from './business-capabilities.js';
import { getAgentToolGrants } from './openclaw-agent-tools.js';
import { mergeRuntimeCapabilityStep } from './runtime-capability-registry.js';
import { isEligiblePlanningAgent } from './intent-classifier.js';
import {
  ensureGoalOutcomeTables,
  parseOutcomeFromPrompt,
  observeStepResult,
  applyObservation,
  recordMissionEvent,
  loadOutcome,
  loadPlanHistory,
  persistOutcome,
  persistPlanHistory,
  snapshotPlanVersion,
  mergeConstraintText,
  listMissionEvents,
} from './goal-outcome.js';
import { classifyToolFailure } from './tool-failure-class.js';
import {
  enrichPlanSteps,
  decideFromObservation,
  nextExecutorForStep,
  buildRetrospective,
} from './goal-plan-runtime.js';
import { getExceptionPolicy } from './exception-policy.js';
import { getAgentsUnderOrchestratorForCeo } from './org-context.js';
import { qualityAssureGoalPlan } from './goal-plan-quality.js';
import { createMediaArtifact } from './ceo-media-artifacts.js';

const TERMINAL_WF = new Set(['completed', 'failed', 'cancelled', 'paused']);
let _tablesReady = false;

function db() {
  return getDb();
}

function parseJson(raw, fallback = {}) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

function clip(s, n = 500) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + '...';
}

export function explicitGoalUrls(text) {
  const found = String(text || '').match(/https:\/\/[^\s<>"']+/gi) || [];
  return [...new Set(found.map((url) => url.replace(/[),.;\]]+$/, '')))];
}

export function selectExplicitFallbackUrl(text, failedItem = '') {
  const urls = explicitGoalUrls(text);
  if (!urls.length) return null;
  const needle = String(failedItem || '').trim().toLowerCase();
  if (needle) {
    const exact = urls.find((url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.pathname}${parsed.search}`.toLowerCase().includes(needle);
      } catch {
        return false;
      }
    });
    if (exact) return exact;
  }
  return urls.length === 1 ? urls[0] : null;
}

export function goalRequestsBrowserRecovery(text) {
  return /\b(browser|browse|web)\b/i.test(String(text || ''));
}

function resultPayload(step) {
  return parseJson(step?.result_json ?? step?.result, null);
}

function usefulReply(result) {
  return String(
    result?.reply_preview ||
    result?.human_outcome ||
    result?.deliverable ||
    result?.summary ||
    ''
  ).trim();
}

export function sanitizeUnsupportedItemClaims(text, unsupportedItems = []) {
  let output = String(text || '');
  const corrected = [];
  for (const rawItem of unsupportedItems) {
    const item = String(rawItem || '').trim();
    if (!item) continue;
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const claim = new RegExp(`(\\b${escaped}\\b[^\\n]{0,180}?)([+-]?\\d+(?:\\.\\d+)?\\s*%)`, 'gi');
    if (claim.test(output)) {
      output = output.replace(claim, `$1unavailable`);
      corrected.push(item);
    }
  }
  if (corrected.length) {
    output += `\n\nVerified-data correction: ${corrected.join(', ')} had no successful source or browser evidence, so no numeric value is reported.`;
  }
  return output;
}

function unresolvedItemsBeforeStep(goalRunId, stepIndex) {
  const failed = new Set();
  const recovered = new Set();
  for (const row of loadGoalSteps(goalRunId)) {
    if (Number(row.step_index) >= Number(stepIndex)) continue;
    const result = resultPayload(row);
    for (const error of result?.errors || []) {
      if (error?.symbol) failed.add(String(error.symbol));
    }
    for (const fallback of result?.fallbacks || []) {
      const hasEvidence = fallback?.status === 'completed' && fallback?.task?.result;
      if (hasEvidence && fallback?.symbol) recovered.add(String(fallback.symbol));
    }
  }
  return [...failed].filter((item) => !recovered.has(item));
}

function priorSuccessfulBrowserFallback(goalRunId, stepIndex, symbol) {
  for (const row of loadGoalSteps(goalRunId).reverse()) {
    if (Number(row.step_index) >= Number(stepIndex)) continue;
    const match = (resultPayload(row)?.fallbacks || []).find((fallback) =>
      String(fallback?.symbol || '').toUpperCase() === String(symbol || '').toUpperCase()
      && fallback?.status === 'completed'
      && fallback?.task?.result
    );
    if (match) return match;
  }
  return null;
}

export function buildVerifiedMarketOutcome(steps = []) {
  const values = new Map();
  const browserValues = new Map();
  for (const step of steps) {
    const result = resultPayload(step);
    if (!result?.multi_symbol) continue;
    for (const item of result.results || []) {
      const payload = item?.result?.result || item?.result || {};
      const change = Number(payload.daily_change_pct);
      if (!item?.symbol || !Number.isFinite(change)) continue;
      values.set(String(item.symbol).toUpperCase(), {
        change,
        close: Number.isFinite(Number(payload.close)) ? Number(payload.close) : null,
        source: payload.source_url || payload.source || null,
        timestamp: payload.source_timestamp || payload.timestamp || null,
      });
    }
    for (const fallback of result.fallbacks || []) {
      if (fallback?.status !== 'completed' || !fallback?.task?.result || !fallback?.symbol) continue;
      if (!browserValues.has(String(fallback.symbol).toUpperCase())) {
        browserValues.set(String(fallback.symbol).toUpperCase(), fallback.task.result);
      }
    }
  }
  if (!values.size && !browserValues.size) return '';
  const lines = ['### Verified market outcome'];
  for (const [symbol, value] of values) {
    const close = value.close == null ? '' : `; close ${value.close}`;
    lines.push(`- **${symbol}: ${value.change >= 0 ? '+' : ''}${value.change.toFixed(2)}%**${close}`);
  }
  for (const [symbol, evidence] of browserValues) {
    const summary = String(evidence?.summary || evidence?.verification?.evidence?.[0] || '').trim();
    lines.push(`- **${symbol} (browser recovery):** ${clip(summary || 'verified recovery completed', 500)}`);
  }
  return lines.join('\n');
}

export function buildOutcomeRichTerminalReport({ goal, steps, terminal = 'completed' } = {}) {
  const rows = Array.isArray(steps) ? steps : [];
  const synthesis = [...rows].reverse().map(resultPayload).map(usefulReply)
    .find((value) => value && value !== '(no response)');
  const toolEvidence = [];
  const gaps = [];
  for (const step of rows) {
    const result = resultPayload(step);
    if (!result) continue;
    const label = step.label || step.step_type || 'Step';
    if (step.step_type === 'human_task' && result.human_outcome) {
      toolEvidence.push(`${label}: ${clip(result.human_outcome, 700)}`);
    } else if (result.multi_symbol) {
      const ok = (result.results || []).map((r) => r.symbol).filter(Boolean);
      if (ok.length) toolEvidence.push(`${label}: ${ok.join(', ')} returned data`);
      for (const err of result.errors || []) gaps.push(`${err.symbol || label}: ${clip(err.error, 180)}`);
      for (const recovered of result.fallbacks || []) {
        const state = recovered?.task?.status || recovered?.status || 'submitted';
        toolEvidence.push(`${recovered.symbol || label}: browser fallback ${state} (${recovered.url})`);
      }
    } else if (result.tool_name) {
      toolEvidence.push(`${label}: ${result.tool_name} ${result.ok === false ? 'failed' : 'completed'}`);
    }
    if (step.status === 'failed' || result.ok === false) {
      gaps.push(`${label}: ${clip(step.error_message || result.error || 'failed', 180)}`);
    }
  }
  const title = goal?.title || clip(goal?.prompt, 100) || goal?.id || 'Goal';
  return [
    `## Goal ${terminal}: \`${goal?.id || ''}\``,
    `**${title}**`,
    synthesis ? `### Outcome\n${clip(synthesis, 5000)}` : '',
    toolEvidence.length ? `### Evidence\n${toolEvidence.slice(0, 20).map((x) => `- ${x}`).join('\n')}` : '',
    gaps.length ? `### Gaps\n${gaps.slice(0, 12).map((x) => `- ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function ensureAgentGoalRunTables() {
  if (_tablesReady) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS agent_goal_runs (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      prompt TEXT DEFAULT '',
      source TEXT DEFAULT '',
      scheduled_goal_id TEXT,
      scheduled_goal_run_id TEXT,
      status TEXT DEFAULT 'pending',
      context_json TEXT DEFAULT '{}',
      current_step_index INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS agent_goal_steps (
      id TEXT PRIMARY KEY,
      goal_run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL,
      step_type TEXT NOT NULL,
      label TEXT DEFAULT '',
      spec_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      child_workflow_run_id INTEGER,
      result_json TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (goal_run_id) REFERENCES agent_goal_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_goal_runs_owner ON agent_goal_runs(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_run ON agent_goal_steps(goal_run_id, step_index ASC);
    CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_wf ON agent_goal_steps(child_workflow_run_id);
  `);
  for (const sql of [
    'ALTER TABLE agent_goal_steps ADD COLUMN exception_retry_count INTEGER DEFAULT 0',
    'ALTER TABLE agent_goal_steps ADD COLUMN exception_kanban_id INTEGER',
    'ALTER TABLE agent_goal_steps ADD COLUMN human_kanban_task_id INTEGER',
  ]) {
    try {
      db().exec(sql);
    } catch (_) {}
  }
  const cols = db().prepare('PRAGMA table_info(agent_goal_steps)').all().map((c) => c.name);
  if (!cols.includes('child_delegation_task_id')) {
    db().exec('ALTER TABLE agent_goal_steps ADD COLUMN child_delegation_task_id INTEGER');
  }
  try {
    db().exec('CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_human_task ON agent_goal_steps(human_kanban_task_id)');
  } catch (_) {}
  try {
    db().exec('CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_del ON agent_goal_steps(child_delegation_task_id)');
  } catch (_) {}
  // Repair legacy/retry cards left active after their parent goal became terminal.
  // This is safe and idempotent, and covers records created before terminal
  // reconciliation was added to completeGoalRun().
  try {
    const stale = db().prepare(
      `SELECT k.id, g.status
       FROM kanban_tasks k
       JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       JOIN agent_goal_runs g ON d.prompt LIKE '%[goal_run_id: ' || g.id || ']%'
       WHERE g.status IN ('completed','failed')
         AND k.status IN ('open','in_progress','awaiting_confirmation')`
    ).all();
    const update = db().prepare(`UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`);
    for (const row of stale) {
      update.run(row.status === 'completed' ? 'completed' : 'failed', row.id);
      clearKanbanTaskNotification(row.id);
    }
    if (stale.length) console.info('[goal-run] repaired stale terminal Kanban cards', { count: stale.length });
  } catch (e) {
    console.warn('[goal-run] stale Kanban repair failed', e?.message || e);
  }
  ensureGoalOutcomeTables();
  _tablesReady = true;
}

/**
 * Normalize a planned step. Idempotent: already-normalized `{ type, label, spec }`
 * rows (and DB step_type/spec shapes) keep phrase/agent/message instead of
 * collapsing to defaults on a second pass (createGoalRun re-maps planGoalStepsAsync output).
 */
export function normalizeStepSpec(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "agent_continue", label: "Continue with agent", spec: {} };
  }
  const nested = raw.spec && typeof raw.spec === "object" ? raw.spec : {};
  const contract = {
    quality_checked: raw.quality_checked === true || nested.quality_checked === true,
    step_key: String(raw.key || raw.step_key || nested.step_key || '').trim() || null,
    depends_on: Array.isArray(raw.depends_on || nested.depends_on)
      ? [...new Set((raw.depends_on || nested.depends_on).map((x) => String(x || '').trim()).filter(Boolean))]
      : [],
    required_inputs: Array.isArray(raw.required_inputs || nested.required_inputs)
      ? (raw.required_inputs || nested.required_inputs)
      : [],
    produces: Array.isArray(raw.produces || nested.produces)
      ? (raw.produces || nested.produces)
      : [],
  };
  const type = String(raw.type || raw.step_type || "workflow_trigger").toLowerCase();
  if (type === "workflow_trigger" || type === "workflow") {
    const phrase = String(
      raw.phrase ||
        raw.message ||
        raw.workflow_phrase ||
        nested.phrase ||
        nested.message ||
        nested.workflow_phrase ||
        ""
    ).trim();
    return {
      type: "workflow_trigger",
      label: String(raw.label || phrase || "Run workflow").trim(),
      spec: {
        ...contract,
        phrase: phrase || "run workflow",
        phase: raw.phase || raw.workflow_phase || nested.phase || "generic",
        workflow_id: raw.workflow_id || nested.workflow_id || null,
        capability_id: raw.capability_id || nested.capability_id || null,
        resolution_evidence: raw.resolution_evidence || nested.resolution_evidence || null,
        selection_rationale: raw.selection_rationale || nested.selection_rationale || null,
      },
    };
  }
  if (type === "notify_ceo" || type === "notify") {
    const title =
      raw.title != null
        ? String(raw.title)
        : nested.title != null
          ? String(nested.title)
          : null;
    const body =
      raw.body != null
        ? String(raw.body)
        : nested.body != null
          ? String(nested.body)
          : null;
    return {
      type: "notify_ceo",
      label: String(raw.label || "Notify CEO").trim(),
      spec: { ...contract, title, body, selection_rationale: raw.selection_rationale || nested.selection_rationale || null },
    };
  }
  if (type === "agent_tool" || type === "self_tool" || type === "tool") {
    const toolName = String(
      raw.tool_name || raw.toolName || nested.tool_name || nested.toolName || ""
    ).trim();
    if (toolName === "notify_ceo") {
      return {
        type: "notify_ceo",
        label: String(raw.label || "Notify CEO").trim(),
        spec: {
          ...contract,
          title: raw.title != null ? String(raw.title) : nested.title != null ? String(nested.title) : null,
          body: raw.body != null ? String(raw.body) : nested.body != null ? String(nested.body) : null,
        },
      };
    }
    const argsRaw = raw.args != null ? raw.args : nested.args != null ? nested.args : raw.tool_args != null ? raw.tool_args : nested.tool_args;
    const args =
      argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw) ? { ...argsRaw } : {};
    return {
      type: "agent_tool",
      label: String(raw.label || toolName || "Run tool").trim(),
      spec: {
        ...contract,
        tool_name: toolName || null,
        args,
        capability_id: raw.capability_id || nested.capability_id || null,
        required_inputs: raw.required_inputs || nested.required_inputs || [],
        resolution_evidence: raw.resolution_evidence || nested.resolution_evidence || null,
        selection_rationale: raw.selection_rationale || nested.selection_rationale || null,
      },
    };
  }
  if (type === "specialty_task" || type === "specialty" || type === "delegate") {
    const agentId = String(
      raw.agent_id || raw.agentId || nested.agent_id || nested.agentId || ""
    ).trim();
    const message = String(
      raw.message || raw.prompt || nested.message || nested.prompt || ""
    ).trim();
    const pgRaw =
      raw.parallel_group != null
        ? raw.parallel_group
        : nested.parallel_group != null
          ? nested.parallel_group
          : null;
    const pg = pgRaw != null ? Number(pgRaw) : null;
    return {
      type: "specialty_task",
      label: String(raw.label || (agentId ? "Specialty: " + agentId : "Specialty task")).trim(),
      spec: {
        ...contract,
        agent_id: agentId,
        message: message || null,
        parallel_group: Number.isFinite(pg) ? pg : null,
        phase: raw.phase || nested.phase || "specialty",
        resolution_evidence: raw.resolution_evidence || nested.resolution_evidence || null,
        selection_rationale: raw.selection_rationale || nested.selection_rationale || null,
      },
    };
  }
  if (type === 'human_task' || type === 'human') {
    const userId = String(raw.user_id || raw.userId || nested.user_id || nested.userId || '').trim();
    return {
      type: 'human_task',
      label: String(raw.label || (userId ? `Human: ${userId}` : 'Human task')).trim(),
      spec: {
        ...contract,
        user_id: userId,
        message: String(raw.message || raw.prompt || nested.message || nested.prompt || '').trim() || null,
        risk: String(raw.risk || nested.risk || 'normal').toLowerCase() === 'high' ? 'high' : 'normal',
        selection_rationale: raw.selection_rationale || nested.selection_rationale || null,
      },
    };
  }
  return {
    type: "agent_continue",
    label: String(raw.label || "Agent continue").trim(),
    spec: {
      ...contract,
      message: raw.message || raw.prompt || nested.message || nested.prompt || null,
      selection_rationale: raw.selection_rationale || nested.selection_rationale || null,
    },
  };
}

export function planGoalStepsFromText(prompt, { explicitSteps, ownerUserId = null } = {}) {
  if (Array.isArray(explicitSteps) && explicitSteps.length) {
    const steps = mergeRuntimeCapabilityStep(
      mergeCapabilitySteps(explicitSteps.map(normalizeStepSpec), prompt), ownerUserId, prompt
    ).map(
      normalizeStepSpec
    );
    if (steps.length >= 1 && !steps.some((s) => s.type === 'notify_ceo')) {
      steps.push(normalizeStepSpec({ type: 'notify_ceo' }));
    }
    return validateAndRepairGoalPlan(steps, prompt, { ownerUserId });
  }

  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const steps = [];

  const crmExplicit = /run\s+crm\s+maker\s+checker/i.test(text);
  const crmCtx =
    /\bcrm\b/i.test(text) &&
    /twenty|pre-order|preorder|opportunity|pipeline|maker\s*checker/.test(lower);
  const erpExplicit = /run\s+erp\s+maker\s+checker/i.test(text);
  const erpCtx =
    /\berp\b/i.test(text) &&
    /o2c|order-to-cash|order to cash|\botc\b|quotation|sales order|maker\s*checker/.test(lower);

  if (crmExplicit || crmCtx) {
    steps.push(
      normalizeStepSpec({
        type: 'workflow_trigger',
        phrase: 'run crm maker checker',
        phase: 'crm_phase',
        label: 'CRM maker-checker workflow',
      })
    );
  }
  if (erpExplicit || erpCtx) {
    steps.push(
      normalizeStepSpec({
        type: 'workflow_trigger',
        phrase: 'run erp maker checker',
        phase: 'erp_phase',
        label: 'ERP O2C maker-checker workflow',
      })
    );
  }

  if (!steps.length) {
    const runRe = /\brun\s+([^\n.;]+)/gi;
    const seen = new Set();
    let m;
    while ((m = runRe.exec(text)) && steps.length < 6) {
      const phrase = ('run ' + String(m[1] || '').trim()).replace(/\s+/g, ' ').slice(0, 240);
      const key = phrase.toLowerCase();
      if (!phrase || key === 'run' || seen.has(key)) continue;
      seen.add(key);
      steps.push(
        normalizeStepSpec({ type: 'workflow_trigger', phrase, phase: 'generic', label: phrase })
      );
    }
  }

  if (!steps.length) {
    steps.push(normalizeStepSpec({ type: 'agent_continue' }));
  }

  const merged = mergeRuntimeCapabilityStep(mergeCapabilitySteps(steps, text), ownerUserId, text).map(normalizeStepSpec);
  if (merged.length >= 1 && !merged.some((s) => s.type === 'notify_ceo')) {
    merged.push(normalizeStepSpec({ type: 'notify_ceo' }));
  }

  const planned = enrichPlanSteps(merged.length ? merged : steps);
  return validateAndRepairGoalPlan(planned.length ? planned : steps, prompt, { ownerUserId });
}



/** Workflow-only structural extract (no specialty, no notify). */
export function extractStructuralWorkflowSteps(prompt) {
  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const steps = [];
  const crmExplicit = /run\s+crm\s+maker\s+checker/i.test(text);
  const crmCtx =
    /\bcrm\b/i.test(text) &&
    /twenty|pre-order|preorder|opportunity|pipeline|maker\s*checker/.test(lower);
  const erpExplicit = /run\s+erp\s+maker\s+checker/i.test(text);
  const erpCtx =
    /\berp\b/i.test(text) &&
    /o2c|order-to-cash|order to cash|\botc\b|quotation|sales order|maker\s*checker/.test(lower);
  if (crmExplicit || crmCtx) {
    steps.push(
      normalizeStepSpec({
        type: 'workflow_trigger',
        phrase: 'run crm maker checker',
        phase: 'crm_phase',
        label: 'CRM maker-checker workflow',
      })
    );
  }
  if (erpExplicit || erpCtx) {
    steps.push(
      normalizeStepSpec({
        type: 'workflow_trigger',
        phrase: 'run erp maker checker',
        phase: 'erp_phase',
        label: 'ERP O2C maker-checker workflow',
      })
    );
  }
  if (!steps.length) {
    const runRe = /\brun\s+([^\n.;]+)/gi;
    const seen = new Set();
    let m;
    while ((m = runRe.exec(text)) && steps.length < 6) {
      const phrase = ('run ' + String(m[1] || '').trim()).replace(/\s+/g, ' ').slice(0, 240);
      const key = phrase.toLowerCase();
      if (!phrase || key === 'run' || seen.has(key)) continue;
      seen.add(key);
      steps.push(
        normalizeStepSpec({ type: 'workflow_trigger', phrase, phase: 'generic', label: phrase })
      );
    }
  }
  return steps;
}

/**
 * Full planner: workflow_trigger + specialty_task (N intents) + notify_ceo.
 */
export async function planGoalStepsAsync(prompt, opts = {}) {
  const memberKey = opts.orchestratorAgentId || opts.agentId || null;
  return withLlmopsContext(
    {
      ownerUserId: opts.ownerUserId,
      memberKey,
      agentId: memberKey,
      source: 'goal_planner',
      toolName: 'goal_plan_intent',
    },
    () => planGoalStepsAsyncInner(prompt, opts)
  );
}

async function planGoalStepsAsyncInner(prompt, opts = {}) {
  const { explicitSteps, ownerUserId = null, maxSpecialty = GOAL_PLAN_MAX_SPECIALTY, feedback = null } = opts;
  if (Array.isArray(explicitSteps) && explicitSteps.length) {
    return planGoalStepsFromText(prompt, { explicitSteps, ownerUserId });
  }

  let fullPrompt = String(prompt || '');
  if (feedback && String(feedback).trim()) {
    fullPrompt =
      fullPrompt +
      '\n\n[CEO plan feedback - adjust the execution plan: ' +
      String(feedback).trim().slice(0, 1500) +
      ']';
  }

  // Primary: LLM intent classification with tools / workflows / org specialty catalog.
  if (ownerUserId && fullPrompt.trim().length >= 8) {
    try {
      const classified = await classifyGoalPlanIntents(ownerUserId, fullPrompt, {
        orchestratorAgentId: opts.orchestratorAgentId || null,
      });
      if (Array.isArray(classified) && classified.length) {
        const steps = enrichPlanSteps(
          mergeRuntimeCapabilityStep(
            mergeCapabilitySteps(classified.map(normalizeStepSpec), fullPrompt), ownerUserId, fullPrompt
          ).map(normalizeStepSpec)
        );
        if (steps.length && !steps.some((s) => s.type === 'notify_ceo')) {
          steps.push(normalizeStepSpec({ type: 'notify_ceo' }));
        }
        console.info('[goal-run] plan via intent classifier', {
          steps: steps.map((x) => x.type + ':' + (x.label || '')).slice(0, 12),
        });
        const repaired = validateAndRepairGoalPlan(steps, fullPrompt, {
          ownerUserId,
          orchestratorAgentId: opts.orchestratorAgentId || null,
        });
        const assigned = await applyHumanAssignmentPolicy(ownerUserId, fullPrompt, repaired);
        const assured = await qualityAssureGoalPlan({
          ownerUserId,
          orchestratorAgentId: opts.orchestratorAgentId || null,
          prompt: fullPrompt,
          candidateSteps: assigned,
        });
        console.info('[goal-run] maker/checker plan accepted', assured.quality);
        return assured.steps.map(normalizeStepSpec);
      }
    } catch (e) {
      console.warn('[goal-run] intent classifier failed; catalog fallback', e?.message || e);
    }
  }

  // Fallback: published chat-phrase catalog order + specialty residual (tenant catalog only).
  let steps = matchWorkflowStepsFromCatalog(fullPrompt, ownerUserId).map(normalizeStepSpec);
  if (!steps.length && !ownerUserId) {
    steps = extractStructuralWorkflowSteps(fullPrompt).map(normalizeStepSpec);
  }

  const residual = stripWorkflowPhrasesFromPrompt(fullPrompt, ownerUserId).trim();
  if (ownerUserId && residual.length >= 8 && isCooStyleOrchestrator(opts.orchestratorAgentId)) {
    try {
      const specialtyRaw = await classifySpecialtyIntentsForPlan(ownerUserId, residual, {
        maxSpecialty,
        orchestratorAgentId: opts.orchestratorAgentId || null,
      });
      const specialtySteps = specialtyIntentsToSteps(specialtyRaw, {
        parallel: specialtyRaw.length > 1 && !residualIsLetteredOrNumbered(residual),
      }).map(normalizeStepSpec);
      if (specialtySteps.length) {
        steps.push(...specialtySteps);
      }
    } catch (e) {
      console.warn('[goal-run] specialty fallback failed', e?.message || e);
    }
  }

  steps = enrichPlanSteps(
    mergeRuntimeCapabilityStep(mergeCapabilitySteps(steps, fullPrompt), ownerUserId, fullPrompt).map(normalizeStepSpec)
  );
  if (!steps.length) {
    steps.push(normalizeStepSpec({ type: 'agent_continue' }));
    steps = enrichPlanSteps(steps);
  }
  if (steps.length && !steps.some((s) => s.type === 'notify_ceo')) {
    steps.push(normalizeStepSpec({ type: 'notify_ceo' }));
  }
  const repaired = validateAndRepairGoalPlan(steps, fullPrompt, {
    ownerUserId,
    orchestratorAgentId: opts.orchestratorAgentId || null,
  });
  if (!ownerUserId) return repaired;
  const assigned = await applyHumanAssignmentPolicy(ownerUserId, fullPrompt, repaired);
  const assured = await qualityAssureGoalPlan({
    ownerUserId,
    orchestratorAgentId: opts.orchestratorAgentId || null,
    prompt: fullPrompt,
    candidateSteps: assigned,
  });
  console.info('[goal-run] maker/checker fallback plan accepted', assured.quality);
  return assured.steps.map(normalizeStepSpec);
}

/**
 * Deterministic final gate shared by ad-hoc and scheduled goals.
 * The LLM may propose a plan, but requested capability outcomes must resolve to
 * real tools granted to the orchestrator. Auto-delegations that cannot execute
 * those capabilities are removed; explicitly named employees remain respected.
 */
export function validateAndRepairGoalPlan(
  steps,
  prompt,
  { ownerUserId = null, orchestratorAgentId = null } = {}
) {
  const text = String(prompt || '');
  const requirements = resolveCapabilitiesFromPrompt(text).filter((c) => c.tool_name || c.workflow_phrase);
  let out = mergeCapabilitySteps(Array.isArray(steps) ? steps : [], text).map(normalizeStepSpec);
  if (requirements.length) {
    out = out.filter(
      (step) => step.type !== 'agent_continue' || String(step.spec?.message || '').trim()
    );
    const requiredDeliveryTools = requirements
      .map((c) => String(c.tool_name || ''))
      .filter((name) => name && isCompositionalTool(name));
    if (requiredDeliveryTools.length) {
      out = out.filter((step) => {
        if (step.type !== 'agent_continue') return true;
        const message = String(step.spec?.message || '');
        if (!/\[Goal run [—-] agent interpretation\]/i.test(message)) return true;
        return !requiredDeliveryTools.some((name) => message.includes(name));
      });
    }
  }

  // Stored/approved plans are still subordinate to the CEO's current execution
  // constraints. This applies to every employee and goal; no agent is special-cased.
  const requiresOrchestratorExecution =
    /\b(?:handle|perform|execute|complete|do)\b[^.\n]{0,80}\b(?:yourself|directly by (?:you|the orchestrator|the coo))\b/i.test(text) ||
    /\b(?:do not|don't|never|must not)\s+(?:delegate|assign|hand\s*off)\b(?![^.\n]{0,60}\bto\b)/i.test(text);
  const forbiddenDelegateClauses = [
    ...text.matchAll(
      /\b(?:do not|don't|never|must not)\s+(?:delegate|assign|hand\s*off)(?:\s+(?:this|it|the\s+(?:goal|task|work)))?\s+to\s+([^.;\n—]+)/gi
    ),
  ].map((m) => String(m[1] || '').toLowerCase().replace(/[^a-z0-9]+/g, ''));
  out = out.filter((step) => {
    if (step.type !== 'specialty_task') return true;
    const agentId = String(step.spec?.agent_id || '').trim();
    const compactId = agentId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const explicitlyForbidden =
      compactId && forbiddenDelegateClauses.some((clause) => clause.includes(compactId));
    if (!requiresOrchestratorExecution && !explicitlyForbidden) return true;
    console.warn('[goal-run] removed delegation conflicting with CEO constraint', {
      agentId,
      constraint: requiresOrchestratorExecution ? 'orchestrator_execution' : 'forbidden_delegate',
    });
    return false;
  });
  if (!ownerUserId) return enrichPlanSteps(out);

  const orchestratorBase = String(orchestratorAgentId || '')
    .split('--')
    .pop()
    .trim();
  const goalRunnerTools = listOrchestratorToolsForGoalPlan(ownerUserId, orchestratorAgentId)
    .map((t) => String(t.name).toLowerCase())
    .filter(Boolean);
  const orchestratorTools = new Set([
    ...goalRunnerTools,
    ...getAgentToolGrants(orchestratorBase).map((t) => String(t).toLowerCase()),
  ]);

  // An explicitly named, granted tool is an executable instruction, even when an
  // older saved plan omitted it. This is catalog-driven and works for any tool.
  for (const tool of goalRunnerTools) {
    if (!tool) continue;
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentioned = new RegExp(`(^|[^a-z0-9_])${escaped}([^a-z0-9_]|$)`, 'i').test(text);
    const present = out.some(
      (step) => step.type === 'agent_tool' && String(step.spec?.tool_name || '').toLowerCase() === tool
    );
    if (mentioned && !present) {
      out.push(normalizeStepSpec({
        type: 'agent_tool',
        label: tool.replace(/_/g, ' '),
        tool_name: tool,
        args: {},
      }));
    }
  }
  const unavailable = new Set();

  out = out.filter((step) => {
    if (step.type !== 'agent_tool') return true;
    const tool = String(step.spec?.tool_name || '').toLowerCase();
    if (!tool || orchestratorTools.has(tool)) return true;
    unavailable.add(tool);
    return false;
  });

  const specialtyCount = out.filter((s) => s.type === 'specialty_task').length;
  const goalRequiredTools = requirements.map((c) => String(c.tool_name || '').toLowerCase()).filter(Boolean);
  out = out.filter((step) => {
    if (step.type !== 'specialty_task') return true;
    const agentId = String(step.spec?.agent_id || '').trim();
    if (!agentId) return false;
    const agent = db().prepare(
      `SELECT a.id, a.name, a.role, a.department,
              COALESCE(a.planning_status, 'production') AS planning_status,
              COALESCE(ua.enabled, 0) AS entitled
       FROM agents a LEFT JOIN user_agents ua ON ua.agent_id=a.id AND ua.user_id=?
       WHERE lower(a.id) = lower(?) LIMIT 1`
    ).get(ownerUserId, agentId);
    if (!agent || !agent.entitled || !isEligiblePlanningAgent(agent)) {
      console.warn('[goal-run] removed ineligible planning agent', {
        agentId,
        planningStatus: agent?.planning_status || 'missing',
        entitled: !!agent?.entitled,
      });
      return false;
    }
    const namedTokens = [agent?.id, agent?.name]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x) => x.length >= 4);
    const explicitlyNamed = namedTokens.some((x) => text.toLowerCase().includes(x));
    const delegatedText = `${step.label || ''} ${step.spec?.message || ''}`;
    const unmistakableTerminalOutcome =
      /\b(?:final\s+outcome|consolidated\s+(?:final\s+)?(?:outcome|result)|report\s+(?:the\s+)?(?:completed|final|consolidated)\s+(?:work|outcome|result))\b/i.test(delegatedText);
    const priorOutputSynthesis =
      /\b(?:consolidat(?:e|ed|ion)|synthesi[sz]e?)\b/i.test(delegatedText) &&
      /\b(?:ceo|this\s+chat|prior\s+steps?|completed\s+(?:steps?|work)|goal\s+outcome)\b/i.test(delegatedText);
    const orchestratorSynthesis = goalWantsChatSynthesis(text) && (unmistakableTerminalOutcome || priorOutputSynthesis);
    if (!explicitlyNamed && orchestratorSynthesis) {
      console.warn('[goal-run] converted delegated terminal synthesis to orchestrator work', {
        agentId,
        step: step.label,
      });
      return false;
    }

    const stepRequirements = resolveCapabilitiesFromPrompt(step.spec?.message || '');
    const relevant = stepRequirements.length
      ? stepRequirements
      : specialtyCount === 1
        ? requirements
        : [];
    const requiredTools = relevant.map((c) => c.tool_name).filter(Boolean);
    const orchestratorOnly = relevant.filter((c) => c.executor_scope === 'orchestrator_only');
    if (orchestratorOnly.length) {
      console.warn('[goal-run] removed orchestrator-only auto-delegation', {
        agentId,
        capabilities: orchestratorOnly.map((c) => c.id),
      });
      return false;
    }
    const targetTools = new Set(getAgentToolGrants(agent?.id || agentId).map((x) => String(x).toLowerCase()));
    if (!explicitlyNamed && !stepRequirements.length && specialtyCount > 1 && goalRequiredTools.length) {
      const sharedTools = goalRequiredTools.filter((tool) => targetTools.has(tool));
      if (!sharedTools.length) {
        console.warn('[goal-run] removed unrelated auto-delegation', { agentId, goalRequiredTools });
        return false;
      }
    }
    if (!requiredTools.length || explicitlyNamed) return true;
    const missingOnTarget = requiredTools.filter(
      (tool) => orchestratorTools.has(String(tool).toLowerCase()) && !targetTools.has(String(tool).toLowerCase())
    );
    if (!missingOnTarget.length) return true;
    console.warn('[goal-run] removed incapable auto-delegation', {
      agentId,
      missingTools: missingOnTarget,
      capabilities: relevant.map((c) => c.id),
    });
    return false;
  });

  // Missing configured tools are surfaced as a real blocked/clarification step,
  // never silently omitted from a plan that would then claim success.
  if (unavailable.size) {
    out.push(normalizeStepSpec({
      type: 'agent_continue',
      label: 'Resolve unavailable goal capability',
      message:
        `[NEEDS_CLARIFICATION] The goal requires unavailable orchestrator tool(s): ${[...unavailable].join(', ')}. ` +
        'Do not claim the goal completed. Explain which capability must be enabled.',
    }));
  }

  // Data/work must precede outbound delivery. Keep the planner's relative order
  // between outbound delivery steps (for example notify_ceo then email_send)
  // instead of unconditionally moving every notification behind email.
  const executionRank = (step) => {
    if (step.type === 'notify_ceo') return 3;
    if (step.type === 'agent_tool' && isCompositionalTool(step.spec?.tool_name)) return 3;
    if (step.type === 'agent_continue') return 2;
    if (step.type === 'agent_tool') return 1;
    return 0;
  };
  out.sort((a, b) => executionRank(a) - executionRank(b));
  out = out.map((step) => {
    const spec = { ...(step.spec || {}) };
    if (spec.selection_rationale) return { ...step, spec };
    if (step.type === 'specialty_task') {
      const agentId = String(spec.agent_id || '').trim();
      const agent = db().prepare(
        `SELECT a.id, a.name, a.role FROM agents a
         JOIN user_agents ua ON ua.agent_id = a.id
         WHERE ua.user_id = ? AND ua.enabled = 1 AND lower(a.id) = lower(?) LIMIT 1`
      ).get(ownerUserId, agentId);
      const grants = new Set(getAgentToolGrants(agent?.id || agentId).map((x) => String(x).toLowerCase()));
      const matched = goalRequiredTools.filter((tool) => grants.has(tool));
      const role = String(agent?.role || '').trim();
      spec.selection_rationale = matched.length
        ? `Selected because this goal needs ${matched.join(', ')} and ${agent?.name || agentId} can use ${matched.join(', ')}.${role ? ` Role: ${role}` : ''}`
        : `Selected as the best-fit specialist from your company${role ? ` for the role: ${role}` : '.'}`;
    } else if (step.type === 'agent_tool') {
      spec.selection_rationale = `Selected because the goal explicitly needs the ${spec.tool_name || 'configured'} tool capability.`;
    } else if (step.type === 'workflow_trigger') {
      spec.selection_rationale = `Selected because the goal matched the published workflow trigger “${spec.phrase || step.label}”.`;
    } else if (step.type === 'notify_ceo') {
      spec.selection_rationale = 'Selected to return the consolidated final outcome to the CEO after execution finishes.';
    } else {
      spec.selection_rationale = 'Selected so the orchestrator can combine prior step outputs and complete the requested outcome.';
    }
    return { ...step, spec };
  });
  console.info('[goal-run] capability plan validation', {
    required: requirements.map((c) => c.id),
    unavailable: [...unavailable],
    steps: out.map((s) => `${s.type}:${s.spec?.tool_name || s.spec?.agent_id || s.label}`),
  });
  return enrichPlanSteps(out);
}

/** Whether a planned step list warrants durable goal_run_plan mode. */
export function planUsesGoalRunMode(planned) {
  const steps = Array.isArray(planned) ? planned : [];
  if (steps.some((s) => (s.type || s.step_type) === 'workflow_trigger')) return true;
  if (steps.some((s) => (s.type || s.step_type) === 'specialty_task')) return true;
  if (steps.some((s) => (s.type || s.step_type) === 'human_task')) return true;
  if (steps.some((s) => (s.type || s.step_type) === 'agent_tool')) return true;
  const real = steps.filter((s) => (s.type || s.step_type) !== 'notify_ceo');
  return real.length >= 2;
}

function loadGoalRunRow(id, ownerUserId = null) {
  ensureAgentGoalRunTables();
  const row = ownerUserId
    ? db()
        .prepare('SELECT * FROM agent_goal_runs WHERE id = ? AND owner_user_id = ?')
        .get(id, ownerUserId)
    : db().prepare('SELECT * FROM agent_goal_runs WHERE id = ?').get(id);
  return row || null;
}

function loadGoalSteps(goalRunId) {
  ensureAgentGoalRunTables();
  return db()
    .prepare(
      'SELECT * FROM agent_goal_steps WHERE goal_run_id = ? ORDER BY step_index ASC, rowid ASC'
    )
    .all(goalRunId);
}

export function serializeGoalRun(row, steps = null) {
  if (!row) return null;
  const stepRows = steps != null ? steps : loadGoalSteps(row.id);
  const ctx = parseJson(row.context_json);
  const terminal = row.status === 'completed' || row.status === 'failed';
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    agent_id: row.agent_id,
    title: row.title,
    prompt: row.prompt,
    source: row.source,
    scheduled_goal_id: row.scheduled_goal_id,
    scheduled_goal_run_id: row.scheduled_goal_run_id,
    status: row.status,
    context: ctx,
    current_step_index: row.current_step_index,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    outcome: loadOutcome(row),
    plan_history: loadPlanHistory(row),
    retrospective: loadOutcome(row)?.retrospective || null,
    final_outcome: terminal
      ? buildOutcomeRichTerminalReport({ goal: row, steps: stepRows, terminal: row.status })
      : null,
    steps: stepRows.map((s) => ({
      id: s.id,
      step_index: s.step_index,
      step_type: s.step_type,
      label: s.label,
      spec: parseJson(s.spec_json),
      status: s.status,
      child_workflow_run_id: s.child_workflow_run_id,
      child_delegation_task_id: s.child_delegation_task_id || null,
      result: parseJson(s.result_json, null),
      error_message: s.error_message,
      started_at: s.started_at,
      completed_at: s.completed_at,
      retry_count: Number(s.exception_retry_count || 0),
      exception_kanban_id: s.exception_kanban_id || null,
    })),
  };
}

export function getGoalRun(goalRunId, ownerUserId = null) {
  const row = loadGoalRunRow(goalRunId, ownerUserId);
  if (!row) return null;
  return serializeGoalRun(row);
}

export function amendGoalRunConstraints(goalRunId, ownerUserId, { constraint = '', rationale = '' } = {}) {
  ensureAgentGoalRunTables();
  const owner = String(ownerUserId || '').trim();
  const goal = loadGoalRunRow(goalRunId, owner);
  if (!goal) {
    const err = new Error('Goal run not found');
    err.status = 404;
    throw err;
  }
  const extra = String(constraint || rationale || '').trim();
  if (!extra) {
    const err = new Error('constraint required');
    err.status = 400;
    throw err;
  }
  const snap = snapshotPlanVersion({
    goalRow: goal,
    steps: loadGoalSteps(goalRunId),
    rationale: rationale || extra,
  });
  const outcome = mergeConstraintText(snap.outcome, extra);
  persistOutcome(goalRunId, owner, outcome);
  persistPlanHistory(goalRunId, owner, snap.history);
  recordMissionEvent({
    ownerUserId: owner,
    goalRunId,
    event_type: 're_plan',
    payload: { from: snap.from, to: snap.to, rationale: extra },
  });
  console.info('[goal-run] re-plan', { goalRunId, from: snap.from, to: snap.to });
  return getGoalRun(goalRunId, owner);
}

export { listMissionEvents };

/** Step-level progress for CEO UI / digest (% completed of planned steps). */
export function summarizeGoalProgress(goal) {
  const steps = Array.isArray(goal?.steps) ? goal.steps : [];
  const total = steps.length;
  const completed = steps.filter((s) => String(s.status || "") === "completed").length;
  const failed = steps.filter((s) => String(s.status || "") === "failed").length;
  const running = steps.filter((s) => String(s.status || "") === "running").length;
  const pending = steps.filter((s) => String(s.status || "") === "pending").length;
  const pct = total ? Math.round((completed / total) * 100) : goal?.status === "completed" ? 100 : 0;
  const current =
    steps.find((s) => String(s.status || "") === "running") ||
    steps.find((s) => String(s.status || "") === "pending") ||
    null;
  return {
    total_steps: total,
    completed_steps: completed,
    failed_steps: failed,
    running_steps: running,
    pending_steps: pending,
    progress_pct: pct,
    current_label: current?.label || null,
    status: goal?.status || null,
  };
}

export function listGoalRuns(
  ownerUserId,
  { limit = 30, status = null, scheduledGoalId = null, fromDate = null, toDate = null } = {}
) {
  ensureAgentGoalRunTables();
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const owner = String(ownerUserId || "").trim();
  const st = status ? String(status) : null;
  const sg = scheduledGoalId ? String(scheduledGoalId).trim() : null;
  const from = fromDate ? String(fromDate).slice(0, 10) : null;
  const to = toDate ? String(toDate).slice(0, 10) : null;

  let sql = 'SELECT * FROM agent_goal_runs WHERE owner_user_id = ?';
  const params = [owner];
  if (sg) {
    sql += ' AND scheduled_goal_id = ?';
    params.push(sg);
  }
  if (st) {
    sql += ' AND status = ?';
    params.push(st);
  }
  if (from) {
    sql += ' AND date(created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(created_at) <= date(?)';
    params.push(to);
  }
  sql += ' ORDER BY datetime(created_at) DESC LIMIT ?';
  params.push(lim);
  const rows = db().prepare(sql).all(...params);
  return rows.map((r) => serializeGoalRun(r));
}

export function createGoalRun({
  ownerUserId,
  agentId,
  title = '',
  prompt = '',
  steps = null,
  source = '',
  scheduledGoalId = null,
  scheduledGoalRunId = null,
  context = {},
} = {}) {
  ensureAgentGoalRunTables();
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner || !agent) {
    const err = new Error('ownerUserId and agentId required');
    err.status = 400;
    throw err;
  }

  const supplied = Array.isArray(steps) && steps.length ? steps.map(normalizeStepSpec) : null;
  const qualityChecked = !!supplied?.length && supplied.every(
    (step) => step.spec?.quality_checked === true && String(step.spec?.step_key || '').trim()
  );
  const proposed = supplied
    ? qualityChecked
      ? supplied
      : enrichPlanSteps(
          mergeRuntimeCapabilityStep(mergeCapabilitySteps(supplied, prompt), owner, prompt).map(normalizeStepSpec)
        )
    : planGoalStepsFromText(prompt, { ownerUserId: owner });
  const plannedRaw = qualityChecked
    ? proposed
    : validateAndRepairGoalPlan(proposed, prompt, {
        ownerUserId: owner,
        orchestratorAgentId: agent,
      });
  // Honor explicit "do not call notify_ceo" in CEO / scheduled prompts.
  const planned = promptForbidsNotifyCeo(prompt)
    ? plannedRaw.filter((s) => (s.type || s.step_type) !== 'notify_ceo')
    : plannedRaw;
  const orchestratorRow = db()
    .prepare(`SELECT id, is_coo, COALESCE(is_orchestrator, 0) AS is_orchestrator FROM agents WHERE lower(id) = lower(?) LIMIT 1`)
    .get(agent.includes('--') ? agent.split('--').pop() : agent);
  if (orchestratorRow?.is_orchestrator && !orchestratorRow?.is_coo) {
    const allowed = new Set(
      getAgentsUnderOrchestratorForCeo(owner, orchestratorRow.id).map((a) => String(a.id).toLowerCase())
    );
    const outside = planned
      .filter((s) => (s.type || s.step_type) === 'specialty_task')
      .map((s) => String(s.agent_id || s.spec?.agent_id || '').toLowerCase())
      .filter((id) => id && !allowed.has(id));
    if (outside.length) {
      const err = new Error(`Orchestrator may delegate only to direct reportees: ${[...new Set(outside)].join(', ')}`);
      err.status = 403;
      throw err;
    }
  }
  if (plannedRaw.length !== planned.length) {
    console.info('[goal-run] stripped notify_ceo step(s) per prompt instruction');
  }

  const id = `agr-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db()
    .prepare(
      `INSERT INTO agent_goal_runs
       (id, owner_user_id, agent_id, title, prompt, source, scheduled_goal_id, scheduled_goal_run_id, status, context_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(
      id,
      owner,
      agent,
      String(title || '').trim() || clip(prompt, 120),
      String(prompt || ''),
      String(source || ''),
      scheduledGoalId || null,
      scheduledGoalRunId || null,
      JSON.stringify(context || {})
    );

  const outcome = parseOutcomeFromPrompt(prompt);
  persistOutcome(id, owner, outcome);
  persistPlanHistory(id, owner, [
    {
      version: 1,
      at: new Date().toISOString(),
      rationale: 'Initial plan from CEO intent',
      outcome: { ...outcome },
      step_labels: planned.map((s) => s.label || s.type),
    },
  ]);
  recordMissionEvent({
    ownerUserId: owner,
    goalRunId: id,
    event_type: 'goal_created',
    payload: {
      intent: outcome.intent,
      kpi: outcome.kpi,
      target: outcome.target,
      constraints: outcome.constraints,
      budget_usd: outcome.budget_usd,
      approval_policy: outcome.approval_policy,
    },
  });
  recordMissionEvent({
    ownerUserId: owner,
    goalRunId: id,
    event_type: 'plan_generated',
    payload: {
      plan_version: 1,
      steps: planned.map((s) => ({ type: s.type, label: s.label, capability_id: s.spec?.capability_id || null })),
    },
  });

  const ins = db().prepare(
    `INSERT INTO agent_goal_steps
     (id, goal_run_id, step_index, step_type, label, spec_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  );
  let firstStepId = null;
  planned.forEach((step, idx) => {
    const stepId = `ags-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    if (idx === 0) firstStepId = stepId;
    ins.run(stepId, id, idx, step.type, step.label || step.type, JSON.stringify(step.spec || {}));
  });
  if (firstStepId) {
    recordMissionEvent({
      ownerUserId: owner,
      goalRunId: id,
      event_type: 'step_started',
      payload: { step_id: firstStepId, label: planned[0]?.label || planned[0]?.type },
    });
  }

  console.info('[goal-run] created', { id, owner, agent, steps: planned.length, source });
  return getGoalRun(id, owner);
}

function markStep(stepId, patch = {}) {
  const fields = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = ?`);
    vals.push(v);
  }
  fields.push("updated_at = datetime('now')");
  // agent_goal_steps has no updated_at — skip
  fields.pop();
  db()
    .prepare(`UPDATE agent_goal_steps SET ${fields.join(', ')} WHERE id = ?`)
    .run(...vals, stepId);
}

function touchGoalRun(goalRunId, patch = {}) {
  const fields = ["updated_at = datetime('now')"];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.unshift(`${k} = ?`);
    vals.unshift(v);
  }
  db()
    .prepare(`UPDATE agent_goal_runs SET ${fields.join(', ')} WHERE id = ?`)
    .run(...vals, goalRunId);
}

export function priorStepSummaries(goalRunId, beforeIndex = Infinity) {
  const steps = loadGoalSteps(goalRunId).filter(
    (s) => s.status === 'completed' && s.step_index < beforeIndex
  );
  const lines = [];
  for (const s of steps) {
    const spec = parseJson(s.spec_json);
    const result = parseJson(s.result_json);
    const label = s.label || s.step_type;
    if (s.step_type === 'workflow_trigger' && s.child_workflow_run_id) {
      lines.push(`- ${label} (workflow run #${s.child_workflow_run_id}): ${clip(result?.summary || result?.status || 'completed', 600)}`);
    } else if (result?.reply_preview) {
      lines.push(`- ${label}: ${clip(result.reply_preview, 600)}`);
    } else if (result?.body) {
      lines.push(`- ${label}: ${clip(result.body, 400)}`);
    } else if (s.step_type === 'agent_tool' && result) {
      const tool = String(result.tool_name || spec.tool_name || '').trim();
      const inner = result.result != null && typeof result.result === 'object' ? result.result : result;
      // Never dump full status_checker JSON into email/notify fallbacks — HTML lives on the step result.
      if (tool === 'status_checker' && (inner?.html || inner?.digest || inner?.counts)) {
        const c = inner.counts || inner.digest?.counts || {};
        lines.push(
          `- ${label} (status_checker): awaiting=${c.awaiting_ceo ?? 0} failed=${c.failed ?? c.failed_1d ?? 0} ` +
            `open=${c.open ?? 0} completed_1d=${c.completed_1d ?? 0}; HTML digest ready for email_send`
        );
      } else if (tool === 'this_week_digest' && (inner?.html || inner?.kpis)) {
        lines.push(`- ${label} (this_week_digest): completed; HTML/KPI digest ready for email_send`);
      } else {
        const payload =
          result.multi_symbol && Array.isArray(result.results)
            ? {
                tool: result.tool_name || spec.tool_name,
                multi_symbol: true,
                symbols: result.symbols,
                results: result.results,
                errors: result.errors,
              }
            : result.result != null
              ? { tool: result.tool_name || spec.tool_name, result: result.result }
              : result;
        lines.push(`- ${label} (tool): ${clip(JSON.stringify(payload), 3500)}`);
      }
    } else {
      lines.push(`- ${label}: completed`);
    }
    if (spec.phrase) lines[lines.length - 1] = `- [${spec.phrase}] ${lines[lines.length - 1].slice(2)}`;
  }
  return lines.join('\n');
}

/** Keep every peer result while bounding large time-series for the next agent. */
export function compactGoalToolContext(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 7) return '[nested value omitted]';
  if (Array.isArray(value)) {
    if (value.length > 20) {
      return {
        item_count: value.length,
        latest_items: value.slice(-3).map((item) => compactGoalToolContext(item, depth + 1)),
      };
    }
    return value.map((item) => compactGoalToolContext(item, depth + 1));
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = compactGoalToolContext(item, depth + 1);
  }
  return out;
}

/**
 * Rich prior context for OpenClaw agent turns (agent_continue / interpreted tools).
 * Includes digest HTML/markdown so the agent can compose email like chat — not one-line stubs.
 */
export function priorStepContextForAgent(goalRunId, beforeIndex = Infinity) {
  const steps = loadGoalSteps(goalRunId).filter(
    (s) => s.status === 'completed' && s.step_index < beforeIndex
  );
  const parts = [];
  for (const s of steps) {
    const spec = parseJson(s.spec_json);
    const result = parseJson(s.result_json);
    const label = s.label || s.step_type;
    if (s.step_type === 'workflow_trigger' && s.child_workflow_run_id) {
      parts.push(
        `### ${label} (workflow #${s.child_workflow_run_id})\n${clip(result?.summary || result?.status || 'completed', 2000)}`
      );
      continue;
    }
    if (s.step_type === 'human_task' && result?.human_outcome) {
      const details = [
        `### ${label} (human result)`,
        clip(result.human_outcome, 4000),
        result.owner_override ? 'Disposition: accepted directly by the CEO/owner.' : null,
        result.assigned_user_id ? `Assigned user: ${result.assigned_user_id}` : null,
        result.kanban_task_id ? `Kanban task: #${result.kanban_task_id}` : null,
      ].filter(Boolean);
      parts.push(details.join('\n'));
      continue;
    }
    if (result?.reply_preview) {
      parts.push(`### ${label}\n${clip(result.reply_preview, 4000)}`);
      continue;
    }
    if (s.step_type === 'agent_tool' && result) {
      const tool = String(result.tool_name || spec.tool_name || '').trim();
      const inner = result.result != null && typeof result.result === 'object' ? result.result : result;
      const html = String(inner?.html || result?.html || '').trim();
      const markdown = String(inner?.markdown || result?.markdown || '').trim();
      if (html || markdown) {
        const block = [
          `### ${label} (${tool || 'tool'}) — emailable artifact ready`,
          html
            ? `HTML digest available (${html.length} chars). Platform delivers this via email_send when the goal asks for email — do NOT re-author a plain-text substitute and do NOT call email_send again after platform delivery.`
            : null,
          markdown ? `Markdown preview:\n${clip(markdown, 4000)}` : null,
        ].filter(Boolean);
        parts.push(block.join('\n'));
        continue;
      }
      const payload =
        result.multi_symbol && Array.isArray(result.results)
          ? {
              tool: result.tool_name || spec.tool_name,
              multi_symbol: true,
              symbols: result.symbols,
              results: compactGoalToolContext(result.results),
              errors: compactGoalToolContext(result.errors),
              fallbacks: compactGoalToolContext(result.fallbacks),
            }
          : result.result != null
            ? { tool: result.tool_name || spec.tool_name, result: compactGoalToolContext(result.result) }
            : compactGoalToolContext(result);
      parts.push(`### ${label} (${tool || 'tool'})\n${clip(JSON.stringify(payload), 12000)}`);
      continue;
    }
    if (result?.body) {
      parts.push(`### ${label}\n${clip(result.body, 2000)}`);
    } else {
      parts.push(`### ${label}\ncompleted`);
    }
  }
  return parts.join('\n\n');
}

function collectArtifactRefs(value, found = new Map(), depth = 0) {
  if (depth > 8 || value == null) return found;
  if (typeof value === 'string') {
    const urls = value.match(/https?:\/\/[^\s<>"')\]]+|\/api\/[^\s<>"')\]]+/g) || [];
    for (const url of urls) found.set(url, { url, label: url.split('/').pop() || 'Goal artifact' });
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectArtifactRefs(item, found, depth + 1));
    return found;
  }
  if (typeof value !== 'object') return found;
  const url = String(value.artifact_url || value.relative_url || value.download_url || value.url || '').trim();
  const artifactId = String(value.artifact_id || value.artifactId || '').trim();
  if (url) {
    found.set(url, {
      url,
      artifact_id: artifactId || null,
      label: String(value.label || value.name || value.filename || value.title || url.split('/').pop() || 'Goal artifact').slice(0, 180),
      mime_type: value.mime_type || value.mimeType || null,
    });
  }
  for (const child of Object.values(value)) collectArtifactRefs(child, found, depth + 1);
  return found;
}

export function priorGoalArtifacts(goalRunId, beforeIndex = Infinity) {
  const rows = loadGoalSteps(goalRunId).filter((s) => s.status === 'completed' && s.step_index < beforeIndex);
  const found = new Map();
  for (const row of rows) collectArtifactRefs(parseJson(row.result_json, {}), found);
  return [...found.values()];
}

function assertRuntimeStepInputs(goalRunId, step) {
  const spec = parseJson(step.spec_json, {});
  const deps = Array.isArray(spec.depends_on) ? spec.depends_on : [];
  const required = Array.isArray(spec.required_inputs) ? spec.required_inputs.filter((x) => x?.required !== false) : [];
  if (!deps.length && !required.length) return;
  const prior = loadGoalSteps(goalRunId).filter((row) => row.step_index < step.step_index);
  const byKey = new Map(prior.map((row) => [parseJson(row.spec_json, {}).step_key, row]));
  for (const dep of deps) {
    const row = byKey.get(dep);
    if (!row || row.status !== 'completed') throw new Error(`Required predecessor ${dep} is not completed`);
  }
  for (const input of required) {
    const source = input?.source_step_key ? byKey.get(input.source_step_key) : null;
    if (!source || source.status !== 'completed') throw new Error(`Required input ${input?.key || 'input'} has no completed source step`);
    const result = parseJson(source.result_json, null);
    if (String(input.kind || 'data') === 'artifact') {
      if (!collectArtifactRefs(result).size) throw new Error(`Required artifact ${input.key} was not produced by ${input.source_step_key}`);
    } else if (result == null || (typeof result === 'object' && !Object.keys(result).length)) {
      throw new Error(`Required ${input.kind || 'data'} ${input.key} was not produced by ${input.source_step_key}`);
    }
  }
}

/** Pull HTML/markdown from a prior agent_tool result suitable for email_send. */
export function findPriorDigestForEmail(goalRunId, beforeIndex = Infinity) {
  const steps = loadGoalSteps(goalRunId).filter(
    (s) => s.status === 'completed' && s.step_index < beforeIndex
  );
  // Prefer known digest tools first, then any prior tool that returned html/markdown.
  const prefer = new Set(['status_checker', 'this_week_digest']);
  const candidates = [];
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = steps[i];
    if (s.step_type !== 'agent_tool') continue;
    const spec = parseJson(s.spec_json);
    const result = parseJson(s.result_json);
    const tool = String(result?.tool_name || spec?.tool_name || '').trim();
    const inner = result?.result != null && typeof result.result === 'object' ? result.result : result;
    const html = String(inner?.html || result?.html || '').trim();
    const markdown = String(inner?.markdown || result?.markdown || '').trim();
    const counts = inner?.counts || inner?.digest?.counts || null;
    if (!html && !markdown) continue;
    candidates.push({ tool, html: html || null, markdown: markdown || null, counts, prefer: prefer.has(tool) });
  }
  if (!candidates.length) return null;
  return candidates.find((c) => c.prefer) || candidates[0];
}

function extractEmailRecipientFromPrompt(prompt) {
  const m = String(prompt || '').match(
    /\b(?:to|email)\s*[=:]\s*["']?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})["']?/i
  );
  return m ? m[1].trim() : null;
}

function extractEmailSubjectFromPrompt(prompt) {
  const m = String(prompt || '').match(/\bsubject\s*[=:]\s*["']([^"']{3,120})["']/i);
  return m ? m[1].trim() : null;
}

function goalContextObject(goal) {
  const raw = goal?.context_json;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  return parseJson(raw, {});
}

/**
 * When prior tools already produced HTML/markdown and the CEO goal asks for email,
 * deliver that artifact via email_send once (platform). Agents routinely invent short
 * plain-text bodies and skip `html=` when asked to re-pass large digests.
 */
async function deliverPriorEmailArtifactIfNeeded(goal, step) {
  const prompt = String(goal.prompt || '');
  if (!/\bemail(_send)?\b/i.test(prompt)) return null;

  const ctx = goalContextObject(goal);
  if (ctx.prior_email_delivered_at) {
    return {
      skipped: true,
      reason: 'already_delivered',
      to: ctx.prior_email_to || null,
      html_len: ctx.prior_email_html_len || 0,
      messageId: ctx.prior_email_message_id || null,
    };
  }

  const artifact = findPriorDigestForEmail(goal.id, step.step_index);
  if (!artifact?.html && !artifact?.markdown) return null;

  const to =
    extractEmailRecipientFromPrompt(prompt) || resolveCeoEmail(goal.owner_user_id) || null;
  if (!to) {
    console.warn('[goal-run] prior email artifact found but no recipient', { goalRunId: goal.id });
    return null;
  }

  let subject = extractEmailSubjectFromPrompt(prompt);
  if (!subject) {
    const c = artifact.counts || {};
    const failedN = c.failed ?? c.failed_1d ?? 0;
    const attention = c.needs_attention ?? (c.awaiting_ceo ?? 0) + failedN;
    subject =
      artifact.tool === 'this_week_digest'
        ? clip(goal.title || 'This Week Digest', 120)
        : `COO Status Report — ${attention} need attention · ${failedN} failed · ${c.awaiting_ceo ?? 0} awaiting you`;
  }

  const args = {
    to,
    subject,
    html: artifact.html || undefined,
    body:
      artifact.markdown ||
      (artifact.html ? artifact.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
    ceo_user_id: goal.owner_user_id,
    owner_user_id: goal.owner_user_id,
  };

  const caller = resolveAgentForGoal(goal.owner_user_id, goal.agent_id);
  const invokeOpts = {
    agentId: caller?.id || goal.agent_id || null,
    openclawAgentId: caller?.openclaw_agent_id || caller?.id || goal.agent_id || null,
    goalId: goal.scheduled_goal_id || goal.id,
  };

  const out = await invokeContentToolHttp('email_send', args, goal.owner_user_id, invokeOpts);
  const htmlLen = String(artifact.html || '').length;
  const nextCtx = {
    ...ctx,
    prior_email_delivered_at: new Date().toISOString(),
    prior_email_to: to,
    prior_email_subject: subject,
    prior_email_html_len: htmlLen,
    prior_email_tool: artifact.tool || null,
    prior_email_message_id: out?.messageId || out?.message_id || null,
  };
  touchGoalRun(goal.id, { context_json: JSON.stringify(nextCtx) });
  // Keep in-memory goal row fresh for later steps in this process.
  goal.context_json = JSON.stringify(nextCtx);

  console.info('[goal-run] platform delivered prior email artifact', {
    goalRunId: goal.id,
    tool: artifact.tool,
    to,
    html_len: htmlLen,
    body_len: String(args.body || '').length,
    messageId: nextCtx.prior_email_message_id,
  });

  return {
    ok: true,
    via: 'platform_prior_artifact',
    to,
    subject,
    html_len: htmlLen,
    tool: artifact.tool,
    result: out,
  };
}

function promptForbidsNotifyCeo(prompt) {
  return /\bdo\s+not\s+call\s+notify[_ ]?ceo\b|\bdon'?t\s+call\s+notify[_ ]?ceo\b|\bdo\s+not\s+notify(_ceo)?\b/i.test(
    String(prompt || '')
  );
}

function looksLikeGoalPlanDumpEmail(text) {
  const t = String(text || '');
  return (
    /\bgoal_run_id:\s*agr-/i.test(t) ||
    /\bCompleted steps:\s*\n-\s*.*\(tool\):/i.test(t) ||
    (/\bGoal:\s*/i.test(t) && /\bstatus_checker\b/i.test(t) && /\{"ok":true/.test(t))
  );
}

export function buildWorkflowInput(phase, goalRun, stepRow) {
  const phaseKey = String(phase || 'generic').toLowerCase();
  const spec = parseJson(stepRow?.spec_json);
  const phrase = spec.phrase || 'run workflow';
  const prior = priorStepSummaries(goalRun.id, stepRow?.step_index ?? Infinity);
  const header = [
    '[Goal run workflow step]',
    `[goal_run_id: ${goalRun.id}]`,
    `[goal_step_id: ${stepRow?.id || ''}]`,
    `[phase: ${phaseKey}]`,
    '',
    `CEO goal: ${clip(goalRun.prompt, 2000)}`,
  ];
  if (prior) {
    header.push('', 'Prior completed steps:', prior, '');
  }
  if (phaseKey === 'crm_phase') {
    header.push(
      'Execute CRM maker-checker now. Pass full customer story in workflow input.',
      '',
      `Trigger phrase: ${phrase}`
    );
  } else if (phaseKey === 'erp_phase') {
    header.push(
      'Execute ERP O2C maker-checker now. Include Twenty CRM IDs and customer story from prior CRM step outcomes.',
      '',
      `Trigger phrase: ${phrase}`
    );
  } else {
    header.push(`Trigger phrase: ${phrase}`);
  }
  return header.join('\n');
}


function patchWorkflowRunGoalContext(workflowRunId, { goalRunId, goalStepId, ownerUserId }) {
  const id = Number(workflowRunId);
  if (!Number.isFinite(id) || id <= 0) return;
  const run = ownerUserId
    ? db()
        .prepare('SELECT * FROM agent_workflow_runs WHERE id = ? AND owner_user_id = ?')
        .get(id, ownerUserId)
    : db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return;
  const ctx = parseJson(run.context_json);
  ctx.goal_run_id = goalRunId;
  ctx.goal_step_id = goalStepId;
  db()
    .prepare(
      "UPDATE agent_workflow_runs SET context_json = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(JSON.stringify(ctx), id);
}

export function bindWorkflowRunToGoalStep({ goalRunId, stepId, workflowRunId, ownerUserId }) {
  ensureAgentGoalRunTables();
  const goal = loadGoalRunRow(goalRunId, ownerUserId);
  if (!goal) {
    const err = new Error('Goal run not found');
    err.status = 404;
    throw err;
  }
  const step = db()
    .prepare('SELECT * FROM agent_goal_steps WHERE id = ? AND goal_run_id = ?')
    .get(stepId, goalRunId);
  if (!step) {
    const err = new Error('Goal step not found');
    err.status = 404;
    throw err;
  }
  const wfId = Number(workflowRunId);
  db()
    .prepare(
      `UPDATE agent_goal_steps SET child_workflow_run_id = ?, status = 'running', started_at = COALESCE(started_at, datetime('now'))
       WHERE id = ?`
    )
    .run(Number.isFinite(wfId) ? wfId : null, stepId);
  touchGoalRun(goalRunId, { status: 'running', current_step_index: step.step_index });
  patchWorkflowRunGoalContext(workflowRunId, {
    goalRunId,
    goalStepId: stepId,
    ownerUserId: goal.owner_user_id,
  });
  return { ok: true, goal_run_id: goalRunId, step_id: stepId, workflow_run_id: wfId };
}

export function findGoalStepByWorkflowRun(workflowRunId) {
  ensureAgentGoalRunTables();
  const id = Number(workflowRunId);
  if (!Number.isFinite(id) || id <= 0) return null;

  let step = db()
    .prepare('SELECT * FROM agent_goal_steps WHERE child_workflow_run_id = ? LIMIT 1')
    .get(id);
  if (step) {
    const goal = loadGoalRunRow(step.goal_run_id);
    return goal ? { goal, step } : null;
  }

  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return null;
  const ctx = parseJson(run.context_json);
  const stepId = ctx.goal_step_id;
  const goalRunId = ctx.goal_run_id;
  if (!stepId || !goalRunId) return null;
  step = db()
    .prepare('SELECT * FROM agent_goal_steps WHERE id = ? AND goal_run_id = ?')
    .get(stepId, goalRunId);
  if (!step) return null;
  const goal = loadGoalRunRow(goalRunId, run.owner_user_id);
  return goal ? { goal, step } : null;
}

function workflowRunSummary(workflowRunId) {
  const id = Number(workflowRunId);
  if (!Number.isFinite(id)) return { status: 'unknown' };
  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return { status: 'missing' };
  const steps = db()
    .prepare(
      `SELECT node_label, status, output_json FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id ASC`
    )
    .all(id);
  const lines = [];
  for (const s of steps.slice(-8)) {
    let snip = '';
    try {
      const o = parseJson(s.output_json);
      snip = clip(o?.text || o?.decision || o?.result || '', 280);
    } catch {
      snip = '';
    }
    lines.push(`${s.node_label || 'step'} [${s.status}]${snip ? ': ' + snip : ''}`);
  }
  return {
    status: run.status,
    definition_id: run.definition_id,
    error_message: run.error_message,
    summary: lines.join('\n'),
  };
}

async function executeWorkflowStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const phrase = spec.phrase || 'run workflow';
  const input = buildWorkflowInput(spec.phase, goal, step);
  const actor = { id: goal.agent_id, type: 'goal_run', name: 'Goal run' };
  const run = await triggerAgentWorkflowForOwner(goal.owner_user_id, {
    message: phrase,
    workflow_id: spec.workflow_id || undefined,
    input: phrase + (input ? ('\n\n' + input) : ''),
    actor,
  });
  const runId = run?.id ?? run?.run_id;
  if (!runId) throw new Error('Workflow trigger did not return run id');

  registerWorkflowRunWatch(runId, {
    ownerUserId: goal.owner_user_id,
    actorAgentId: goal.agent_id,
    actorName: 'Goal plan',
    notifyOnWaiting: true,
    notifyOnTerminal: true,
    wakeOrchestratorOnTerminal: false,
    goalRunId: goal.id,
    goalTitle: goal.title || null,
    goalStepLabel: step.label || null,
    goalStepIndex: step.step_index != null ? Number(step.step_index) : null,
  });
  bindWorkflowRunToGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    workflowRunId: runId,
    ownerUserId: goal.owner_user_id,
  });
  console.info('[goal-run] workflow step started', {
    goalRunId: goal.id,
    stepId: step.id,
    workflowRunId: runId,
    phrase,
  });
  return { ok: true, async: true, workflow_run_id: runId };
}

function resolveAgentForGoal(ownerUserId, agentId) {
  const owner = String(ownerUserId || '').trim();
  let id = String(agentId || '').trim();
  if (!id) {
    return db().prepare('SELECT * FROM agents WHERE is_coo = 1 LIMIT 1').get() || null;
  }
  if (id.includes('--')) id = id.split('--').pop() || id;
  const agent = db().prepare('SELECT * FROM agents WHERE lower(id) = lower(?)').get(id);
  if (!agent) return null;
  const entitled = db()
    .prepare('SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1')
    .get(owner, agent.id);
  if (!entitled && !agent.is_coo) return null;
  return agent;
}

async function executeAgentContinueStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const agent = resolveAgentForGoal(goal.owner_user_id, goal.agent_id);
  if (!agent) throw new Error(`Agent not found or not entitled: ${goal.agent_id}`);

  const prior = priorStepContextForAgent(goal.id, step.step_index);

  // Prefer platform delivery of prior HTML/markdown artifacts (agents drop html= on large digests).
  let delivered = null;
  try {
    delivered = await deliverPriorEmailArtifactIfNeeded(goal, step);
  } catch (e) {
    console.warn('[goal-run] prior email artifact delivery failed', e?.message || e);
  }

  const deliveryNote = delivered?.ok
    ? [
        '',
        '[Platform email delivery]',
        `Already sent email_send once with the prior ${delivered.tool || 'tool'} HTML/markdown artifact.`,
        `to=${delivered.to} subject=${JSON.stringify(delivered.subject)} html_len=${delivered.html_len}`,
        'Do NOT call email_send again. Do NOT invent a new plain-text digest body.',
        'Briefly confirm delivery and summarize highlights only.',
      ].join('\n')
    : delivered?.skipped
      ? [
          '',
          '[Platform email delivery]',
          'Email artifact was already delivered for this goal run. Do NOT call email_send again.',
        ].join('\n')
      : '';

  // Email-only goals with platform-delivered HTML: skip OpenClaw (avoids duplicate plain-text sends).
  if (delivered?.ok && !goalWantsChatSynthesis(goal.prompt || '')) {
    const reply = [
      `Sent daily digest email to ${delivered.to} with prior HTML artifact (${delivered.html_len} chars).`,
      `Subject: ${delivered.subject}`,
      'Did not call notify_ceo (honored prompt rules when present).',
    ].join('\n');
    try {
      insertChatTurn({
        agentId: resolveAgentForGoal(goal.owner_user_id, goal.agent_id)?.id || goal.agent_id,
        ownerUserId: goal.owner_user_id,
        role: 'assistant',
        content: reply,
      });
    } catch (_) {
      /* optional */
    }
    return {
      ok: true,
      via: 'platform_prior_artifact',
      email: delivered,
      reply_preview: reply.slice(0, 2000),
    };
  }

  let prompt =
    spec.message ||
    [
      '[Goal run - agent continue]',
      `[goal_run_id: ${goal.id}]`,
      '',
      `CEO goal:\n${goal.prompt}`,
      prior ? `\nPrior step outputs:\n${prior}` : '',
      deliveryNote,
      '',
      'Continue executing this goal with your tools. Work autonomously; summarize outcomes when done.',
      delivered?.ok || delivered?.skipped
        ? 'Email already sent by platform — do not call email_send.'
        : 'If the goal requires email_send and no HTML artifact exists yet, call email_send once with real content.',
    ].join('\n');

  // When the plan already stored an interpretation message, still attach rich priors + delivery note.
  if (spec.message && prior) {
    prompt = `${String(spec.message).trim()}\n\n[goal_run_id: ${goal.id}]\n\nCEO goal:\n${goal.prompt}\n\nPrior step outputs:\n${prior}${deliveryNote}`;
  } else if (spec.message && deliveryNote) {
    prompt = `${String(spec.message).trim()}\n${deliveryNote}`;
  }

  try {
    // Fresh run only — do not inject MEMORY/"already done today?" (confuses scheduled digests).
    prompt = getPromptForFreshGoalRun(prompt);
  } catch (_) {
    /* optional */
  }
  prompt = `[ceo_user_id: ${goal.owner_user_id}]\n[owner_user_id: ${goal.owner_user_id}]\n${prompt}`;
  prompt +=
    '\n\n[Platform execution boundary — synthesis only]\n' +
    'Do not call tools, create/delegate work, or request another goal/step transition.\n' +
    'Use the completed outputs above to return the final, concrete CEO-facing response now.\n' +
    'The platform will persist this response and advance the goal automatically.';

  try {
    insertChatTurn({
      agentId: agent.id,
      ownerUserId: goal.owner_user_id,
      role: 'user',
      content: clip(prompt, 4000),
    });
  } catch (e) {
    console.warn('[goal-run] chat user turn:', e?.message || e);
  }

  const { content, modelUsed, usage } = await platformChatCompletions({
    messages: [
      { role: 'system', content: `You are ${agent.name || agent.id}, completing one isolated company goal. Synthesize only from supplied evidence. Successful primary tool results are authoritative for each item. Use browser fallback evidence only for the specific failed item it recovered; never replace successful primary values with unrelated values found during fallback. Never invent a number for an unresolved item.` },
      { role: 'user', content: prompt },
    ],
    ownerUserId: goal.owner_user_id,
    memberKey: agent.id,
    source: 'goal_agent_continue',
    sessionId: `goal:${goal.id}:${step.id}`,
    runId: goal.id,
    maxTokens: 3000,
  });
  const unsupportedItems = unresolvedItemsBeforeStep(goal.id, step.step_index);
  const verifiedMarketOutcome = buildVerifiedMarketOutcome(loadGoalSteps(goal.id).filter(
    (row) => Number(row.step_index) < Number(step.step_index)
  ));
  const modelReply = sanitizeUnsupportedItemClaims(String(content || '').trim() || '(no response)', unsupportedItems);
  // Numeric market reporting must be rendered from structured evidence. Models may
  // turn 0.026% into 2.60% or prefer stale browser text over a successful API value.
  const reply = verifiedMarketOutcome || modelReply;
  // When a terminal notify step follows, completeGoalRun() owns the single final
  // orchestrator chat post. Posting here as well produced two near-identical COO
  // messages and could expose a synthesis before the goal was actually terminal.
  const terminalNotifyFollows = loadGoalSteps(goal.id).some(
    (row) => Number(row.step_index) > Number(step.step_index) && row.step_type === 'notify_ceo'
  );
  let orchestratorChatPosted = false;
  if (!terminalNotifyFollows) {
    try {
      const ctx = goalContextObject(goal);
      insertChatTurn({
        agentId: agent.id,
        ownerUserId: goal.owner_user_id,
        role: 'assistant',
        content: reply,
        sessionId: ctx.chat_session_id || null,
      });
      orchestratorChatPosted = true;
    } catch (_) {
      /* terminal nudge remains the durable fallback */
    }
  }
  return {
    ok: true,
    via: 'platform_synthesis',
    model_used: modelUsed,
    usage,
    reply_preview: reply.slice(0, 5000),
    orchestrator_chat_posted: orchestratorChatPosted,
    terminal_delivery_pending: terminalNotifyFollows,
  };
}

async function executeAgentToolStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const toolName = String(spec.tool_name || '').trim();
  if (!toolName) throw new Error('agent_tool requires tool_name');

  if (toolName === 'notify_ceo') {
    return executeNotifyCeoStep(goal, step);
  }

  const prior = priorStepSummaries(goal.id, step.step_index);
  const hasPriorSteps = Boolean(String(prior || '').trim());

  // Extension hook only. Outbound actions currently require a real endpoint result;
  // agent prose is never accepted as execution evidence.
  if (toolNeedsAgentInterpretation(toolName, { hasPriorSteps })) {
    console.info('[goal-run] compositional agent_tool via agent interpretation', {
      goalRunId: goal.id,
      toolName,
      stepId: step.id,
    });
    return executeCompositionalToolViaAgent(goal, step, toolName);
  }

  let args =
    spec.args && typeof spec.args === 'object' && !Array.isArray(spec.args) ? { ...spec.args } : {};

  if (toolName === 'email_send') {
    if (!args.to && !args.cc && !args.bcc) {
      const ceoEmail = resolveCeoEmail(goal.owner_user_id);
      if (ceoEmail) args.to = ceoEmail;
    }
    const digestMail = findPriorDigestForEmail(goal.id, step.step_index);
    if (digestMail?.html || digestMail?.markdown) {
      // Prefer the real status_checker / digest HTML — never the goal-plan dump.
      if (!args.html && digestMail.html) args.html = digestMail.html;
      if (!args.body && !args.text) {
        args.body =
          digestMail.markdown ||
          (digestMail.html ? digestMail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
      }
      if (!args.subject || /^goal plan complete$/i.test(String(args.subject)) || args.subject === clip(goal.title || '', 120)) {
        const c = digestMail.counts || {};
        const failedN = c.failed ?? c.failed_1d ?? 0;
        const attention = c.needs_attention ?? (c.awaiting_ceo ?? 0) + failedN;
        args.subject =
          digestMail.tool === 'this_week_digest'
            ? clip(goal.title || 'This Week Digest', 120)
            : `COO Status Report — ${attention} need attention · ${failedN} failed · ${c.awaiting_ceo ?? 0} awaiting you`;
      }
      console.info('[goal-run] email_send using prior digest HTML', {
        goalRunId: goal.id,
        tool: digestMail.tool,
        html_len: String(args.html || '').length,
        body_len: String(args.body || '').length,
      });
    } else if (!args.body && !args.text && !args.html) {
      args.body = [
        goal.title ? 'Goal: ' + goal.title : '',
        'goal_run_id: ' + goal.id,
        clip(goal.prompt, 600),
        prior ? '\nCompleted steps:\n' + prior : '',
      ]
        .filter(Boolean)
        .join('\n');
    }
    if (!args.subject) {
      args.subject = clip(goal.title || 'Goal plan complete', 120);
    }
  }

  if (toolName === 'agent_workflow_list' || toolName === 'agent_workflow_enquire') {
    try {
      const all = listPublishedWorkflows(goal.owner_user_id) || [];
      return {
        ok: true,
        tool_name: toolName,
        count: all.length,
        workflows: all.map((w) => ({
          id: w.id,
          name: w.name,
          chat_trigger_phrase: w.chat_trigger_phrase || '',
          status: w.status,
        })),
      };
    } catch (e) {
      console.warn('[goal-run] workflow list local failed', e?.message || e);
    }
  }

  // Chat-like arg fill: goal plans often store args:{} while chat's tool-loop fills symbol etc.
  let multiSymbols;
  try {
    const resolved = await resolveAgentToolArgsForGoal({
      toolName,
      args,
      goalPrompt: goal.prompt || '',
      goalTitle: goal.title || '',
      priorSummary: prior || '',
      ownerUserId: goal.owner_user_id,
    });
    args = resolved.args || args;
    multiSymbols = resolved.symbols;
  } catch (e) {
    console.warn('[goal-run] tool arg resolve failed', toolName, e?.message || e);
  }

  // Re-assert digest HTML after LLM arg fill — models often paste the goal dump into body.
  if (toolName === 'email_send') {
    const digestMail = findPriorDigestForEmail(goal.id, step.step_index);
    if (digestMail?.html || digestMail?.markdown) {
      const bodyNow = String(args.body || args.text || '');
      if (!args.html || looksLikeGoalPlanDumpEmail(bodyNow)) {
        if (digestMail.html) args.html = digestMail.html;
        args.body =
          digestMail.markdown ||
          (digestMail.html ? digestMail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : bodyNow);
        if (looksLikeGoalPlanDumpEmail(String(args.subject || ''))) {
          const c = digestMail.counts || {};
          const failedN = c.failed ?? c.failed_1d ?? 0;
          const attention = c.needs_attention ?? (c.awaiting_ceo ?? 0) + failedN;
          args.subject = `COO Status Report — ${attention} need attention · ${failedN} failed · ${c.awaiting_ceo ?? 0} awaiting you`;
        }
      }
    }
  }

  args.ceo_user_id = args.ceo_user_id || goal.owner_user_id;
  args.owner_user_id = args.owner_user_id || goal.owner_user_id;
  if (toolName === 'browse_task_start' || toolName === 'kanban_create_task') {
    args.goal_run_id = args.goal_run_id || goal.id;
    args.goal_step_id = args.goal_step_id || step.id;
  }

  const caller = resolveAgentForGoal(goal.owner_user_id, goal.agent_id);
  const invokeOpts = {
    agentId: caller?.id || goal.agent_id || null,
    openclawAgentId: caller?.openclaw_agent_id || caller?.id || goal.agent_id || null,
    goalId: goal.scheduled_goal_id || goal.id,
  };

  // Single-symbol tools + multi-ticker goals (MAG7, lists): invoke per symbol and aggregate.
  if (Array.isArray(multiSymbols) && multiSymbols.length > 1) {
    const results = [];
    const errors = [];
    const fallbacks = [];
    for (const sym of multiSymbols.slice(0, 20)) {
      const body = { ...args, symbol: sym };
      delete body.symbols;
      try {
        const out = await invokeContentToolHttp(toolName, body, goal.owner_user_id, invokeOpts);
        results.push({ symbol: sym, ok: true, result: out });
      } catch (e) {
        const msg = e?.message || String(e);
        errors.push({ symbol: sym, ok: false, error: msg });
        console.warn('[goal-run] multi-symbol tool fail', { toolName, sym, err: msg });
      }
    }
    // Recover a failed item from an explicit CEO-provided URL. Executor selection
    // remains in browser routing: extension -> desktop -> managed fallback.
    for (const failed of errors) {
      const goalText = `${goal.title || ''}\n${goal.prompt || ''}`;
      const fallbackUrl = selectExplicitFallbackUrl(goalText, failed.symbol);
      if (!fallbackUrl && !goalRequestsBrowserRecovery(goalText)) continue;
      const priorRecovery = priorSuccessfulBrowserFallback(goal.id, step.step_index, failed.symbol);
      if (priorRecovery) {
        fallbacks.push({ ...priorRecovery, reused: true });
        continue;
      }
      try {
        const excludedDrivers = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const browserArgs = {
            mode: 'autonomous',
            goal: `Recover only the missing factual data for ${failed.symbol} after ${toolName} failed. The CEO goal requests: ${clip(goal.prompt, 900)} Do not collect or report values for other items. Return only ${failed.symbol}'s requested values, source URL, and source timestamp. Do not submit or modify anything.`,
            goal_run_id: goal.id,
            goal_step_id: step.id,
            excluded_drivers: excludedDrivers,
          };
          if (fallbackUrl) browserArgs.start_url = fallbackUrl;
          const started = await invokeContentToolHttp('browse_task_start', browserArgs, goal.owner_user_id, invokeOpts);
          const taskId = started?.task_id || started?.task?.id;
          const terminalResult = taskId
            ? await invokeContentToolHttp('browse_task_status', { task_id: taskId, wait_ms: 90000 }, goal.owner_user_id, invokeOpts)
            : started;
          const taskResult = terminalResult?.task || started?.task || null;
          const status = taskResult?.status || 'submitted';
          fallbacks.push({
            symbol: failed.symbol,
            url: fallbackUrl || taskResult?.url || null,
            task_id: taskId || null,
            task: taskResult,
            status,
            attempt: attempt + 1,
          });
          if (status === 'completed' || status === 'blocked_on_input') break;
          const failedDriver = String(taskResult?.selected_driver_mode || '').trim();
          if (!failedDriver || failedDriver === 'managed_playwright') break;
          excludedDrivers.push(failedDriver);
        }
      } catch (fallbackError) {
        fallbacks.push({ symbol: failed.symbol, url: fallbackUrl || null, status: 'failed', error: fallbackError?.message || String(fallbackError) });
      }
    }
    if (!results.length) {
      throw new Error(
        errors[0]?.error || `tool ${toolName} failed for all symbols (${multiSymbols.join(',')})`
      );
    }
    console.info('[goal-run] multi-symbol agent_tool', {
      toolName,
      ok: results.length,
      fail: errors.length,
      symbols: multiSymbols.slice(0, 12),
    });
    return {
      ok: true,
      tool_name: toolName,
      multi_symbol: true,
      symbols: multiSymbols,
      results,
      errors: errors.length ? errors : undefined,
      fallbacks: fallbacks.length ? fallbacks : undefined,
    };
  }

  try {
    const out = await invokeContentToolHttp(toolName, args, goal.owner_user_id, invokeOpts);
    return { ok: true, tool_name: toolName, result: out };
  } catch (e) {
    e.actionArgs = { ...args };
    throw e;
  } finally {
    // Approval tokens are one-use and short-lived; never retain them in goal telemetry/specs.
    if (args.approval_token) {
      const cleanSpec = parseJson(step.spec_json, {});
      if (cleanSpec.args && typeof cleanSpec.args === 'object') delete cleanSpec.args.approval_token;
      db().prepare('UPDATE agent_goal_steps SET spec_json=? WHERE id=?').run(JSON.stringify(cleanSpec), step.id);
    }
  }
}

/**
 * Run a compositional agent_tool (email_send, …) through platform artifact delivery
 * when prior HTML exists; otherwise OpenClaw interpretation (not dry plan-dump HTTP).
 */
async function executeCompositionalToolViaAgent(goal, step, toolName) {
  if (toolName === 'email_send') {
    try {
      const delivered = await deliverPriorEmailArtifactIfNeeded(goal, step);
      if (delivered?.ok || delivered?.skipped) {
        return {
          ok: true,
          tool_name: toolName,
          via: delivered.ok ? 'platform_prior_artifact' : 'platform_prior_artifact_skipped',
          email: delivered,
          reply_preview: delivered.ok
            ? `Sent email to ${delivered.to} with prior HTML (${delivered.html_len} chars).`
            : `Email already delivered earlier in this goal run.`,
        };
      }
    } catch (e) {
      console.warn('[goal-run] compositional email platform delivery failed; falling back to agent', e?.message || e);
    }
  }

  const agent = resolveAgentForGoal(goal.owner_user_id, goal.agent_id);
  if (!agent) throw new Error(`Agent not found or not entitled: ${goal.agent_id}`);

  let openclawId = agent.openclaw_agent_id || agent.id;
  try {
    openclawId = ensureTenantOpenClawAgent(agent, goal.owner_user_id).openclawAgentId;
  } catch (e) {
    console.warn('[goal-run] tenant ensure failed', agent.id, e?.message || e);
  }

  const prior = priorStepContextForAgent(goal.id, step.step_index);
  const ceoEmail = resolveCeoEmail(goal.owner_user_id);
  let prompt = [
    '[Goal run — interpreted tool step]',
    `[goal_run_id: ${goal.id}]`,
    `[required_tool: ${toolName}]`,
    '',
    'CEO goal (follow exactly, including formatting and "do not …" rules):',
    goal.prompt,
    '',
    prior
      ? `Prior step outputs (use these — do not re-fetch unless missing):\n${prior}`
      : 'No prior step outputs.',
    '',
    `Invoke **${toolName}** once with correct parameters derived from the CEO goal and prior outputs.`,
    isCompositionalTool(toolName)
      ? 'For email: if a prior HTML artifact exists, pass it in `html` (never invent a short plain-text substitute). Call email_send exactly once.'
      : '',
    ceoEmail && toolName === 'email_send' ? `Default recipient if goal does not override: ${ceoEmail}` : '',
    'Do not invent a new goal plan. Do not call unrelated tools except what this step requires.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    prompt = getPromptForFreshGoalRun(prompt);
  } catch (_) {
    /* optional */
  }
  prompt = `[ceo_user_id: ${goal.owner_user_id}]\n[owner_user_id: ${goal.owner_user_id}]\n${prompt}`;

  const sessionUser = openclaw.sessionUserFor(
    openclawId,
    goal.owner_user_id,
    `goalrun-${String(goal.id).replace(/^agr-/, '')}-tool-${String(toolName).slice(0, 24)}`
  );

  try {
    insertChatTurn({
      agentId: agent.id,
      ownerUserId: goal.owner_user_id,
      role: 'user',
      content: clip(prompt, 4000),
    });
  } catch (e) {
    console.warn('[goal-run] chat user turn (interpreted tool):', e?.message || e);
  }

  const { content } = await openclaw.chatCompletions(
    openclawId,
    [{ role: 'user', content: prompt }],
    sessionUser,
    false,
    {
      injectLearningsInstruction: false,
      injectKanbanInstruction: true,
      injectSessionHistoryInstruction: false,
      timeoutMs: Number(process.env.GOAL_AGENT_CONTINUE_TIMEOUT_MS || process.env.OPENCLAW_FETCH_TIMEOUT_MS || 240000),
    }
  );
  const reply = String(content || '').trim() || '(no response)';
  try {
    insertChatTurn({
      agentId: agent.id,
      ownerUserId: goal.owner_user_id,
      role: 'assistant',
      content: reply,
    });
  } catch (e) {
    console.warn('[goal-run] chat assistant turn (interpreted tool):', e?.message || e);
  }

  console.info('[goal-run] compositional tool via agent done', {
    goalRunId: goal.id,
    toolName,
    reply_len: reply.length,
  });
  return {
    ok: true,
    tool_name: toolName,
    via: 'agent_interpretation',
    reply_preview: reply.slice(0, 2000),
  };
}

async function executeNotifyCeoStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const steps = loadGoalSteps(goal.id).filter((s) => Number(s.step_index) < Number(step.step_index));
  const report = buildOutcomeRichTerminalReport({ goal, steps, terminal: 'completed' });
  const title = spec.title || clip(goal.title || 'Goal run complete', 120);
  const body = spec.body ? `${spec.body}\n\n${report}` : report;

  sendPlatformNotifications({
    userIds: [goal.owner_user_id],
    title,
    body: clip(body, 4000),
    linkUrl: `/goal-plans/${encodeURIComponent(goal.id)}`,
    createdBy: String(goal.agent_id || 'goal-run').slice(0, 64),
    source: 'agent_goal_run',
    sourceKey: `goal-run:${goal.id}:notify`,
  });
  return { ok: true, title, body: clip(body, 4000), outcome_report: clip(report, 4000) };
}

export function completeGoalRun(goalRunId, { status = 'completed', error = null } = {}) {
  touchGoalRun(goalRunId, {
    status,
    error_message: error ? String(error).slice(0, 1000) : null,
    completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
  });
  console.info('[goal-run] finished', { goalRunId, status });
  // Every specialty retry gets a new delegation and therefore a new Kanban card.
  // A terminal goal must not leave any card from any attempt looking active.
  // Match through the immutable goal marker in the delegation prompt so this also
  // repairs cards created before goal_run_id/goal_step_id columns existed.
  if (status === 'completed' || status === 'failed') {
    try {
      const marker = `%[goal_run_id: ${String(goalRunId)}]%`;
      const rows = db().prepare(
        `SELECT k.id
         FROM kanban_tasks k
         JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
         WHERE d.prompt LIKE ? AND k.status IN ('open','in_progress','awaiting_confirmation','failed')`
      ).all(marker);
      const terminalCardStatus = status === 'completed' ? 'completed' : 'failed';
      const update = db().prepare(
        `UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`
      );
      for (const row of rows) {
        update.run(terminalCardStatus, row.id);
        clearKanbanTaskNotification(row.id);
      }
      if (rows.length) {
        console.info('[goal-run] reconciled terminal Kanban attempts', {
          goalRunId, status: terminalCardStatus, cards: rows.map((r) => r.id),
        });
      }
    } catch (e) {
      console.warn('[goal-run] terminal Kanban reconciliation failed', goalRunId, e?.message || e);
    }
  }
  try {
    const row = loadGoalRunRow(goalRunId);
    if (row) {
      const outcome = loadOutcome(row);
      const steps = loadGoalSteps(goalRunId);
      const events = listMissionEvents(row.owner_user_id, { goalRunId, limit: 200 });
      const retrospective = buildRetrospective({
        outcome,
        steps: steps.map((s) => ({
          id: s.id,
          label: s.label,
          result: parseJson(s.result_json, null),
        })),
        events,
        status,
        error,
        startedAt: row.created_at,
        completedAt: new Date().toISOString(),
      });
      persistOutcome(goalRunId, row.owner_user_id, { ...outcome, retrospective });
      recordMissionEvent({
        ownerUserId: row.owner_user_id,
        goalRunId,
        event_type: 'goal_completed',
        payload: {
          status,
          kpi: outcome.kpi,
          current_value: outcome.current_value,
          target: outcome.target,
          rejected_count: outcome.rejected_count,
          unknown_count: outcome.unknown_count,
          plan_version: outcome.plan_version,
          retrospective,
          shortfall:
            outcome.target != null && Number(outcome.current_value || 0) < Number(outcome.target)
              ? 'explained_or_open'
              : null,
        },
      });
    }
  } catch (e) {
    console.warn('[goal-run] mission complete event failed', e?.message || e);
  }
  // Once-only COO chat nudge so the CEO sees a final ladder update without re-asking.
  if (status === 'completed' || status === 'failed') {
    void nudgeCooOnGoalPlanTerminal(goalRunId, { status }).catch((e) =>
      console.warn('[goal-run] completion nudge failed', goalRunId, e?.message || e)
    );
  }
  // On failure: recovery Kanban + pending delegation (chat/tool path, not a new goal plan).
  if (status === 'failed') {
    void import('./goal-plan-failure-kanban.js')
      .then(({ enqueueGoalPlanFailureKanban }) =>
        enqueueGoalPlanFailureKanban(goalRunId, { error })
      )
      .catch((e) =>
        console.warn('[goal-run] failure recovery kanban failed', goalRunId, e?.message || e)
      );
  }
  return getGoalRun(goalRunId);
}



/**
 * Once per goal run: wake COO to post a final chat status (and always insert a fallback
 * assistant turn so the dashboard chat updates without the CEO re-enquiring).
 * Idempotent via context_json.coo_completion_nudge_at.
 */
export async function nudgeCooOnGoalPlanTerminal(goalRunId, opts = {}) {
  if (String(process.env.GOAL_PLAN_COO_COMPLETION_NUDGE || '1') === '0') {
    return { ok: false, skipped: true, reason: 'disabled_by_env' };
  }
  if (!opts.force && !isPlatformCronActive('goal_plan_completion_nudge')) {
    return { ok: false, skipped: true, reason: 'paused_admin' };
  }
  const id = String(goalRunId || '').trim();
  if (!id) return { ok: false, error: 'goal_run_id required' };

  ensureAgentGoalRunTables();
  const row = loadGoalRunRow(id);
  if (!row) return { ok: false, error: 'goal not found' };

  const ctx = parseJson(row.context_json, {});
  if (ctx.coo_completion_nudge_at && !opts.force) {
    return { ok: true, skipped: true, reason: 'already_nudged', at: ctx.coo_completion_nudge_at };
  }

  const claimedAt = new Date().toISOString();
  ctx.coo_completion_nudge_at = claimedAt;
  ctx.coo_completion_nudge_status = opts.status || row.status || 'completed';
  touchGoalRun(id, { context_json: JSON.stringify(ctx) });

  const goal = getGoalRun(id, row.owner_user_id) || serializeGoalRun(row);
  const owner = goal?.owner_user_id || row.owner_user_id;
  const agentId = goal?.agent_id || row.agent_id || null;
  const agent = resolveAgentForGoal(owner, agentId);
  if (!agent) {
    console.warn('[goal-run] completion nudge: no agent', { id, owner, agentId });
    return { ok: false, error: 'no_agent' };
  }

  const terminal = String(opts.status || goal.status || row.status || 'completed');
  const progress = summarizeGoalProgress(goal);
  const steps = Array.isArray(goal.steps) ? goal.steps : loadGoalSteps(id);
  const ladder = steps
    .map((s, i) => {
      const st = s.status || '?';
      const lab = s.label || s.step_type || 'step';
      const tool = s.spec?.tool_name ? ` (${s.spec.tool_name})` : '';
      const agentBit = s.spec?.agent_id ? ` → ${s.spec.agent_id}` : '';
      const child =
        s.child_workflow_run_id != null
          ? ` · WF #${s.child_workflow_run_id}`
          : s.child_delegation_task_id != null
            ? ` · task #${s.child_delegation_task_id}`
            : '';
      return `${i + 1}. [${st}] ${lab}${tool}${agentBit}${child}`;
    })
    .join('\n');

  const title = goal.title || clip(goal.prompt, 72) || id;
  const fallback = buildOutcomeRichTerminalReport({ goal, steps, terminal });
  const hasPlatformSynthesis = steps.some((s) => {
    const result = resultPayload(s);
    return s.step_type === 'agent_continue' && result?.via === 'platform_synthesis' && usefulReply(result);
  });

  let reply = fallback;
  let via = hasPlatformSynthesis ? 'platform_terminal_report' : 'fallback';

  // A completed agent_continue step already used the originating orchestrator's
  // model with the isolated goal evidence. Rewriting it through OpenClaw a second
  // time can drop facts or turn completed human work back into future work.
  if (!hasPlatformSynthesis) try {
    let openclawId = agent.openclaw_agent_id || agent.id;
    try {
      openclawId = ensureTenantOpenClawAgent(agent, owner).openclawAgentId;
    } catch (e) {
      console.warn('[goal-run] completion nudge tenant ensure', e?.message || e);
    }

    const prompt =
      `[ceo_user_id: ${owner}]\n[owner_user_id: ${owner}]\n` +
      `[SYSTEM goal_plan_terminal_once]\n` +
      `Goal plan ${id} ("${clip(title, 100)}") just reached terminal status: ${terminal}.\n` +
      `You are the COO. Post ONE final chat update for the CEO. Rules:\n` +
      `- Quote the exact goal run id ${id} (agr-…).\n` +
      `- Preserve every material value and gap from the outcome evidence below.\n` +
      `- Do not create a new plan, re-trigger workflows, or call tools unless agent_goal_status is required.\n` +
      `- Do not ask the CEO to re-request status — this IS the status post.\n` +
      `- Keep it short, professional, factual.\n\n` +
      `### Outcome evidence\n${clip(fallback, 7000)}\n\n### Ladder\n${ladder || '(none)'}\n\n` +
      (goal.error_message ? `Error: ${clip(goal.error_message, 500)}\n` : '') +
      `Progress: ${progress.completed_steps || 0}/${progress.total_steps || 0} (${progress.progress_pct || 0}%).`;

    const sessionUser = openclaw.sessionUserFor(
      openclawId,
      owner,
      `goal-done-${String(id).slice(4, 16)}`
    );

    const timeoutMs = Number(process.env.GOAL_PLAN_COO_NUDGE_TIMEOUT_MS) || 45000;
    const llmPromise = openclaw.chatCompletions(
      openclawId,
      [{ role: 'user', content: prompt }],
      sessionUser,
      false,
      {
        injectLearningsInstruction: false,
        injectKanbanInstruction: false,
        injectSessionHistoryInstruction: false,
        timeoutMs,
      }
    );
    const timed = await Promise.race([
      llmPromise.then((r) => ({ ok: true, r })),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, timeout: true }), timeoutMs + 2000)),
    ]);
    if (timed.ok && timed.r) {
      const text = String(timed.r.content || '').trim();
      if (text && text.length >= 20) {
        reply = /\bagr-[a-f0-9]{8,}\b/i.test(text) ? text : `${text}\n\nGoal plan: \`${id}\``;
        via = 'coo_llm';
      }
    }
  } catch (e) {
    console.warn('[goal-run] completion nudge LLM skipped', id, e?.message || e);
  }

  try {
    insertChatTurn({
      agentId: agent.id,
      ownerUserId: owner,
      role: 'assistant',
      content: reply,
      sessionId: ctx.chat_session_id || null,
    });
  } catch (e) {
    console.warn('[goal-run] completion nudge chat insert failed', e?.message || e);
    return { ok: false, error: e?.message || String(e), via };
  }

  try {
    sendPlatformNotifications({
      userIds: [owner],
      title:
        terminal === 'failed'
          ? `Goal plan failed: ${clip(title, 80)}`
          : `Goal plan completed: ${clip(title, 80)}`,
      body: clip(
        `${reply}\n\n${ladder || ''}`.slice(
          0,
          3500
        ),
        4000
      ),
      linkUrl: `/agents/${encodeURIComponent(agent.id)}/chat`,
      createdBy: String(agent.id || 'goal-run').slice(0, 64),
      source: 'agent_goal_run',
      sourceKey: `goal-run:${id}:terminal`,
    });
  } catch (e) {
    console.warn('[goal-run] completion push failed', e?.message || e);
  }

  if (row.scheduled_goal_id) {
    void deliverScheduledGoalOutcome({
      ownerUserId: owner,
      agentId: agent.id,
      scheduledGoalId: row.scheduled_goal_id,
      text: reply,
      sourceKey: `agr:${id}:terminal`,
    }).catch((e) => console.warn('[goal-run] channel fan-out', e?.message || e));
  }

  console.info('[goal-run] completion nudge posted', { goalRunId: id, via, terminal });
  return { ok: true, via, goal_run_id: id, terminal };
}


export function completeGoalStep({ goalRunId, stepId, ownerUserId, result = null, failed = false, error = null, skipRecovery = false }) {
  ensureAgentGoalRunTables();
  const goal = loadGoalRunRow(goalRunId, ownerUserId);
  if (!goal) {
    const err = new Error('Goal run not found');
    err.status = 404;
    throw err;
  }
  const step = db()
    .prepare('SELECT * FROM agent_goal_steps WHERE id = ? AND goal_run_id = ?')
    .get(stepId, goalRunId);
  if (!step) {
    const err = new Error('Goal step not found');
    err.status = 404;
    throw err;
  }

  const observation = observeStepResult(result || {});
  const resultPayload = { ...(result && typeof result === 'object' ? result : { result }), observation };

  if (failed) {
    const spec = parseJson(step.spec_json, {});
    const exceptionPolicy = getExceptionPolicy(goal.owner_user_id);
    const classified = classifyToolFailure(
      { message: error || result?.error || result?.message || 'step failed' },
      { status: result?.status || result?.http_status, policyDenied: result?.policy_denied }
    );
    const failedProviders = Array.isArray(spec.failed_providers) ? [...spec.failed_providers] : [];
    if (spec.tool_name) failedProviders.push(spec.tool_name);
    const fallback = nextExecutorForStep({ ...spec, capability_id: spec.capability_id }, failedProviders);
    const decision = skipRecovery ? { action: 'escalate', reason: 'Human employee reported this task could not be completed.', ceo_required: true } : decideFromObservation({
      observation,
      failure: classified,
      retryCount: Number(step.exception_retry_count || 0),
      maxRetries: exceptionPolicy.retry_limit,
      fallbackAvailable: !!fallback,
      allowFallback: false,
      failed: true,
    });
    recordMissionEvent({
      ownerUserId: goal.owner_user_id,
      goalRunId,
      event_type: 'decision',
      payload: {
        action: decision.action,
        reason: decision.reason,
        step_id: stepId,
        ceo_required: !!decision.ceo_required,
        failure_class: classified.failure_class,
        retry_count: Number(step.exception_retry_count || 0),
        retry_limit: Number(exceptionPolicy.retry_limit || 0),
      },
    });
    console.info('[goal-run] decision', { goalRunId, stepId, action: decision.action, reason: decision.reason });

    if (decision.action === 'retry') {
      spec.retry_count = Number(spec.retry_count || 0) + 1;
      db()
        .prepare(
          `UPDATE agent_goal_steps SET status = 'pending', spec_json = ?, result_json = ?, error_message = ?,
             completed_at = NULL, child_workflow_run_id = NULL, child_delegation_task_id = NULL,
             exception_retry_count = COALESCE(exception_retry_count, 0) + 1
           WHERE id = ?`
        )
        .run(JSON.stringify(spec), JSON.stringify(resultPayload), String(error || decision.reason).slice(0, 1000), stepId);
      touchGoalRun(goalRunId, { status: 'running' });
      return { ok: true, recovered: true, decision, goal: getGoalRun(goalRunId, ownerUserId) };
    }

    if (decision.action === 'switch_executor' && fallback) {
      const snap = snapshotPlanVersion({
        goalRow: goal,
        steps: loadGoalSteps(goalRunId),
        rationale: `switch executor: ${spec.tool_name || spec.phrase || 'primary'} → ${fallback.tool_name || fallback.workflow_phrase}`,
      });
      persistOutcome(goalRunId, goal.owner_user_id, snap.outcome);
      persistPlanHistory(goalRunId, goal.owner_user_id, snap.history);
      recordMissionEvent({
        ownerUserId: goal.owner_user_id,
        goalRunId,
        event_type: 're_plan',
        payload: { from: snap.from, to: snap.to, reason: decision.reason, capability_id: spec.capability_id || null },
      });
      spec.failed_providers = failedProviders;
      spec.retry_count = 0;
      spec.execution_mode = 'fallback';
      if (fallback.workflow_phrase) {
        spec.phrase = fallback.workflow_phrase;
      }
      if (fallback.tool_name) spec.tool_name = fallback.tool_name;
      db()
        .prepare(
          `UPDATE agent_goal_steps SET status = 'pending', spec_json = ?, result_json = ?, error_message = ?
           WHERE id = ?`
        )
        .run(JSON.stringify(spec), JSON.stringify(resultPayload), String(decision.reason).slice(0, 1000), stepId);
      touchGoalRun(goalRunId, { status: 'running' });
      return { ok: true, recovered: true, decision, goal: getGoalRun(goalRunId, ownerUserId) };
    }

    db()
      .prepare(
        `UPDATE agent_goal_steps SET status = 'failed', result_json = ?, error_message = ?, completed_at = datetime('now')
         WHERE id = ?`
      )
      .run(JSON.stringify(resultPayload), String(error || decision.reason || 'escalated').slice(0, 1000), stepId);
    completeGoalRun(goalRunId, { status: 'failed', error: error || decision.reason || 'escalated' });
    return { ok: false, escalated: true, decision, goal: getGoalRun(goalRunId, ownerUserId) };
  }

  db()
    .prepare(
      `UPDATE agent_goal_steps SET status = ?, result_json = ?, error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    )
    .run('completed', JSON.stringify(resultPayload), null, stepId);

  const outcome = applyObservation(loadOutcome(goal), observation);
  persistOutcome(goalRunId, goal.owner_user_id, outcome);
  recordMissionEvent({
    ownerUserId: goal.owner_user_id,
    goalRunId,
    event_type: 'step_completed',
    payload: {
      step_id: stepId,
      step_type: step.step_type,
      label: step.label,
      failed: !!failed,
      observation,
      kpi: { current: outcome.current_value, target: outcome.target },
    },
  });

  const steps = loadGoalSteps(goalRunId);
  const open = steps.find((s) => s.status === 'pending' || s.status === 'running');
  if (!open) {
    completeGoalRun(goalRunId, { status: 'completed' });
    return { ok: true, done: true, goal: getGoalRun(goalRunId, ownerUserId) };
  }

  touchGoalRun(goalRunId, { current_step_index: open.step_index, status: 'running' });
  recordMissionEvent({
    ownerUserId: goal.owner_user_id,
    goalRunId,
    event_type: 'step_started',
    payload: { step_id: open.id, step_type: open.step_type, label: open.label },
  });
  return { ok: true, done: false, goal: getGoalRun(goalRunId, ownerUserId) };
}


async function executeSpecialtyTaskStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const agentId = String(spec.agent_id || '').trim().toLowerCase();
  if (!agentId) throw new Error('specialty_task requires agent_id');
  // Specialists receive complete, bounded prior I/O from this goal only, matching
  // continuation turns rather than the shorter notification-oriented summary.
  const prior = priorStepContextForAgent(goal.id, step.step_index);
  const originalGoal = String(goal.prompt || '').trim() || 'Complete the CEO goal.';
  const assignedDeliverable =
    (spec.message && String(spec.message).trim()) || 'Complete the specialty portion assigned by the plan.';
  const outputContract = Array.isArray(spec.produces) && spec.produces.length
    ? spec.produces.map((output) => `- ${output.key}: ${output.kind || 'data'}${output.required === false ? ' (optional)' : ' (required)'}`).join('\n')
    : '- completed_deliverable: data (required)';
  let message =
    `Original CEO goal (verbatim):\n${originalGoal}\n\n` +
    `Your assigned specialty deliverable:\n${assignedDeliverable}\n\n` +
    `Typed output contract (your response is validated before the next step):\n${outputContract}\n` +
    `For an artifact output, return the real file/attachment/download URL in the response; a description of a future file is not an artifact.\n\n` +
    `An empty upstream result is still valid evidence. If you can accurately document that no records were found, produce the contracted data or exception artifact and a bounded recommendation; do not invent records or request clarification merely because the result set is empty.\n\n` +
    `Relevant completed outputs from THIS goal only:\n${prior || '(none — this is the first relevant step)'}\n\n` +
    `Context boundary:\n` +
    `- Use only the original goal and outputs listed above.\n` +
    `- Never reuse facts, target markets, companies, locations, or results from another task or memory.\n` +
    `- If an essential target, market, geography, audience, account, date range, or other required input is missing, ` +
    `do not guess. Reply with [NEEDS_CLARIFICATION] followed by the smallest specific question(s) needed.\n` +
    `- Otherwise return the concrete completed deliverable, not a future-tense acknowledgement.`;
  message =
    message +
    `\n\n[goal_run_id: ${goal.id}]\n[goal_step_id: ${step.id}]\n[ceo_user_id: ${goal.owner_user_id}]`;

  const standupId = getOrCreateDelegationHubStandup(goal.owner_user_id);
  if (!standupId) throw new Error('specialty_task could not resolve delegation hub standup');
  const out = await scheduleCeoRequestViaOpenClawCron(standupId, message, goal.owner_user_id, {
    preAllocated: { [agentId]: message },
    restrictToAgentIds: [agentId],
    maxAgents: 1,
  });
  let taskId = null;
  if (out?.requestId) {
    const row = db()
      .prepare(
        `SELECT id FROM agent_delegation_tasks WHERE request_id = ? AND lower(to_agent_id) = lower(?) ORDER BY id DESC LIMIT 1`
      )
      .get(out.requestId, agentId);
    taskId = row?.id || null;
  }
  if (!taskId) {
    const row = db()
      .prepare(
        `SELECT id FROM agent_delegation_tasks WHERE owner_user_id = ? AND lower(to_agent_id) = lower(?) AND status IN ('pending','processing') ORDER BY id DESC LIMIT 1`
      )
      .get(goal.owner_user_id, agentId);
    taskId = row?.id || null;
  }
  if (!taskId) {
    throw new Error(`specialty_task failed to enqueue delegation for ${agentId}`);
  }
  db()
    .prepare(
      `UPDATE agent_goal_steps SET child_delegation_task_id = ?, status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?`
    )
    .run(Number(taskId), step.id);
  db()
    .prepare(
      `UPDATE kanban_tasks SET goal_run_id = ?, goal_step_id = ?
       WHERE agent_delegation_task_id = ?`
    )
    .run(goal.id, step.id, Number(taskId));
  touchGoalRun(goal.id, { status: 'running', current_step_index: step.step_index });
  console.info('[goal-run] specialty_task started', {
    goalRunId: goal.id,
    stepId: step.id,
    agentId,
    taskId,
  });
  return { ok: true, async: true, delegation_task_id: Number(taskId), agent_id: agentId };
}

export function findGoalStepByDelegationTask(taskId) {
  ensureAgentGoalRunTables();
  const id = Number(taskId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const step = db()
    .prepare('SELECT * FROM agent_goal_steps WHERE child_delegation_task_id = ? LIMIT 1')
    .get(id);
  if (!step) return null;
  const goal = loadGoalRunRow(step.goal_run_id);
  return goal ? { goal, step } : null;
}

const activeAgentContinueSteps = new Set();

/** Recover agent_continue work abandoned by a backend restart or lost background turn. */
export async function recoverStaleAgentContinueGoalSteps({
  ownerUserId = null,
  limit = 20,
  staleMs = null,
} = {}) {
  ensureAgentGoalRunTables();
  const configured = Number(
    staleMs ?? process.env.GOAL_AGENT_CONTINUE_STALE_MS ??
      (Number(process.env.GOAL_AGENT_CONTINUE_TIMEOUT_MS || process.env.OPENCLAW_FETCH_TIMEOUT_MS || 240000) + 60000)
  );
  const ageSeconds = Math.max(60, Math.ceil((Number.isFinite(configured) ? configured : 300000) / 1000));
  const owner = String(ownerUserId || '').trim();
  const params = owner ? [owner, `-${ageSeconds} seconds`, limit] : [`-${ageSeconds} seconds`, limit];
  const rows = db().prepare(
    `SELECT s.id AS step_id, s.goal_run_id, g.owner_user_id
     FROM agent_goal_steps s JOIN agent_goal_runs g ON g.id = s.goal_run_id
     WHERE s.step_type = 'agent_continue' AND s.status = 'running'
       AND g.status = 'running'
       ${owner ? 'AND g.owner_user_id = ?' : ''}
       AND datetime(COALESCE(s.started_at, g.updated_at)) < datetime('now', ?)
     ORDER BY datetime(COALESCE(s.started_at, g.updated_at)) ASC LIMIT ?`
  ).all(...params);
  const recovered = [];
  for (const row of rows) {
    if (activeAgentContinueSteps.has(row.step_id)) continue;
    const changed = db().prepare(
      `UPDATE agent_goal_steps SET status='pending', started_at=NULL, error_message=NULL
       WHERE id=? AND status='running'`
    ).run(row.step_id);
    if (!changed.changes) continue;
    touchGoalRun(row.goal_run_id, { status: 'running' });
    console.warn('[goal-run] reclaimed stale agent_continue', {
      goalRunId: row.goal_run_id, stepId: row.step_id, ageSeconds,
    });
    const execution = await startGoalRunExecution(row.goal_run_id, { ownerUserId: row.owner_user_id });
    recovered.push({ goal_run_id: row.goal_run_id, step_id: row.step_id, execution });
  }
  return { scanned: rows.length, recovered: recovered.length, stale_seconds: ageSeconds, details: recovered };
}

export async function onDelegationTerminalForGoalRun(taskId) {
  const found = findGoalStepByDelegationTask(taskId);
  if (!found) return { ok: false, skipped: true, reason: 'no_goal_step' };
  const { goal, step } = found;
  if (step.status === 'completed' || step.status === 'failed') {
    return { ok: true, skipped: true, reason: 'step_already_terminal', goal_run_id: goal.id };
  }
  const task = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(Number(taskId));
  const response = String(task?.response_content || '').trim();
  const spec = parseJson(step.spec_json, {});
  const requiredArtifact = (Array.isArray(spec.produces) ? spec.produces : [])
    .find((output) => output?.required !== false && String(output?.kind || '') === 'artifact');
  const needsClarification = /\[NEEDS_CLARIFICATION\]/i.test(response);
  let effectiveResponse = response;
  let artifactRefs = collectArtifactRefs(response);
  if (
    requiredArtifact &&
    !artifactRefs.size &&
    response &&
    task &&
    String(task.status || '') !== 'failed' &&
    !needsClarification
  ) {
    const safeKey = String(requiredArtifact.key || 'specialist-deliverable')
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'specialist-deliverable';
    const created = createMediaArtifact(goal.owner_user_id, {
      buffer: Buffer.from(response, 'utf8'),
      filename: `${safeKey}.md`,
      mimeType: 'text/markdown; charset=utf-8',
      kind: 'document',
      meta: {
        source: 'goal_specialty_output',
        goal_run_id: goal.id,
        goal_step_id: step.id,
        delegation_task_id: Number(taskId),
        output_key: requiredArtifact.key,
      },
    });
    const ref = created.ref;
    effectiveResponse = `${response}\n\n[${requiredArtifact.key || 'Specialist deliverable'}](${ref.url})`;
    artifactRefs = collectArtifactRefs({ ...ref, reply: effectiveResponse });
  }
  const missingArtifact = requiredArtifact && !artifactRefs.size;
  const failed = !task || String(task.status || '') === 'failed' || needsClarification || !!missingArtifact;
  const contractError = missingArtifact
    ? `Specialty response did not satisfy required artifact output ${requiredArtifact.key}: no real file or URL was returned`
    : null;
  const result = {
    delegation_task_id: Number(taskId),
    status: task?.status || 'missing',
    reply_preview: clip(effectiveResponse, 2000),
    reply: clip(effectiveResponse, 12000),
    artifacts: [...artifactRefs.values()].slice(0, 20),
    error_message: task?.error_message || contractError || (needsClarification ? 'Needs CEO clarification' : null),
    needs_clarification: needsClarification,
  };
  const completion = await completeGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    ownerUserId: goal.owner_user_id,
    result,
    failed,
    error: failed
      ? task?.error_message || contractError || (needsClarification ? 'Needs CEO clarification' : task?.status || 'delegation failed')
      : null,
  });
  if (completion?.recovered) {
    return startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
  }
  if (failed) {
    return { ok: false, failed: true, goal_run_id: goal.id, task_id: Number(taskId) };
  }
  try {
    return await startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
  } catch (e) {
    return { ok: false, error: e?.message || String(e), goal_run_id: goal.id };
  }
}

function parallelGroupOf(step) {
  const spec = parseJson(step.spec_json);
  const g = spec?.parallel_group;
  return g != null && Number.isFinite(Number(g)) ? Number(g) : null;
}

async function startParallelSpecialtyGroup(goal, steps, group) {
  const peers = steps.filter(
    (s) =>
      s.step_type === 'specialty_task' &&
      parallelGroupOf(s) === group &&
      (s.status === 'pending' || s.status === 'running')
  );
  const results = [];
  for (const step of peers) {
    if (step.status === 'running' && step.child_delegation_task_id) {
      results.push({ step_id: step.id, already: true });
      continue;
    }
    if (step.status === 'pending') {
      db()
        .prepare(
          `UPDATE agent_goal_steps SET status = 'running', started_at = datetime('now') WHERE id = ?`
        )
        .run(step.id);
    }
    try {
      const out = await executeSpecialtyTaskStep(goal, { ...step, status: 'running' });
      results.push({ step_id: step.id, ...out });
    } catch (e) {
      const msg = e?.message || String(e);
      db()
        .prepare(
          `UPDATE agent_goal_steps SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`
        )
        .run(msg.slice(0, 1000), step.id);
      const completion = completeGoalStep({
        goalRunId: goal.id,
        stepId: step.id,
        ownerUserId: goal.owner_user_id,
        result: { error: msg },
        failed: true,
        error: msg,
      });
      if (completion?.recovered) {
        return startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
      }
      return { ok: false, error: msg, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }
  }
  touchGoalRun(goal.id, { status: 'running' });
  return {
    ok: true,
    async: true,
    parallel_group: group,
    started: results,
    goal: getGoalRun(goal.id, goal.owner_user_id),
  };
}

async function executeHumanTaskStep(goal, step) {
  const spec = parseJson(step.spec_json, {});
  const userId = String(spec.user_id || '').trim();
  if (!userId) throw new Error('human_task requires user_id');
  const employee = db().prepare(
    `SELECT id, name, department, role_title, enabled FROM platform_users
     WHERE id = ? AND (id = ? OR owner_user_id = ?)`
  ).get(userId, goal.owner_user_id, goal.owner_user_id);
  if (!employee || !employee.enabled) throw new Error('Assigned human employee is unavailable in this company');
  const existing = step.human_kanban_task_id
    ? db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(step.human_kanban_task_id)
    : null;
  if (existing) return { kanban_task_id: existing.id, assigned_user_id: userId, waiting_for_human: true };
  const prior = priorStepContextForAgent(goal.id, step.step_index);
  const artifacts = priorGoalArtifacts(goal.id, step.step_index);
  const artifactBlock = artifacts.length
    ? artifacts.map((item) => `- [${item.label}](${item.url})${item.mime_type ? ` (${item.mime_type})` : ''}`).join('\n')
    : '';
  const description = [
    `## Original company goal\n${String(goal.prompt || '').trim()}`,
    `## Your assigned outcome\n${String(spec.message || step.label || '').trim()}`,
    prior ? `## Relevant completed outputs from this goal only\n${prior}` : '',
    artifactBlock ? `## Attached goal artifacts\n${artifactBlock}` : '',
    '## How to continue the goal\nOpen this task and choose **Complete task**, **Unable to complete**, or **Ask a question**. A completion outcome resumes the exact goal step automatically.',
    spec.selection_rationale ? `## Why you were selected\n${spec.selection_rationale}` : '',
  ].filter(Boolean).join('\n\n');
  const { resolveKanbanEtaHours, computeDueAt } = await import('./kanban-sla.js');
  const etaHours = resolveKanbanEtaHours(goal.owner_user_id, spec.eta_hours, `${step.label || ''}\n${spec.message || ''}\nrisk:${spec.risk || 'normal'}`);
  const dueAt = computeDueAt(etaHours);
  const info = db().prepare(
    `INSERT INTO kanban_tasks
       (title, description, status, assigned_user_id, created_by, owner_user_id, goal_run_id, goal_step_id, eta_hours, due_at, created_at, updated_at)
     VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(step.label || `Human task for ${employee.name}`, description, userId, goal.agent_id || 'balserve', goal.owner_user_id, goal.id, step.id, etaHours, dueAt);
  const taskId = Number(info.lastInsertRowid);
  db().prepare('UPDATE agent_goal_steps SET human_kanban_task_id = ? WHERE id = ?').run(taskId, step.id);
  const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(taskId);
  notifyKanbanTaskCreated({ userId, task });
  recordMissionEvent({
    ownerUserId: goal.owner_user_id,
    goalRunId: goal.id,
    event_type: 'human_task_assigned',
    payload: { step_id: step.id, kanban_task_id: taskId, assigned_user_id: userId, risk: spec.risk || 'normal' },
  });
  return { kanban_task_id: taskId, assigned_user_id: userId, waiting_for_human: true };
}

export async function respondToHumanGoalTask({ ownerUserId, actorUserId, taskId, action, outcome, authorizedActor = false }) {
  ensureAgentGoalRunTables();
  const task = db().prepare('SELECT * FROM kanban_tasks WHERE id = ? AND owner_user_id = ?').get(taskId, ownerUserId);
  if (!task || !task.goal_run_id || !task.goal_step_id) {
    const err = new Error('Linked human goal task not found'); err.status = 404; throw err;
  }
  if (!authorizedActor && task.assigned_user_id !== actorUserId && ownerUserId !== actorUserId) {
    const err = new Error('Only the assigned employee or company owner may respond'); err.status = 403; throw err;
  }
  const normalized = String(action || '').toLowerCase();
  const text = String(outcome || '').trim();
  if (!['complete', 'unable', 'question'].includes(normalized)) {
    const err = new Error('action must be complete, unable, or question'); err.status = 400; throw err;
  }
  if (!text) { const err = new Error('An outcome, reason, or question is required'); err.status = 400; throw err; }
  db().prepare('INSERT INTO task_messages (task_id, role, content) VALUES (?, ?, ?)').run(task.id, actorUserId, text);
  if (normalized === 'question') {
    db().prepare("UPDATE kanban_tasks SET status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?").run(task.id);
    sendPlatformNotifications({ userIds: [ownerUserId], title: `Question on: ${task.title}`, body: text, linkUrl: `/kanban?task=${task.id}`, createdBy: actorUserId, source: 'human_goal_question', sourceKey: String(task.id) });
    return { ok: true, waiting_for_answer: true, task_id: task.id };
  }
  const goal = loadGoalRunRow(task.goal_run_id, ownerUserId);
  const step = loadGoalSteps(task.goal_run_id).find((s) => s.id === task.goal_step_id);
  const ownerOverride = actorUserId === ownerUserId && actorUserId !== task.assigned_user_id;
  const validation = ownerOverride
    ? { accepted: true, reason: 'Company owner explicitly accepted this disposition.', overridden_by_owner: true }
    : await validateHumanOutcome({ ownerUserId, goal, step, action: normalized, outcome: text });
  if (!validation.accepted) {
    const note = validation.reason || 'The response does not yet demonstrate the assigned outcome or a concrete blocker.';
    db().prepare("INSERT INTO task_messages (task_id, role, content) VALUES (?, 'system', ?)").run(task.id, `COO validation: ${note}`);
    db().prepare("UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(task.id);
    sendPlatformNotifications({ userIds: [task.assigned_user_id], title: `More evidence needed: ${task.title}`, body: note, linkUrl: `/kanban?task=${task.id}`, createdBy: goal?.agent_id || 'system', source: 'human_goal_validation', sourceKey: String(task.id) });
    return { ok: false, validation_failed: true, reason: note, task_id: task.id };
  }
  const failed = normalized === 'unable';
  if (ownerOverride) {
    const disposition = failed ? 'failed' : 'completed';
    db().prepare("INSERT INTO task_messages (task_id, role, content) VALUES (?, 'system', ?)")
      .run(task.id, `CEO override: task marked ${disposition}. Automated evidence validation was bypassed and this decision was audited.`);
    db().prepare("UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(disposition, task.id);
    clearKanbanTaskNotification(task.id, task.assigned_user_id);
    clearKanbanTaskNotification(task.id, actorUserId);
    recordMissionEvent({
      ownerUserId,
      goalRunId: task.goal_run_id,
      event_type: 'human_task_owner_override',
      payload: {
        step_id: task.goal_step_id,
        kanban_task_id: task.id,
        assigned_user_id: task.assigned_user_id,
        actor_user_id: actorUserId,
        disposition,
        outcome: text.slice(0, 1000),
      },
    });
    const completion = completeGoalStep({
      goalRunId: task.goal_run_id,
      stepId: task.goal_step_id,
      ownerUserId,
      result: {
        ok: !failed,
        human_outcome: text,
        assigned_user_id: task.assigned_user_id,
        kanban_task_id: task.id,
        owner_override: true,
      },
      failed,
      error: failed ? text : null,
      skipRecovery: true,
    });
    if (!failed && !completion.done) await startGoalRunExecution(task.goal_run_id, { ownerUserId });
    return {
      ok: !failed,
      owner_override: true,
      task_id: task.id,
      completion,
      validation,
      goal: getGoalRun(task.goal_run_id, ownerUserId),
    };
  }
  if (failed) {
    const reassignment = selectHumanTaskReassignment({ ownerUserId, task, step, outcome: text });
    if (reassignment?.kind === 'human') {
      const spec = { ...parseJson(step.spec_json, {}), user_id: reassignment.id, reassigned_from_user_id: task.assigned_user_id, reassignment_reason: text };
      db().prepare("UPDATE agent_goal_steps SET spec_json = ? WHERE id = ?").run(JSON.stringify(spec), step.id);
      db().prepare("UPDATE kanban_tasks SET assigned_user_id = ?, status = 'in_progress', sla_nudged_at = NULL, sla_escalated_at = NULL, updated_at = datetime('now') WHERE id = ?").run(reassignment.id, task.id);
      notifyKanbanTaskCreated({ userId: reassignment.id, task: { ...task, assigned_user_id: reassignment.id } });
      return { ok: true, blocked: true, reassigned: true, reassignment, task_id: task.id, validation };
    }
    if (reassignment?.kind === 'agent') {
      const spec = { agent_id: reassignment.id, message: parseJson(step.spec_json, {}).message || step.label, phase: 'reassigned_human_blocker', resolution_evidence: text, selection_rationale: reassignment.reason };
      db().prepare("UPDATE agent_goal_steps SET step_type = 'specialty_task', spec_json = ?, status = 'pending', started_at = NULL, human_kanban_task_id = NULL WHERE id = ?").run(JSON.stringify(spec), step.id);
      db().prepare("UPDATE kanban_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(task.id);
      await startGoalRunExecution(task.goal_run_id, { ownerUserId });
      return { ok: true, blocked: true, reassigned: true, reassignment, task_id: task.id, validation };
    }
    // No safe alternative matched: pause for CEO resolution, never silently fail.
    db().prepare("UPDATE kanban_tasks SET status = 'awaiting_confirmation', updated_at = datetime('now') WHERE id = ?").run(task.id);
    sendPlatformNotifications({ userIds: [ownerUserId], title: `Reassignment decision: ${task.title}`, body: `${text}\n\nCOO validation: ${validation.reason || 'valid blocker'}`, linkUrl: `/kanban?task=${task.id}`, createdBy: goal?.agent_id || 'system', source: 'human_goal_blocker', sourceKey: String(task.id) });
    return { ok: true, blocked: true, awaiting_reassignment: true, task_id: task.id, validation };
  }
  db().prepare("UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(failed ? 'failed' : 'completed', task.id);
  clearKanbanTaskNotification(task.id, actorUserId);
  const completion = completeGoalStep({
    goalRunId: task.goal_run_id,
    stepId: task.goal_step_id,
    ownerUserId,
    result: { ok: !failed, human_outcome: text, assigned_user_id: task.assigned_user_id, kanban_task_id: task.id },
    failed,
    error: failed ? text : null,
    skipRecovery: true,
  });
  if (!failed && !completion.done) await startGoalRunExecution(task.goal_run_id, { ownerUserId });
  return { ok: !failed, task_id: task.id, completion, goal: getGoalRun(task.goal_run_id, ownerUserId) };
}

function selectHumanTaskReassignment({ ownerUserId, task, step, outcome }) {
  const spec = parseJson(step?.spec_json, {});
  const highRisk = String(spec.risk || '').toLowerCase() === 'high';
  const words = new Set(`${step?.label || ''} ${spec.message || ''} ${outcome || ''}`.toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const score = (row) => (`${row.department || ''} ${row.specialty || ''} ${row.purpose || ''} ${row.role || ''}`.toLowerCase().match(/[a-z0-9]{4,}/g) || []).reduce((n, w) => n + (words.has(w) ? 1 : 0), 0);
  const humans = db().prepare("SELECT id,name,department,specialty,purpose FROM platform_users WHERE owner_user_id = ? AND role='org_user' AND enabled=1 AND id <> ?").all(ownerUserId, task.assigned_user_id).map((r) => ({ ...r, kind: 'human', match: score(r) })).filter((r) => r.match > 0);
  const agents = highRisk ? [] : db().prepare("SELECT a.id,a.name,a.department,a.role FROM user_agents ua JOIN agents a ON a.id=ua.agent_id WHERE ua.user_id=? AND ua.enabled=1 AND COALESCE(a.is_coo,0)=0").all(ownerUserId).map((r) => ({ ...r, kind: 'agent', match: score(r) })).filter((r) => r.match > 0);
  const hit = [...humans, ...agents].sort((a, b) => b.match - a.match)[0];
  return hit ? { id: hit.id, name: hit.name, kind: hit.kind, reason: `Matched ${hit.match} goal/blocker terms; ${highRisk ? 'high-risk policy kept reassignment human-only' : 'eligible company roster'}.` } : null;
}

async function validateHumanOutcome({ ownerUserId, goal, step, action, outcome }) {
  const spec = parseJson(step?.spec_json, {});
  const minimum = String(outcome || '').trim();
  if (minimum.length < 12) return { accepted: false, reason: 'Add a concrete result, evidence, or blocker (not only “done” or “unable”).' };
  try {
    const { content } = await platformChatCompletions({
      ownerUserId,
      purpose: 'human_task_outcome_validation',
      messages: [{ role: 'system', content: 'Validate a human work response against the actual work requested by the original goal and assigned outcome. Return strict JSON only: {"accepted":boolean,"reason":"short factual reason"}. The responder is already the assigned employee: never require evidence that the task was assigned, routed, or delegated to them. If an assigned-outcome note merely describes assigning/routing the work, assess the response against the original goal itself. Accept a completion only if it contains a plausible concrete result/evidence. Accept an unable response only if it states a specific blocker. Do not judge writing style and do not invent facts.' }, { role: 'user', content: `ORIGINAL GOAL:\n${goal?.prompt || ''}\n\nASSIGNED OUTCOME:\n${spec.message || step?.label || ''}\n\nACTION: ${action}\nRESPONSE:\n${minimum}` }],
    });
    const parsed = parseJson(content, null);
    if (parsed && typeof parsed.accepted === 'boolean') return { accepted: parsed.accepted, reason: String(parsed.reason || '').slice(0, 500) };
  } catch (e) { console.warn('[goal-run] human outcome validation unavailable', e?.message || e); }
  // Deterministic fallback keeps company execution available if the utility model is
  // down, while still rejecting acknowledgement-only responses.
  const statusOnly = /^(done|completed|complete|finished|unable|cannot complete|not able)([.! ]*)$/i.test(minimum);
  const concrete = minimum.length >= 30 && !statusOnly;
  return action === 'unable'
    ? { accepted: concrete, reason: concrete ? 'Specific blocker recorded for reassignment review.' : 'Explain the blocker and what was attempted.' }
    : { accepted: concrete, reason: concrete ? 'Concrete outcome recorded (deterministic validation fallback).' : 'Add a concrete result, evidence, date, identifier, or decision.' };
}

export async function startGoalRunExecution(goalRunId, opts = {}) {
  ensureAgentGoalRunTables();
  const ownerUserId = opts.ownerUserId || null;
  const goal = loadGoalRunRow(goalRunId, ownerUserId);
  if (!goal) {
    const err = new Error('Goal run not found');
    err.status = 404;
    throw err;
  }
  if (goal.status === 'completed' || goal.status === 'failed' || goal.status === 'cancelled') {
    return { ok: true, skipped: true, reason: 'terminal', goal: serializeGoalRun(goal) };
  }

  const steps = loadGoalSteps(goalRunId);

  const runningSpecialty = steps.filter(
    (s) => s.step_type === 'specialty_task' && s.status === 'running'
  );
  if (runningSpecialty.length) {
    const g0 = parallelGroupOf(runningSpecialty[0]);
    if (g0 != null) {
      const groupPeers = steps.filter(
        (s) => s.step_type === 'specialty_task' && parallelGroupOf(s) === g0
      );
      const anyPending = groupPeers.some((s) => s.status === 'pending');
      const anyRunning = groupPeers.some((s) => s.status === 'running');
      if (anyPending) {
        return await startParallelSpecialtyGroup(goal, steps, g0);
      }
      if (anyRunning) {
        return {
          ok: true,
          async: true,
          waiting_parallel: true,
          parallel_group: g0,
          goal: getGoalRun(goal.id, goal.owner_user_id),
        };
      }
    } else {
      return {
        ok: true,
        async: true,
        waiting: true,
        step_id: runningSpecialty[0].id,
        goal: getGoalRun(goal.id, goal.owner_user_id),
      };
    }
  }

  // Running agent_continue is backgrounded (OpenClaw chat can hang); do not re-enter.
  const runningContinue = steps.find(
    (s) => s.step_type === 'agent_continue' && s.status === 'running'
  );
  if (runningContinue) {
    return {
      ok: true,
      async: true,
      waiting: true,
      step_id: runningContinue.id,
      goal: getGoalRun(goal.id, goal.owner_user_id),
    };
  }

  const runningHuman = steps.find((s) => s.step_type === 'human_task' && s.status === 'running');
  if (runningHuman) {
    return { ok: true, async: true, waiting_for_human: true, step_id: runningHuman.id, kanban_task_id: runningHuman.human_kanban_task_id, goal: getGoalRun(goal.id, goal.owner_user_id) };
  }

  // Running workflow steps without a bound child run cannot advance on terminal; re-fire them.
  const runningWfBound = steps.find(
    (s) =>
      s.step_type === 'workflow_trigger' &&
      s.status === 'running' &&
      s.child_workflow_run_id
  );
  if (runningWfBound) {
    return {
      ok: true,
      async: true,
      waiting: true,
      step_id: runningWfBound.id,
      goal: getGoalRun(goal.id, goal.owner_user_id),
    };
  }
  const orphanRunningWf = steps.find(
    (s) =>
      s.step_type === 'workflow_trigger' &&
      s.status === 'running' &&
      !s.child_workflow_run_id
  );
  if (orphanRunningWf) {
    console.warn('[goal-run] re-firing orphan running workflow step (no child_workflow_run_id)', {
      goalRunId,
      stepId: orphanRunningWf.id,
    });
    db()
      .prepare(
        `UPDATE agent_goal_steps SET status = 'pending', started_at = NULL, error_message = NULL WHERE id = ?`
      )
      .run(orphanRunningWf.id);
  }

  let step = loadGoalSteps(goalRunId).find((s) => s.status === 'pending');
  if (!step) {
    completeGoalRun(goalRunId, { status: 'completed' });
    return { ok: true, done: true, goal: getGoalRun(goal.id, goal.owner_user_id) };
  }

  if (step.step_type === 'specialty_task') {
    const g = parallelGroupOf(step);
    if (g != null) {
      return await startParallelSpecialtyGroup(goal, steps, g);
    }
  }

  // Workflow steps stay pending until executeWorkflowStep / bindWorkflowRunToGoalStep
  // (sets running + child_workflow_run_id). Other step types mark running here.
  if (step.status === 'pending' && step.step_type !== 'workflow_trigger') {
    db()
      .prepare(
        `UPDATE agent_goal_steps SET status = 'running', started_at = datetime('now') WHERE id = ?`
      )
      .run(step.id);
    touchGoalRun(goalRunId, { status: 'running', current_step_index: step.step_index });
  }

  try {
    assertRuntimeStepInputs(goal.id, step);
    if (step.step_type === 'workflow_trigger') {
      const out = await executeWorkflowStep(goal, step);
      return { ok: true, async: true, step_id: step.id, ...out, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }

    if (step.step_type === 'specialty_task') {
      const out = await executeSpecialtyTaskStep(goal, step);
      return { ok: true, async: true, step_id: step.id, ...out, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }

    if (step.step_type === 'human_task') {
      const out = await executeHumanTaskStep(goal, step);
      return { ok: true, async: true, step_id: step.id, ...out, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }

    if (step.step_type === 'notify_ceo') {
      if (promptForbidsNotifyCeo(goal.prompt)) {
        console.info('[goal-run] skipping notify_ceo (prompt forbids)', { goalRunId: goal.id, stepId: step.id });
        await completeGoalStep({
          goalRunId: goal.id,
          stepId: step.id,
          ownerUserId: goal.owner_user_id,
          result: { ok: true, skipped: true, reason: 'prompt_forbids_notify_ceo' },
        });
        return startGoalRunExecution(goalRunId, { ownerUserId: goal.owner_user_id });
      }
      const result = await executeNotifyCeoStep(goal, step);
      await completeGoalStep({
        goalRunId: goal.id,
        stepId: step.id,
        ownerUserId: goal.owner_user_id,
        result,
      });
      return startGoalRunExecution(goalRunId, { ownerUserId: goal.owner_user_id });
    }

    if (step.step_type === 'agent_tool') {
      const result = await executeAgentToolStep(goal, step);
      await completeGoalStep({
        goalRunId: goal.id,
        stepId: step.id,
        ownerUserId: goal.owner_user_id,
        result,
      });
      return startGoalRunExecution(goalRunId, { ownerUserId: goal.owner_user_id });
    }

    if (step.step_type === 'agent_continue') {
      // Non-blocking: OpenClaw chat can hang for minutes (or longer if the gateway stalls).
      // Keep step=running and finish via background so scheduled-goals / HTTP callers are not stuck.
      const goalId = goal.id;
      const stepId = step.id;
      const owner = goal.owner_user_id;
      const stepSnap = { ...step };
      const goalSnap = { ...goal };
      activeAgentContinueSteps.add(stepId);
      setImmediate(() => {
        Promise.resolve()
          .then(() => executeAgentContinueStep(goalSnap, stepSnap))
          .then(async (result) => {
            await completeGoalStep({
              goalRunId: goalId,
              stepId,
              ownerUserId: owner,
              result,
            });
            await startGoalRunExecution(goalId, { ownerUserId: owner });
          })
          .catch((e) => {
            const msg = e?.message || String(e);
            console.error('[goal-run] agent_continue background failed', {
              goalRunId: goalId,
              stepId,
              error: msg,
            });
            try {
              const completion = completeGoalStep({
                goalRunId: goalId,
                stepId,
                ownerUserId: owner,
                result: { error: msg },
                failed: true,
                error: msg,
              });
              if (completion?.recovered) {
                void startGoalRunExecution(goalId, { ownerUserId: owner });
              }
            } catch (failErr) {
              console.warn('[goal-run] agent_continue fail finalize:', failErr?.message || failErr);
            }
          })
          .finally(() => activeAgentContinueSteps.delete(stepId));
      });
      return {
        ok: true,
        async: true,
        waiting: true,
        step_id: step.id,
        goal: getGoalRun(goal.id, goal.owner_user_id),
      };
    }

    throw new Error(`Unknown step type: ${step.step_type}`);
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[goal-run] step failed', { goalRunId, stepId: step.id, error: msg });
    if (e?.needsApproval || e?.details?.needs_approval === true) {
      const spec = parseJson(step.spec_json, {});
      const { createGoalActionApproval } = await import('./goal-action-approval.js');
      const approval = createGoalActionApproval({
        ownerUserId: goal.owner_user_id,
        goal,
        step,
        toolName: String(spec.tool_name || ''),
        actionFamily: e?.details?.action_family || 'communicate_external',
        args: e?.actionArgs || spec.args || {},
        error: msg,
      });
      db().prepare("UPDATE agent_goal_steps SET status='awaiting_approval',error_message=? WHERE id=?")
        .run(msg.slice(0, 1000), step.id);
      touchGoalRun(goalRunId, { status: 'awaiting_approval', current_step_index: step.step_index, error_message: null });
      recordMissionEvent({ ownerUserId: goal.owner_user_id, goalRunId, event_type: 'awaiting_approval', payload: {
        step_id: step.id, tool_name: spec.tool_name || null, kanban_task_id: approval.kanban_task_id,
      } });
      return { ok: true, waiting: true, needs_approval: true, kanban_task_id: approval.kanban_task_id,
        goal: getGoalRun(goal.id, goal.owner_user_id) };
    }
    const completion = completeGoalStep({
      goalRunId,
      stepId: step.id,
      ownerUserId: goal.owner_user_id,
      result: { error: msg },
      failed: true,
      error: msg,
    });
    if (completion?.recovered) {
      return startGoalRunExecution(goalRunId, { ownerUserId: goal.owner_user_id });
    }
    return { ok: false, error: msg, goal: getGoalRun(goal.id, goal.owner_user_id) };
  }
}

export async function onWorkflowTerminalForGoalRun(workflowRunId) {
  const id = Number(workflowRunId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'run_id required' };

  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run || !TERMINAL_WF.has(String(run.status || ''))) {
    return { ok: false, skipped: true, reason: 'not_terminal' };
  }

  const found = findGoalStepByWorkflowRun(id);
  if (!found) return { ok: false, skipped: true, reason: 'no_goal_step' };

  const { goal, step } = found;
  if (step.status === 'completed' || step.status === 'failed') {
    return { ok: true, skipped: true, reason: 'step_already_terminal', goal_run_id: goal.id };
  }

  const failed = run.status !== 'completed';
  const wfSummary = workflowRunSummary(id);
  const result = {
    workflow_run_id: id,
    status: run.status,
    summary: wfSummary.summary,
    error_message: run.error_message,
  };

  const completion = await completeGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    ownerUserId: goal.owner_user_id,
    result,
    failed,
    error: failed ? run.error_message || run.status : null,
  });
  if (completion?.recovered) {
    return startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
  }

  if (!failed) {
    try {
      return await startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
    } catch (e) {
      return { ok: false, error: e?.message || String(e), goal_run_id: goal.id };
    }
  }

  return { ok: false, failed: true, goal_run_id: goal.id, workflow_run_id: id };
}

export async function createAndStartGoalRun(opts = {}) {
  let steps = opts.steps;
  if (!Array.isArray(steps) || !steps.length) {
    steps = await planGoalStepsAsync(opts.prompt || '', {
      ownerUserId: opts.ownerUserId,
      explicitSteps: opts.explicitSteps,
      orchestratorAgentId: opts.orchestratorAgentId || opts.agentId || null,
    });
  }
  const goal = createGoalRun({ ...opts, steps });
  const exec = await withLlmopsContext(
    {
      ownerUserId: goal.owner_user_id,
      memberKey: goal.agent_id,
      agentId: goal.agent_id,
      source: 'goal_planner',
      runId: goal.id,
      traceId: goal.id,
      goalRunId: goal.id,
    },
    () => startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id })
  );
  return {
    async: true,
    goal_run_id: goal.id,
    goal: getGoalRun(goal.id, goal.owner_user_id) || goal,
    execution: exec,
  };
}

export async function createGoalRunWithPlan(opts = {}) {
  let steps = opts.steps;
  if (!Array.isArray(steps) || !steps.length) {
    steps = await planGoalStepsAsync(opts.prompt || '', {
      ownerUserId: opts.ownerUserId,
      explicitSteps: opts.explicitSteps,
      feedback: opts.feedback,
      orchestratorAgentId: opts.orchestratorAgentId || opts.agentId || null,
    });
  }
  return createGoalRun({ ...opts, steps });
}


