/**
 * When a specialty agent replies with status-only chatter ("marked completed"),
 * re-enqueue the same ask so the agent is picked up again without CEO nudge.
 *
 * Retry count is stored on the Kanban description as [status_only_retry:N].
 * Cap via DELEGATION_STATUS_ONLY_MAX_RETRIES (default 1).
 */
import { getDb } from '../db/schema.js';
import { shouldCompleteKanbanForReply } from './kanban-reply-enrich.js';
import { isAgentWorkflowPrompt } from './agent-workflow-kanban.js';

const RETRY_TAG_RE = /\[status_only_retry:(\d+)\]/i;
const MAX_RETRIES = () => {
  const n = Number(process.env.DELEGATION_STATUS_ONLY_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 3) : 1;
};

function db() {
  return getDb();
}

export function isJobPipelinePrompt(prompt) {
  return /\[job_pipeline/i.test(String(prompt || ''));
}

/** OpenClaw down / network blip — leave task pending instead of burning the status-only retry. */
export function isTransientOpenClawError(err) {
  const msg = String(err?.message || err || '');
  return /gateway unreachable|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|gateway timeout|AbortError|TimeoutError|network/i.test(
    msg
  );
}

export function getTransientAttempt(errorMessage) {
  const m = String(errorMessage || '').match(/^\[transient:(\d+)\]/i);
  return m ? Number(m[1]) || 0 : 0;
}

export function maxGatewayTransientRetries() {
  const n = Number(process.env.DELEGATION_GATEWAY_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 20) : 8;
}

/** Specialty CEO asks only — not workflow agent steps or job pipeline. */
export function isEligibleForStatusOnlyRetry(prompt) {
  if (!prompt) return false;
  if (isAgentWorkflowPrompt(prompt)) return false;
  if (isJobPipelinePrompt(prompt)) return false;
  return true;
}

export function getStatusOnlyRetryCount(description) {
  const m = String(description || '').match(RETRY_TAG_RE);
  return m ? Number(m[1]) || 0 : 0;
}

export function withStatusOnlyRetryCount(description, count) {
  const base = String(description || '')
    .replace(RETRY_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const tag = `[status_only_retry:${count}]`;
  return base ? `${base}\n${tag}` : tag;
}

function buildRetryPrompt(originalPrompt, attempt) {
  const base = String(originalPrompt || '').trim();
  const banner =
    `\n\n---\n[System — automatic retry ${attempt}/${MAX_RETRIES()}] ` +
    `Your previous run only posted a status line (e.g. "task marked as completed") ` +
    `without answering the CEO ask. Do the work now and put the FULL answer in this reply. ` +
    `Do NOT reply with only a status sentence. Call kanban_move_status → completed only after ` +
    `the deliverable is in the message body.\n---`;
  if (/\[System — automatic retry/i.test(base)) {
    return base.replace(/\[System — automatic retry[\s\S]*?---\s*$/m, banner.trim());
  }
  return `${base}${banner}`;
}

/**
 * Re-queue the same agent for a Kanban card after a status-only reply.
 * @returns {{ ok: boolean, reason?: string, newDelegationId?: number, retryCount?: number }}
 */
export function requeueKanbanAfterStatusOnlyReply({
  kanbanId = null,
  delegationTaskId = null,
  force = false,
} = {}) {
  let kanban = null;
  let oldTask = null;

  if (delegationTaskId) {
    oldTask = db().prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?').get(delegationTaskId);
    kanban =
      db().prepare('SELECT * FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(delegationTaskId) ||
      (kanbanId ? db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(kanbanId) : null);
  } else if (kanbanId) {
    kanban = db().prepare('SELECT * FROM kanban_tasks WHERE id = ?').get(kanbanId);
    if (kanban?.agent_delegation_task_id) {
      oldTask = db()
        .prepare('SELECT * FROM agent_delegation_tasks WHERE id = ?')
        .get(kanban.agent_delegation_task_id);
    }
  }

  if (!kanban) return { ok: false, reason: 'kanban_not_found' };
  if (!oldTask) return { ok: false, reason: 'delegation_not_found' };
  if (!isEligibleForStatusOnlyRetry(oldTask.prompt)) {
    return { ok: false, reason: 'not_eligible' };
  }
  if (!force && shouldCompleteKanbanForReply(oldTask.response_content)) {
    return { ok: false, reason: 'reply_has_deliverable' };
  }

  // Already have a newer pending/processing run linked? Don't double-queue.
  const pendingSameAgent = db()
    .prepare(
      `SELECT id FROM agent_delegation_tasks
       WHERE to_agent_id = ? AND status IN ('pending', 'processing')
         AND id != ? AND standup_id = ?
       LIMIT 1`
    )
    .get(oldTask.to_agent_id, oldTask.id, oldTask.standup_id);
  if (pendingSameAgent) {
    // Point the card at the in-flight retry if not already.
    if (Number(kanban.agent_delegation_task_id) !== Number(pendingSameAgent.id)) {
      db()
        .prepare(
          `UPDATE kanban_tasks SET agent_delegation_task_id = ?, status = 'in_progress', updated_at = datetime('now') WHERE id = ?`
        )
        .run(pendingSameAgent.id, kanban.id);
    }
    return { ok: false, reason: 'already_pending', newDelegationId: pendingSameAgent.id };
  }

  const prev = getStatusOnlyRetryCount(kanban.description);
  const max = MAX_RETRIES();
  if (prev >= max) {
    console.warn(
      `[delegation-retry] kanban=${kanban.id} agent=${oldTask.to_agent_id} exhausted retries (${prev}/${max})`
    );
    return { ok: false, reason: 'max_retries', retryCount: prev };
  }

  const nextCount = prev + 1;
  const requestId = `req-retry-${kanban.id}-${Date.now()}`;
  const prompt = buildRetryPrompt(oldTask.prompt, nextCount);
  const owner =
    oldTask.owner_user_id ||
    kanban.owner_user_id ||
    db().prepare('SELECT owner_user_id FROM standups WHERE id = ?').get(oldTask.standup_id)
      ?.owner_user_id ||
    null;

  db()
    .prepare(
      `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .run(oldTask.standup_id, requestId, oldTask.to_agent_id, prompt, owner);
  const newId = db().prepare('SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1').get()?.id;
  if (!newId) return { ok: false, reason: 'insert_failed' };

  const desc = withStatusOnlyRetryCount(kanban.description, nextCount);
  db()
    .prepare(
      `UPDATE kanban_tasks
       SET agent_delegation_task_id = ?, status = 'in_progress', description = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(newId, desc, kanban.id);

  console.log(
    `[delegation-retry] requeued kanban=${kanban.id} agent=${oldTask.to_agent_id} ` +
      `oldDelegation=${oldTask.id} → newDelegation=${newId} attempt=${nextCount}/${max}`
  );
  return { ok: true, newDelegationId: newId, retryCount: nextCount, requestId };
}

/**
 * Find Kanban cards left in_progress after a status-only completed delegation and requeue once.
 * Safe to run on startup and periodically from the delegation cron.
 */
export function requeueStuckStatusOnlyKanbanCards({ limit = 25, ownerUserId = null } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const rows = owner
    ? db()
        .prepare(
          `SELECT k.id AS kanban_id, k.description, d.id AS delegation_id, d.response_content, d.prompt
           FROM kanban_tasks k
           JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
           WHERE k.status = 'in_progress'
             AND k.owner_user_id = ?
             AND d.status = 'completed'
             AND d.response_content IS NOT NULL
             AND d.response_content != ''
           ORDER BY k.updated_at ASC
           LIMIT ?`
        )
        .all(owner, limit)
    : db()
        .prepare(
          `SELECT k.id AS kanban_id, k.description, d.id AS delegation_id, d.response_content, d.prompt
           FROM kanban_tasks k
           JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
           WHERE k.status = 'in_progress'
             AND d.status = 'completed'
             AND d.response_content IS NOT NULL
             AND d.response_content != ''
           ORDER BY k.updated_at ASC
           LIMIT ?`
        )
        .all(limit);

  let requeued = 0;
  let skipped = 0;
  const details = [];
  for (const r of rows) {
    if (!isEligibleForStatusOnlyRetry(r.prompt)) {
      skipped += 1;
      continue;
    }
    if (shouldCompleteKanbanForReply(r.response_content)) {
      skipped += 1;
      continue;
    }
    const out = requeueKanbanAfterStatusOnlyReply({
      kanbanId: r.kanban_id,
      delegationTaskId: r.delegation_id,
    });
    details.push({ kanban_id: r.kanban_id, ...out });
    if (out.ok) requeued += 1;
    else skipped += 1;
  }
  if (requeued) {
    console.log(
      `[delegation-retry] requeued ${requeued} stuck status-only card(s)` +
        (owner ? ` owner=${owner}` : '')
    );
  }
  return { scanned: rows.length, requeued, skipped, details };
}

/**
 * If a status-only auto-retry already failed because OpenClaw was down, put that
 * same task back to pending (does not consume another status_only_retry slot).
 */
export function rependInfraFailedStatusOnlyRetries({ limit = 25, ownerUserId = null } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const rows = owner
    ? db()
        .prepare(
          `SELECT d.id AS delegation_id, d.error_message, k.id AS kanban_id
           FROM agent_delegation_tasks d
           JOIN kanban_tasks k ON k.agent_delegation_task_id = d.id
           WHERE d.status = 'failed'
             AND k.status = 'in_progress'
             AND k.owner_user_id = ?
             AND d.prompt LIKE '%automatic retry%'
             AND (
               d.error_message LIKE '%gateway unreachable%'
               OR d.error_message LIKE '%gateway timeout%'
               OR d.error_message LIKE '%fetch failed%'
               OR d.error_message LIKE '[transient:%'
             )
           ORDER BY d.completed_at ASC
           LIMIT ?`
        )
        .all(owner, limit)
    : db()
        .prepare(
          `SELECT d.id AS delegation_id, d.error_message, k.id AS kanban_id
           FROM agent_delegation_tasks d
           JOIN kanban_tasks k ON k.agent_delegation_task_id = d.id
           WHERE d.status = 'failed'
             AND k.status = 'in_progress'
             AND d.prompt LIKE '%automatic retry%'
             AND (
               d.error_message LIKE '%gateway unreachable%'
               OR d.error_message LIKE '%gateway timeout%'
               OR d.error_message LIKE '%fetch failed%'
               OR d.error_message LIKE '[transient:%'
             )
           ORDER BY d.completed_at ASC
           LIMIT ?`
        )
        .all(limit);

  let repended = 0;
  for (const r of rows) {
    const attempt = getTransientAttempt(r.error_message) + 1;
    const maxT = maxGatewayTransientRetries();
    if (attempt > maxT) continue;
    db()
      .prepare(
        `UPDATE agent_delegation_tasks
         SET status = 'pending', error_message = ?, completed_at = NULL
         WHERE id = ? AND status = 'failed'`
      )
      .run(`[transient:${attempt}] recovered after gateway outage`, r.delegation_id);
    repended += 1;
    console.log(
      `[delegation-retry] re-pended infra-failed retry delegation=${r.delegation_id} kanban=${r.kanban_id} (${attempt}/${maxT})`
    );
  }
  return { scanned: rows.length, repended };
}
