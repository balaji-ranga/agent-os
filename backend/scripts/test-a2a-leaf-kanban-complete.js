#!/usr/bin/env node
/**
 * Smoke: A2A/external leaf Kanban completion — trust protocol terminal state, and heal
 * cards stuck in_progress after "Workflow completed successfully."
 * Usage: node scripts/test-a2a-leaf-kanban-complete.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { reconcileA2AKanbanForOwner } from '../src/services/coo-status-checker.js';
import { shouldCompleteKanbanForReply } from '../src/services/kanban-reply-enrich.js';

initDb();
const db = getDb();
const owner = `__e2e_a2a_leaf_kanban_${Date.now()}__`;
// Use disposable owner so we never touch ceo-bala production cards.
db.prepare(
  `INSERT OR IGNORE INTO platform_users (id, email, name, role, enabled, password_hash)
   VALUES (?, 'e2e-a2a-leaf@test.local', 'E2E A2A Leaf', 'ceo', 1, 'x')`
).run(owner);

let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

const created = [];
try {
  check(
    'status-only gate still flags bare workflow success text',
    shouldCompleteKanbanForReply('Workflow completed successfully.') === false
  );

  const info = db
    .prepare(
      `INSERT INTO kanban_tasks
         (title, description, status, assigned_member_key, created_by, owner_user_id)
       VALUES (?, ?, 'in_progress', 'ext:a2a-fake-echo', 'coo', ?)`
    )
    .run(
      'Ops Echo heal probe',
      `[owner_user_id: ${owner}]\nDelegated by balserve to external/A2A agent ext:a2a-fake-echo.\n\nrun check\n\n---\nResult:\nWorkflow completed successfully.`,
      owner
    );
  const id = Number(info.lastInsertRowid);
  created.push(id);

  const changes = reconcileA2AKanbanForOwner(owner);
  const row = db.prepare(`SELECT status FROM kanban_tasks WHERE id = ?`).get(id);
  check('heal moves stuck success card to completed', row.status === 'completed', row.status);
  check(
    'heal recorded a change',
    changes.some((c) => c.kanban_id === id && c.to === 'completed'),
    JSON.stringify(changes)
  );
} finally {
  for (const id of created) {
    try {
      db.prepare(`DELETE FROM kanban_tasks WHERE id = ?`).run(id);
    } catch (_) {}
  }
  try {
    db.prepare(`DELETE FROM platform_users WHERE id = ?`).run(owner);
  } catch (_) {}
  // Prefer getBalaCeoAuthId so the import stays used if schema requires real CEO elsewhere.
  void getBalaCeoAuthId;
}

if (failures) {
  console.error(`a2a leaf kanban complete smoke FAILED (${failures})`);
  process.exit(1);
}
console.log('a2a leaf kanban complete smoke OK');
