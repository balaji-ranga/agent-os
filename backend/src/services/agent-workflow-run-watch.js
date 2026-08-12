/**
 * COO-friendly workflow run watches: fire-and-forget after agent_workflow_trigger.
 * Platform notifies the entitled CEO on CEO-wait / terminal, and re-wakes the COO
 * orchestrator on terminal so multi-phase goals (CRM then ERP O2C) can continue.
 */
import { getDb } from '../db/schema.js';
import { sendPlatformNotifications } from './platform-notifications.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';
import * as openclaw from '../gateway/openclaw.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { getPromptWithMemoryInjected } from './delegation-queue.js';
import { insertChatTurn } from './chat-history.js';
import { onWorkflowTerminalForGoalRun, findGoalStepByWorkflowRun } from './agent-goal-run.js';
import { isPlatformCronActive } from './platform-cron-registry.js';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'paused']);

function db() {
  return getDb();
}

function parseContext(runRow) {
  try {
    return JSON.parse(runRow?.context_json || '{}') || {};
  } catch {
    return {};
  }
}

function saveContext(runId, context) {
  db()
    .prepare(
      "UPDATE agent_workflow_runs SET context_json = ?, updated_at = datetime('now') WHERE id = ?"
    )
    .run(JSON.stringify(context || {}), runId);
}

function definitionName(definitionId) {
  const row = db()
    .prepare('SELECT name FROM agent_workflow_definitions WHERE id = ?')
    .get(definitionId);
  return row?.name || definitionId || 'Workflow';
}

function isPlaceholderActor(id) {
  const s = String(id || '')
    .trim()
    .toLowerCase();
  return !s || s === 'system' || s === 'agent-workflow' || s === 'agent_workflow';
}

/**
 * Prefer a real COO/Workflow Builder actor over system so terminal wake works.
 * Later empty/system refreshes never wipe a good prior actor.
 */
function mergeActorId(incoming, previous) {
  const next = String(incoming || '').trim();
  const prev = String(previous || '').trim();
  if (!isPlaceholderActor(next)) return next;
  if (!isPlaceholderActor(prev)) return prev;
  return next || prev || null;
}

function mergeActorName(incoming, previous, actorId) {
  const next = String(incoming || '').trim();
  const prev = String(previous || '').trim();
  if (next && !isPlaceholderActor(incoming)) return next;
  if (prev && !isPlaceholderActor(previous)) return prev;
  if (next) return next;
  if (prev) return prev;
  return actorId || null;
}

/**
 * Register (or refresh) a watch on a workflow run when COO/Workflow Builder triggers it.
 */
export function registerWorkflowRunWatch(
  runId,
  {
    ownerUserId,
    actorAgentId = null,
    actorName = null,
    notifyOnWaiting = true,
    notifyOnTerminal = true,
    wakeOrchestratorOnTerminal = true,
    goalRunId = null,
    goalTitle = null,
    goalStepLabel = null,
    goalStepIndex = null,
  } = {}
) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'run_id required' };
  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return { ok: false, error: 'run not found' };
  if (ownerUserId && run.owner_user_id && String(run.owner_user_id) !== String(ownerUserId)) {
    return { ok: false, error: 'run not found for owner' };
  }
  const owner = String(ownerUserId || run.owner_user_id || '').trim();
  if (!owner) return { ok: false, error: 'owner_user_id required' };

  const context = parseContext(run);
  const prev =
    context.coo_run_watch && typeof context.coo_run_watch === 'object' ? context.coo_run_watch : {};
  const mergedActor = mergeActorId(actorAgentId, prev.actor_agent_id);
  context.coo_run_watch = {
    enabled: true,
    owner_user_id: owner,
    actor_agent_id: mergedActor,
    actor_name: mergeActorName(actorName, prev.actor_name, mergedActor),
    notify_on_waiting: notifyOnWaiting !== false,
    notify_on_terminal: notifyOnTerminal !== false,
    wake_orchestrator_on_terminal:
      wakeOrchestratorOnTerminal === false || prev.wake_orchestrator_on_terminal === false
        ? false
        : true,
    registered_at: prev.registered_at || new Date().toISOString(),
    refreshed_at: new Date().toISOString(),
    events_sent: Array.isArray(prev.events_sent) ? prev.events_sent : [],
      goal_run_id: goalRunId || prev.goal_run_id || null,
    goal_title: goalTitle || prev.goal_title || null,
    goal_step_label: goalStepLabel != null ? goalStepLabel : prev.goal_step_label || null,
    goal_step_index: goalStepIndex != null ? goalStepIndex : prev.goal_step_index ?? null,
  };
  saveContext(id, context);
  console.info('[wf-run-watch] registered', {
    runId: id,
    owner,
    actorAgentId: mergedActor,
  });
  return {
    ok: true,
    run_id: id,
    status: run.status,
    watch: context.coo_run_watch,
    async: true,
    goal_run_id: context.coo_run_watch.goal_run_id || null,
    instruction: context.coo_run_watch.goal_run_id
      ? 'ASYNC: Workflow step of goal plan ' +
        context.coo_run_watch.goal_run_id +
        ' started (workflow run_id=' +
        id +
        '). Confirm agr-… and this step to the CEO; END TURN. Platform advances remaining plan steps on terminal — do not poll.'
      : 'Do not wait on this run in chat. Confirm run_id to the CEO, then stop this turn. ' +
        'Platform notifies the CEO on CEO approval wait / terminal, and may re-wake you (COO) on terminal. ' +
        'A numeric workflow run_id is NOT a goal plan. Multi-phase goals need agent_goal_create (agr-…). ' +
        'Use agent_workflow_runs / agent_workflow_watch_tick only if the CEO asks for status.',
  };
}

function markEvent(context, eventKey) {
  const watch = context.coo_run_watch;
  if (!watch || !watch.enabled) return false;
  const sent = Array.isArray(watch.events_sent) ? watch.events_sent : [];
  if (sent.includes(eventKey)) return false;
  sent.push(eventKey);
  watch.events_sent = sent.slice(-30);
  context.coo_run_watch = watch;
  return true;
}

function pushNotify({ ownerUserId, title, body, runId, sourceKey, actorAgentId }) {
  if (!ownerUserId) return null;
  try {
    return sendPlatformNotifications({
      userIds: [ownerUserId],
      title,
      body,
      linkUrl: '/workflows?run_id=' + runId,
      createdBy: String(actorAgentId || 'system').slice(0, 64),
      source: 'workflow_run_watch',
      sourceKey: String(sourceKey).slice(0, 200),
    });
  } catch (e) {
    console.warn('[wf-run-watch] notify failed', runId, e?.message || e);
    return null;
  }
}

function clip(s, n = 400) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + '...';
}

/**
 * Resolve durable goal plan binding for a workflow run (child step or watch metadata).
 * @returns {{ goal_run_id: string, title: string, step_label: string|null, step_index: number|null }|null}
 */
function resolveGoalPlanRefForRun(runId, watch = null) {
  try {
    const found = findGoalStepByWorkflowRun(runId);
    if (found?.goal?.id) {
      return {
        goal_run_id: String(found.goal.id),
        title: String(found.goal.title || '').trim() || String(found.goal.id),
        step_label: found.step?.label ? String(found.step.label) : null,
        step_index:
          found.step?.step_index != null && Number.isFinite(Number(found.step.step_index))
            ? Number(found.step.step_index)
            : null,
      };
    }
  } catch (_) {
    /* ignore */
  }
  const gId = String(watch?.goal_run_id || '').trim();
  if (gId) {
    return {
      goal_run_id: gId,
      title: String(watch?.goal_title || gId).trim() || gId,
      step_label: watch?.goal_step_label ? String(watch.goal_step_label) : null,
      step_index:
        watch?.goal_step_index != null && Number.isFinite(Number(watch.goal_step_index))
          ? Number(watch.goal_step_index)
          : null,
    };
  }
  return null;
}

function formatGoalPlanRef(ref) {
  if (!ref?.goal_run_id) return '';
  const title = ref.title && ref.title !== ref.goal_run_id ? ` \"${clip(ref.title, 80)}\"` : '';
  let step = '';
  if (ref.step_label || ref.step_index != null) {
    step =
      ' · step ' +
      (ref.step_index != null ? String(ref.step_index) : '') +
      (ref.step_label ? ` (${clip(ref.step_label, 60)})` : '');
  }
  return `goal plan ${ref.goal_run_id}${title}${step}`;
}


/** True when id is a placeholder, not a real orchestrating agent. */

function stepTextSnippet(outputJson, max = 500) {
  if (!outputJson) return '';
  try {
    const o = typeof outputJson === 'string' ? JSON.parse(outputJson) : outputJson;
    const text = o?.text || o?.decision || o?.result;
    if (text != null) return clip(String(text), max);
    return clip(JSON.stringify(o), max);
  } catch {
    return clip(String(outputJson), max);
  }
}

function buildTerminalStepSummary(runId) {
  const steps = db()
    .prepare(
      `SELECT node_id, node_label, node_type, status, output_json
       FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id ASC`
    )
    .all(runId);
  const lines = [];
  for (const s of steps) {
    if (!s || s.status === 'skipped') continue;
    const label = s.node_label || s.node_id;
    const snip = stepTextSnippet(s.output_json, 420);
    if (snip) lines.push(`- [${s.status}] ${label}: ${snip}`);
    else lines.push(`- [${s.status}] ${label}`);
  }
  return lines.slice(-12).join('\n');
}

function resolveOrchestratorAgent(ownerUserId, preferredAgentId) {
  const owner = String(ownerUserId || '').trim();
  let pref = String(preferredAgentId || '').trim();
  if (pref.includes('--')) pref = pref.split('--').pop() || pref;

  const tryId = (id) => {
    if (!id || isPlaceholderActor(id)) return null;
    const agent = db().prepare('SELECT * FROM agents WHERE lower(id) = lower(?)').get(id);
    if (!agent) return null;
    const entitled = db()
      .prepare(
        `SELECT 1 AS ok FROM user_agents WHERE user_id = ? AND agent_id = ? AND enabled = 1`
      )
      .get(owner, agent.id);
    if (!entitled && !agent.is_coo && !/workflow.?builder/i.test(String(agent.id || ''))) {
      return null;
    }
    return agent;
  };

  const fromPref = tryId(pref);
  if (fromPref) return fromPref;

  const coo =
    db()
      .prepare(
        `SELECT a.* FROM agents a
         INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
         WHERE a.is_coo = 1
         ORDER BY a.id ASC LIMIT 1`
      )
      .get(owner) ||
    db().prepare(`SELECT * FROM agents WHERE is_coo = 1 ORDER BY id ASC LIMIT 1`).get();
  return coo || null;
}


function recentScheduledGoalForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return null;
  try {
    return (
      db()
        .prepare(
          `SELECT id, title, prompt, agent_id, last_run_at, status
           FROM scheduled_goals
           WHERE owner_user_id = ?
           ORDER BY COALESCE(last_run_at, updated_at, created_at) DESC
           LIMIT 1`
        )
        .get(owner) || null
    );
  } catch {
    return null;
  }
}

function isCrmMcDefinition(definitionId, definitionName) {
  const id = String(definitionId || '').toLowerCase();
  const name = String(definitionName || '').toLowerCase();
  return id.startsWith('crm-mc-') || (name.includes('crm') && name.includes('maker'));
}

function goalImpliesCrmToErp(goalText) {
  const t = String(goalText || '').toLowerCase();
  if (!t) return false;
  const hasCrm = /\bcrm\b|twenty|pre-order|maker checker/.test(t);
  const hasErp = /\berp\b|o2c|order-to-cash|otc|quotation|sales order/.test(t);
  return hasCrm && hasErp;
}

/**
 * Re-invoke COO after a terminal run so multi-phase goals continue (CRM then ERP).
 * Idempotent per run/status unless force is set.
 */
export async function wakeOrchestratorOnWorkflowTerminal(runId, opts = {}) {
  const force = !!opts.force;
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'run_id required' };
  if (process.env.WORKFLOW_COO_WAKE_ON_TERMINAL === '0') {
    return { ok: false, skipped: true, reason: 'disabled_by_env' }
  if (!force && !isPlatformCronActive('workflow_terminal_watch')) {
    return { ok: false, skipped: true, reason: 'paused_admin' };
  };
  }

  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return { ok: false, error: 'run not found' };
  if (!TERMINAL.has(String(run.status || ''))) {
    return { ok: false, error: 'run not terminal', status: run.status };
  }

  const context = parseContext(run);
  const watch = context.coo_run_watch;
  if (!watch?.enabled) return { ok: false, skipped: true, reason: 'no_watch' };
  if (watch.wake_orchestrator_on_terminal === false) {
    return { ok: false, skipped: true, reason: 'wake_disabled' };
  }

  const eventKey = 'coo_wake:terminal:' + run.status;
  if (!force) {
    if (!markEvent(context, eventKey)) {
      return { ok: false, skipped: true, reason: 'already_woke' };
    }
  } else {
    markEvent(context, eventKey);
  }
  saveContext(id, context);

  const owner = String(watch.owner_user_id || run.owner_user_id || '').trim();
  const agent = resolveOrchestratorAgent(owner, watch.actor_agent_id);
  if (!agent) {
    console.warn('[wf-run-watch] coo wake: no orchestrator agent', { runId: id, owner });
    return { ok: false, error: 'no_orchestrator_agent' };
  }

  let openclawId = agent.openclaw_agent_id || agent.id;
  try {
    openclawId = ensureTenantOpenClawAgent(agent, owner).openclawAgentId;
  } catch (e) {
    console.warn('[wf-run-watch] tenant ensure failed', agent.id, e?.message || e);
  }

  const name = definitionName(run.definition_id);
  const runLabel = run.run_number != null ? '#' + run.run_number : '#' + id;
  const initial = clip(context.initial_input || '', 2500);
  const stepSummary = buildTerminalStepSummary(id) || '(no step outputs)';
  const err = run.error_message ? String(run.error_message).slice(0, 400) : '';
  const goal = recentScheduledGoalForOwner(owner);
  const goalText = goal ? String(goal.prompt || '') : '';
  const goalBlob = [goalText, initial, name, String(run.definition_id || '')].join('\n');
  const planRefEarly = resolveGoalPlanRefForRun(id, watch);
  const multiPhaseCrmToErp =
    !planRefEarly &&
    run.status === 'completed' &&
    isCrmMcDefinition(run.definition_id, name) &&
    goalImpliesCrmToErp(goalBlob);
  const multiPhaseNote = goal
    ? '**Active/recent scheduled goal:** "' +
      clip(goal.title, 120) +
      '" (id ' +
      goal.id +
      ')\n' +
      clip(goalText, 1800)
    : '**No scheduled_goals row found** — still apply multi-phase rules from prior chat / run input.';

  const planRefWake = planRefEarly || resolveGoalPlanRefForRun(id, watch);
  let prompt =
    '[Workflow run terminal - continue orchestration]\n' +
    (planRefWake
      ? '[goal_run_id: ' +
        planRefWake.goal_run_id +
        ']\n' +
        '[goal_title: ' +
        clip(planRefWake.title, 120) +
        ']\n' +
        (planRefWake.step_label
          ? '[goal_step: ' + clip(planRefWake.step_label, 80) + ']\n'
          : '')
      : '') +
    '[ceo_user_id: ' +
    owner +
    ']\n' +
    '[owner_user_id: ' +
    owner +
    ']\n' +
    '[workflow_run_id: ' +
    id +
    ']\n' +
    '[workflow_run_number: ' +
    (run.run_number ?? '') +
    ']\n' +
    '[definition_id: ' +
    run.definition_id +
    ']\n' +
    '[definition_name: ' +
    name +
    ']\n' +
    '[status: ' +
    run.status +
    ']\n' +
    '[multi_phase_crm_to_erp: ' +
    (multiPhaseCrmToErp ? 'YES' : 'no') +
    ']\n\n' +
    'A workflow you (or this org COO) started has reached a terminal status while your chat turn was already closed (async trigger).\n\n' +
    '**Workflow:** ' +
    name +
    ' · run ' +
    runLabel +
    ' (id ' +
    id +
    ') -> **' +
    run.status +
    '**' +
    (err ? '\n**Error:** ' + err : '') +
    '\n\n' +
    multiPhaseNote +
    '\n\n' +
    '**Original run input (phase context):**\n' +
    (initial || '(empty)') +
    '\n\n' +
    '**Step outcomes (latest):**\n' +
    stepSummary +
    '\n\n' +
    '**Your job now (mandatory):**\n' +
    (multiPhaseCrmToErp
      ? '1. **HARD REQUIREMENT:** This run was **CRM maker-checker** and the CEO goal still requires **ERP O2C after CRM**. ' +
        'You MUST call **agent_workflow_trigger** now with phrase **run erp maker checker** (or the ERP workflow_id) and pass the **full customer story + Twenty CRM IDs** from the step outcomes. ' +
        'Do **not** decide this is CRM-only retest complete. Do **not** only notify_ceo without starting ERP.\n' +
        '2. After trigger returns run_id, confirm that ERP run_id and end the turn (async).\n' +
        '3. Never invent free-form CEO HITL Kanban; ERP >=5% discount uses workflow needs_ceo.\n'
      : '1. If this was one phase of a multi-phase CEO / scheduled goal (e.g. CRM then ERP O2C), continue the next phase now with agent_workflow_trigger (async) and full context.\n' +
        '2. If the full goal is already complete after this run, notify_ceo with a short final summary only.\n' +
        '3. Do not re-run the same phase unless it failed and the CEO still wants it.\n' +
        '4. Still non-blocking; never invent free-form CEO HITL Kanban.\n');

  try {
    prompt = await getPromptWithMemoryInjected(agent.id, prompt);
  } catch (_) {
    /* optional */
  }
  prompt = '[ceo_user_id: ' + owner + ']\n[owner_user_id: ' + owner + ']\n' + prompt;

  // Prefer the same OpenClaw session as the scheduled goal fire so phase-B context is retained.
  const sessionThread = goal?.id
    ? 'sched-' + String(goal.id).slice(0, 12)
    : 'coo-orch-' + owner.slice(0, 18);
  const sessionUser = openclaw.sessionUserFor(openclawId, owner, sessionThread);
  try {
    insertChatTurn({
      agentId: agent.id,
      ownerUserId: owner,
      role: 'user',
      content: (() => {
        const planRef = resolveGoalPlanRefForRun(id, watch);
        const planBit = planRef
          ? formatGoalPlanRef(planRef) + '. '
          : 'This workflow run is not bound to a goal plan. ';
        const nextBit = planRef
          ? 'Platform advances remaining plan steps; do not invent freeform agent_workflow_trigger for the next phase. Status-only reply if woken.'
          : 'Continue multi-phase only via agent_goal_create / an existing agr-… — do not invent binding from workflow run ids.';
        return (
          '[Workflow finished ' +
          run.status +
          '] ' +
          name +
          ' run ' +
          runLabel +
          '. ' +
          planBit +
          nextBit
        );
      })(),
    });
  } catch (e) {
    console.warn('[wf-run-watch] chat user turn:', e?.message || e);
  }

  try {
    console.info('[wf-run-watch] coo wake start', {
      runId: id,
      status: run.status,
      agent: agent.id,
      openclawId,
    });
    const { content } = await openclaw.chatCompletions(
      openclawId,
      [{ role: 'user', content: prompt }],
      sessionUser,
      false,
      { injectLearningsInstruction: true, injectKanbanInstruction: true }
    );
    const reply = String(content || '').trim() || '(no response)';
    try {
      insertChatTurn({ agentId: agent.id, ownerUserId: owner, role: 'assistant', content: reply });
    } catch (_) {
      /* ignore */
    }
    console.info('[wf-run-watch] coo wake done', {
      runId: id,
      agent: agent.id,
      replyLen: reply.length,
    });
    return {
      ok: true,
      run_id: id,
      agent_id: agent.id,
      reply_preview: reply.slice(0, 500),
    };
  } catch (errWake) {
    const msg = errWake?.message || String(errWake);
    console.error('[wf-run-watch] coo wake failed', id, msg);
    return { ok: false, run_id: id, error: msg };
  }
}

/** Notify when a run reaches completed/failed/cancelled (idempotent per event). */
export function notifyWorkflowRunTerminal(runId) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run || !TERMINAL.has(String(run.status || ''))) return null;
  const context = parseContext(run);
  const watch = context.coo_run_watch;
  const watchActive = isPlatformCronActive('workflow_terminal_watch');
  const boundEarly = typeof findGoalStepByWorkflowRun === 'function' ? findGoalStepByWorkflowRun(id) : null;
  const advanceGoal = () => {
    if (boundEarly?.goal?.id) {
      void onWorkflowTerminalForGoalRun(id).catch((e) =>
        console.warn('[wf-run-watch] goal-run advance failed:', e?.message || e)
      );
    }
  };
  if (!watchActive) {
    advanceGoal();
    return null;
  }
  if (!watch?.enabled || watch.notify_on_terminal === false) {
    if (watch?.enabled && watch.wake_orchestrator_on_terminal !== false) {
      void wakeOrchestratorOnWorkflowTerminal(id).catch((e) =>
        console.warn('[wf-run-watch] coo wake (notify skip path):', e?.message || e)
      );
    }
    advanceGoal();
    return null;
  }
  const eventKey = 'terminal:' + run.status;
  if (!markEvent(context, eventKey)) {
    void wakeOrchestratorOnWorkflowTerminal(id).catch((e) =>
      console.warn('[wf-run-watch] coo wake (replay):', e?.message || e)
    );
    advanceGoal();
    return null;
  }
  saveContext(id, context);

  const name = definitionName(run.definition_id);
  const runLabel = run.run_number != null ? '#' + run.run_number : '#' + id;
  const planRef = resolveGoalPlanRefForRun(id, watch);
  const planLabel = planRef ? formatGoalPlanRef(planRef) : '';
  const title = planRef
    ? (run.status === 'completed'
        ? 'Goal plan step finished: ' + (planRef.title || planRef.goal_run_id)
        : 'Goal plan step ' + run.status + ': ' + (planRef.title || planRef.goal_run_id))
    : run.status === 'completed'
      ? 'Workflow finished: ' + name
      : 'Workflow ' + run.status + ': ' + name;
  const err = run.error_message ? String(run.error_message).slice(0, 280) : '';
  const body =
    run.status === 'completed'
      ? (planLabel ? planLabel + '\n' : '') +
        name +
        ' · workflow run ' +
        runLabel +
        ' completed.' +
        (planRef
          ? ' Platform advances remaining goal-plan steps in the background.'
          : ' Open Workflows for details (this workflow run is not a goal plan).')
      : (planLabel ? planLabel + '\n' : '') +
        name +
        ' · workflow run ' +
        runLabel +
        ' ' +
        run.status +
        (err ? ': ' + err : '');

  console.info('[wf-run-watch] terminal', { runId: id, status: run.status });
  const notifyResult = pushNotify({
    ownerUserId: watch.owner_user_id || run.owner_user_id,
    title,
    body,
    runId: id,
    sourceKey: 'wf-run:' + id + ':' + eventKey,
    actorAgentId: watch.actor_agent_id,
  });

  // Generic goal plan advance (CRM->ERP etc.) — prefer plan engine over ad-hoc COO wake.
  if (boundEarly?.goal?.id) {
    void onWorkflowTerminalForGoalRun(id).catch((e) =>
      console.warn('[wf-run-watch] goal-run advance failed:', e?.message || e)
    );
  } else if (watch.wake_orchestrator_on_terminal !== false) {
    void wakeOrchestratorOnWorkflowTerminal(id).catch((e) =>
      console.warn('[wf-run-watch] coo wake failed after terminal notify:', e?.message || e)
    );
  }

  return notifyResult;
}

/** Notify when a run is blocked on a ceo_approval step (idempotent per step). */
export function notifyWorkflowRunWaitingCeo(runId, { nodeId, kanbanTaskId = null } = {}) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return null;
  const context = parseContext(run);
  const watch = context.coo_run_watch;
  if (!watch?.enabled || watch.notify_on_waiting === false) return null;
  const step = String(nodeId || 'ceo_approval').slice(0, 80);
  const eventKey = 'waiting_ceo:' + step;
  if (!markEvent(context, eventKey)) return null;
  saveContext(id, context);

  const name = definitionName(run.definition_id);
  const runLabel = run.run_number != null ? '#' + run.run_number : '#' + id;
  const planRef = resolveGoalPlanRefForRun(id, watch);
  const planLabel = planRef ? formatGoalPlanRef(planRef) : '';
  const kanbanBit = kanbanTaskId ? ' Kanban #' + kanbanTaskId + '.' : '';
  const title = planRef
    ? 'Goal plan needs CEO approval: ' + (planRef.title || planRef.goal_run_id)
    : 'Workflow needs CEO approval: ' + name;
  const body =
    (planLabel ? planLabel + '\n' : '') +
    name +
    ' · run ' +
    runLabel +
    ' is waiting on CEO approval.' +
    kanbanBit +
    ' Use Approve/Reject on the Kanban card (chat "Approved" alone does not resume).';

  console.info('[wf-run-watch] waiting_ceo', { runId: id, nodeId: step, kanbanTaskId });
  return pushNotify({
    ownerUserId: watch.owner_user_id || run.owner_user_id,
    title,
    body,
    runId: id,
    sourceKey: 'wf-run:' + id + ':' + eventKey,
    actorAgentId: watch.actor_agent_id,
  });
}

/**
 * COO cron-friendly poll: NO_REPLY while running; notify text when waiting/terminal.
 */
export async function runWorkflowWatchTick({ runId, cronJobId = null, ownerUserId = null }) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'run_id required' };
  const run = ownerUserId
    ? db()
        .prepare('SELECT * FROM agent_workflow_runs WHERE id = ? AND owner_user_id = ?')
        .get(id, ownerUserId)
    : db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run) return { ok: false, error: 'run not found' };

  const name = definitionName(run.definition_id);
  const runLabel = run.run_number != null ? '#' + run.run_number : '#' + id;
  const status = String(run.status || '');

  if (status === 'running') {
    const ceoStep = db()
      .prepare(
        "SELECT node_id, kanban_task_id FROM agent_workflow_run_steps " +
          "WHERE run_id = ? AND status = 'in_progress' " +
          "AND (node_type = 'ceo_approval' OR lower(COALESCE(node_type, '')) LIKE '%ceo%' " +
          "OR lower(node_id) LIKE '%ceo%') " +
          'ORDER BY id DESC LIMIT 1'
      )
      .get(id);
    if (ceoStep) {
      const reply = [
        'Workflow ' + name + ' run ' + runLabel + ' is waiting for CEO approval',
        ceoStep.kanban_task_id ? '(Kanban #' + ceoStep.kanban_task_id + ').' : '.',
        'Use Kanban Approve/Reject - free-form chat does not resume.',
      ].join(' ');
      return {
        ok: true,
        run_id: id,
        status: 'awaiting_ceo',
        phase: 'waiting_ceo',
        reply,
        stop_cron: false,
        notify_text: reply,
      };
    }
    return {
      ok: true,
      run_id: id,
      status,
      phase: 'running',
      reply: 'NO_REPLY',
      stop_cron: false,
    };
  }

  if (TERMINAL.has(status)) {
    const err = clip(run.error_message, 200);
    const planRef = resolveGoalPlanRefForRun(id, parseContext(run).coo_run_watch);
    const planPrefix = planRef ? formatGoalPlanRef(planRef) + '. ' : '';
    const reply =
      status === 'completed'
        ? planPrefix + 'Workflow ' + name + ' run ' + runLabel + ' completed.'
        : planPrefix +
          'Workflow ' +
          name +
          ' run ' +
          runLabel +
          ' ' +
          status +
          (err ? ': ' + err : '') +
          '.';

    const cron_removed = [];
    if (cronJobId) {
      try {
        await openclawAdminRpc('cron.remove', { id: cronJobId });
        cron_removed.push(cronJobId);
      } catch (e) {
        console.warn('[wf-run-watch] cron remove failed', cronJobId, e?.message || e);
      }
    }

    return {
      ok: true,
      run_id: id,
      status,
      phase: 'terminal',
      reply,
      notify_text: reply,
      stop_cron: true,
      cron_removed,
    };
  }

  return {
    ok: true,
    run_id: id,
    status,
    phase: 'unknown',
    reply: 'NO_REPLY',
    stop_cron: false,
  };
}

/** Auto-register when COO/chat triggers a run (non-blocking ack path). */
export function maybeAutoRegisterRunWatch(run, actor) {
  if (!run?.id) return null;
  const actorId = String(actor?.id || '').trim();
  const actorType = String(actor?.type || '').toLowerCase();
  const looksCoo =
    actorType === 'coo' ||
    actorType === 'workflow_builder' ||
    actorType === 'video_orchestrator' ||
    /balserve|coo|workflowbuilder|video-orch/i.test(actorId);
  if (!looksCoo && actorType !== 'chat') return null;
  return registerWorkflowRunWatch(run.id, {
    ownerUserId: run.owner_user_id,
    actorAgentId: isPlaceholderActor(actorId) ? null : actorId,
    actorName: isPlaceholderActor(actorId) ? null : actor?.name || null,
  });
}
