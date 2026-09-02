/**
 * VPS / container smoke: scheduled goals CRUD + pause tick safety (no OpenClaw fire required).
 * Run: docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/_smoke-scheduled-goals.mjs
 */
import {
  createScheduledGoal,
  listScheduledGoals,
  pauseScheduledGoal,
  resumeScheduledGoal,
  deleteScheduledGoal,
  getScheduledGoal,
  updateScheduledGoal,
  isGoalDueNow,
  normalizeCadence,
  runKeyForParts,
  zonedParts,
} from '../src/services/scheduled-goals.js';
import { getDb } from '../src/db/schema.js';
import { getPlatformTimezone } from '../src/utils/format-datetime.js';

const db = getDb();
const tools = db
  .prepare(`SELECT name FROM content_tools_meta WHERE name LIKE 'scheduled_goal_%' ORDER BY name`)
  .all()
  .map((r) => r.name);
console.log('tools_meta', tools);
if (tools.length < 5) {
  console.error('expected 5 scheduled_goal tools, got', tools.length);
  process.exit(2);
}

const grants = db
  .prepare(`SELECT COUNT(*) AS n FROM agent_tool_grants WHERE tool_name LIKE 'scheduled_goal_%'`)
  .get().n;
console.log('grants', grants);
if (grants < 5) {
  console.error('COO grants missing (expected >=5)');
  process.exit(3);
}

const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('scheduled_goals','scheduled_goal_runs')`)
  .all()
  .map((r) => r.name);
if (tables.length < 2) {
  console.error('tables missing', tables);
  process.exit(4);
}
console.log('tables', tables);

const ceo = db
  .prepare(`SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 ORDER BY id LIMIT 1`)
  .get();
if (!ceo) {
  console.error('no ceo');
  process.exit(5);
}
const owner = ceo.id;
const smokePlan = {
  version: 1,
  amended_manually: true,
  steps: [{ id: 'smoke-step', type: 'agent', agent_id: 'balserve', task: 'Verify scheduled goal CRUD.' }],
};
const createSmokeGoal = (input) => createScheduledGoal(owner, { ...input, plan: smokePlan });

// Clean leftover smokes
for (const r of db
  .prepare(`SELECT id FROM scheduled_goals WHERE owner_user_id = ? AND source = 'vps_smoke'`)
  .all(owner)) {
  try {
    deleteScheduledGoal(owner, r.id);
  } catch (_) {}
}

const goal = await createSmokeGoal({
  title: 'VPS smoke market insights',
  prompt: 'Daily smoke: summarize one market theme; do not publish.',
  agent_id: 'balserve',
  cadence: 'daily',
  time_local: '23:59',
  ends_at: null,
  source: 'vps_smoke',
  approve_plan: true,
});
console.log('created', {
  id: goal.id,
  status: goal.status,
  schedule: goal.schedule_label,
  ends: goal.ends_label,
  is_perpetual: goal.is_perpetual,
});
if (!goal.is_perpetual) throw new Error('expected perpetual');
if (!Array.isArray(goal.deliver_to) || !goal.deliver_to.includes('web') || goal.deliver_to.includes('whatsapp')) {
  throw new Error(`expected default deliver_to web-only, got ${JSON.stringify(goal.deliver_to)}`);
}
const withWa = updateScheduledGoal(owner, goal.id, { also_whatsapp: true });
if (!withWa.deliver_to?.includes('whatsapp')) throw new Error('also_whatsapp did not stick');
const webOnly = updateScheduledGoal(owner, goal.id, { deliver_to: ['web'] });
if (webOnly.deliver_to?.includes('whatsapp')) throw new Error('deliver_to web did not clear whatsapp');
console.log('deliver_to_ok', webOnly.deliver_to);

const listed = listScheduledGoals(owner);
if (!listed.find((g) => g.id === goal.id)) throw new Error('list missing created');
console.log('list_ok', listed.length);

const paused = pauseScheduledGoal(owner, goal.id);
if (paused.status !== 'paused') throw new Error('pause failed');
const rowPaused = db.prepare('SELECT * FROM scheduled_goals WHERE id = ?').get(goal.id);
if (isGoalDueNow(rowPaused)) throw new Error('paused goal still due');
console.log('pause_ok');

// Verify pause safety without invoking the global scheduler. Calling the real
// tick here can launch unrelated, currently-due production goals and keep this
// isolated CRUD smoke alive on their network sessions.
const stillPaused = db.prepare('SELECT last_run_status, status FROM scheduled_goals WHERE id = ?').get(goal.id);
if (stillPaused.status !== 'paused') throw new Error('tick changed pause status');
if (stillPaused.last_run_status === 'ok' || stillPaused.last_run_status === 'running') {
  throw new Error('tick fired paused goal');
}
if (isGoalDueNow(db.prepare('SELECT * FROM scheduled_goals WHERE id = ?').get(goal.id), new Date())) {
  throw new Error('paused goal became due');
}
console.log('paused_goal_not_due_ok');

const resumed = resumeScheduledGoal(owner, goal.id);
if (resumed.status !== 'active') throw new Error('resume failed');
console.log('resume_ok tz=', getPlatformTimezone());

deleteScheduledGoal(owner, goal.id);
if (getScheduledGoal(owner, goal.id)) throw new Error('delete failed');
console.log('delete_ok');

// Deleted must not reappear as due after "restart" (just reload row)
const g2 = await createSmokeGoal({
  title: 'delete persist check',
  prompt: 'should be gone',
  agent_id: 'balserve',
  time_local: '00:00',
  cadence: 'daily',
  source: 'vps_smoke',
  approve_plan: true,
});
const id2 = g2.id;
deleteScheduledGoal(owner, id2);
if (db.prepare('SELECT id FROM scheduled_goals WHERE id = ?').get(id2)) {
  throw new Error('row still exists after delete');
}
console.log('delete_persistent_ok');

const g3 = await createSmokeGoal({
  title: 'ends 2099',
  prompt: 'temporary',
  agent_id: 'balserve',
  ends_at: '2099-12-31',
  source: 'vps_smoke',
  approve_plan: true,
});
if (g3.is_perpetual) throw new Error('should not be perpetual');
const g4 = await createSmokeGoal({
  title: 'forever',
  prompt: 'perpetual',
  agent_id: 'balserve',
  ends_at: 'perpetual',
  source: 'vps_smoke',
  approve_plan: true,
});
if (!g4.is_perpetual) throw new Error('should be perpetual');
deleteScheduledGoal(owner, g3.id);
deleteScheduledGoal(owner, g4.id);

// Weekdays cadence field
const g5 = await createSmokeGoal({
  title: 'weekdays',
  prompt: 'weekday only',
  agent_id: 'balserve',
  cadence: 'weekdays',
  time_local: '08:30',
  source: 'vps_smoke',
  approve_plan: true,
});
if (g5.cadence !== 'weekdays') throw new Error('weekdays cadence');
if (!String(g5.schedule_label).toLowerCase().includes('weekday')) throw new Error('label');
deleteScheduledGoal(owner, g5.id);

// Hourly + update (edit)
if (normalizeCadence('every hour') !== 'hourly') throw new Error('normalizeCadence hourly alias');
const g6 = await createSmokeGoal({
  title: 'hourly smoke',
  prompt: 'hourly check',
  agent_id: 'balserve',
  cadence: 'hourly',
  time_local: '00:15',
  source: 'vps_smoke',
  approve_plan: true,
});
if (g6.cadence !== 'hourly') throw new Error('hourly cadence');
if (!String(g6.schedule_label).toLowerCase().includes('hourly')) throw new Error('hourly label');
const parts = zonedParts(new Date(), getPlatformTimezone());
const slot = runKeyForParts({ cadence: 'hourly' }, parts, { force: false });
if (!/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(slot)) throw new Error('hourly run key shape ' + slot);
const g6e = updateScheduledGoal(owner, g6.id, {
  title: 'hourly smoke edited',
  prompt: 'edited prompt',
  cadence: 'daily',
  time_local: '10:00',
});
if (g6e.title !== 'hourly smoke edited' || g6e.cadence !== 'daily') throw new Error('update failed');
if (!String(g6e.prompt).includes('edited')) throw new Error('prompt not updated');
deleteScheduledGoal(owner, g6.id);
console.log('hourly_and_edit_ok');

console.log('SCHEDULED_GOALS_SMOKE_OK');
