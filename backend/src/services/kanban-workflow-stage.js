/**
 * Create/update Kanban cards for synchronous workflow stages (fit scoring, resume tailoring).
 */
import { getDb } from '../db/schema.js';
import {
  notifyKanbanTaskCreated,
  clearKanbanTaskNotification,
} from './platform-notifications.js';
import { shouldCompleteKanbanForReply } from './kanban-reply-enrich.js';

const PIPELINE_TAG = '[job_pipeline';

/** Delete Kanban task rows (+ messages), clearing FK refs first. */
export function deleteKanbanTasksByIds(taskIds = []) {
  const ids = [...new Set(taskIds.map((id) => Number(id)).filter((id) => id > 0))];
  if (!ids.length) return { removed: 0, ids: [] };

  const placeholders = ids.map(() => '?').join(',');
  db().prepare(`UPDATE kanban_tasks SET standup_id = NULL, agent_delegation_task_id = NULL WHERE id IN (${placeholders})`).run(...ids);
  db().prepare(`DELETE FROM task_messages WHERE task_id IN (${placeholders})`).run(...ids);
  db().prepare(`DELETE FROM kanban_tasks WHERE id IN (${placeholders})`).run(...ids);
  return { removed: ids.length, ids };
}

/**
 * Remove all Kanban tasks tied to a workflow run (stage cards + CEO review link).
 */
export function removeKanbanTasksForWorkflowRun(workflowRunId) {
  const wfId = Number(workflowRunId);
  if (!wfId) return { removed: 0, ids: [] };

  const ids = new Set();
  const run = db().prepare('SELECT kanban_ceo_review_task_id FROM job_workflow_runs WHERE id = ?').get(wfId);
  if (run?.kanban_ceo_review_task_id) ids.add(run.kanban_ceo_review_task_id);

  const byWorkflow = db()
    .prepare(`SELECT id FROM kanban_tasks WHERE description LIKE ?`)
    .all(`%workflow_id: ${wfId}%`);
  for (const row of byWorkflow) ids.add(row.id);

  const byNumber = db()
    .prepare(`SELECT id FROM kanban_tasks WHERE description LIKE ? AND description LIKE ?`)
    .all(`%workflow_number:%`, `%workflow_id: ${wfId}%`);
  for (const row of byNumber) ids.add(row.id);

  return deleteKanbanTasksByIds([...ids]);
}

/**
 * Cancel in-flight pipeline delegations and remove their Kanban cards (e.g. on workflow supersede).
 */
export function cancelPendingPipelineDelegationsAndKanban(reason = 'workflow superseded') {
  const rows = db()
    .prepare(
      `SELECT id FROM agent_delegation_tasks
       WHERE status IN ('pending', 'processing') AND prompt LIKE ?`
    )
    .all(`${PIPELINE_TAG}%`);

  const kanbanIds = [];
  for (const row of rows) {
    const k = db().prepare('SELECT id FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(row.id);
    if (k?.id) kanbanIds.push(k.id);
    db()
      .prepare(
        `UPDATE agent_delegation_tasks SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`
      )
      .run(reason, row.id);
  }

  const deleted = deleteKanbanTasksByIds(kanbanIds);
  return { delegations_cancelled: rows.length, kanban_removed: deleted.removed, kanban_ids: deleted.ids };
}

const STAGE_AGENT = {
  job_discovery: 'jobdiscovery',
  fit_scoring: 'fitscorer',
  resume_tailoring: 'resumetailor',
  fitscorer: 'fitscorer',
  resumetailor: 'resumetailor',
  discovery: 'jobdiscovery',
};

const STAGE_TITLE = {
  job_discovery: 'Job Discovery — scheduled run',
  fit_scoring: 'Fit Scoring — score discovered jobs',
  resume_tailoring: 'Resume Tailoring — shortlisted jobs',
  fitscorer: 'Fit Scoring — score discovered jobs',
  resumetailor: 'Resume Tailoring — shortlisted jobs',
  discovery: 'Job Discovery — scheduled run',
};

const PIPELINE_STAGE = {
  job_discovery: 'discovery',
  fit_scoring: 'fitscorer',
  resume_tailoring: 'resumetailor',
};

function db() {
  return getDb();
}

function buildStageDescription({ stage, ceoUserId, profileId, workflowId, workflowNumber, summary, detail = {} }) {
  const pipelineStage = PIPELINE_STAGE[stage] || stage;
  const lines = [
    `[job_pipeline:${pipelineStage}]`,
    `ceo_user_id: ${ceoUserId}`,
    `profile_id: ${profileId}`,
    `workflow_id: ${workflowId}`,
    `workflow_number: ${workflowNumber}`,
    `stage: ${pipelineStage}`,
    '',
    '## Summary',
    summary || '(completed)',
  ];
  if (detail && Object.keys(detail).length > 0) {
    lines.push('', '## Details', '```json', JSON.stringify(detail, null, 2), '```');
  }
  return lines.join('\n');
}

function findExistingStageTask(workflowId, stage) {
  const pipelineStage = PIPELINE_STAGE[stage] || stage;
  return db()
    .prepare(
      `SELECT id, status FROM kanban_tasks
       WHERE description LIKE ? AND description LIKE ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(`%workflow_id: ${workflowId}%`, `%[job_pipeline:${pipelineStage}]%`);
}

/**
 * Upsert a completed Kanban task under the agent column for a workflow stage.
 */
export function upsertWorkflowStageKanban({
  stage,
  ceoUserId,
  profileId,
  profileDisplayName = profileId,
  workflowId,
  workflowNumber,
  status = 'completed',
  summary,
  detail = {},
}) {
  const agentId = STAGE_AGENT[stage];
  if (!agentId) throw new Error(`Unknown workflow stage for Kanban: ${stage}`);

  const titleBase = STAGE_TITLE[stage] || stage;
  const title = `${titleBase} — ${profileDisplayName}`;
  const description = buildStageDescription({
    stage,
    ceoUserId,
    profileId,
    workflowId,
    workflowNumber,
    summary,
    detail,
  });

  const existing = findExistingStageTask(workflowId, stage);
  if (existing) {
    db()
      .prepare(
        `UPDATE kanban_tasks SET title = ?, description = ?, status = ?, assigned_agent_id = ?, updated_at = datetime('now') WHERE id = ?`
      )
      .run(title, description, status, agentId, existing.id);
    if (status === 'completed' || status === 'failed') clearKanbanTaskNotification(existing.id);
    return { kanban_task_id: existing.id, created: false, updated: true, status, assigned_agent_id: agentId };
  }

  db()
    .prepare(
      `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, due_date, owner_user_id)
       VALUES (?, ?, ?, ?, 'job_workflow', NULL, ?)`
    )
    .run(title, description, status, agentId, ceoUserId || null);

  const row = db().prepare('SELECT id FROM kanban_tasks ORDER BY id DESC LIMIT 1').get();
  if (row?.id && status !== 'completed' && status !== 'failed') {
    // Prefer auth-style owner: resolveCeoDataUserId maps bala→default; notify both if needed
    notifyKanbanTaskCreated({
      userId: ceoUserId === 'default' ? 'ceo-bala' : ceoUserId,
      task: { id: row.id, title, assigned_agent_id: agentId },
    });
  } else if (row?.id && (status === 'completed' || status === 'failed')) {
    clearKanbanTaskNotification(row.id);
  }
  return { kanban_task_id: row?.id, created: true, updated: false, status, assigned_agent_id: agentId };
}

/** Mark pipeline delegation Kanban completed when agent finishes (if still open). */
export function completePipelineKanbanForDelegation(delegationTaskId, { ok = true, replyText = null } = {}) {
  if (!delegationTaskId) return null;
  const row = db()
    .prepare('SELECT id, status FROM kanban_tasks WHERE agent_delegation_task_id = ?')
    .get(delegationTaskId);
  if (!row) return null;

  // Status-only "I marked it completed" must NOT stick — reopen even if the agent
  // already called kanban_move_status → completed during the same turn.
  if (ok && replyText != null && !shouldCompleteKanbanForReply(replyText)) {
    if (row.status !== 'in_progress') {
      db()
        .prepare(`UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`)
        .run(row.id);
    }
    console.warn(
      `[kanban] skip auto-complete for delegation=${delegationTaskId} kanban=${row.id} — status-only reply (was ${row.status})`
    );
    return { ...row, status: 'in_progress', skipped_status_only: true };
  }

  if (['completed', 'failed'].includes(row.status)) return row;

  const next = ok ? 'completed' : 'failed';
  db().prepare(`UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(next, row.id);
  clearKanbanTaskNotification(row.id);
  return { ...row, status: next };
}

/** Move linked Kanban card to in_progress when the agent run starts. */
export function markKanbanInProgressForDelegation(delegationTaskId) {
  if (!delegationTaskId) return null;
  const row = db()
    .prepare('SELECT id, status FROM kanban_tasks WHERE agent_delegation_task_id = ?')
    .get(delegationTaskId);
  if (!row) return null;
  if (['completed', 'failed', 'in_progress'].includes(row.status)) return row;
  db()
    .prepare(`UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`)
    .run(row.id);
  return { ...row, status: 'in_progress' };
}

/**
 * Heal cards stuck in awaiting_confirmation / open after the linked delegation already finished.
 * @returns {{ healed: number }}
 */
export function healStuckKanbanForCompletedDelegations() {
  const rows = db()
    .prepare(
      `SELECT k.id AS kanban_id, k.status AS kanban_status, d.id AS delegation_id, d.status AS delegation_status,
              d.response_content AS response_content
       FROM kanban_tasks k
       JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.status IN ('awaiting_confirmation', 'open', 'in_progress')
         AND d.status IN ('completed', 'failed')`
    )
    .all();
  let healed = 0;
  let skippedStatusOnly = 0;
  for (const r of rows) {
    if (
      r.delegation_status === 'completed' &&
      !shouldCompleteKanbanForReply(r.response_content)
    ) {
      // Leave specialty cards in_progress when the agent only posted status chatter.
      skippedStatusOnly += 1;
      continue;
    }
    const next = r.delegation_status === 'failed' ? 'failed' : 'completed';
    db()
      .prepare(`UPDATE kanban_tasks SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(next, r.kanban_id);
    clearKanbanTaskNotification(r.kanban_id);
    healed += 1;
  }

  // Repair cards already wrongly marked completed with status-only chatter.
  const badDone = db()
    .prepare(
      `SELECT k.id AS kanban_id, d.response_content AS response_content
       FROM kanban_tasks k
       JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
       WHERE k.status = 'completed'
         AND d.status = 'completed'
         AND d.response_content IS NOT NULL
         AND d.response_content != ''`
    )
    .all();
  let reopened = 0;
  for (const r of badDone) {
    if (shouldCompleteKanbanForReply(r.response_content)) continue;
    db()
      .prepare(`UPDATE kanban_tasks SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`)
      .run(r.kanban_id);
    reopened += 1;
  }
  if (reopened) {
    console.warn(`[kanban] reopened ${reopened} status-only completed card(s)`);
  }
  return { healed, scanned: rows.length, skipped_status_only: skippedStatusOnly, reopened_status_only: reopened };
}
