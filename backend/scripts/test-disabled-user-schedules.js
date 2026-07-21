/**
 * Smoke: disabled CEO must not run standup schedules / workflow schedules / pipeline.
 * Run: node scripts/test-disabled-user-schedules.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { setUserEnabled, isUserEnabled } from '../src/services/users.js';
import { isUserEnabled as isEnabledLite } from '../src/services/user-enabled.js';
import {
  removeWorkflowSchedulesForOwner,
  syncWorkflowScheduleRegistry,
  listScheduledFromRegistry,
} from '../src/services/agent-workflow-store.js';
import { runDueStandupSchedules, alreadyRanStandupToday, isStandupDueNow } from '../src/cron/standup.js';
import { runPipelineTick } from '../src/services/job-applicant-pipeline.js';

initDb();
const db = getDb();

const ceo = db
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' ORDER BY rowid LIMIT 1`)
  .get();
if (!ceo?.id) {
  console.error('FAIL: no CEO');
  process.exit(1);
}
const ownerUserId = ceo.id;
const wasEnabled = isUserEnabled(ownerUserId);

// Ensure a due manual standup exists for this owner
const dueAt = new Date();
dueAt.setUTCSeconds(0, 0);
db.prepare(
  `INSERT INTO standups (scheduled_at, status, source, title, outcomes, owner_user_id)
   VALUES (?, 'scheduled', 'manual', 'Disable-cron smoke', 'should not run when disabled', ?)`
).run(dueAt.toISOString(), ownerUserId);
const standupId = db.prepare('SELECT id FROM standups WHERE id = last_insert_rowid()').get().id;

// Seed a fake schedule registry row (if any published workflow exists)
const wf = db
  .prepare(
    `SELECT id, name, schedule_cron FROM agent_workflow_definitions
     WHERE owner_user_id = ? AND status = 'published' AND schedule_cron IS NOT NULL AND schedule_cron != ''
     LIMIT 1`
  )
  .get(ownerUserId);
if (wf) {
  db.prepare(
    `INSERT INTO agent_workflow_schedules (definition_id, owner_user_id, workflow_name, schedule_cron, enabled, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(definition_id) DO UPDATE SET enabled = 1, owner_user_id = excluded.owner_user_id, updated_at = datetime('now')`
  ).run(wf.id, ownerUserId, wf.name, wf.schedule_cron);
}

setUserEnabled(ownerUserId, false);

if (isEnabledLite(ownerUserId) || isUserEnabled(ownerUserId)) {
  console.error('FAIL: user still enabled after setUserEnabled(false)');
  process.exit(1);
}

const removed = removeWorkflowSchedulesForOwner(ownerUserId);
const listed = listScheduledFromRegistry().filter((d) => d.owner_user_id === ownerUserId);
if (listed.length) {
  console.error('FAIL: workflow schedules still listed for disabled owner', listed.map((d) => d.id));
  process.exit(1);
}
console.log('OK: workflow schedules cleared for disabled owner', { removed, listed: listed.length });

const tick = await runDueStandupSchedules(dueAt);
const ranOurs = (tick.results || []).some((r) => r.standupId === standupId && !r.skipped && !r.error);
if (ranOurs) {
  console.error('FAIL: standup schedule ran for disabled owner', tick);
  process.exit(1);
}
const row = db.prepare('SELECT last_scheduled_run_at FROM standups WHERE id = ?').get(standupId);
if (row?.last_scheduled_run_at) {
  console.error('FAIL: standup last_scheduled_run_at set while disabled');
  process.exit(1);
}
console.log('OK: standup schedule skipped for disabled owner');

const pipe = await runPipelineTick(ownerUserId, null);
if (pipe.reason !== 'owner_disabled') {
  console.error('FAIL: pipeline tick should skip disabled owner', pipe);
  process.exit(1);
}
console.log('OK: pipeline tick skipped for disabled owner');

// Restore
setUserEnabled(ownerUserId, wasEnabled);
if (wasEnabled) syncWorkflowScheduleRegistry();

db.prepare('DELETE FROM standup_messages WHERE standup_id = ?').run(standupId);
db.prepare('DELETE FROM standups WHERE id = ?').run(standupId);

console.log('PASS: disabled-user schedule gates');
