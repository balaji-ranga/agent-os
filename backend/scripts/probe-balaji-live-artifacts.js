/**
 * Read-only snapshot of everything the live delegation validation left behind for `ceo-bala`,
 * so the CEO can cross-check the UI against the database.
 *
 * Usage: node backend/scripts/probe-balaji-live-artifacts.js
 */
import { getDb, initDb } from '../src/db/schema.js';

const OWNER = process.env.LIVE_OWNER || 'ceo-bala';

initDb();
const db = getDb();

console.log('== delegation tasks (internal path) ==');
console.log(
  db
    .prepare(
      `SELECT id, to_agent_id, status, substr(COALESCE(response_content, ''), 1, 160) AS reply
       FROM agent_delegation_tasks
       WHERE owner_user_id = ? ORDER BY id DESC LIMIT 5`
    )
    .all(OWNER)
);

console.log('\n== recent kanban cards ==');
console.log(
  db
    .prepare(
      `SELECT id, status, assigned_agent_id, assigned_member_key, substr(title, 1, 70) AS title
       FROM kanban_tasks WHERE owner_user_id = ? ORDER BY id DESC LIMIT 10`
    )
    .all(OWNER)
);

console.log('\n== org leaf members ==');
console.log(
  db
    .prepare(
      `SELECT id, kind, department, parent_id, monthly_token_budget, error_budget_pct, enabled
       FROM org_agent_members WHERE owner_user_id = ?`
    )
    .all(OWNER)
);

console.log('\n== budgets this period ==');
console.log(
  db
    .prepare(
      `SELECT member_key, period, monthly_token_budget, error_budget_pct, warn_token_pct
       FROM agent_ops_budgets WHERE owner_user_id = ? AND period = strftime('%Y-%m', 'now')`
    )
    .all(OWNER)
);

console.log('\n== leaf member invocations ==');
console.log(
  db
    .prepare(
      `SELECT member_key, source, status, latency_ms, task_id, created_at
       FROM org_member_invocations WHERE owner_user_id = ? ORDER BY id DESC LIMIT 10`
    )
    .all(OWNER)
);
