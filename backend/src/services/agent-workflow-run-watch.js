/**
 * COO-friendly workflow run watches: fire-and-forget after agent_workflow_trigger.
 * Platform notifies the entitled CEO when a run completes, fails, or waits on ceo_approval.
 */
import { getDb } from '../db/schema.js';
import { sendPlatformNotifications } from './platform-notifications.js';
import { openclawAdminRpc } from '../gateway/openclaw-admin-rpc.js';

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
      'UPDATE agent_workflow_runs SET context_json = ?, updated_at = datetime(\'now\') WHERE id = ?'
    )
    .run(JSON.stringify(context || {}), runId);
}

function definitionName(definitionId) {
  const row = db()
    .prepare('SELECT name FROM agent_workflow_definitions WHERE id = ?')
    .get(definitionId);
  return row?.name || definitionId || 'Workflow';
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
  context.coo_run_watch = {
    enabled: true,
    owner_user_id: owner,
    actor_agent_id: actorAgentId || prev.actor_agent_id || null,
    actor_name: actorName || prev.actor_name || null,
    notify_on_waiting: notifyOnWaiting !== false,
    notify_on_terminal: notifyOnTerminal !== false,
    registered_at: prev.registered_at || new Date().toISOString(),
    refreshed_at: new Date().toISOString(),
    events_sent: Array.isArray(prev.events_sent) ? prev.events_sent : [],
  };
  saveContext(id, context);
  console.info('[wf-run-watch] registered', { runId: id, owner, actorAgentId });
  return {
    ok: true,
    run_id: id,
    status: run.status,
    watch: context.coo_run_watch,
    async: true,
    instruction:
      'Do not wait on this run in chat. Confirm run_id to the CEO, then stop this turn. ' +
      'Platform notifies when the run waits for CEO approval or reaches a terminal status. ' +
      'Use agent_workflow_runs / agent_workflow_watch_tick only if the CEO asks for status.',
  };
}

function markEvent(context, eventKey) {
  const watch = context.coo_run_watch;
  if (!watch || !watch.enabled) return false;
  const sent = Array.isArray(watch.events_sent) ? watch.events_sent : [];
  if (sent.includes(eventKey)) return false;
  sent.push(eventKey);
  watch.events_sent = sent.slice(-20);
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

/** Notify when a run reaches completed/failed/cancelled (idempotent per event). */
export function notifyWorkflowRunTerminal(runId) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const run = db().prepare('SELECT * FROM agent_workflow_runs WHERE id = ?').get(id);
  if (!run || !TERMINAL.has(String(run.status || ''))) return null;
  const context = parseContext(run);
  const watch = context.coo_run_watch;
  if (!watch?.enabled || watch.notify_on_terminal === false) return null;
  const eventKey = 'terminal:' + run.status;
  if (!markEvent(context, eventKey)) return null;
  saveContext(id, context);

  const name = definitionName(run.definition_id);
  const runLabel = run.run_number != null ? '#' + run.run_number : '#' + id;
  const title =
    run.status === 'completed' ? 'Workflow finished: ' + name : 'Workflow ' + run.status + ': ' + name;
  const err = run.error_message ? String(run.error_message).slice(0, 280) : '';
  const body =
    run.status === 'completed'
      ? name + ' · run ' + runLabel + ' completed. Open Workflows for details.'
      : name + ' · run ' + runLabel + ' ' + run.status + (err ? ': ' + err : '');

  console.info('[wf-run-watch] terminal', { runId: id, status: run.status });
  return pushNotify({
    ownerUserId: watch.owner_user_id || run.owner_user_id,
    title,
    body,
    runId: id,
    sourceKey: 'wf-run:' + id + ':' + eventKey,
    actorAgentId: watch.actor_agent_id,
  });
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
  const kanbanBit = kanbanTaskId ? ' Kanban #' + kanbanTaskId + '.' : '';
  const title = 'Workflow needs CEO approval: ' + name;
  const body =
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

function clip(s, n = 400) {
  const t = String(s || '').trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + '...';
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
        'Use Kanban Approve/Reject — free-form chat does not resume.',
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
    const reply =
      status === 'completed'
        ? 'Workflow ' + name + ' run ' + runLabel + ' completed.'
        : 'Workflow ' +
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
    /balserve|coo|workflowbuilder/i.test(actorId);
  if (!looksCoo && actorType !== 'chat') return null;
  return registerWorkflowRunWatch(run.id, {
    ownerUserId: run.owner_user_id,
    actorAgentId: actorId || null,
    actorName: actor?.name || null,
  });
}
