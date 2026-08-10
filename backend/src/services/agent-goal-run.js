/**
 * Generic multi-intent goal runs: plan steps, execute, advance on async child terminal.
 * Not CRM/ERP-specific - workflow_trigger / agent_continue / notify steps work for any owner/agent.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { sendPlatformNotifications } from './platform-notifications.js';
import * as openclaw from '../gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getPromptWithMemoryInjected } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';
import { triggerAgentWorkflowForOwner } from './agent-workflow-chat-tools.js';
import { registerWorkflowRunWatch } from './agent-workflow-run-watch.js';

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
  _tablesReady = true;
}

export function normalizeStepSpec(raw) {
  if (!raw || typeof raw !== 'object') {
    return { type: 'agent_continue', label: 'Continue with agent', spec: {} };
  }
  const type = String(raw.type || raw.step_type || 'workflow_trigger').toLowerCase();
  if (type === 'workflow_trigger' || type === 'workflow') {
    const phrase = String(raw.phrase || raw.message || raw.workflow_phrase || '').trim();
    return {
      type: 'workflow_trigger',
      label: String(raw.label || phrase || 'Run workflow').trim(),
      spec: {
        phrase: phrase || 'run workflow',
        phase: raw.phase || raw.workflow_phase || 'generic',
        workflow_id: raw.workflow_id || null,
      },
    };
  }
  if (type === 'notify_ceo' || type === 'notify') {
    return {
      type: 'notify_ceo',
      label: String(raw.label || 'Notify CEO').trim(),
      spec: {
        title: raw.title != null ? String(raw.title) : null,
        body: raw.body != null ? String(raw.body) : null,
      },
    };
  }
  return {
    type: 'agent_continue',
    label: String(raw.label || 'Agent continue').trim(),
    spec: {
      message: raw.message || raw.prompt || null,
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
      result: parseJson(s.result_json, null),
      error_message: s.error_message,
      started_at: s.started_at,
      completed_at: s.completed_at,
    })),
  };
}

export function getGoalRun(goalRunId, ownerUserId) {
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
  { limit = 30, status = null, scheduledGoalId = null } = {}
) {
  ensureAgentGoalRunTables();
  const lim = Math.min(Math.max(Number(limit) || 30, 1), 200);
  const owner = String(ownerUserId || "").trim();
  const st = status ? String(status) : null;
  const sg = scheduledGoalId ? String(scheduledGoalId).trim() : null;

  let rows;
  if (sg && st) {
    rows = db()
      .prepare(
        `SELECT * FROM agent_goal_runs
         WHERE owner_user_id = ? AND scheduled_goal_id = ? AND status = ?
         ORDER BY datetime(created_at) DESC LIMIT ?`
      )
      .all(owner, sg, st, lim);
  } else if (sg) {
    rows = db()
      .prepare(
        `SELECT * FROM agent_goal_runs
         WHERE owner_user_id = ? AND scheduled_goal_id = ?
         ORDER BY datetime(created_at) DESC LIMIT ?`
      )
      .all(owner, sg, lim);
  } else if (st) {
    rows = db()
      .prepare(
        `SELECT * FROM agent_goal_runs WHERE owner_user_id = ? AND status = ?
         ORDER BY datetime(created_at) DESC LIMIT ?`
      )
      .all(owner, st, lim);
  } else {
    rows = db()
      .prepare(
        `SELECT * FROM agent_goal_runs WHERE owner_user_id = ?
         ORDER BY datetime(created_at) DESC LIMIT ?`
      )
      .all(owner, lim);
  }
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
    actorName: null,
    notifyOnWaiting: true,
    notifyOnTerminal: true,
    wakeOrchestratorOnTerminal: false,
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
    { injectLearningsInstruction: true, injectKanbanInstruction: true }
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
    linkUrl: '/agents',
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
  return getGoalRun(goalRunId);
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
  let step = steps.find((s) => s.status === 'running');
  if (!step) step = steps.find((s) => s.status === 'pending');
  if (!step) {
    completeGoalRun(goalRunId, { status: 'completed' });
    return { ok: true, done: true, goal: getGoalRun(goal.id, goal.owner_user_id) };
  }

  if (step.status === 'pending') {
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

    if (step.step_type === 'agent_continue') {
      const result = await executeAgentContinueStep(goal, step);
      await completeGoalStep({
        goalRunId: goal.id,
        stepId: step.id,
        ownerUserId: goal.owner_user_id,
        result,
      });
      return startGoalRunExecution(goalRunId, { ownerUserId: goal.owner_user_id });
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
  const goal = createGoalRun(opts);
  const exec = await startGoalRunExecution(goal.id, { ownerUserId: goal.owner_user_id });
  return { goal, execution: exec };
}


