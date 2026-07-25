/**
 * Probe Kanban vs status_checker consistency and orphan stuck cards for a CEO.
 * Usage: node scripts/probe-kanban-orphan-status.js [ownerUserId]
 */
import { initDb, getDb } from '../src/db/schema.js';
import { buildStatusDigest } from '../src/services/coo-status-checker.js';

const owner = process.argv[2] || 'ceo-bala';
initDb();
const db = getDb();

const byStatus = db
  .prepare(
    `SELECT status, COUNT(*) AS n FROM kanban_tasks WHERE owner_user_id = ? GROUP BY status ORDER BY n DESC`
  )
  .all(owner);
console.log('--- kanban by status ---');
console.log(byStatus);

const weekAgo = db
  .prepare(
    `SELECT status, COUNT(*) AS n FROM kanban_tasks
     WHERE owner_user_id = ?
       AND datetime(created_at) >= datetime('now', '-7 days')
     GROUP BY status`
  )
  .all(owner);
console.log('--- kanban created last 7 days ---');
console.log(weekAgo);

const olderOpen = db
  .prepare(
    `SELECT id, title, status, assigned_agent_id, assigned_member_key,
            agent_delegation_task_id, created_at, updated_at
     FROM kanban_tasks
     WHERE owner_user_id = ?
       AND status IN ('open','awaiting_confirmation','in_progress','failed')
       AND datetime(created_at) < datetime('now', '-7 days')
     ORDER BY updated_at DESC LIMIT 20`
  )
  .all(owner);
console.log('--- open/failed older than 7 days (hidden from weekly UI) ---');
console.log(olderOpen);

const orphans = db
  .prepare(
    `SELECT k.id, k.title, k.status AS kanban_status, k.assigned_agent_id,
            k.agent_delegation_task_id, k.updated_at,
            d.status AS del_status, d.error_message,
            substr(d.response_content, 1, 80) AS reply_head
     FROM kanban_tasks k
     LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
     WHERE k.owner_user_id = ?
       AND k.status IN ('open','in_progress','failed')
       AND (
         k.agent_delegation_task_id IS NULL
         OR d.id IS NULL
         OR d.status IN ('pending','processing','failed')
         OR (d.status = 'completed' AND k.status = 'in_progress')
       )
     ORDER BY k.updated_at DESC
     LIMIT 25`
  )
  .all(owner);
console.log('--- orphan / stuck candidates ---');
console.log(orphans);

const digest = buildStatusDigest(owner, { reconcile: false });
console.log('--- status_checker counts ---');
console.log(digest.counts);
