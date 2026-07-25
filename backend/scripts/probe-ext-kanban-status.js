/**
 * Probe recent external/A2A leaf Kanban cards for a CEO.
 * Usage: node scripts/probe-ext-kanban-status.js [owner]
 */
import { initDb, getDb } from '../src/db/schema.js';

const owner = process.argv[2] || 'ceo-bala';
initDb();
const db = getDb();
console.log(
  db
    .prepare(
      `SELECT id, title, status, assigned_member_key, a2a_task_id, workflow_run_id,
              substr(description, -280) AS tail, updated_at
       FROM kanban_tasks
       WHERE owner_user_id = ?
         AND assigned_member_key IS NOT NULL
       ORDER BY id DESC LIMIT 8`
    )
    .all(owner)
);
