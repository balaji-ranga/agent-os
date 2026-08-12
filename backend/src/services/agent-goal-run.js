/**
 * Generic multi-intent goal runs: plan steps, execute, advance on async child terminal.
 * Not CRM/ERP-specific - workflow_trigger / agent_continue / notify steps work for any owner/agent.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { sendPlatformNotifications } from './platform-notifications.js';
import { isPlatformCronActive } from './platform-cron-registry.js';
import * as openclaw from '../gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getPromptWithMemoryInjected } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';
import { triggerAgentWorkflowForOwner } from './agent-workflow-chat-tools.js';
import { registerWorkflowRunWatch } from './agent-workflow-run-watch.js';
import {
  stripWorkflowPhrasesFromPrompt,
  classifySpecialtyIntentsForPlan,
  specialtyIntentsToSteps,
  GOAL_PLAN_MAX_SPECIALTY,
} from './goal-plan-specialty.js';
import {
  classifyGoalPlanIntents,
  matchWorkflowStepsFromCatalog,
  resolveCeoEmail,
} from './goal-plan-intent.js';
import { invokeContentToolHttp } from './content-tool-http-invoke.js';
import { listPublishedWorkflows } from './agent-workflow-chat-tools.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import { scheduleCeoRequestViaOpenClawCron } from './delegation-queue.js';
import { resolveAgentToolArgsForGoal } from './goal-plan-tool-args.js';

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
  const cols = db().prepare('PRAGMA table_info(agent_goal_steps)').all().map((c) => c.name);
  if (!cols.includes('child_delegation_task_id')) {
    db().exec('ALTER TABLE agent_goal_steps ADD COLUMN child_delegation_task_id INTEGER');
  }
  try {
    db().exec('CREATE INDEX IF NOT EXISTS idx_agent_goal_steps_del ON agent_goal_steps(child_delegation_task_id)');
  } catch (_) {}
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
        phrase: phrase || "run workflow",
        phase: raw.phase || raw.workflow_phase || nested.phase || "generic",
        workflow_id: raw.workflow_id || nested.workflow_id || null,
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
      spec: { title, body },
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
        tool_name: toolName || null,
        args,
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
        agent_id: agentId,
        message: message || null,
        parallel_group: Number.isFinite(pg) ? pg : null,
        phase: raw.phase || nested.phase || "specialty",
      },
    };
  }
  return {
    type: "agent_continue",
    label: String(raw.label || "Agent continue").trim(),
    spec: {
      message: raw.message || raw.prompt || nested.message || nested.prompt || null,
    },
  };
}

export function planGoalStepsFromText(prompt, { explicitSteps } = {}) {
  if (Array.isArray(explicitSteps) && explicitSteps.length) {
    const steps = explicitSteps.map(normalizeStepSpec);
    if (steps.length >= 1 && !steps.some((s) => s.type === 'notify_ceo')) {
      steps.push(normalizeStepSpec({ type: 'notify_ceo' }));
    }
    return steps;
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

  if (steps.length >= 1 && !steps.some((s) => s.type === 'notify_ceo')) {
    steps.push(normalizeStepSpec({ type: 'notify_ceo' }));
  }

  return steps;
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
  const { explicitSteps, ownerUserId = null, maxSpecialty = GOAL_PLAN_MAX_SPECIALTY, feedback = null } = opts;
  if (Array.isArray(explicitSteps) && explicitSteps.length) {
    return planGoalStepsFromText(prompt, { explicitSteps });
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
        const steps = classified.map(normalizeStepSpec);
        console.info('[goal-run] plan via intent classifier', {
          steps: steps.map((x) => x.type + ':' + (x.label || '')).slice(0, 12),
        });
        return steps;
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

  const residual = stripWorkflowPhrasesFromPrompt(fullPrompt, ownerUserId).replace(/\s{2,}/g, ' ').trim();
  if (ownerUserId && residual.length >= 8) {
    try {
      const specialtyRaw = await classifySpecialtyIntentsForPlan(ownerUserId, residual, { maxSpecialty });
      const specialtySteps = specialtyIntentsToSteps(specialtyRaw, {
        parallel: specialtyRaw.length > 1,
      }).map(normalizeStepSpec);
      if (specialtySteps.length > 1) {
        const g = 1;
        steps.push(
          ...specialtySteps.map((st) =>
            normalizeStepSpec({
              type: 'specialty_task',
              agent_id: st.spec?.agent_id,
              message: st.spec?.message,
              parallel_group: g,
              label: st.label,
            })
          )
        );
      } else if (specialtySteps.length) {
        steps.push(...specialtySteps);
      }
    } catch (e) {
      console.warn('[goal-run] specialty fallback failed', e?.message || e);
    }
  }

  if (!steps.length) {
    steps.push(normalizeStepSpec({ type: 'agent_continue' }));
  }
  return steps;
}

/** Whether a planned step list warrants durable goal_run_plan mode. */
export function planUsesGoalRunMode(planned) {
  const steps = Array.isArray(planned) ? planned : [];
  if (steps.some((s) => (s.type || s.step_type) === 'workflow_trigger')) return true;
  if (steps.some((s) => (s.type || s.step_type) === 'specialty_task')) return true;
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
    })),
  };
}

export function getGoalRun(goalRunId, ownerUserId = null) {
  const row = loadGoalRunRow(goalRunId, ownerUserId);
  if (!row) return null;
  return serializeGoalRun(row);
}

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

  const planned = Array.isArray(steps) && steps.length
    ? steps.map(normalizeStepSpec)
    : planGoalStepsFromText(prompt, {});

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

  const ins = db().prepare(
    `INSERT INTO agent_goal_steps
     (id, goal_run_id, step_index, step_type, label, spec_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  );
  planned.forEach((step, idx) => {
    const stepId = `ags-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    ins.run(stepId, id, idx, step.type, step.label || step.type, JSON.stringify(step.spec || {}));
  });

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
      // Include multi-symbol / tool payload so agent_continue can synthesize like chat.
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
    } else {
      lines.push(`- ${label}: completed`);
    }
    if (spec.phrase) lines[lines.length - 1] = `- [${spec.phrase}] ${lines[lines.length - 1].slice(2)}`;
  }
  return lines.join('\n');
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

  let openclawId = agent.openclaw_agent_id || agent.id;
  try {
    openclawId = ensureTenantOpenClawAgent(agent, goal.owner_user_id).openclawAgentId;
  } catch (e) {
    console.warn('[goal-run] tenant ensure failed', agent.id, e?.message || e);
  }

  const prior = priorStepSummaries(goal.id, step.step_index);
  let prompt =
    spec.message ||
    [
      '[Goal run - agent continue]',
      `[goal_run_id: ${goal.id}]`,
      '',
      `CEO goal:\n${goal.prompt}`,
      prior ? `\nPrior steps:\n${prior}` : '',
      '',
      'Continue executing this goal with your tools. Work autonomously; summarize outcomes when done.',
    ].join('\n');

  try {
    prompt = await getPromptWithMemoryInjected(agent.id, prompt);
  } catch (_) {
    /* optional */
  }
  prompt = `[ceo_user_id: ${goal.owner_user_id}]\n[owner_user_id: ${goal.owner_user_id}]\n${prompt}`;

  const sessionUser = openclaw.sessionUserFor(
    openclawId,
    goal.owner_user_id,
    `goal-${String(goal.id).slice(4, 16)}`
  );

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

  const { content } = await openclaw.chatCompletions(
    openclawId,
    [{ role: 'user', content: prompt }],
    sessionUser,
    false,
    {
      injectLearningsInstruction: true,
      injectKanbanInstruction: true,
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
  } catch (_) {
    /* ignore */
  }
  return { ok: true, reply_preview: reply.slice(0, 2000) };
}

async function executeAgentToolStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const toolName = String(spec.tool_name || '').trim();
  if (!toolName) throw new Error('agent_tool requires tool_name');

  if (toolName === 'notify_ceo') {
    return executeNotifyCeoStep(goal, step);
  }

  const prior = priorStepSummaries(goal.id, step.step_index);
  let args =
    spec.args && typeof spec.args === 'object' && !Array.isArray(spec.args) ? { ...spec.args } : {};

  if (toolName === 'email_send') {
    if (!args.to && !args.cc && !args.bcc) {
      const ceoEmail = resolveCeoEmail(goal.owner_user_id);
      if (ceoEmail) args.to = ceoEmail;
    }
    if (!args.subject) {
      args.subject = clip(goal.title || 'Goal plan complete', 120);
    }
    if (!args.body && !args.text && !args.html) {
      args.body = [
        goal.title ? 'Goal: ' + goal.title : '',
        'goal_run_id: ' + goal.id,
        clip(goal.prompt, 600),
        prior ? '\nCompleted steps:\n' + prior : '',
      ]
        .filter(Boolean)
        .join('\n');
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

  args.ceo_user_id = args.ceo_user_id || goal.owner_user_id;
  args.owner_user_id = args.owner_user_id || goal.owner_user_id;
  const caller = resolveAgentForGoal(goal.owner_user_id, goal.agent_id);
  const invokeOpts = {
    agentId: caller?.id || goal.agent_id || null,
    openclawAgentId: caller?.openclaw_agent_id || caller?.id || goal.agent_id || null,
  };

  // Single-symbol tools + multi-ticker goals (MAG7, lists): invoke per symbol and aggregate.
  if (Array.isArray(multiSymbols) && multiSymbols.length > 1) {
    const results = [];
    const errors = [];
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
    };
  }

  const out = await invokeContentToolHttp(toolName, args, goal.owner_user_id, invokeOpts);
  return { ok: true, tool_name: toolName, result: out };
}

async function executeNotifyCeoStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const prior = priorStepSummaries(goal.id, step.step_index + 1);
  const title = spec.title || clip(goal.title || 'Goal run complete', 120);
  const body =
    spec.body ||
    [
      goal.title ? `Goal: ${goal.title}` : '',
      clip(goal.prompt, 800),
      prior ? `\nSteps completed:\n${prior}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  sendPlatformNotifications({
    userIds: [goal.owner_user_id],
    title,
    body: clip(body, 4000),
    linkUrl: `/goal-plans?highlight=${encodeURIComponent(goal.id)}`,
    createdBy: String(goal.agent_id || 'goal-run').slice(0, 64),
    source: 'agent_goal_run',
    sourceKey: `goal-run:${goal.id}:notify`,
  });
  return { ok: true, title, body: clip(body, 500) };
}

export function completeGoalRun(goalRunId, { status = 'completed', error = null } = {}) {
  touchGoalRun(goalRunId, {
    status,
    error_message: error ? String(error).slice(0, 1000) : null,
    completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null,
  });
  console.info('[goal-run] finished', { goalRunId, status });
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
  const agentId = goal?.agent_id || row.agent_id || 'balserve';
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
  const fallback =
    terminal === 'failed'
      ? `## Goal plan failed: \`${id}\`\n\n**${title}** reached a failed status.\n\n` +
        (goal.error_message ? `Error: ${clip(goal.error_message, 400)}\n\n` : '') +
        `### Step ladder\n${ladder || '(no steps)'}\n\n` +
        `Progress: ${progress.completed_steps || 0}/${progress.total_steps || 0} completed.`
      : `## Goal plan completed: \`${id}\`\n\n**${title}** finished all planned steps.\n\n` +
        `### Step ladder\n${ladder || '(no steps)'}\n\n` +
        `Progress: ${progress.completed_steps || 0}/${progress.total_steps || 0} · ${progress.progress_pct || 100}%.\n\n` +
        `Open **Goal plans** or the GOAL PLAN panel on this message for live detail.`;

  let reply = fallback;
  let via = 'fallback';

  try {
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
      `- Summarize every step outcome from the ladder below (completed/failed).\n` +
      `- Do not create a new plan, re-trigger workflows, or call tools unless agent_goal_status is required.\n` +
      `- Do not ask the CEO to re-request status — this IS the status post.\n` +
      `- Keep it short, professional, factual.\n\n` +
      `### Ladder\n${ladder || '(none)'}\n\n` +
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
        `${id} · ${terminal}\n${ladder || ''}\n\nOpen chat with your COO or Goal plans for full detail.`.slice(
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

  console.info('[goal-run] completion nudge posted', { goalRunId: id, via, terminal });
  return { ok: true, via, goal_run_id: id, terminal };
}


export function completeGoalStep({ goalRunId, stepId, ownerUserId, result = null, failed = false, error = null }) {
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

  const status = failed ? 'failed' : 'completed';
  db()
    .prepare(
      `UPDATE agent_goal_steps SET status = ?, result_json = ?, error_message = ?, completed_at = datetime('now')
       WHERE id = ?`
    )
    .run(status, result != null ? JSON.stringify(result) : null, error ? String(error).slice(0, 1000) : null, stepId);

  if (failed) {
    completeGoalRun(goalRunId, { status: 'failed', error: error || 'step failed' });
    return { ok: false, goal: getGoalRun(goalRunId, ownerUserId) };
  }

  const steps = loadGoalSteps(goalRunId);
  const open = steps.find((s) => s.status === 'pending' || s.status === 'running');
  if (!open) {
    completeGoalRun(goalRunId, { status: 'completed' });
    return { ok: true, done: true, goal: getGoalRun(goalRunId, ownerUserId) };
  }

  touchGoalRun(goalRunId, { current_step_index: open.step_index, status: 'running' });
  return { ok: true, done: false, goal: getGoalRun(goalRunId, ownerUserId) };
}


async function executeSpecialtyTaskStep(goal, step) {
  const spec = parseJson(step.spec_json);
  const agentId = String(spec.agent_id || '').trim().toLowerCase();
  if (!agentId) throw new Error('specialty_task requires agent_id');
  const prior = priorStepSummaries(goal.id, step.step_index);
  let message =
    (spec.message && String(spec.message).trim()) ||
    String(goal.prompt || '').trim() ||
    'Complete this specialty task for the CEO goal.';
  if (prior) {
    message =
      message +
      '\n\nPrior completed goal steps:\n' +
      prior +
      '\n\nStay focused on your assigned specialty deliverable.';
  }
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

export async function onDelegationTerminalForGoalRun(taskId) {
  const found = findGoalStepByDelegationTask(taskId);
  if (!found) return { ok: false, skipped: true, reason: 'no_goal_step' };
  const { goal, step } = found;
  if (step.status === 'completed' || step.status === 'failed') {
    return { ok: true, skipped: true, reason: 'step_already_terminal', goal_run_id: goal.id };
  }
  const task = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(Number(taskId));
  const failed = !task || String(task.status || '') === 'failed';
  const result = {
    delegation_task_id: Number(taskId),
    status: task?.status || 'missing',
    reply_preview: clip(task?.response_content || '', 400),
    error_message: task?.error_message || null,
  };
  await completeGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    ownerUserId: goal.owner_user_id,
    result,
    failed,
    error: failed ? task?.error_message || task?.status || 'delegation failed' : null,
  });
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
      completeGoalRun(goal.id, { status: 'failed', error: msg });
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
    if (step.step_type === 'workflow_trigger') {
      const out = await executeWorkflowStep(goal, step);
      return { ok: true, async: true, step_id: step.id, ...out, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }

    if (step.step_type === 'specialty_task') {
      const out = await executeSpecialtyTaskStep(goal, step);
      return { ok: true, async: true, step_id: step.id, ...out, goal: getGoalRun(goal.id, goal.owner_user_id) };
    }

    if (step.step_type === 'notify_ceo') {
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
              db()
                .prepare(
                  `UPDATE agent_goal_steps SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ? AND status = 'running'`
                )
                .run(msg.slice(0, 1000), stepId);
              completeGoalRun(goalId, { status: 'failed', error: msg });
            } catch (failErr) {
              console.warn('[goal-run] agent_continue fail finalize:', failErr?.message || failErr);
            }
          });
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
    db()
      .prepare(
        `UPDATE agent_goal_steps SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`
      )
      .run(msg.slice(0, 1000), step.id);
    completeGoalRun(goalRunId, { status: 'failed', error: msg });
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

  await completeGoalStep({
    goalRunId: goal.id,
    stepId: step.id,
    ownerUserId: goal.owner_user_id,
    result,
    failed,
    error: failed ? run.error_message || run.status : null,
  });

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
    });
  }
  const goal = createGoalRun({ ...opts, steps });
  // First child starts and returns; remaining steps advance on terminal callbacks (async).
  const exec = await startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
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
    });
  }
  return createGoalRun({ ...opts, steps });
}


