/**
 * Verify standup get_work_from_team can fan out to agents under COO (not false "no agents").
 *
 * Default is a dry run: no standup row, no Kanban cards, no OpenClaw jobs, no CEO bell.
 * VPS deploy used to persist a live fan-out against ceo-bala then delete the standup,
 * which left Kanban notifications with no Org standup entry.
 *
 * Usage: node scripts/test-standup-get-work-from-team.js [ownerUserId]
 * Opt-in live persist (isolated labs only): STANDUP_FANOUT_LIVE=1
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getAgentsUnderCooForCeo } from '../src/services/org-context.js';
import { scheduleStandupStatusFanout } from '../src/services/delegation-queue.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { runCooStatusChecker } from '../src/services/coo-status-checker.js';

initDb();
const owner = process.argv[2] || getBalaCeoAuthId();
const db = getDb();
const live = String(process.env.STANDUP_FANOUT_LIVE || '').trim() === '1';

const under = getAgentsUnderCooForCeo(owner);
if (!under.length) {
  console.error('FAIL: expected agents under COO for', owner);
  process.exit(1);
}

function cleanupOrphanedStatusFanoutNotifications(ownerUserId) {
  const rows = db
    .prepare(
      `SELECT id, source_key FROM platform_user_notifications
       WHERE user_id = ?
         AND source = 'kanban_task'
         AND title LIKE 'Kanban: Provide your status and deliverables%'`
    )
    .all(ownerUserId);
  let deleted = 0;
  for (const row of rows) {
    const exists = db
      .prepare(`SELECT id FROM kanban_tasks WHERE CAST(id AS TEXT) = ?`)
      .get(String(row.source_key || ''));
    if (exists?.id) continue;
    db.prepare('DELETE FROM platform_user_notifications WHERE id = ?').run(row.id);
    deleted++;
  }
  return deleted;
}

const cleaned = cleanupOrphanedStatusFanoutNotifications(owner);
if (cleaned) {
  console.log('cleaned_orphaned_status_fanout_notifications', cleaned);
}

let standupId = 0;
if (live) {
  const ins = db
    .prepare(
      `INSERT INTO standups (scheduled_at, status, source, title, owner_user_id)
       VALUES (datetime('now'), 'active', 'cron', 'deploy fanout probe', ?)`
    )
    .run(owner);
  standupId = Number(ins.lastInsertRowid);
}

const out = await scheduleStandupStatusFanout(standupId, owner, '', {
  persist: live,
  notify: false,
  scheduleOpenClaw: false,
});
console.log('fanout', {
  live,
  persist: live,
  agentsAvailable: out.agentsAvailable,
  count: out.count,
  agentNames: out.agentNames,
  blocked: (out.internalBlocked || []).length,
});

if (!out.agentsAvailable) {
  console.error('FAIL: agentsAvailable=0');
  process.exit(1);
}
if (out.count === 0 && !(out.internalBlocked || []).length) {
  console.error('FAIL: count=0 with no budget blocks — would have shown false "no agents" before');
  process.exit(1);
}

// status_checker tool path must not email
const status = await runCooStatusChecker(owner, { email: false, postStandup: false });
if (status.email) {
  console.error('FAIL: email should be null/undefined when email:false', status.email);
  process.exit(1);
}
console.log('status_checker email_disabled_ok', { awaiting: status.digest.counts.awaiting_ceo });

if (live && standupId) {
  const taskIds = db
    .prepare(`SELECT id FROM kanban_tasks WHERE standup_id = ?`)
    .all(standupId)
    .map((r) => r.id);
  for (const id of taskIds) {
    db.prepare(
      `DELETE FROM platform_user_notifications WHERE source = 'kanban_task' AND source_key = ? AND user_id = ?`
    ).run(String(id), owner);
  }
  db.prepare('DELETE FROM kanban_tasks WHERE standup_id = ?').run(standupId);
  db.prepare('DELETE FROM agent_delegation_tasks WHERE standup_id = ?').run(standupId);
  db.prepare('DELETE FROM standup_messages WHERE standup_id = ?').run(standupId);
  db.prepare('DELETE FROM standups WHERE id = ?').run(standupId);
}

console.log('PASS: standup get_work_from_team fanout (dry-run) + status email batch-only');
