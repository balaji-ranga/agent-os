#!/usr/bin/env node
/**
 * Smoke: Kanban orphan watcher recovers specialty tasks stuck in `processing`
 * and reinitiates cards whose linked delegation failed transiently.
 * Usage: node scripts/test-kanban-orphan-watcher.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  recoverStaleSpecialtyProcessingDelegations,
  reinitiateKanbanDelegation,
  cancelDelegationsForDeletedKanban,
  runKanbanOrphanWatcher,
} from '../src/services/kanban-orphan-watcher.js';
import { getOrCreateDelegationHubStandup } from '../src/services/standup-hub.js';

initDb();
const db = getDb();
const owner = getBalaCeoAuthId();
const agent = db
  .prepare(`SELECT id FROM agents WHERE is_coo = 0 AND id != 'platformhelp' ORDER BY rowid LIMIT 1`)
  .get();
if (!agent) throw new Error('no specialty agent');

const standupId = getOrCreateDelegationHubStandup(owner);
const created = [];
const createdDelegations = [];
let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

function cleanup() {
  for (const id of created) {
    try {
      db.prepare(`UPDATE kanban_tasks SET agent_delegation_task_id = NULL WHERE id = ?`).run(id);
      db.prepare(`DELETE FROM kanban_tasks WHERE id = ?`).run(id);
    } catch (e) {
      console.warn('cleanup kanban', id, e?.message || e);
    }
  }
  for (const id of createdDelegations) {
    try {
      db.prepare(`DELETE FROM agent_delegation_tasks WHERE id = ?`).run(id);
    } catch (e) {
      console.warn('cleanup del', id, e?.message || e);
    }
  }
  // Only rows we tagged for this smoke — never mass-delete orphan-* (real watcher may create those).
  try {
    db.prepare(`DELETE FROM agent_delegation_tasks WHERE request_id LIKE 'orphan-test-%'`).run();
  } catch (_) {}
}

try {
  // --- stuck processing ---
  const info = db
    .prepare(
      `INSERT INTO agent_delegation_tasks
         (standup_id, request_id, to_agent_id, prompt, status, owner_user_id, created_at)
       VALUES (?, ?, ?, ?, 'processing', ?, datetime('now', '-20 minutes'))`
    )
    .run(standupId, `orphan-test-proc-${Date.now()}`, agent.id, 'Research X thoroughly for orphan test.', owner);
  const delId = Number(info.lastInsertRowid);
  createdDelegations.push(delId);
  const kInfo = db
    .prepare(
      `INSERT INTO kanban_tasks
         (title, description, status, assigned_agent_id, created_by, standup_id, agent_delegation_task_id, owner_user_id, updated_at)
       VALUES (?, ?, 'in_progress', ?, 'coo', ?, ?, ?, datetime('now', '-20 minutes'))`
    )
    .run('Orphan stuck processing', 'Do research X', agent.id, standupId, delId, owner);
  const kanbanId = Number(kInfo.lastInsertRowid);
  created.push(kanbanId);

  const stale = recoverStaleSpecialtyProcessingDelegations({ ownerUserId: owner, limit: 20 });
  const after = db.prepare(`SELECT status, error_message FROM agent_delegation_tasks WHERE id = ?`).get(delId);
  check('stale processing recovered', after.status === 'pending', `status=${after.status}`);
  check('recovery counted', stale.recovered >= 1, JSON.stringify(stale));

  // --- reinitiate after failed ---
  db.prepare(
    `UPDATE agent_delegation_tasks SET status = 'failed', error_message = 'gateway unreachable', completed_at = datetime('now') WHERE id = ?`
  ).run(delId);
  db.prepare(
    `UPDATE kanban_tasks SET status = 'failed', updated_at = datetime('now', '-10 minutes'), description = description || '\n' WHERE id = ?`
  ).run(kanbanId);

  const rein = reinitiateKanbanDelegation(kanbanId, { reason: 'test_failed' });
  check('reinitiate after transient failure', rein.ok === true, JSON.stringify(rein));
  if (rein.new_delegation_id) createdDelegations.push(rein.new_delegation_id);
  const k2 = db.prepare(`SELECT status, agent_delegation_task_id FROM kanban_tasks WHERE id = ?`).get(kanbanId);
  check('card back to in_progress', k2.status === 'in_progress', k2.status);
  check('new delegation linked', k2.agent_delegation_task_id !== delId, `old=${delId} new=${k2.agent_delegation_task_id}`);

  // --- cancel on delete ---
  const pendingId = k2.agent_delegation_task_id;
  const cancelled = cancelDelegationsForDeletedKanban([kanbanId]);
  check('cancel pending on delete', cancelled.cancelled >= 1, JSON.stringify(cancelled));
  const d3 = db.prepare(`SELECT status, error_message FROM agent_delegation_tasks WHERE id = ?`).get(pendingId);
  check('delegation marked failed for delete', d3.status === 'failed' && /deleted/i.test(d3.error_message || ''), d3.error_message);

  // Watcher shape only — do NOT run full owner scan (would touch real stuck cards on shared DB).
  const pass = {
    stale_processing: { recovered: 0 },
    orphans: { reinitiated: 0 },
  };
  check('watcher helpers exported', typeof runKanbanOrphanWatcher === 'function');
  void pass;
} finally {
  cleanup();
}

if (failures) {
  console.error(`kanban orphan watcher smoke FAILED (${failures})`);
  process.exit(1);
}
console.log('kanban orphan watcher smoke OK');
