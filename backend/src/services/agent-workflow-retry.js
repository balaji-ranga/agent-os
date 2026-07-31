/**
 * Retry agent workflow runs: from start (new run) or from failed step (resume same run).
 */
import { getDb } from '../db/schema.js';
import * as store from './agent-workflow-store.js';
import { startAgentWorkflowRun, resumeRunFromFailedStep } from './agent-workflow-runner.js';
import { cancelAllListenersForRun } from './agent-workflow-event-listener.js';

function db() {
  return getDb();
}

function normalizeMode(mode) {
  const m = String(mode || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (['from_start', 'start', 'restart', 'new_run'].includes(m)) return 'from_start';
  if (['from_failed_step', 'from_failed', 'failed_step', 'resume_failed', 'retry_failed'].includes(m)) {
    return 'from_failed_step';
  }
  return null;
}

/**
 * @param {number|string} runId
 * @param {string} ownerUserId
 * @param {{ mode: string, node_id?: string, input?: any, actor?: object }} opts
 */
export async function retryAgentWorkflowRun(runId, ownerUserId, opts = {}) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('run_id required');
    err.status = 400;
    throw err;
  }
  const mode = normalizeMode(opts.mode);
  if (!mode) {
    const err = new Error('mode must be from_start or from_failed_step');
    err.status = 400;
    throw err;
  }

  const run = store.getRun(id, ownerUserId);
  if (!run) {
    const err = new Error('Run not found');
    err.status = 404;
    throw err;
  }

  if (mode === 'from_start') {
    return retryFromStart(run, ownerUserId, opts);
  }
  return retryFromFailedStep(run, ownerUserId, opts);
}

async function retryFromStart(run, ownerUserId, { input, actor } = {}) {
  if (!['failed', 'paused', 'completed', 'cancelled'].includes(run.status)) {
    const err = new Error(`Cannot retry-from-start while run is ${run.status} (pause or wait for it to finish)`);
    err.status = 409;
    throw err;
  }
  const def = store.getDefinition(run.definition_id, ownerUserId);
  if (!def) {
    const err = new Error('Workflow not found');
    err.status = 404;
    throw err;
  }
  if (def.paused) {
    const err = new Error('Workflow is paused — resume the workflow before retrying');
    err.status = 409;
    throw err;
  }

  let resolvedInput = input;
  if (resolvedInput === undefined || resolvedInput === null || resolvedInput === '') {
    resolvedInput = run.context?.initial_input ?? '';
  }

  const newRun = await startAgentWorkflowRun(run.definition_id, ownerUserId, {
    trigger: 'manual',
    input: resolvedInput,
    actor: actor || { id: 'retry', name: 'Retry from start' },
    variables: run.context?.workflow_variables || run.context?.variables || null,
  });

  store.appendAudit(run.definition_id, {
    action: 'run_retry_from_start',
    summary: `Retry from start: run #${run.run_number} (id ${run.id}) → new run #${newRun.run_number} (id ${newRun.id})`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  console.info('[agent-workflow] retry from_start', {
    source_run_id: run.id,
    new_run_id: newRun.id,
    definition_id: run.definition_id,
    ownerUserId,
  });

  return {
    ok: true,
    mode: 'from_start',
    source_run_id: run.id,
    source_run_number: run.run_number,
    run_id: newRun.id,
    run_number: newRun.run_number,
    status: newRun.status,
    message: `Started new run #${newRun.run_number} from failed/prior run #${run.run_number}.`,
  };
}

async function retryFromFailedStep(run, ownerUserId, { node_id, actor } = {}) {
  if (!['failed', 'paused'].includes(run.status)) {
    const err = new Error(
      `Retry from failed step requires a failed or paused run (current status: ${run.status})`
    );
    err.status = 409;
    throw err;
  }

  const steps = run.steps || [];
  let failedStep = null;
  const wantNode = String(node_id || '').trim();
  if (wantNode) {
    failedStep = [...steps].reverse().find((s) => s.node_id === wantNode && s.status === 'failed');
    if (!failedStep) {
      failedStep = [...steps].reverse().find((s) => s.node_id === wantNode);
    }
  } else {
    failedStep = [...steps].reverse().find((s) => s.status === 'failed');
  }
  if (!failedStep) {
    const err = new Error('No failed step found on this run — pass node_id or use mode from_start');
    err.status = 400;
    throw err;
  }

  cancelAllListenersForRun(run.id);

  // Cancel leftover pending/processing delegations for this run
  const pattern = `%agent_wf_run_id: ${run.id}%`;
  db()
    .prepare(
      `UPDATE agent_delegation_tasks SET status = 'failed', error_message = 'workflow retry from failed step',
       completed_at = datetime('now')
       WHERE status IN ('pending', 'processing') AND prompt LIKE ?`
    )
    .run(pattern);

  const result = await resumeRunFromFailedStep(run.id, failedStep.node_id, {
    ownerUserId,
    actor,
  });

  store.appendAudit(run.definition_id, {
    action: 'run_retry_from_failed_step',
    summary: `Retry from failed step ${failedStep.node_label || failedStep.node_id} on run #${run.run_number}`,
    changedBy: actor?.id,
    changedByName: actor?.name,
  });

  console.info('[agent-workflow] retry from_failed_step', {
    run_id: run.id,
    node_id: failedStep.node_id,
    ownerUserId,
  });

  return {
    ok: true,
    mode: 'from_failed_step',
    run_id: run.id,
    run_number: run.run_number,
    node_id: failedStep.node_id,
    node_label: failedStep.node_label || failedStep.node_id,
    node_type: failedStep.node_type,
    status: 'running',
    message: result?.message || `Resumed run #${run.run_number} from step ${failedStep.node_label || failedStep.node_id}.`,
  };
}

/**
 * COO / Workflow Builder tool entry point.
 */
export async function executeAgentWorkflowRetry(body, { ownerUserId } = {}) {
  const runId = body?.run_id ?? body?.runId;
  const mode = body?.mode || body?.retry_mode || body?.action;
  const nodeId = body?.node_id || body?.nodeId || null;
  const input = body?.input;
  const actor = body?.actor || null;
  try {
    return await retryAgentWorkflowRun(runId, ownerUserId, {
      mode,
      node_id: nodeId,
      input,
      actor,
    });
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      status: e.status || 500,
    };
  }
}