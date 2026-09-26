import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  getAgentDelegatedWorkHistory,
  listAgentDelegatedWorkHistory,
} from '../src/services/agent-work-history.js';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE agent_delegation_tasks (
    id INTEGER PRIMARY KEY, prompt TEXT, status TEXT, response_content TEXT,
    error_message TEXT, created_at TEXT, completed_at TEXT
  );
  CREATE TABLE kanban_tasks (
    id INTEGER PRIMARY KEY, title TEXT, description TEXT, status TEXT,
    assigned_agent_id TEXT, owner_user_id TEXT, goal_run_id TEXT,
    agent_delegation_task_id INTEGER, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE chat_turns (
    id INTEGER PRIMARY KEY, agent_id TEXT, owner_user_id TEXT, role TEXT,
    content TEXT, session_id TEXT, created_at TEXT
  );
  CREATE TABLE task_messages (
    id INTEGER PRIMARY KEY, task_id INTEGER, role TEXT, content TEXT, created_at TEXT
  );
`);

const insertDelegation = db.prepare(`INSERT INTO agent_delegation_tasks
  (id,prompt,status,response_content,error_message,created_at,completed_at)
  VALUES(?,?,?,?,?,datetime('now','-2 minutes'),datetime('now','-1 minute'))`);
const insertTask = db.prepare(`INSERT INTO kanban_tasks
  (id,title,description,status,assigned_agent_id,owner_user_id,goal_run_id,agent_delegation_task_id,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,datetime('now','-3 minutes'),datetime('now'))`);

insertDelegation.run(11, 'Research the latest campaign results.', 'completed', 'The campaign reached 42 qualified leads.', null);
insertTask.run(101, 'Campaign research', 'Research campaign performance.', 'completed', 'social-researcher', 'ceo-a', null, 11);
db.prepare(`INSERT INTO chat_turns VALUES(1,'social-researcher','ceo-a','user',?,'delegation-11',datetime('now','-2 minutes'))`)
  .run('Research the latest campaign results.');
db.prepare(`INSERT INTO chat_turns VALUES(2,'social-researcher','ceo-a','assistant',?,'delegation-11',datetime('now','-1 minute'))`)
  .run('The campaign reached 42 qualified leads.');
db.prepare(`INSERT INTO task_messages VALUES(1,101,'user','Please include source links.',datetime('now'))`).run();

insertDelegation.run(12, '[goal_run_id: agr-1]\n[goal_step_id: ags-2]\nSummarize market response.', 'completed', 'Market response was positive.', null);
insertTask.run(102, 'Goal market summary', '', 'completed', 'social-researcher', 'ceo-a', 'agr-1', 12);
db.prepare(`INSERT INTO chat_turns VALUES(3,'social-researcher','ceo-a','assistant',?,'goal-agr-1-ags-2',datetime('now'))`)
  .run('Market response was positive.');

insertDelegation.run(13, 'Private tenant request.', 'completed', 'Private tenant result.', null);
insertTask.run(201, 'Other tenant', '', 'completed', 'social-researcher', 'ceo-b', null, 13);
insertDelegation.run(14, 'Other agent request.', 'completed', 'Other agent result.', null);
insertTask.run(301, 'Other agent', '', 'completed', 'sales-agent', 'ceo-a', null, 14);

const firstPage = listAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'social-researcher', days: 90, limit: 1, offset: 0, database: db,
});
assert.equal(firstPage.total, 2);
assert.equal(firstPage.items.length, 1);
assert.equal(firstPage.has_more, true);
assert(firstPage.items.every((item) => item.task_id !== 201 && item.task_id !== 301));

const secondPage = listAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'social-researcher', days: 90, limit: 1, offset: 1, database: db,
});
assert.equal(secondPage.items.length, 1);
assert.equal(secondPage.has_more, false);
assert.notEqual(firstPage.items[0].task_id, secondPage.items[0].task_id);

const detail = getAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'social-researcher', taskId: 101, days: 90, database: db,
});
assert.equal(detail.session_id, 'delegation-11');
assert.equal(detail.turns.length, 2);
assert.match(detail.response, /42 qualified leads/);
assert.equal(detail.task_messages.length, 1);

const goalDetail = getAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'social-researcher', taskId: 102, days: 90, database: db,
});
assert.equal(goalDetail.session_id, 'goal-agr-1-ags-2');
assert.equal(goalDetail.turns.length, 1);

assert.equal(getAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-b', agentId: 'social-researcher', taskId: 101, days: 90, database: db,
}), null, 'another owner must not read the task');
assert.equal(getAgentDelegatedWorkHistory({
  ownerUserId: 'ceo-a', agentId: 'sales-agent', taskId: 101, days: 90, database: db,
}), null, 'another agent chat must not read the task');

db.close();
console.log('PASS agent chat work history');
