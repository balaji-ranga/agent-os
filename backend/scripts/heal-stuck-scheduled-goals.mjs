/**
 * Heal scheduled_goal_runs stuck at status=running (Balaji morning 9am case).
 * Usage: node scripts/heal-stuck-scheduled-goals.mjs [ownerUserId]
 */
import { initDb } from '../src/db/schema.js';
import { reconcileStuckScheduledGoalRuns } from '../src/services/scheduled-goals.js';

initDb();
const owner = String(process.env.OWNER_USER_ID || process.argv[2] || '').trim();
// Force age-out of anything older than 5 minutes for this heal pass.
process.env.SCHEDULED_GOAL_STUCK_MINUTES = process.env.SCHEDULED_GOAL_STUCK_MINUTES || '5';
const out = reconcileStuckScheduledGoalRuns(new Date());
console.log(JSON.stringify({ ok: true, owner: owner || null, ...out }, null, 2));
