/**
 * Verify standup get_work_from_team fans out to agents under COO (not false "no agents").
 * Usage: node scripts/test-standup-get-work-from-team.js [ownerUserId]
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getAgentsUnderCooForCeo } from '../src/services/org-context.js';
import { scheduleStandupStatusFanout } from '../src/services/delegation-queue.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { runCooStatusChecker } from '../src/services/coo-status-checker.js';

initDb();
const owner = process.argv[2] || getBalaCeoAuthId();
const under = getAgentsUnderCooForCeo(owner);
if (!under.length) {
  console.error('FAIL: expected agents under COO for', owner);
  process.exit(1);
}

// Disposable standup so we don't pollute a real CEO thread with a full fan-out in CI.
const ins = getDb()
  .prepare(
    `INSERT INTO standups (scheduled_at, status, source, owner_user_id)
     VALUES (datetime('now'), 'active', 'manual', ?)`
  )
  .run(owner);
const standupId = Number(ins.lastInsertRowid);

const out = await scheduleStandupStatusFanout(standupId, owner, '');
console.log('fanout', {
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

// Cleanup fan-out tasks created for this probe standup (best-effort).
getDb().prepare('DELETE FROM kanban_tasks WHERE standup_id = ?').run(standupId);
getDb().prepare('DELETE FROM agent_delegation_tasks WHERE standup_id = ?').run(standupId);
getDb().prepare('DELETE FROM standup_messages WHERE standup_id = ?').run(standupId);
getDb().prepare('DELETE FROM standups WHERE id = ?').run(standupId);

console.log('PASS: standup get_work_from_team fanout + status email batch-only');
