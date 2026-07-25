#!/usr/bin/env node
import { initDb } from '../src/db/schema.js';
import { runKanbanOrphanWatcher } from '../src/services/kanban-orphan-watcher.js';
import { buildStatusDigest } from '../src/services/coo-status-checker.js';
import { getDb } from '../src/db/schema.js';

initDb();
const owner = process.argv[2] || 'ceo-bala';
const w = runKanbanOrphanWatcher({ ownerUserId: owner, limit: 25 });
console.log(
  JSON.stringify(
    {
      stale: w.stale_processing,
      orphans: { scanned: w.orphans.scanned, reinitiated: w.orphans.reinitiated, skipped: w.orphans.skipped },
      status_only: w.status_only,
    },
    null,
    2
  )
);
const d = buildStatusDigest(owner, { reconcile: false });
console.log('counts', d.counts);
const stuck = getDb()
  .prepare(
    `SELECT k.id, k.title, k.status AS kstatus, d.status AS dstatus, d.error_message
     FROM kanban_tasks k
     LEFT JOIN agent_delegation_tasks d ON d.id = k.agent_delegation_task_id
     WHERE k.owner_user_id = ? AND k.id IN (1770, 1771)
     ORDER BY k.id`
  )
  .all(owner);
console.log('research cards', stuck);
