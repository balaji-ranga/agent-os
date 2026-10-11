import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { buildHomeTeamActivity } from '../src/services/home-team-activity.js';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE kanban_tasks (id INTEGER PRIMARY KEY, assigned_agent_id TEXT, owner_user_id TEXT,
    title TEXT, status TEXT, created_at TEXT, updated_at TEXT);
  CREATE TABLE chat_turns (id INTEGER PRIMARY KEY, agent_id TEXT, owner_user_id TEXT,
    role TEXT, content TEXT, created_at TEXT);
  CREATE TABLE agent_delegation_tasks (id INTEGER PRIMARY KEY, to_agent_id TEXT, owner_user_id TEXT,
    prompt TEXT, created_at TEXT, completed_at TEXT);
  CREATE TABLE agent_goal_runs (id TEXT PRIMARY KEY, agent_id TEXT, owner_user_id TEXT,
    title TEXT, created_at TEXT, updated_at TEXT, completed_at TEXT);
`);
const agents = Array.from({ length: 12 }, (_, i) => ({
  id: `agent-${i}`, name: `${String.fromCharCode(65 + i)} Agent`, role: 'Researcher',
}));
const options = {
  agents, ownerUserId: 'ceo-a', ownerFilter: { clause: 'k.owner_user_id IN (?,?)', params: ['ceo-a', 'legacy-a'] },
};
const run = (extra = {}) => buildHomeTeamActivity(db, { ...options, ...extra });
const task = db.prepare('INSERT INTO kanban_tasks VALUES(?,?,?,?,?,?,?)');
const chat = db.prepare('INSERT INTO chat_turns VALUES(?,?,?,?,?,?)');
task.run(1, 'agent-0', 'ceo-a', 'Older work', 'completed', '2026-10-10 01:00:00', '2026-10-10 02:00:00');
task.run(2, 'agent-11', 'ceo-a', 'Latest task', 'in_progress', '2026-10-11 03:00:00', '2026-10-11 04:00:00');
task.run(3, 'agent-8', 'legacy-a', 'Legacy scoped work', 'open', '2026-10-11 02:00:00', null);
chat.run(1, 'agent-10', 'ceo-a', 'assistant', 'Private chat content', '2026-10-11T13:00:00+08:00');
db.prepare('INSERT INTO agent_delegation_tasks VALUES(?,?,?,?,?,?)')
  .run(1, 'agent-9', 'ceo-a', 'Private delegated prompt', '2026-10-10 01:00:00', '2026-10-11 03:00:00');
db.prepare('INSERT INTO agent_goal_runs VALUES(?,?,?,?,?,?,?)')
  .run('goal-1', 'agent-7', 'ceo-a', 'Finished goal', '2026-10-10 01:00:00', '2026-10-11 00:00:00', '2026-10-11 06:00:00');

assert.deepEqual(run().map((a) => a.id), [
  'agent-7', 'agent-10', 'agent-11', 'agent-9', 'agent-8', 'agent-0', 'agent-1', 'agent-2',
], 'sort the entire team before truncation, including agents beyond the alphabetical first eight');
assert.equal(run()[1].last_active_at, '2026-10-11T05:00:00.000Z', 'normalize timezone offsets and SQLite UTC');
assert.equal(run()[1].activity, 'Recent chat', 'activity label corresponds to latest source');
assert.equal(run()[2].activity, 'Latest task');
assert.equal(run()[2].active_tasks, 1);
assert.equal(run()[2].status, 'active');
assert.equal(run()[0].status, 'idle', 'recency does not imply still running');
assert.equal(run().find((a) => a.id === 'agent-8').active_tasks, 1, 'preserve legacy owner scope');
assert.equal(run()[6].last_active_at, null, 'never-active agents follow actual activity');
assert.equal(run()[6].activity, 'Researcher');

// A shared agent's other-company work must not change order, counts or labels.
task.run(4, 'agent-0', 'ceo-b', 'Other company confidential title', 'in_progress', '2026-12-01 00:00:00', null);
chat.run(2, 'agent-0', 'ceo-b', 'assistant', 'Other company confidential chat', '2026-12-01 00:00:00');
db.prepare('INSERT INTO agent_delegation_tasks VALUES(?,?,?,?,?,?)')
  .run(2, 'agent-0', 'ceo-b', 'Other company prompt', '2026-12-01 00:00:00', null);
db.prepare('INSERT INTO agent_goal_runs VALUES(?,?,?,?,?,?,?)')
  .run('goal-2', 'agent-0', 'ceo-b', 'Other company goal', '2026-12-01 00:00:00', null, null);
task.run(5, 'disabled-agent', 'ceo-a', 'No access', 'in_progress', '2026-12-01 00:00:00', null);
chat.run(3, 'agent-1', 'ceo-a', 'system', 'System noise', '2026-12-01 00:00:00');
chat.run(4, 'agent-2', 'ceo-a', 'assistant', 'Bad timestamp', 'invalid');
assert.deepEqual(run().map((a) => a.id), ['agent-7', 'agent-10', 'agent-11', 'agent-9', 'agent-8', 'agent-0', 'agent-1', 'agent-2']);
assert.equal(run().find((a) => a.id === 'agent-0').active_tasks, 0);
assert(!JSON.stringify(run()).match(/confidential|Private|No access|System noise/));
assert.deepEqual(run({ agents: [] }), []);
assert.deepEqual(run({ ownerUserId: '' }), []);
assert.equal(run({ limit: 6 }).length, 6, 'support the six-row Home display');
assert.deepEqual(run({ limit: 0 }), []);

chat.run(5, 'agent-3', 'ceo-a', 'user', 'Fresh request', '2026-10-11 07:00:00');
chat.run(6, 'agent-4', 'ceo-a', 'assistant', 'Fresh reply', '2026-10-11T07:00:00.000Z');
assert.deepEqual(run().slice(0, 2).map((a) => a.id), ['agent-3', 'agent-4'], 'ties resolve deterministically');
assert.deepEqual(run({ agents: [...agents].reverse() }), run(), 'independent of input/picker ordering');
chat.run(7, 'agent-11', 'ceo-a', 'assistant', 'New work', '2026-10-11 08:00:00');
assert.equal(run()[0].id, 'agent-11', 'subsequent snapshots pick up newly active agents');
assert.equal(run()[0].activity_source, 'chat');
assert.equal(run()[0].activity, 'Recent chat', 'do not attach an unrelated old task title to fresh chat');

const route = readFileSync(new URL('../src/routes/home.js', import.meta.url), 'utf8');
assert.match(route, /const agentActivity = buildHomeTeamActivity\(db,/);
assert.doesNotMatch(route, /agents\.slice\(0, 8\)\.map/);
db.close();
console.log('PASS Home team activity: full-team recency, chat/task/delegation/goal sources, tenant isolation, limits, ties and refresh');
