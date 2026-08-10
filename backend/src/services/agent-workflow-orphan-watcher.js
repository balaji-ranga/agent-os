/**
 * Workflow run orphan / stuck-step recovery.
 * Works with kanban orphan watcher — accurate stall signals, plus a 24h hard renudge.
 *
 * Accurate "stuck" (may renudge sooner than 24h for agent nodes only):
 * - Linked agent_delegation_tasks is missing / failed
 * - Delegation completed but step still in_progress
 * - Delegation stuck in processing longer than specialty processing stale window
 *   (not a healthy slow call: re-pend path after OpenClaw fetch window)
 *
 * Never auto-retry solely because a node "is taking time" within normal timeouts.
 * External wait: ceo_approval and listening nodes are not soft-stuck (human / event wait).
 * Any non-terminal step in_progress / pending (except intentional external wait until 24h)
 * that has been open for WORKFLOW_STUCK_HARD_HOURS (default 24) is hard-stuck → retry step.
 */
import { getDb } from '../db/schema.js';
import { isAgentWorkflowPrompt } from './agent-workflow-kanban.js';
import { releaseDelegationRunLock } from './delegation-queue.js';
import { cancelAllListenersForRun } from './agent-workflow-event-listener.js';

function db() {
  return getDb();
}

/** Hard renudge after this many hours (default 24). */
export function workflowStuckHardHours() {
  const n = Number(process.env.WORKFLOW_STUCK_HARD_HOURS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 24;
}

/** Soft processing stall for agent workflow delegations (seconds). Aligns with specialty orphan. */
function workflowAgentProcessingStaleSec() {
  const ms = Number(process.env.DELEGATION_SPECIALTY_PROCESSING_TIMEOUT_MS);
  if (Number.isFinite(ms) && ms >= 60000) return Math.ceil(ms / 1000);
  const fetchMs = Number(process.env.OPENCLAW_FETCH_TIMEOUT_MS);
  const fromFetch = Number.isFinite(fetchMs) && fetchMs >= 60000 ? Math.ceil(fetchMs / 1000) + 60 : 0;
  return Math.max(fromFetch, 180);
}

function parseAgeMs(isoLike) {
  if (!isoLike) return null;
  const raw = String(isoLike).trim();
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
  const t = Date.parse(normalized);
  return Number.isFinite(t) ? Date.now() - t : null;
}

function hoursToMs(h) {
  return Number(h) * 3600 * 1000;
}

/** Node types that wait outside the process (do not soft-stuck-retry). */
const EXTERNAL_WAIT = new Set(['ceo_approval', 'sse_listen', 'mcp_listen']);

/**
 * @returns {{ stuck: boolean, hard: boolean, reason: string|null, soft: boolean }}
 */
export function diagnoseWorkflowStepStuck(step, { delegation = null, nodeType = null } = {}) {
  const status = String(step?.status || '');
  if (!['in_progress', 'pending', 'listening'].includes(status)) {
    return { stuck: false, hard: false, soft: false, reason: null };
  }

  const type = String(nodeType || step.node_type || '').toLowerCase();
  const ageMs = parseAgeMs(step.started_at || step.created_at);
  const hardMs = hoursToMs(workflowStuckHardHours());
  const hard = ageMs != null && ageMs >= hardMs;

  if (EXTERNAL_WAIT.has(type) || status === 'listening') {
    // Human / event wait — only hard age renudge
    if (hard) return { stuck: true, hard: true, soft: false, reason: 'hard_wait_timeout_24h' };
    return { stuck: false, hard: false, soft: false, reason: null };
  }

  if (type === 'agent') {
    const del = delegation;
    if (!step.delegation_task_id || !del) {
      if (ageMs != null && ageMs >= 60_000) {
        return { stuck: true, hard, soft: true, reason: 'missing_delegation' };
      }
      return { stuck: false, hard: false, soft: false, reason: null };
    }
    if (del.status === 'failed') {
      return {
        stuck: true,
        hard,
        soft: true,
        reason: `delegation_failed:${String(del.error_message || '').slice(0, 80)}`,
      };
    }
    if (del.status === 'completed' && status === 'in_progress') {
      return { stuck: true, hard, soft: true, reason: 'delegation_completed_step_open' };
    }
    if (del.status === 'processing') {
      const delAge = parseAgeMs(del.created_at);
      const staleSec = workflowAgentProcessingStaleSec();
      if (delAge != null && delAge >= staleSec * 1000) {
        return {
          stuck: true,
          hard,
          soft: true,
          reason: `delegation_processing_stale_${staleSec}s`,
        };
      }
    }
    // Healthy pending or recent processing — not soft-stuck
    if (hard) return { stuck: true, hard: true, soft: false, reason: 'hard_24h' };
    return { stuck: false, hard: false, soft: false, reason: null };
  }

  // Timed nodes (api, brain, tool…): trust node timeout watchdog for soft; hard 24h only
  if (hard && status === 'in_progress') {
    return { stuck: true, hard: true, soft: false, reason: 'hard_24h' };
  }
  return { stuck: false, hard: false, soft: false, reason: null };
}

/**
 * Re-pend workflow agent delegations stuck in processing (previously skipped by kanban orphan).
 */
export function recoverStaleWorkflowAgentProcessing({ ownerUserId = null, limit = 40 } = {}) {
  const staleSec = workflowAgentProcessingStaleSec();
  const owner = String(ownerUserId || '').trim() || null;
  let rows;
  try {
    if (owner) {
      rows = db()
        .prepare(
          `SELECT id, to_agent_id, prompt, owner_user_id, created_at
           FROM agent_delegation_tasks
           WHERE status = 'processing'
             AND prompt LIKE '%agent_wf_run_id:%'
             AND (owner_user_id = ? OR prompt LIKE ?)
             AND datetime(created_at) < datetime('now', ?)
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(owner, `%owner_user_id: ${owner}%`, `-${staleSec} seconds`, limit);
    } else {
      rows = db()
        .prepare(
          `SELECT id, to_agent_id, prompt, owner_user_id, created_at
           FROM agent_delegation_tasks
           WHERE status = 'processing'
             AND prompt LIKE '%agent_wf_run_id:%'
             AND datetime(created_at) < datetime('now', ?)
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(`-${staleSec} seconds`, limit);
    }
  } catch (e) {
    console.warn('[wf-orphan] stale processing lookup failed', e?.message || e);
    return { scanned: 0, recovered: 0, stale_sec: staleSec, details: [] };
  }

  let recovered = 0;
  const details = [];
  for (const row of rows) {
    if (!isAgentWorkflowPrompt(row.prompt)) continue;
    const r = db()
      .prepare(
        `UPDATE agent_delegation_tasks
         SET status = 'pending',
             error_message = ?,
             completed_at = NULL
         WHERE id = ? AND status = 'processing'`
      )
      .run(`[wf-orphan] re-pended after ${staleSec}s stuck in processing`, row.id);
    if (r.changes) {
      releaseDelegationRunLock(row.id);
      recovered += 1;
      details.push({ delegation_id: row.id, agent: row.to_agent_id });
      console.info(
        '[wf-orphan] re-pended workflow agent del=%s agent=%s stale_sec=%s',
        row.id,
        row.to_agent_id,
        staleSec
      );
    }
  }
  return { scanned: rows.length, recovered, stale_sec: staleSec, details };
}

/**
 * Scan agent_workflow_run_steps for accurately stuck steps and resume from that node.
 */
export async function recoverStuckWorkflowRunSteps({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const hardH = workflowStuckHardHours();
  // Load candidate steps on non-terminal runs
  const sql = owner
    ? `SELECT s.id AS step_id, s.run_id, s.node_id, s.node_type, s.node_label, s.status,
              s.started_at, s.delegation_task_id, s.kanban_task_id,
              r.owner_user_id, r.status AS run_status, r.run_number, r.definition_id
       FROM agent_workflow_run_steps s
       JOIN agent_workflow_runs r ON r.id = s.run_id
       WHERE r.owner_user_id = ?
         AND r.status IN ('running', 'paused')
         AND s.status IN ('in_progress', 'pending', 'listening')
         AND s.id = (
           SELECT s2.id FROM agent_workflow_run_steps s2
           WHERE s2.run_id = s.run_id AND s2.node_id = s.node_id
           ORDER BY s2.id DESC LIMIT 1
         )
       ORDER BY s.started_at ASC
       LIMIT ?`
    : `SELECT s.id AS step_id, s.run_id, s.node_id, s.node_type, s.node_label, s.status,
              s.started_at, s.delegation_task_id, s.kanban_task_id,
              r.owner_user_id, r.status AS run_status, r.run_number, r.definition_id
       FROM agent_workflow_run_steps s
       JOIN agent_workflow_runs r ON r.id = s.run_id
       WHERE r.status IN ('running', 'paused')
         AND s.status IN ('in_progress', 'pending', 'listening')
         AND s.id = (
           SELECT s2.id FROM agent_workflow_run_steps s2
           WHERE s2.run_id = s.run_id AND s2.node_id = s.node_id
           ORDER BY s2.id DESC LIMIT 1
         )
       ORDER BY s.started_at ASC
       LIMIT ?`;

  const rows = owner ? db().prepare(sql).all(owner, limit * 4) : db().prepare(sql).all(limit * 4);

  // Deduplicate by run_id — only renudge first stuck node per run
  const byRun = new Map();
  for (const row of rows) {
    if (byRun.has(row.run_id)) continue;
    let del = null;
    if (row.delegation_task_id) {
      del = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(row.delegation_task_id);
    }
    const diag = diagnoseWorkflowStepStuck(row, { delegation: del, nodeType: row.node_type });
    if (!diag.stuck) continue;
    byRun.set(row.run_id, { row, del, diag });
    if (byRun.size >= limit) break;
  }

  let retried = 0;
  let skipped = 0;
  const details = [];

  // Lazy import to avoid circular deps with runner at module load
  const { resumeRunFromStep } = await import('./agent-workflow-runner.js');

  for (const { row, diag } of byRun.values()) {
    try {
      // Cancel hung del so a new step dispatch does not race
      if (row.delegation_task_id) {
        db()
          .prepare(
            `UPDATE agent_delegation_tasks
             SET status = 'failed',
                 error_message = ?,
                 completed_at = datetime('now')
             WHERE id = ? AND status IN ('pending', 'processing')`
          )
          .run(`[wf-orphan] ${diag.reason}`, row.delegation_task_id);
        releaseDelegationRunLock(row.delegation_task_id);
      }
      cancelAllListenersForRun(row.run_id);

      const out = await resumeRunFromStep(row.run_id, row.node_id, {
        ownerUserId: row.owner_user_id,
        actor: { id: 'wf-orphan', name: 'Workflow orphan watcher' },
        reason: diag.reason,
        allowRunning: true,
      });
      retried += 1;
      details.push({
        ok: true,
        run_id: row.run_id,
        run_number: row.run_number,
        node_id: row.node_id,
        reason: diag.reason,
        hard: diag.hard,
        ...out,
      });
      console.info(
        '[wf-orphan] retry step run=%s node=%s reason=%s hard=%s',
        row.run_id,
        row.node_id,
        diag.reason,
        diag.hard
      );
    } catch (e) {
      skipped += 1;
      details.push({
        ok: false,
        run_id: row.run_id,
        node_id: row.node_id,
        reason: diag.reason,
        error: e?.message || String(e),
      });
      console.warn(
        '[wf-orphan] retry failed run=%s node=%s:',
        row.run_id,
        row.node_id,
        e?.message || e
      );
    }
  }

  return {
    owner_user_id: owner,
    hard_hours: hardH,
    scanned: rows.length,
    candidates: byRun.size,
    retried,
    skipped,
    details,
  };
}

/** Full workflow orphan pass (stale processing re-pend + stuck step resume). */
export async function runWorkflowOrphanWatcher({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const stale = recoverStaleWorkflowAgentProcessing({ ownerUserId: owner, limit });
  const stuck = await recoverStuckWorkflowRunSteps({ ownerUserId: owner, limit });

  let process_pending = null;
  if ((stale.recovered || 0) > 0) {
    try {
      const { processPendingDelegationTasksForCeo, processPendingDelegationTasks } = await import(
        './delegation-queue.js'
      );
      if (owner) {
        await processPendingDelegationTasksForCeo(owner, { skipOrphanWatcher: true });
        process_pending = { owner_user_id: owner, kicked: true };
      } else {
        await processPendingDelegationTasks({ skipOrphanWatcher: true });
        process_pending = { all: true, kicked: true };
      }
    } catch (e) {
      console.warn('[wf-orphan] processPending kick failed:', e?.message || e);
      process_pending = { ok: false, error: e?.message || String(e) };
    }
  }

  return {
    owner_user_id: owner,
    stale_workflow_processing: stale,
    stuck_steps: stuck,
    process_pending,
  };
}
