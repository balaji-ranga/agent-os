// Read-only production acceptance: specify an existing CEO by exact name.
// Usage: docker exec -e HOME_OWNER_NAME='...' agent-os-backend-1 node scripts/vps-test-home-team-activity-live.mjs
import assert from 'node:assert/strict';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildHomeTeamActivity } from '../src/services/home-team-activity.js';
import { resolveCeoDataUserId } from '../src/services/job-applicant-ceo.js';

const name = String(process.env.HOME_OWNER_NAME || '').trim();
assert(name, 'HOME_OWNER_NAME must identify the CEO whose Home page is being tested');
assert(process.env.AGENT_OS_DATA_DIR, 'AGENT_OS_DATA_DIR must identify the production database');
const db = new Database(join(process.env.AGENT_OS_DATA_DIR, 'agent-os.db'), { readonly: true, fileMustExist: true });
const owners = db.prepare("SELECT id FROM platform_users WHERE name = ? AND role = 'ceo'").all(name);
assert.equal(owners.length, 1, 'resolve exactly one existing CEO, never an arbitrary tenant');
const owner = owners[0].id;
const scopeIds = [...new Set([owner, resolveCeoDataUserId(owner)])];
const ownerFilter = { clause: `k.owner_user_id IN (${scopeIds.map(() => '?').join(',')})`, params: scopeIds };
const agents = db.prepare(`SELECT a.* FROM user_agents ua JOIN agents a ON a.id = ua.agent_id
  WHERE ua.user_id = ? AND ua.enabled = 1 ORDER BY a.name`).all(owner);
const started = performance.now();
const rows = buildHomeTeamActivity(db, { agents, ownerUserId: owner, ownerFilter });
const elapsed = performance.now() - started;
assert.equal(rows.length, Math.min(8, agents.length));
assert(rows.every((row) => agents.some((agent) => agent.id === row.id)));
for (let i = 1; i < rows.length; i++) {
  assert((Date.parse(rows[i - 1].last_active_at) || 0) >= (Date.parse(rows[i].last_active_at) || 0), 'descending recency');
}
// Check the most recent scoped event across all accessible agents, not merely the displayed subset.
const newest = db.prepare(`SELECT MAX(occurred_at) AS occurred_at FROM (
  SELECT k.assigned_agent_id AS agent_id, COALESCE(julianday(k.updated_at),julianday(k.created_at)) AS occurred_at
    FROM kanban_tasks k WHERE ${ownerFilter.clause}
  UNION ALL SELECT agent_id,julianday(created_at) FROM chat_turns WHERE owner_user_id=? AND role IN ('user','assistant')
  UNION ALL SELECT to_agent_id,COALESCE(julianday(completed_at),julianday(created_at)) FROM agent_delegation_tasks WHERE owner_user_id=?
  UNION ALL SELECT agent_id,COALESCE(julianday(completed_at),julianday(updated_at),julianday(created_at)) FROM agent_goal_runs WHERE owner_user_id=?
) WHERE agent_id IN (SELECT value FROM json_each(?))`)
  .get(...scopeIds, owner, owner, owner, JSON.stringify(agents.map((agent) => agent.id))).occurred_at;
if (newest != null) {
  assert.equal(rows[0].last_active_at, db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', ?) AS time").get(newest).time);
}
console.log(JSON.stringify({
  result: 'HOME_LIVE_READONLY_PASS', agent_count: agents.length, query_ms: Number(elapsed.toFixed(2)),
  visible_team: rows.slice(0, 6).map(({ name, last_active_at, activity_source }) => ({ name, last_active_at, activity_source })),
}, null, 2));
db.close();
