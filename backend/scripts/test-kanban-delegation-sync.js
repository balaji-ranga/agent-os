#!/usr/bin/env node
/**
 * Smoke: Kanban sync helpers for delegation lifecycle.
 * Cleans up all inserted rows so deploy verify does not pollute CEO Dashboard.
 * Usage: node scripts/test-kanban-delegation-sync.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  markKanbanInProgressForDelegation,
  completePipelineKanbanForDelegation,
  healStuckKanbanForCompletedDelegations,
} from '../src/services/kanban-workflow-stage.js';

initDb();
const db = getDb();
const owner = getBalaCeoAuthId();
const agent = db.prepare(`SELECT id FROM agents WHERE is_coo = 0 ORDER BY rowid LIMIT 1`).get();
if (!agent) throw new Error('no non-COO agent');

const standup = db
  .prepare(
    `INSERT INTO standups (scheduled_at, status, source, title, owner_user_id) VALUES (datetime('now'), 'active', 'kanban_sync_smoke', 'Kanban sync smoke', ?)`
  )
  .run(owner);
const standupId = standup.lastInsertRowid;

db.prepare(
  `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt, status, owner_user_id)
   VALUES (?, ?, ?, ?, 'pending', ?)`
).run(standupId, `kanban-sync-${Date.now()}`, agent.id, 'smoke prompt', owner);
const delId = db.prepare('SELECT id FROM agent_delegation_tasks ORDER BY id DESC LIMIT 1').get().id;

db.prepare(
  `INSERT INTO kanban_tasks (title, description, status, assigned_agent_id, created_by, standup_id, agent_delegation_task_id, owner_user_id)
   VALUES (?, '', 'awaiting_confirmation', ?, 'coo', ?, ?, ?)`
).run('Kanban sync smoke task', agent.id, standupId, delId, owner);

try {
  const mid = markKanbanInProgressForDelegation(delId);
  if (mid?.status !== 'in_progress') throw new Error(`expected in_progress, got ${JSON.stringify(mid)}`);

  db.prepare(`UPDATE agent_delegation_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(delId);
  // Simulate stuck awaiting_confirmation after completed delegation
  db.prepare(`UPDATE kanban_tasks SET status = 'awaiting_confirmation' WHERE agent_delegation_task_id = ?`).run(delId);
  const healed = healStuckKanbanForCompletedDelegations();
  const row = db.prepare('SELECT status FROM kanban_tasks WHERE agent_delegation_task_id = ?').get(delId);
  if (row.status !== 'completed') throw new Error(`heal failed status=${row.status} healed=${JSON.stringify(healed)}`);

  const done = completePipelineKanbanForDelegation(delId, { ok: true });
  if (done?.status !== 'completed') throw new Error('complete should be idempotent');

  console.log('KANBAN_DELEGATION_SYNC_OK', { delId, healed });
} finally {
  db.prepare(`DELETE FROM kanban_tasks WHERE agent_delegation_task_id = ? OR standup_id = ?`).run(delId, standupId);
  db.prepare(`DELETE FROM agent_delegation_tasks WHERE id = ?`).run(delId);
  db.prepare(`DELETE FROM standups WHERE id = ? AND source = 'kanban_sync_smoke'`).run(standupId);
  // Sweep any leftover smoke standups from older runs
  const leftovers = db
    .prepare(`SELECT id FROM standups WHERE source = 'kanban_sync_smoke' AND owner_user_id = ?`)
    .all(owner)
    .map((r) => r.id);
  for (const sid of leftovers) {
    db.prepare(`DELETE FROM kanban_tasks WHERE standup_id = ?`).run(sid);
    db.prepare(`DELETE FROM agent_delegation_tasks WHERE standup_id = ?`).run(sid);
    db.prepare(`DELETE FROM standup_messages WHERE standup_id = ?`).run(sid);
    db.prepare(`DELETE FROM standup_responses WHERE standup_id = ?`).run(sid);
    db.prepare(`DELETE FROM standups WHERE id = ?`).run(sid);
  }
  if (leftovers.length) console.log('KANBAN_DELEGATION_SYNC_CLEANED', { leftovers });
}
