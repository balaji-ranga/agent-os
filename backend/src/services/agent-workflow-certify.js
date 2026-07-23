/**
 * Autonomous workflow certify: WorkflowGoal → Maker/Checker loop → CertifyReport.
 * OpenClaw workflowbuilder starts jobs; status/resume are pull-on-request.
 * No Cursor escalation path.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions, getLlmConfig } from '../config/llm.js';
import * as store from './agent-workflow-store.js';
import { validateWorkflowForPublish } from './agent-workflow-builder-catalog.js';
import { diagnoseWorkflowGraph } from './agent-workflow-agent-troubleshoot.js';
import { buildDetailedGraphSummary } from './agent-workflow-agent-describe.js';
import {
  executeUntilSuccess,
  runMeetsSuccessCriteria,
} from './agent-workflow-agent-until-success.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const HARD_MAX_ATTEMPTS = 10;
const JOB_STATUSES = new Set([
  'pending',
  'testing',
  'blocked_on_input',
  'certified',
  'failed',
  'budget_exhausted',
  'cancelled',
]);

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function envFlag(name, defaultOn = false) {
  const v = process.env[name];
  if (v == null || v === '') return defaultOn;
  return !['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function setDefinitionCertifyState(workflowId, ownerUserId, certifyState, actor) {
  if (!workflowId || !ownerUserId) return;
  try {
    getDb()
      .prepare(
        `UPDATE agent_workflow_definitions SET certify_state = ?, updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
      )
      .run(certifyState || null, workflowId, ownerUserId);
    store.appendAudit(workflowId, {
      action: 'certify_state',
      summary: `Certify state → ${certifyState || 'cleared'}`,
      changedBy: actor?.id || null,
      changedByName: actor?.name || null,
      diff: { certify_state: certifyState },
    });
  } catch (_) {}
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    workflow_id: row.workflow_id,
    status: row.status,
    goal: parseJson(row.goal_json, {}),
    report: parseJson(row.report_json, null),
    attempt: row.attempt || 0,
    max_attempts: row.max_attempts || DEFAULT_MAX_ATTEMPTS,
    last_error: row.last_error || null,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

export function getCertifyJob(jobId, ownerUserId = null) {
  if (!jobId) return null;
  const row = ownerUserId
    ? getDb()
        .prepare(`SELECT * FROM agent_workflow_certify_jobs WHERE id = ? AND owner_user_id = ?`)
        .get(jobId, ownerUserId)
    : getDb().prepare(`SELECT * FROM agent_workflow_certify_jobs WHERE id = ?`).get(jobId);
  return rowToJob(row);
}

export function listCertifyJobs(ownerUserId, { workflowId = null, limit = 20 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  if (workflowId) {
    return getDb()
      .prepare(
        `SELECT * FROM agent_workflow_certify_jobs
         WHERE owner_user_id = ? AND workflow_id = ?
         ORDER BY updated_at DESC LIMIT ?`
      )
      .all(ownerUserId, workflowId, lim)
      .map(rowToJob);
  }
  return getDb()
    .prepare(
      `SELECT * FROM agent_workflow_certify_jobs
       WHERE owner_user_id = ?
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(ownerUserId, lim)
    .map(rowToJob);
}

function insertJob({ ownerUserId, workflowId, goal, actor, maxAttempts }) {
  const id = `cert-${randomUUID()}`;
  getDb()
    .prepare(
      `INSERT INTO agent_workflow_certify_jobs
       (id, owner_user_id, workflow_id, status, goal_json, attempt, max_attempts, created_by, created_by_name)
       VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)`
    )
    .run(
      id,
      ownerUserId,
      workflowId || null,
      JSON.stringify(goal || {}),
      maxAttempts,
      actor?.id || null,
      actor?.name || null
    );
  return getCertifyJob(id, ownerUserId);
}

function updateJob(jobId, ownerUserId, patch) {
  const job = getCertifyJob(jobId, ownerUserId);
  if (!job) throw new Error(`Certify job not found: ${jobId}`);
  const status = patch.status != null ? patch.status : job.status;
  if (status && !JOB_STATUSES.has(status)) throw new Error(`Invalid certify status: ${status}`);
  const goal = patch.goal != null ? patch.goal : job.goal;
  const report = patch.report !== undefined ? patch.report : job.report;
  const attempt = patch.attempt != null ? patch.attempt : job.attempt;
  const maxAttempts = patch.max_attempts != null ? patch.max_attempts : job.max_attempts;
  const lastError = patch.last_error !== undefined ? patch.last_error : job.last_error;
  const workflowId = patch.workflow_id !== undefined ? patch.workflow_id : job.workflow_id;
  const completed =
    patch.completed_at !== undefined
      ? patch.completed_at
      : ['certified', 'failed', 'budget_exhausted', 'cancelled'].includes(status)
        ? job.completed_at || nowIso()
        : job.completed_at;

  getDb()
    .prepare(
      `UPDATE agent_workflow_certify_jobs SET
         workflow_id = ?, status = ?, goal_json = ?, report_json = ?,
         attempt = ?, max_attempts = ?, last_error = ?,
         updated_at = datetime('now'), completed_at = ?
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(
      workflowId || null,
      status,
      JSON.stringify(goal || {}),
      report == null ? null : JSON.stringify(report),
      attempt,
      maxAttempts,
      lastError || null,
      completed || null,
      jobId,
      ownerUserId
    );
  return getCertifyJob(jobId, ownerUserId);
}

/** Build default acceptance criteria when user only says "make it work". */
export function defaultAcceptanceCriteria() {
  return [
    { id: 'ac-preflight', type: 'publish_preflight_clean', required: true },
    { id: 'ac-struct', type: 'structural_clean', required: true },
    { id: 'ac-run', type: 'run_completed', required: true },
    { id: 'ac-steps', type: 'no_failed_steps', required: true },
  ];
}

/**
 * Compile a natural-language prompt into WorkflowGoal.v1.
 */
export function compileGoal(message, { workflowId = null, existingGoal = null } = {}) {
  const raw = String(message || '').trim();
  if (existingGoal && typeof existingGoal === 'object') {
    return {
      ...existingGoal,
      goal_id: existingGoal.goal_id || `goal-${randomUUID()}`,
      workflow_id: workflowId || existingGoal.workflow_id || null,
      intent: {
        ...(existingGoal.intent || {}),
        raw: existingGoal.intent?.raw || raw,
      },
    };
  }

  const criteriaMatch =
    raw.match(/success\s+criteria?\s*[:=]\s*["']?([^"'\n]+)["']?/i) ||
    raw.match(/criteria?\s*[:=]\s*["']?([^"'\n]+)["']?/i);
  const inputMatch =
    raw.match(/(?:test\s+)?input\s*[:=]\s*["']([^"']+)["']/i) ||
    raw.match(/with\s+(?:test\s+)?input\s+["']([^"']+)["']/i);
  const attemptsMatch = raw.match(/(?:max(?:imum)?\s+)?attempts?\s*[:=]?\s*(\d+)/i);

  const tokens = (criteriaMatch?.[1] || '').trim();
  const acceptance = defaultAcceptanceCriteria();
  if (tokens && !['completed', 'success', 'pass', 'passed', 'ok', 'green'].includes(tokens.toLowerCase())) {
    acceptance.push({
      id: 'ac-out',
      type: 'output_contains',
      required: true,
      params: { tokens: tokens.split(/\s+/).filter((t) => t.length > 2) },
    });
  }

  const maxAttempts = Math.min(
    Math.max(attemptsMatch ? Number(attemptsMatch[1]) : envInt('WORKFLOW_CERTIFY_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS), 1),
    HARD_MAX_ATTEMPTS
  );

  const testInput = (inputMatch?.[1] || '').trim() || 'Certify validation run';

  return {
    goal_id: `goal-${randomUUID()}`,
    workflow_id: workflowId || null,
    intent: {
      raw,
      summary: raw.slice(0, 240),
      domain: 'general',
      constraints: [],
    },
    acceptance,
    test_fixtures: [{ id: 'fx1', input: testInput, expect: acceptance }],
    budget: {
      max_attempts: maxAttempts,
      max_wall_ms: envInt('WORKFLOW_CERTIFY_MAX_WALL_MS', 300000),
      timeout_ms_per_test: envInt('WORKFLOW_CERTIFY_TEST_TIMEOUT_MS', 45000),
    },
    models: {
      maker: process.env.WORKFLOW_CERTIFY_MAKER_MODEL || null,
      checker: process.env.WORKFLOW_CERTIFY_CHECKER_MODEL || null,
    },
    certify_policy: 'auto',
    allow_ask: true,
    escalation: {
      openclaw_agent: null,
      cursor_on_platform_bug: false,
    },
  };
}

function collectRunHaystack(runSummary) {
  if (!runSummary) return '';
  return [
    runSummary.status,
    runSummary.error_message,
    ...(runSummary.steps || []).flatMap((s) => [
      s.status,
      s.error_message,
      s.output_preview,
      typeof s.output === 'string' ? s.output : s.output ? JSON.stringify(s.output) : '',
    ]),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function detectInputRequests(def, lastRun, publishErrors = []) {
  const requests = [];
  const errBlob = [
    ...(publishErrors || []),
    lastRun?.error_message,
    ...(lastRun?.steps || []).map((s) => s.error_message),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const nodes = def?.draft_graph?.nodes || [];
  for (const n of nodes) {
    const cfg = n?.data?.task_config || n?.data?.taskConfig || {};
    const nodeId = n.id;
    const label = n?.data?.label || n.id;
    const type = n?.data?.nodeType || n?.data?.type || n.type;

    if (/api\s*key|apikey|unauthorized|401|missing.*key/i.test(errBlob)) {
      if (['brain', 'api'].includes(String(type)) && !cfg.apiKey) {
        requests.push({
          id: `req-${nodeId}-apiKey`,
          blocker_class: 'secret',
          key: `nodes.${nodeId}.task_config.apiKey`,
          reason: `${label} appears to need an API key`,
          how_to_provide: `Provide apiKey for node ${label} (${nodeId}), or switch brain modelSource to ollama if local is enough`,
          blocking_criterion_ids: ['ac-run', 'ac-steps'],
        });
      }
    }
    if (/mcp.*not found|unknown mcp|mcpServerId/i.test(errBlob) && String(type) === 'mcp_tool') {
      requests.push({
        id: `req-${nodeId}-mcp`,
        blocker_class: 'identity',
        key: `nodes.${nodeId}.task_config.mcpServerId`,
        reason: `${label} MCP server id missing or invalid`,
        how_to_provide: 'Pass a valid mcpServerId from your MCP servers list',
        blocking_criterion_ids: ['ac-run'],
      });
    }
    if (/agent_id|agent not found/i.test(errBlob) && String(type) === 'agent' && !n?.data?.agent_id && !cfg.agent_id) {
      requests.push({
        id: `req-${nodeId}-agent`,
        blocker_class: 'identity',
        key: `nodes.${nodeId}.agent_id`,
        reason: `${label} needs a real org agent id`,
        how_to_provide: 'Pass agent_id from your Agents list',
        blocking_criterion_ids: ['ac-run'],
      });
    }
  }

  // Dedupe by key
  const seen = new Set();
  return requests.filter((r) => {
    if (seen.has(r.key)) return false;
    seen.add(r.key);
    return true;
  });
}

/**
 * Deterministic Checker — grades goal acceptance against graph + last run.
 */
export function checkGoal({ goal, def, lastRun = null }) {
  const acceptance = Array.isArray(goal?.acceptance) && goal.acceptance.length
    ? goal.acceptance
    : defaultAcceptanceCriteria();
  const publishErrors = validateWorkflowForPublish(def?.draft_graph || def?.published_graph) || [];
    const diagnosis = diagnoseWorkflowGraph(def);
  const structuralIssues = (diagnosis.issues || []).filter((i) => i.severity !== 'info');
  const criteria_results = [];
  const suggested = [];

  for (const c of acceptance) {
    const id = c.id || c.type;
    const type = c.type;
    let pass = false;
    let evidence = '';

    if (type === 'publish_preflight_clean') {
      pass = publishErrors.length === 0;
      evidence = pass ? 'Publish preflight clean' : publishErrors.slice(0, 5).join('; ');
      if (!pass && diagnosis.fixActions?.length) suggested.push(...diagnosis.fixActions);
    } else if (type === 'structural_clean') {
      pass = structuralIssues.length === 0;
      evidence = pass
        ? 'No structural issues'
        : structuralIssues
            .slice(0, 5)
            .map((i) => i.message || i.code || JSON.stringify(i))
            .join('; ');
      if (!pass && diagnosis.fixActions?.length) suggested.push(...diagnosis.fixActions);
    } else if (type === 'run_completed') {
      pass = String(lastRun?.status || '').toLowerCase() === 'completed';
      evidence = lastRun ? `run status=${lastRun.status}` : 'no run yet';
    } else if (type === 'no_failed_steps') {
      const failed = (lastRun?.steps || []).filter((s) => s.status === 'failed');
      pass = !!lastRun && failed.length === 0;
      evidence = pass
        ? 'no failed steps'
        : failed.map((s) => `${s.node_label || s.node_id}: ${s.error_message || 'failed'}`).join('; ') ||
          'no run yet';
    } else if (type === 'output_contains') {
      const tokens = c.params?.tokens || [];
      const hay = collectRunHaystack(lastRun);
      const missing = tokens.filter((t) => !hay.includes(String(t).toLowerCase()));
      pass = !!lastRun && missing.length === 0;
      evidence = pass ? `found tokens: ${tokens.join(', ')}` : `missing tokens: ${missing.join(', ')}`;
    } else if (type === 'ceo_gate_present') {
      const nodes = def?.draft_graph?.nodes || [];
      pass = nodes.some((n) => {
        const t = n?.data?.nodeType || n?.data?.type || n.type;
        return String(t) === 'ceo_approval';
      });
      evidence = pass ? 'ceo_approval node present' : 'ceo_approval node missing';
    } else if (type === 'output_json_schema' || type === 'step_output_match' || type === 'side_effect_probe') {
      // Soft criteria — fail closed without LLM; LLM checker may upgrade later
      pass = runMeetsSuccessCriteria(lastRun, 'completed');
      evidence = `soft criterion ${type}: treated as run_completed for deterministic check`;
    } else {
      pass = runMeetsSuccessCriteria(lastRun, type);
      evidence = `fallback criteria ${type}: ${pass ? 'met' : 'not met'}`;
    }

    criteria_results.push({
      criterion_id: id,
      pass,
      evidence,
      suggested_fix_actions: [],
    });
  }

  const requiredFailed = criteria_results.filter((r, i) => {
    const c = acceptance[i];
    return (c?.required !== false) && !r.pass;
  });
  const input_requests =
    goal?.allow_ask !== false ? detectInputRequests(def, lastRun, publishErrors) : [];

  let verdict = 'certified';
  if (input_requests.length && requiredFailed.some((r) => ['ac-run', 'ac-steps'].includes(r.criterion_id))) {
    verdict = 'blocked_on_input';
  } else if (requiredFailed.length) {
    verdict = 'failed';
  }

  // Attach suggested fixes to first failed criterion
  if (suggested.length && requiredFailed.length) {
    const first = criteria_results.find((r) => !r.pass);
    if (first) first.suggested_fix_actions = suggested.slice(0, 20);
  }

  return {
    goal_id: goal?.goal_id || null,
    workflow_id: def?.id || goal?.workflow_id || null,
    verdict,
    checked_at: nowIso(),
    checker_model: 'deterministic',
    maker_model: null,
    criteria_results,
    attempts: [],
    last_run: lastRun
      ? { run_id: lastRun.run_id || lastRun.id, run_number: lastRun.run_number, status: lastRun.status }
      : null,
    input_requests,
    notes: '',
  };
}

/**
 * Optional LLM Checker (fast/cheap model via env) — may refine soft criteria + input_requests.
 */
async function llmCheckGoal({ ownerUserId, goal, def, lastRun, baseReport }) {
  if (!envFlag('WORKFLOW_CERTIFY_USE_LLM_CHECKER', false)) return baseReport;

  const cfg = getLlmConfig(ownerUserId);
  const checkerModel =
    goal?.models?.checker ||
    process.env.WORKFLOW_CERTIFY_CHECKER_MODEL ||
    cfg.secondary?.model ||
    null;
  if (!checkerModel && !cfg.secondary) return baseReport;

  const prompt = {
    role: 'user',
    content: `You are the Workflow Certify Checker. Grade this workflow against the goal.
Return ONLY JSON: { "verdict": "certified"|"failed"|"blocked_on_input", "criteria_results": [{"criterion_id","pass","evidence","suggested_fix_actions":[]}], "input_requests": [{"id","blocker_class","key","reason","how_to_provide"}], "notes": "" }
suggested_fix_actions must be Agent OS builder actions only (update_node, add_edge, etc).
Do not invent secrets. Prefer blocked_on_input for missing API keys / agent ids / MCP ids.

GOAL:
${JSON.stringify(goal, null, 2)}

GRAPH SUMMARY:
${buildDetailedGraphSummary(def?.draft_graph)}

LAST RUN:
${JSON.stringify(lastRun ? { status: lastRun.status, error: lastRun.error_message, steps: lastRun.steps } : null, null, 2)}

DETERMINISTIC BASE (authoritative for run_completed / no_failed_steps / preflight / structural — do NOT contradict a pass):
${JSON.stringify(baseReport, null, 2)}

Rules:
- If deterministic base already passed ac-run / ac-steps / preflight / structural, you MUST keep pass:true for those.
- Prefer adding suggested_fix_actions and input_requests for soft issues only.
- Only set blocked_on_input for real missing secrets/ids.`,
  };

  try {
    // Prefer secondary endpoint when present by passing checker model override
    const { content, modelUsed } = await chatCompletions({
      messages: [
        {
          role: 'system',
          content: 'You are a strict workflow certification checker. Reply with JSON only.',
        },
        prompt,
      ],
      modelOverride: checkerModel || undefined,
      maxTokens: 2048,
      ownerUserId,
    });
    const jsonMatch = String(content).match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ...baseReport, checker_model: modelUsed || baseReport.checker_model };
    const parsed = JSON.parse(jsonMatch[0]);

    // Merge: never let LLM overturn hard deterministic passes (it often hallucinates step status).
    const HARD = new Set([
      'publish_preflight_clean',
      'structural_clean',
      'run_completed',
      'no_failed_steps',
      'ac-preflight',
      'ac-struct',
      'ac-run',
      'ac-steps',
    ]);
    const baseById = new Map((baseReport.criteria_results || []).map((c) => [c.criterion_id, c]));
    const acceptanceTypes = new Map((goal?.acceptance || []).map((c) => [c.id || c.type, c.type]));
    const mergedCriteria = (parsed.criteria_results || baseReport.criteria_results || []).map((c) => {
      const base = baseById.get(c.criterion_id);
      const type = acceptanceTypes.get(c.criterion_id) || c.criterion_id;
      const hard = HARD.has(c.criterion_id) || HARD.has(type);
      if (hard && base?.pass === true) {
        return { ...c, pass: true, evidence: base.evidence || c.evidence };
      }
      if (hard && base && c.pass === true && base.pass === false) {
        // Allow LLM to keep deterministic fail unless it adds suggested fixes only
        return { ...base, suggested_fix_actions: c.suggested_fix_actions || base.suggested_fix_actions || [] };
      }
      return {
        ...c,
        suggested_fix_actions: c.suggested_fix_actions || base?.suggested_fix_actions || [],
      };
    });

    // Recompute verdict from merged hard criteria
    const requiredFailed = mergedCriteria.filter((r) => {
      const acc = (goal?.acceptance || []).find((a) => (a.id || a.type) === r.criterion_id);
      return (acc?.required !== false) && !r.pass;
    });
    let verdict = 'certified';
    const input_requests = Array.isArray(parsed.input_requests)
      ? parsed.input_requests
      : baseReport.input_requests || [];
    if (input_requests.length && requiredFailed.some((r) => ['ac-run', 'ac-steps'].includes(r.criterion_id))) {
      verdict = 'blocked_on_input';
    } else if (requiredFailed.length) {
      verdict = 'failed';
    } else if (baseReport.verdict === 'certified' && !requiredFailed.length) {
      verdict = 'certified';
    }

    return {
      ...baseReport,
      ...parsed,
      criteria_results: mergedCriteria,
      input_requests,
      verdict,
      goal_id: goal?.goal_id || baseReport.goal_id,
      workflow_id: def?.id || baseReport.workflow_id,
      checked_at: nowIso(),
      checker_model: modelUsed || checkerModel || 'llm',
      attempts: baseReport.attempts || [],
      last_run: baseReport.last_run,
      notes: [baseReport.notes, parsed.notes, 'LLM merged with deterministic hard criteria'].filter(Boolean).join(' | '),
    };
  } catch (e) {
    return {
      ...baseReport,
      notes: `${baseReport.notes || ''} LLM checker skipped: ${e.message}`.trim(),
    };
  }
}

async function makerFixActions({ ownerUserId, goal, def, lastRun, report, attempt }) {
  const makerModel = goal?.models?.maker || process.env.WORKFLOW_CERTIFY_MAKER_MODEL || undefined;
  const prompt = `You are the Workflow Certify Maker. The Checker failed certification.
Return ONLY a JSON array of builder actions to fix the workflow (update_node, add_edge, delete_edge, add_node, set_metadata, unpublish).
No until_success / until_certified / create_workflow. Never invent IDs not in the graph/runtime.

GOAL: ${JSON.stringify({ intent: goal?.intent, acceptance: goal?.acceptance })}
ATTEMPT: ${attempt}
CHECKER REPORT: ${JSON.stringify(report)}
GRAPH: ${buildDetailedGraphSummary(def?.draft_graph)}
LAST RUN: ${JSON.stringify(lastRun ? { status: lastRun.status, error: lastRun.error_message, steps: lastRun.steps } : null)}`;

  try {
    const { content, modelUsed } = await chatCompletions({
      messages: [
        { role: 'system', content: 'Emit a JSON array of Agent OS workflow builder actions only.' },
        { role: 'user', content: prompt },
      ],
      modelOverride: makerModel,
      maxTokens: 2048,
      ownerUserId,
    });
    const arrMatch = String(content).match(/\[[\s\S]*\]/);
    if (!arrMatch) return { actions: [], modelUsed };
    const actions = JSON.parse(arrMatch[0]);
    return {
      actions: (Array.isArray(actions) ? actions : []).filter((a) => {
        const op = String(a?.action || a?.op || '').toLowerCase();
        return op && !['until_success', 'build_until_success', 'until_certified', 'create_workflow'].includes(op);
      }),
      modelUsed,
    };
  } catch (_) {
    return { actions: [], modelUsed: null };
  }
}

function applyInputPatches(inputs) {
  const actions = [];
  for (const [key, value] of Object.entries(inputs || {})) {
    const m = String(key).match(/^nodes\.([^.]+)\.(.+)$/);
    if (!m) continue;
    const nodeId = m[1];
    const path = m[2];
    if (path === 'agent_id') {
      actions.push({ action: 'update_node', node_id: nodeId, agent_id: value });
      continue;
    }
    if (path.startsWith('task_config.')) {
      const field = path.slice('task_config.'.length);
      actions.push({ action: 'update_node', node_id: nodeId, task_config: { [field]: value } });
      continue;
    }
    actions.push({ action: 'update_node', node_id: nodeId, [path]: value });
  }
  return actions;
}

async function applyActions(ownerUserId, workflowId, actions, actor) {
  if (!actions?.length) return { workflow_id: workflowId, results: [] };
  const { applyWorkflowBuilderActions } = await import('./agent-workflow-builder.js');
  return applyWorkflowBuilderActions(ownerUserId, workflowId, actions, actor);
}

/**
 * Sync until_certified loop (Maker/Checker around until_success).
 */
export async function executeUntilCertified({
  ownerUserId,
  workflowId,
  actor,
  goal: goalIn = null,
  message = '',
  maxAttempts = null,
  applyMakerFixes = true,
}) {
  if (!ownerUserId) throw new Error('ownerUserId required for until_certified');
  let currentId = workflowId || null;
  let goal = compileGoal(message || goalIn?.intent?.raw || 'Certify workflow end-to-end', {
    workflowId: currentId,
    existingGoal: goalIn,
  });
  if (maxAttempts != null) {
    goal = {
      ...goal,
      budget: { ...goal.budget, max_attempts: Math.min(Math.max(Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS, 1), HARD_MAX_ATTEMPTS) },
    };
  }
  const budget = goal.budget?.max_attempts || DEFAULT_MAX_ATTEMPTS;
  const attempts = [];
  let lastReport = null;
  let lastRun = null;
  let makerModel = null;

  if (currentId) setDefinitionCertifyState(currentId, ownerUserId, 'testing', actor);

  for (let attempt = 1; attempt <= budget; attempt++) {
    if (!currentId) {
      lastReport = {
        goal_id: goal.goal_id,
        workflow_id: null,
        verdict: 'failed',
        checked_at: nowIso(),
        checker_model: 'deterministic',
        criteria_results: [],
        attempts,
        input_requests: [
          {
            id: 'req-workflow',
            blocker_class: 'ambiguity',
            key: 'workflow_id',
            reason: 'No workflow in context to certify',
            how_to_provide: 'Create or open a workflow first, or pass workflow_id',
          },
        ],
        notes: 'Missing workflow',
      };
      break;
    }

    const fixtureInput = goal.test_fixtures?.[0]?.input || 'Certify validation run';
    const untilOutcome = await executeUntilSuccess({
      ownerUserId,
      workflowId: currentId,
      actor,
      input: fixtureInput,
      successCriteria: 'completed',
      maxAttempts: 2,
      timeoutMs: goal.budget?.timeout_ms_per_test || 45000,
      applyStructuralFixes: true,
      llmFixFn: applyMakerFixes
        ? async (ctx) => {
            const interim = checkGoal({ goal, def: ctx.def, lastRun: ctx.run || null });
            const { actions, modelUsed } = await makerFixActions({
              ownerUserId,
              goal,
              def: ctx.def,
              lastRun: ctx.run,
              report: interim,
              attempt,
            });
            if (modelUsed) makerModel = modelUsed;
            return actions;
          }
        : null,
    });

    currentId = untilOutcome.workflow_id || currentId;
    lastRun = untilOutcome.last_run;
    attempts.push({
      attempt,
      phase: 'until_success',
      ok: !!untilOutcome.success,
      run_id: lastRun?.run_id || lastRun?.id || null,
      errors: untilOutcome.success ? [] : [untilOutcome.last_run?.error_message].filter(Boolean),
    });

    let def = store.getDefinition(currentId, ownerUserId);
    let report = checkGoal({ goal, def, lastRun });
    report = await llmCheckGoal({ ownerUserId, goal, def, lastRun, baseReport: report });
    report.attempts = [...attempts];
    report.maker_model = makerModel;
    lastReport = report;

    attempts.push({
      attempt,
      phase: 'checker',
      ok: report.verdict === 'certified',
      errors: (report.criteria_results || []).filter((c) => !c.pass).map((c) => c.evidence),
    });

    if (report.verdict === 'certified') {
      setDefinitionCertifyState(currentId, ownerUserId, 'certified', actor);
      if (goal.certify_policy === 'auto_publish' && def?.status !== 'published') {
        await applyActions(ownerUserId, currentId, [{ action: 'publish' }], actor);
      }
      return {
        success: true,
        verdict: 'certified',
        workflow_id: currentId,
        goal,
        report: lastReport,
        attempts,
        last_run: lastRun,
      };
    }

    if (report.verdict === 'blocked_on_input' && report.input_requests?.length) {
      setDefinitionCertifyState(currentId, ownerUserId, 'blocked_on_input', actor);
      return {
        success: false,
        verdict: 'blocked_on_input',
        workflow_id: currentId,
        goal,
        report: lastReport,
        attempts,
        last_run: lastRun,
        input_requests: report.input_requests,
      };
    }

    // Apply checker suggestions + maker fixes
    const fixFromChecker = (report.criteria_results || []).flatMap((c) => c.suggested_fix_actions || []);
    if (fixFromChecker.length) {
      await applyActions(ownerUserId, currentId, fixFromChecker, actor);
      attempts.push({ attempt, phase: 'maker_fix', ok: true, actions_applied: fixFromChecker.slice(0, 10) });
      continue;
    }

    if (applyMakerFixes) {
      def = store.getDefinition(currentId, ownerUserId);
      const { actions, modelUsed } = await makerFixActions({
        ownerUserId,
        goal,
        def,
        lastRun,
        report,
        attempt,
      });
      if (modelUsed) makerModel = modelUsed;
      if (actions.length) {
        await applyActions(ownerUserId, currentId, actions, actor);
        attempts.push({ attempt, phase: 'maker_fix', ok: true, actions_applied: actions.slice(0, 10) });
        continue;
      }
    }

    // No more repairs
    break;
  }

  const verdict = lastReport?.verdict === 'blocked_on_input' ? 'blocked_on_input' : 'budget_exhausted';
  if (currentId) setDefinitionCertifyState(currentId, ownerUserId, verdict === 'blocked_on_input' ? 'blocked_on_input' : null, actor);
  if (lastReport) {
    lastReport.verdict = verdict === 'blocked_on_input' ? 'blocked_on_input' : 'budget_exhausted';
    lastReport.attempts = attempts;
  }

  return {
    success: false,
    verdict,
    workflow_id: currentId,
    goal,
    report: lastReport,
    attempts,
    last_run: lastRun,
    input_requests: lastReport?.input_requests || [],
  };
}

export function formatCertifyReply(outcomeOrJob) {
  if (!outcomeOrJob) return 'Certify did not run.';
  // Job status shape
  if (outcomeOrJob.status && outcomeOrJob.goal) {
    const j = outcomeOrJob;
    const lines = [
      `**Certify job** \`${j.id}\``,
      `Status: **${j.status}** (attempt ${j.attempt}/${j.max_attempts})`,
      j.workflow_id ? `Workflow: \`${j.workflow_id}\`` : null,
      j.last_error ? `Last error: ${j.last_error}` : null,
    ].filter(Boolean);
    const reqs = j.report?.input_requests || [];
    if (reqs.length) {
      lines.push('', '**Inputs needed:**');
      for (const r of reqs) lines.push(`- \`${r.key}\`: ${r.reason} — ${r.how_to_provide}`);
    }
    if (j.status === 'certified') lines.push('', 'Certified ✓');
    return lines.join('\n');
  }

  const o = outcomeOrJob;
  const lines = [
    o.verdict === 'certified'
      ? `**Certify: PASSED** (${o.attempts?.length || 0} phases)`
      : `**Certify: ${String(o.verdict || 'failed').toUpperCase()}**`,
    o.workflow_id ? `Workflow: \`${o.workflow_id}\`` : null,
  ].filter(Boolean);
  for (const a of o.attempts || []) {
    lines.push(`- Attempt ${a.attempt} ${a.phase}: ${a.ok ? 'ok' : 'issues'}`);
  }
  if (o.input_requests?.length) {
    lines.push('', '**Inputs needed:**');
    for (const r of o.input_requests) lines.push(`- \`${r.key}\`: ${r.reason}`);
  }
  return lines.join('\n');
}

export function formatCertifyStatus(job) {
  if (!job) return { ok: false, error: 'Job not found' };
  return {
    ok: true,
    job_id: job.id,
    workflow_id: job.workflow_id,
    status: job.status,
    attempt: job.attempt,
    max_attempts: job.max_attempts,
    phase: job.report?.attempts?.slice(-1)?.[0]?.phase || null,
    last_error: job.last_error,
    input_requests: job.report?.input_requests || [],
    last_run: job.report?.last_run || null,
    verdict: job.report?.verdict || null,
    goal_summary: job.goal?.intent?.summary || job.goal?.intent?.raw || null,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
  };
}

async function runCertifyJob(jobId, ownerUserId) {
  let job = getCertifyJob(jobId, ownerUserId);
  if (!job) throw new Error(`Certify job not found: ${jobId}`);
  const actor = {
    id: job.created_by || 'workflowbuilder',
    name: job.created_by_name || 'Workflow Builder',
    type: 'workflow_builder',
  };

  job = updateJob(jobId, ownerUserId, { status: 'testing', last_error: null });
  if (job.workflow_id) setDefinitionCertifyState(job.workflow_id, ownerUserId, 'testing', actor);

  try {
    const outcome = await executeUntilCertified({
      ownerUserId,
      workflowId: job.workflow_id,
      actor,
      goal: job.goal,
      message: job.goal?.intent?.raw || '',
      maxAttempts: job.max_attempts,
      applyMakerFixes: true,
    });

    const terminal =
      outcome.verdict === 'certified'
        ? 'certified'
        : outcome.verdict === 'blocked_on_input'
          ? 'blocked_on_input'
          : outcome.verdict === 'budget_exhausted'
            ? 'budget_exhausted'
            : 'failed';

    return updateJob(jobId, ownerUserId, {
      status: terminal,
      workflow_id: outcome.workflow_id || job.workflow_id,
      goal: outcome.goal || job.goal,
      report: outcome.report,
      attempt: outcome.attempts?.length || job.attempt,
      last_error:
        terminal === 'certified'
          ? null
          : outcome.report?.criteria_results?.find((c) => !c.pass)?.evidence ||
            outcome.last_run?.error_message ||
            terminal,
      completed_at: ['certified', 'failed', 'budget_exhausted'].includes(terminal) ? nowIso() : null,
    });
  } catch (e) {
    return updateJob(jobId, ownerUserId, {
      status: 'failed',
      last_error: e.message,
      completed_at: nowIso(),
    });
  }
}

/**
 * Start certify job (async by default for OpenClaw face).
 */
export function startCertifyJob({
  ownerUserId,
  message = '',
  workflowId = null,
  goal = null,
  actor = null,
  async: asyncRun = true,
  maxAttempts = null,
}) {
  if (!ownerUserId) throw new Error('ownerUserId required');
  const compiled = compileGoal(message || goal?.intent?.raw || 'Certify workflow end-to-end', {
    workflowId,
    existingGoal: goal,
  });
  if (maxAttempts != null) {
    compiled.budget = {
      ...compiled.budget,
      max_attempts: Math.min(Math.max(Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS, 1), HARD_MAX_ATTEMPTS),
    };
  }
  const job = insertJob({
    ownerUserId,
    workflowId: workflowId || compiled.workflow_id,
    goal: compiled,
    actor,
    maxAttempts: compiled.budget.max_attempts,
  });

  if (!asyncRun) {
    return runCertifyJob(job.id, ownerUserId);
  }

  void runCertifyJob(job.id, ownerUserId).catch((err) => {
    try {
      updateJob(job.id, ownerUserId, {
        status: 'failed',
        last_error: err.message,
        completed_at: nowIso(),
      });
    } catch (_) {}
  });

  return {
    ok: true,
    async: true,
    ...formatCertifyStatus(job),
    status: 'testing',
    message: `Started certify job ${job.id}. Ask for status anytime with job_id or workflow name.`,
  };
}

/**
 * Resume a blocked certify job after providing inputs.
 */
export async function resumeCertifyJob({ ownerUserId, jobId, inputs = {}, actor = null }) {
  const job = getCertifyJob(jobId, ownerUserId);
  if (!job) throw new Error(`Certify job not found: ${jobId}`);
  if (!job.workflow_id) throw new Error('Job has no workflow_id');

  const patchActions = applyInputPatches(inputs);
  if (patchActions.length) {
    await applyActions(
      ownerUserId,
      job.workflow_id,
      patchActions,
      actor || { id: job.created_by, name: job.created_by_name, type: 'workflow_builder' }
    );
  }

  // Clear prior input_requests and continue async
  updateJob(jobId, ownerUserId, {
    status: 'testing',
    last_error: null,
    completed_at: null,
    report: {
      ...(job.report || {}),
      input_requests: [],
      verdict: 'failed',
      notes: `Resumed with inputs: ${Object.keys(inputs || {}).join(', ')}`,
    },
  });

  void runCertifyJob(jobId, ownerUserId).catch((err) => {
    try {
      updateJob(jobId, ownerUserId, { status: 'failed', last_error: err.message, completed_at: nowIso() });
    } catch (_) {}
  });

  return {
    ok: true,
    async: true,
    ...formatCertifyStatus(getCertifyJob(jobId, ownerUserId)),
    message: `Resumed certify job ${jobId}. Ask for status anytime.`,
  };
}

/**
 * Resolve status by job_id, workflow_id, or fuzzy query against recent jobs.
 */
export function getCertifyStatusForOwner(ownerUserId, { jobId = null, workflowId = null, query = null } = {}) {
  if (jobId) {
    const job = getCertifyJob(jobId, ownerUserId);
    if (!job) return { ok: false, error: 'Job not found' };
    return formatCertifyStatus(job);
  }
  if (workflowId) {
    const jobs = listCertifyJobs(ownerUserId, { workflowId, limit: 1 });
    if (!jobs.length) return { ok: false, error: 'No certify jobs for workflow' };
    return formatCertifyStatus(jobs[0]);
  }
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    const jobs = listCertifyJobs(ownerUserId, { limit: 50 });
    const hit =
      jobs.find((j) => j.id.toLowerCase() === q) ||
      jobs.find((j) => String(j.workflow_id || '').toLowerCase() === q) ||
      jobs.find((j) => String(j.goal?.intent?.summary || j.goal?.intent?.raw || '').toLowerCase().includes(q));
    if (hit) return formatCertifyStatus(hit);
    // Also match workflow names
    const defs = store.listDefinitions(ownerUserId, { search: q });
    for (const d of defs || []) {
      const forWf = listCertifyJobs(ownerUserId, { workflowId: d.id, limit: 1 });
      if (forWf[0]) return formatCertifyStatus(forWf[0]);
    }
    return { ok: false, error: `No certify job matching "${query}"` };
  }
  const latest = listCertifyJobs(ownerUserId, { limit: 1 })[0];
  if (!latest) return { ok: false, error: 'No certify jobs yet' };
  return formatCertifyStatus(latest);
}
