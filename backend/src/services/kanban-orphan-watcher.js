/**
 * Kanban orphan watcher — find specialty cards stuck without a live agent run and reinitiate.
 *
 * Covers the gap left by job-pipeline-only stale recovery:
 *  - Specialty `agent_delegation_tasks` left in `processing` after a backend restart / hang
 *  - Cards in_progress whose linked delegation is missing / failed (transient)
 *  - Cards with an assigned agent but no delegation row at all
 *
 * Caps retries with [orphan_retry:N] on the Kanban description so a permanently-broken
 * agent cannot loop forever. CEO-approval and job-pipeline / workflow cards are skipped.
 */
import { getDb } from '../db/schema.js';
import { getOrCreateDelegationHubStandup } from './standup-hub.js';
import {
  requeueStuckStatusOnlyKanbanCards,
  rependInfraFailedStatusOnlyRetries,
  isEligibleForStatusOnlyRetry,
} from './delegation-status-only-retry.js';
import { isAgentWorkflowPrompt } from './agent-workflow-kanban.js';
import { healStuckKanbanForCompletedDelegations } from './kanban-workflow-stage.js';
import { reconcileA2AKanbanForOwner } from './coo-status-checker.js';

const ORPHAN_TAG_RE = /\[orphan_retry:(\d+)\]/i;
const PIPELINE_TAG = '[job_pipeline';

function db() {
  return getDb();
}

function maxOrphanRetries() {
  const n = Number(process.env.KANBAN_ORPHAN_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 5) : 2;
}

/** Seconds a specialty task may sit in `processing` before we re-pend it. Default 10 min. */
function specialtyProcessingStaleSec() {
  const ms = Number(process.env.DELEGATION_SPECIALTY_PROCESSING_TIMEOUT_MS);
  if (Number.isFinite(ms) && ms >= 60000) return Math.ceil(ms / 1000);
  const pipelineMs = Number(process.env.DELEGATION_PROCESSING_TIMEOUT_MS);
  if (Number.isFinite(pipelineMs) && pipelineMs >= 60000) return Math.ceil(pipelineMs / 1000);
  return 600;
}

export function getOrphanRetryCount(description) {
  const m = String(description || '').match(ORPHAN_TAG_RE);
  return m ? Number(m[1]) || 0 : 0;
}

export function withOrphanRetryCount(description, count) {
  const base = String(description || '')
    .replace(ORPHAN_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const tag = `[orphan_retry:${count}]`;
  return base ? `${base}\n${tag}` : tag;
}

function isCeoApprovalCard(task) {
  const d = String(task.description || '').toLowerCase();
  return (
    task.status === 'awaiting_confirmation' ||
    d.includes('node_type: ceo_approval') ||
    d.includes('node_type:ceo_approval') ||
    d.includes('ceo approval') ||
    d.includes('awaiting ceo') ||
    /approve\b/i.test(String(task.title || ''))
  );
}

function isPermanentFailure(errorMessage) {
  const msg = String(errorMessage || '');
  return /budget exceeded|budget-gate|agent not found|not entitled|private a2a|monthly token budget exhausted/i.test(
    msg
  );
}

function resolvePromptFromKanban(kanban, oldDelegation) {
  const fromDel = String(oldDelegation?.prompt || '').trim();
  if (fromDel) {
    return fromDel
      .replace(/\n*---\n\[System — automatic retry[\s\S]*?---\s*$/m, '')
      .replace(/\n*---\n\[System — orphan watcher[\s\S]*?---\s*$/m, '')
      .trim();
  }
  const desc = String(kanban.description || '');
  const afterHeader = desc.split(/\n\n/).slice(1).join('\n\n').trim();
  const withoutMeta = afterHeader
    .replace(/\n*---\n[\s\S]*$/m, '')
    .replace(/\[orphan_retry:\d+\]/gi, '')
    .replace(/\[status_only_retry:\d+\]/gi, '')
    .trim();
  if (withoutMeta.length >= 8) return withoutMeta;
  return String(kanban.title || '').trim();
}

function listStaleProcessing(owner, staleSec, limit) {
  try {
    if (owner) {
      return db()
        .prepare(
          `SELECT id, to_agent_id, prompt, owner_user_id, created_at
           FROM agent_delegation_tasks
           WHERE status = 'processing'
             AND prompt NOT LIKE ?
             AND (owner_user_id = ? OR (owner_user_id IS NULL AND standup_id IN (
               SELECT id FROM standups WHERE owner_user_id = ?
             )))
             AND datetime(created_at) < datetime('now', ?)
           ORDER BY created_at ASC
           LIMIT ?`
        )
        .all(`${PIPELINE_TAG}%`, owner, owner, `-${staleSec} seconds`, limit);
    }
    return db()
      .prepare(
        `SELECT id, to_agent_id, prompt, owner_user_id, created_at
         FROM agent_delegation_tasks
         WHERE status = 'processing'
           AND prompt NOT LIKE ?
           AND datetime(created_at) < datetime('now', ?)
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(`${PIPELINE_TAG}%`, `-${staleSec} seconds`, limit);
  } catch (e) {
    console.warn('[orphan-watcher] stale processing lookup failed', e?.message || e);
    return [];
  }
}

/**
 * Re-pend specialty (non-pipeline) delegations stuck in `processing`.
 * After a backend restart the in-memory running set is empty but SQLite still says
 * processing — without this, Vedic/TechResearcher cards sit in_progress forever.
 */
export function recoverStaleSpecialtyProcessingDelegations({
  ownerUserId = null,
  limit = 40,
} = {}) {
  const staleSec = specialtyProcessingStaleSec();
  const owner = String(ownerUserId || '').trim() || null;
  const rows = listStaleProcessing(owner, staleSec, limit);

  let recovered = 0;
  const details = [];
  for (const row of rows) {
    if (isAgentWorkflowPrompt(row.prompt) && /\[agent_workflow/i.test(row.prompt)) {
      continue;
    }
    const r = db()
      .prepare(
        `UPDATE agent_delegation_tasks
         SET status = 'pending',
             error_message = ?,
             completed_at = NULL
         WHERE id = ? AND status = 'processing'`
      )
      .run(`[orphan-watcher] re-pended after ${staleSec}s stuck in processing`, row.id);
    if (r.changes) {
      recovered += 1;
      details.push({ delegation_id: row.id, agent: row.to_agent_id });
      db()
        .prepare(
          `UPDATE kanban_tasks
           SET status = 'in_progress', updated_at = datetime('now')
           WHERE agent_delegation_task_id = ? AND status NOT IN ('completed')`
        )
        .run(row.id);
      console.log(
        `[orphan-watcher] re-pended stuck processing delegation=${row.id} agent=${row.to_agent_id}`
      );
    }
  }
  return { scanned: rows.length, recovered, stale_sec: staleSec, details };
}

/**
 * Create a fresh pending delegation for a stuck specialty Kanban card and link it.
 */
export function reinitiateKanbanDelegation(kanbanId, { reason = 'orphan_watcher' } = {}) {
  const kanban = db().prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(kanbanId);
  if (!kanban) return { ok: false, reason: 'kanban_not_found' };
  if (!kanban.assigned_agent_id) return { ok: false, reason: 'no_assigned_agent' };
  if (kanban.assigned_member_key) return { ok: false, reason: 'external_leaf' };
  if (isCeoApprovalCard(kanban)) return { ok: false, reason: 'ceo_approval' };

  const retries = getOrphanRetryCount(kanban.description);
  if (retries >= maxOrphanRetries()) {
    return { ok: false, reason: 'max_retries', retries };
  }

  let old = null;
  if (kanban.agent_delegation_task_id) {
    old = db()
      .prepare(`SELECT * FROM agent_delegation_tasks WHERE id = ?`)
      .get(kanban.agent_delegation_task_id);
  }

  if (old && (old.status === 'pending' || old.status === 'processing')) {
    return { ok: false, reason: 'already_active', delegation_id: old.id, status: old.status };
  }
  if (old && isPermanentFailure(old.error_message)) {
    return { ok: false, reason: 'permanent_failure', error: old.error_message };
  }
  if (old?.prompt && !isEligibleForStatusOnlyRetry(old.prompt) && isAgentWorkflowPrompt(old.prompt)) {
    return { ok: false, reason: 'not_eligible' };
  }
  if (old?.prompt && String(old.prompt).includes(PIPELINE_TAG)) {
    return { ok: false, reason: 'job_pipeline' };
  }

  const promptBase = resolvePromptFromKanban(kanban, old);
  if (!promptBase || promptBase.length < 3) return { ok: false, reason: 'empty_prompt' };

  const nextRetry = retries + 1;
  const banner =
    `\n\n---\n[System — orphan watcher retry ${nextRetry}/${maxOrphanRetries()}] ` +
    `Your previous run did not finish (${reason}). Complete the CEO ask now and put the FULL ` +
    `answer in this reply. Call kanban_move_status → completed only after the deliverable is in the body.\n---`;
  const prompt = `${promptBase}${banner}`;

  const owner = String(kanban.owner_user_id || '').trim();
  if (!owner) return { ok: false, reason: 'no_owner' };

  const standupId = getOrCreateDelegationHubStandup(owner);
  const requestId = `orphan-${kanban.id}-${Date.now()}`;
  const info = db()
    .prepare(
      `INSERT INTO agent_delegation_tasks
         (standup_id, request_id, to_agent_id, prompt, status, owner_user_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .run(standupId, requestId, kanban.assigned_agent_id, prompt, owner);
  const newId = Number(info.lastInsertRowid);

  const desc = withOrphanRetryCount(
    `${kanban.description || ''}\n\n---\nOrphan watcher: reinitiated (${reason}) at ${new Date().toISOString()}`,
    nextRetry
  );
  db()
    .prepare(
      `UPDATE kanban_tasks
       SET status = 'in_progress',
           agent_delegation_task_id = ?,
           description = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(newId, desc, kanban.id);

  console.log(
    `[orphan-watcher] reinitiated kanban=${kanban.id} agent=${kanban.assigned_agent_id} ` +
      `delegation=${newId} retry=${nextRetry} reason=${reason}`
  );
  return {
    ok: true,
    kanban_id: kanban.id,
    new_delegation_id: newId,
    retry: nextRetry,
    agent_id: kanban.assigned_agent_id,
  };
}

/**
 * Scan for orphan / stuck specialty cards and reinitiate where safe.
 */
export function reinitiateOrphanKanbanCards({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const sql = owner
    ? `SELECT k.*
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.owner_user_id = ?
         AND k.assigned_agent_id IS NOT NULL
         AND k.assigned_member_key IS NULL
         AND k.status IN ('in_progress', 'failed', 'open')
         AND (
           k.agent_delegation_task_id IS NULL
           OR d.id IS NULL
           OR (d.status = 'failed')
           OR (d.status = 'completed' AND k.status = 'in_progress')
         )
         AND datetime(k.updated_at) < datetime('now', '-3 minutes')
       ORDER BY k.updated_at ASC
       LIMIT ?`
    : `SELECT k.*
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.assigned_agent_id IS NOT NULL
         AND k.assigned_member_key IS NULL
         AND k.status IN ('in_progress', 'failed', 'open')
         AND (
           k.agent_delegation_task_id IS NULL
           OR d.id IS NULL
           OR (d.status = 'failed')
           OR (d.status = 'completed' AND k.status = 'in_progress')
         )
         AND datetime(k.updated_at) < datetime('now', '-3 minutes')
       ORDER BY k.updated_at ASC
       LIMIT ?`;

  const rows = owner ? db().prepare(sql).all(owner, limit) : db().prepare(sql).all(limit);
  let reinitiated = 0;
  let skipped = 0;
  const details = [];

  for (const k of rows) {
    if (isCeoApprovalCard(k)) {
      skipped += 1;
      continue;
    }
    let old = null;
    if (k.agent_delegation_task_id) {
      old = db()
        .prepare(`SELECT * FROM agent_delegation_tasks WHERE id = ?`)
        .get(k.agent_delegation_task_id);
    }
    if (old?.status === 'completed') {
      skipped += 1;
      continue;
    }
    if (old?.status === 'failed' && isPermanentFailure(old.error_message)) {
      skipped += 1;
      details.push({ kanban_id: k.id, ok: false, reason: 'permanent_failure' });
      continue;
    }

    const reason =
      !old || !k.agent_delegation_task_id
        ? 'missing_delegation'
        : old.status === 'failed'
          ? `delegation_failed:${String(old.error_message || '').slice(0, 80)}`
          : 'stuck_in_progress';
    const out = reinitiateKanbanDelegation(k.id, { reason });
    details.push(out);
    if (out.ok) reinitiated += 1;
    else skipped += 1;
  }

  if (reinitiated) {
    console.log(
      `[orphan-watcher] reinitiated ${reinitiated} orphan Kanban card(s)` +
        (owner ? ` owner=${owner}` : '')
    );
  }
  return { scanned: rows.length, reinitiated, skipped, details };
}

/**
 * Cancel pending/processing delegations linked to Kanban cards about to be deleted.
 */
export function cancelDelegationsForDeletedKanban(taskIds = []) {
  const ids = (taskIds || []).map((n) => Number(n)).filter((n) => n > 0);
  if (!ids.length) return { cancelled: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const linked = db()
    .prepare(
      `SELECT agent_delegation_task_id AS id FROM kanban_tasks
       WHERE id IN (${placeholders}) AND agent_delegation_task_id IS NOT NULL`
    )
    .all(...ids)
    .map((r) => r.id)
    .filter(Boolean);
  if (!linked.length) return { cancelled: 0 };
  const ph2 = linked.map(() => '?').join(',');
  const result = db()
    .prepare(
      `UPDATE agent_delegation_tasks
       SET status = 'failed',
           error_message = 'Kanban card deleted by user',
           completed_at = datetime('now')
       WHERE id IN (${ph2}) AND status IN ('pending', 'processing')`
    )
    .run(...linked);
  if (result.changes) {
    console.log(
      `[orphan-watcher] cancelled ${result.changes} delegation(s) for deleted Kanban card(s)`
    );
  }
  return { cancelled: result.changes || 0 };
}

/** One watcher pass for a CEO (or all when ownerUserId omitted). */
export function runKanbanOrphanWatcher({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const stale = recoverStaleSpecialtyProcessingDelegations({ ownerUserId: owner, limit });
  let statusOnly = { requeued: 0 };
  let infra = { repended: 0 };
  let heal = { healed: 0 };
  try {
    statusOnly = requeueStuckStatusOnlyKanbanCards({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] status-only requeue:', e?.message || e);
  }
  try {
    infra = rependInfraFailedStatusOnlyRetries({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] infra repend:', e?.message || e);
  }
  try {
    if (!owner) heal = healStuckKanbanForCompletedDelegations();
  } catch (e) {
    console.warn('[orphan-watcher] heal:', e?.message || e);
  }
  const orphans = reinitiateOrphanKanbanCards({ ownerUserId: owner, limit });
  let a2aLeaf = [];
  try {
    // Move ext:/a2a: leaf cards to completed/failed from workflow_a2a_tasks / run status
    // (and heal "Workflow completed successfully." left in_progress by the old status-only gate).
    if (owner) a2aLeaf = reconcileA2AKanbanForOwner(owner) || [];
  } catch (e) {
    console.warn('[orphan-watcher] A2A leaf reconcile:', e?.message || e);
  }
  return {
    owner_user_id: owner,
    stale_processing: stale,
    status_only: statusOnly,
    infra_repend: infra,
    heal,
    orphans,
    a2a_leaf_reconcile: a2aLeaf,
  };
}

export async function runKanbanOrphanWatcherForAllCeos() {
  const ceos = db()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  const results = [];
  for (const ceo of ceos) {
    try {
      results.push(runKanbanOrphanWatcher({ ownerUserId: ceo.id, limit: 20 }));
    } catch (e) {
      console.warn('[orphan-watcher] ceo failed', ceo.id, e?.message || e);
      results.push({ owner_user_id: ceo.id, ok: false, error: e?.message || String(e) });
    }
  }
  try {
    healStuckKanbanForCompletedDelegations();
  } catch (_) {}
  return { count: results.length, results };
}
