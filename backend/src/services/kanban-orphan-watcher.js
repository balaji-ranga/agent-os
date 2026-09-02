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
import { isGoalPlanFailureKanbanDisabled } from './goal-plan-failure-kanban.js';
import {
  requeueStuckStatusOnlyKanbanCards,
  rependInfraFailedStatusOnlyRetries,
  isEligibleForStatusOnlyRetry,
} from './delegation-status-only-retry.js';
import { isAgentWorkflowPrompt } from './agent-workflow-kanban.js';
import { healStuckKanbanForCompletedDelegations } from './kanban-workflow-stage.js';
import { reconcileA2AKanbanForOwner } from './coo-status-checker.js';
import { releaseDelegationRunLock } from './delegation-queue.js';
import { isPlatformLocalOllama } from './platform-llm-settings.js';
import { getMemberBudgetStatus } from './agent-budgets.js';

const ORPHAN_TAG_RE = /\[orphan_retry:(\d+)\]/i;
const PIPELINE_TAG = '[job_pipeline';

function db() {
  return getDb();
}

function maxOrphanRetries() {
  const n = Number(process.env.KANBAN_ORPHAN_MAX_RETRIES);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 5) : 2;
}

/** Seconds a specialty task may sit in `processing` before we re-pend it.
 * Must exceed OpenClaw fetch timeout so we do not re-pend a still-valid slow call.
 * Default: max(OPENCLAW_FETCH_TIMEOUT_MS+60s, 180s) — was a flat 600s, which made
 * Admin "Run now" look broken for hung cards under 10 minutes.
 */
function specialtyProcessingStaleSec() {
  const ms = Number(process.env.DELEGATION_SPECIALTY_PROCESSING_TIMEOUT_MS);
  if (Number.isFinite(ms) && ms >= 60000) return Math.ceil(ms / 1000);
  const pipelineMs = Number(process.env.DELEGATION_PROCESSING_TIMEOUT_MS);
  if (Number.isFinite(pipelineMs) && pipelineMs >= 60000) return Math.ceil(pipelineMs / 1000);
  const fetchMs = Number(process.env.OPENCLAW_FETCH_TIMEOUT_MS);
  const fromFetch = Number.isFinite(fetchMs) && fetchMs >= 60000 ? Math.ceil(fetchMs / 1000) + 60 : 0;
  return Math.max(fromFetch, 180);
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
  if (
    /budget exceeded|budget-gate|agent not found|not entitled|private a2a|monthly token budget exhausted|Google Places not configured|Places not configured|recovery paused|Hard-stop: Google Places/i.test(
      msg
    )
  ) {
    return true;
  }
  // Local CPU Ollama cannot serve a flood of specialty retries; 408/OOM would loop forever.
  if (isPlatformLocalOllama()) {
    return /408|upstream provider timeout|llama-server process|resource limitations|model runner has unexpectedly stopped|Request was aborted/i.test(
      msg
    );
  }
  return false;
}

/**
 * Keep exception-policy recovery visible while its assigned agent is budget
 * blocked. Once the budget is available again, reopen it so the ordinary
 * orphan path creates a fresh delegation. This also repairs cards created by
 * older releases that were marked failed immediately by the budget gate.
 */
export function reconcileBudgetBlockedGoalRecoveryCards({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const ownerSql = owner ? 'AND k.owner_user_id = ?' : '';
  const args = owner ? [owner, limit] : [limit];
  const rows = db()
    .prepare(
      `SELECT k.*, d.error_message AS delegation_error
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.created_by = 'exception-policy'
         AND k.assigned_agent_id IS NOT NULL
         AND k.status IN ('failed', 'awaiting_confirmation')
         ${ownerSql}
         AND (
           lower(COALESCE(d.error_message, '')) LIKE '%budget%'
           OR lower(COALESCE(d.error_message, '')) LIKE '%monthly token%'
           OR k.description LIKE '%[SYSTEM recovery_blocker]%'
         )
       ORDER BY datetime(k.updated_at) ASC
       LIMIT ?`
    )
    .all(...args);
  let awaiting = 0;
  let reopened = 0;
  const details = [];
  for (const row of rows) {
    const status = getMemberBudgetStatus(row.owner_user_id, row.assigned_agent_id);
    if (status.state === 'blocked') {
      const reason = status.reasons.join('; ') || 'Agent execution budget is blocked.';
      const marker = `[SYSTEM recovery_blocker] ${reason}`;
      const description = String(row.description || '').includes('[SYSTEM recovery_blocker]')
        ? row.description
        : `${String(row.description || '').trim()}\n\n${marker}\nReset or increase the agent budget, then reopen this card to continue recovery.`;
      db().prepare(
        `UPDATE kanban_tasks
         SET status = 'awaiting_confirmation', description = ?, updated_at = datetime('now')
         WHERE id = ? AND status IN ('failed', 'awaiting_confirmation')`
      ).run(description, row.id);
      awaiting += 1;
      details.push({ kanban_id: row.id, state: 'awaiting_confirmation', reason });
      continue;
    }
    if (row.status === 'awaiting_confirmation') {
      const description = `${String(row.description || '').trim()}\n\n[SYSTEM recovery_resumed] Agent budget is available; recovery reopened automatically.`;
      db().prepare(
        `UPDATE kanban_tasks SET status = 'open', description = ?, updated_at = datetime('now') WHERE id = ? AND status = 'awaiting_confirmation'`
      ).run(description, row.id);
      reopened += 1;
      details.push({ kanban_id: row.id, state: 'open' });
    }
  }
  return { scanned: rows.length, awaiting, reopened, details };
}

function resolvePromptFromKanban(kanban, oldDelegation) {
  const stripBanners = (text) =>
    String(text || '')
      .replace(/\n*---\n\[System — automatic retry[\s\S]*?---\s*$/m, '')
      .replace(/\n*---\n\[System — orphan watcher[\s\S]*?---\s*$/m, '')
      .replace(/\n*---\nOrphan watcher:[\s\S]*$/im, '')
      .replace(/\[orphan_retry:\d+\]/gi, '')
      .replace(/\[status_only_retry:\d+\]/gi, '')
      .trim();

  const isMetaOnly = (text) => {
    const lines = String(text || '')
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return true;
    return lines.every((l) => /^(owner_user_id|created_by_agent|created_by)\s*:/i.test(l));
  };

  const fromDel = stripBanners(oldDelegation?.prompt);
  if (fromDel && !isMetaOnly(fromDel) && fromDel.length >= 8) return fromDel;

  // Keep the CEO ask (first paragraphs). Do NOT slice(1) — that dropped the ask when
  // description was "ask\n\nowner_user_id:…\ncreated_by_agent:…".
  let desc = stripBanners(kanban.description);
  desc = desc
    .split(/\n/)
    .filter((l) => !/^(owner_user_id|created_by_agent|created_by)\s*:/i.test(l.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (desc.length >= 8) return desc;
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
      // Drop in-memory lock so processPending can reclaim immediately (hung OpenClaw call
      // may still be awaiting timeout with the id still in runningDelegationIds).
      releaseDelegationRunLock(row.id);
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
 * @param {number|string} kanbanId
 * @param {{ reason?: string, resetRetries?: boolean }} [opts]
 *   resetRetries — CEO reopen / drag-to-open: clear [orphan_retry:N] so intentional
 *   re-asks are not blocked by the automatic retry cap.
 */
export function reinitiateKanbanDelegation(
  kanbanId,
  { reason = 'orphan_watcher', resetRetries = false } = {}
) {
  const kanban = db().prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(kanbanId);
  if (!kanban) return { ok: false, reason: 'kanban_not_found' };
  if (!kanban.assigned_agent_id) return { ok: false, reason: 'no_assigned_agent' };
  if (kanban.assigned_member_key) return { ok: false, reason: 'external_leaf' };
  if (isCeoApprovalCard(kanban)) return { ok: false, reason: 'ceo_approval' };

  // Do not re-fire goal-plan recovery loops (esp. config failures like Places).
  const descLower = String(kanban.description || '').toLowerCase();
  const titleLower = String(kanban.title || '').toLowerCase();
  if (
    titleLower.startsWith('goal recovery:') ||
    descLower.includes('goal_plan_recovery') ||
    descLower.includes('[goal_plan_recovery]')
  ) {
    if (
      isGoalPlanFailureKanbanDisabled() ||
      /google places not configured|places not configured|recovery paused|hard-stop: google places/i.test(
        `${kanban.description || ''}\n${kanban.title || ''}`
      )
    ) {
      return { ok: false, reason: 'goal_recovery_suppressed' };
    }
  }

  let retries = resetRetries ? 0 : getOrphanRetryCount(kanban.description);
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
  if (old && isPermanentFailure(old.error_message) && !resetRetries) {
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

  const owner = String(kanban.owner_user_id || '').trim();
  if (!owner) return { ok: false, reason: 'no_owner' };

  const nextRetry = retries + 1;
  const banner =
    `\n\n---\n[System — orphan watcher retry ${nextRetry}/${maxOrphanRetries()}] ` +
    `Your previous run did not finish (${reason}). Complete the CEO ask now and put the FULL ` +
    `answer in this reply. If you have kanban_move_status, call it → completed only after the ` +
    `deliverable is in the body; otherwise answer fully and the platform will update the card.\n---`;
  // Keep owner_user_id in the prompt so tenant OpenClaw id resolves to t-<ceo>--… not t-default--…
  const prompt = `${promptBase}\n\nowner_user_id: ${owner}${banner}`;

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

  let descBase = String(kanban.description || '');
  if (resetRetries) {
    descBase = descBase
      .replace(/\[orphan_retry:\d+\]/gi, '')
      .replace(/\n*---\nOrphan watcher:[\s\S]*$/im, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  const desc = withOrphanRetryCount(
    `${descBase}\n\n---\nOrphan watcher: reinitiated (${reason}) at ${new Date().toISOString()}`,
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
 *
 * Includes CEO-reopened cards: status `open`/`failed` still linked to a *completed*
 * delegation (drag-to-open / Reopen used to leave that link, so the watcher ignored them).
 * `open` cards skip the 3-minute cool-off so status-checker / watcher runs pick them up immediately.
 */
export function reinitiateOrphanKanbanCards({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  const orphanWhere = `
         AND k.assigned_agent_id IS NOT NULL
         AND k.assigned_member_key IS NULL
         AND k.status IN ('in_progress', 'open')
         AND (
           k.agent_delegation_task_id IS NULL
           OR d.id IS NULL
           OR (d.status = 'failed')
           OR (d.status = 'completed' AND k.status IN ('in_progress', 'open'))
         )
         AND (
           k.status = 'open'
           OR datetime(k.updated_at) < datetime('now', '-3 minutes')
         )`;
  const sql = owner
    ? `SELECT k.*
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.owner_user_id = ?
         ${orphanWhere}
       ORDER BY k.updated_at ASC
       LIMIT ?`
    : `SELECT k.*
       FROM kanban_tasks k
       LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE 1=1
         ${orphanWhere}
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
    // Completed work still on an in_progress card is healed elsewhere — do not re-run.
    // Only `open` is an explicit CEO/user reopen. `failed` is terminal and must never
    // be interpreted as user intent; exception-policy/recovery flows own failed work.
    if (old?.status === 'completed' && k.status === 'in_progress') {
      skipped += 1;
      continue;
    }
    if (old?.status === 'failed' && isPermanentFailure(old.error_message) && k.status !== 'open') {
      skipped += 1;
      details.push({ kanban_id: k.id, ok: false, reason: 'permanent_failure' });
      continue;
    }

    const ceoReopen =
      k.status === 'open' && (!old || old.status === 'completed' || old.status === 'failed');
    const reason =
      !old || !k.agent_delegation_task_id
        ? 'missing_delegation'
        : old.status === 'completed' && k.status === 'open'
          ? 'ceo_reopen_completed'
          : old.status === 'failed'
            ? `delegation_failed:${String(old.error_message || '').slice(0, 80)}`
            : 'stuck_in_progress';
    const out = reinitiateKanbanDelegation(k.id, {
      reason,
      resetRetries: !!ceoReopen,
    });
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
export async function runKanbanOrphanWatcher({ ownerUserId = null, limit = 25 } = {}) {
  const owner = String(ownerUserId || '').trim() || null;
  let orphanHumanGoalTasks = { cancelled: 0, goals: [] };
  try {
    const { reconcileOrphanHumanGoalTasks } = await import('./agent-goal-run.js');
    orphanHumanGoalTasks = reconcileOrphanHumanGoalTasks({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] orphan human goal task:', e?.message || e);
  }
  let budgetBlockedRecovery = { scanned: 0, awaiting: 0, reopened: 0, details: [] };
  try {
    budgetBlockedRecovery = reconcileBudgetBlockedGoalRecoveryCards({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] budget-blocked goal recovery:', e?.message || e);
  }
  if (isPlatformLocalOllama()) {
    console.info('[orphan-watcher] skip reinitiate on local Ollama (CPU cannot fan-out specialty retries)');
    return { skipped: true, reason: 'local_ollama', owner_user_id: owner, orphan_human_goal_tasks: orphanHumanGoalTasks, budget_blocked_recovery: budgetBlockedRecovery };
  }
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
  let workflowOrphan = null;
  try {
    const { runWorkflowOrphanWatcher } = await import('./agent-workflow-orphan-watcher.js');
    workflowOrphan = await runWorkflowOrphanWatcher({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] workflow orphan:', e?.message || e);
    workflowOrphan = { ok: false, error: e?.message || String(e) };
  }
  let a2aLeaf = [];
  try {
    // Move ext:/a2a: leaf cards to completed/failed from workflow_a2a_tasks / run status
    // (and heal "Workflow completed successfully." left in_progress by the old status-only gate).
    if (owner) a2aLeaf = reconcileA2AKanbanForOwner(owner) || [];
  } catch (e) {
    console.warn('[orphan-watcher] A2A leaf reconcile:', e?.message || e);
  }
  let staleGoalContinue = { recovered: 0 };
  try {
    const { recoverStaleAgentContinueGoalSteps } = await import('./agent-goal-run.js');
    staleGoalContinue = await recoverStaleAgentContinueGoalSteps({ ownerUserId: owner, limit });
  } catch (e) {
    console.warn('[orphan-watcher] stale goal continuation:', e?.message || e);
  }

  const needsProcess =
    (stale.recovered || 0) +
      (statusOnly.requeued || 0) +
      (infra.repended || 0) +
      (orphans.reinitiated || 0) +
      (workflowOrphan?.stale_workflow_processing?.recovered || 0) >
    0;
  let process_pending = null;
  if (needsProcess) {
    try {
      const { processPendingDelegationTasksForCeo } = await import('./delegation-queue.js');
      if (owner) {
        await processPendingDelegationTasksForCeo(owner, { skipOrphanWatcher: true });
        process_pending = { owner_user_id: owner, kicked: true };
      } else {
        // Avoid re-entering orphan watcher for every CEO while we already are it.
        const ceos = db()
          .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
          .all();
        for (const ceo of ceos) {
          await processPendingDelegationTasksForCeo(ceo.id, { skipOrphanWatcher: true });
        }
        process_pending = { all: true, kicked: true, ceo_count: ceos.length };
      }
      console.info(
        '[orphan-watcher] kicked processPending after recovery owner=%s recovered=%s',
        owner || 'all',
        (stale.recovered || 0) + (orphans.reinitiated || 0)
      );
    } catch (e) {
      console.warn('[orphan-watcher] processPending kick failed:', e?.message || e);
      process_pending = { ok: false, error: e?.message || String(e) };
    }
  }

  return {
    owner_user_id: owner,
    stale_processing: stale,
    status_only: statusOnly,
    infra_repend: infra,
    heal,
    orphans,
    workflow_orphan: workflowOrphan,
    a2a_leaf_reconcile: a2aLeaf,
    stale_goal_continue: staleGoalContinue,
    orphan_human_goal_tasks: orphanHumanGoalTasks,
    budget_blocked_recovery: budgetBlockedRecovery,
    process_pending,
  };
}

export async function runKanbanOrphanWatcherForAllCeos() {
  const ceos = db()
    .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1`)
    .all();
  const results = [];
  for (const ceo of ceos) {
    try {
      results.push(await runKanbanOrphanWatcher({ ownerUserId: ceo.id, limit: 20 }));
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
