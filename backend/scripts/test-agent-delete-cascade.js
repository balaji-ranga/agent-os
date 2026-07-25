/**
 * Agent delete: FK cascade + no resurrection.
 *
 * Reproduces the two production bugs and pins the fixes:
 *   1. an agent with kanban assignments could not be deleted (FOREIGN KEY
 *      constraint failed) and the failed attempt still wiped chat history;
 *   2. a deleted agent reappeared via the startup catalog re-grant and via
 *      POST /api/openclaw/sync reading leftover openclaw.json entries.
 *
 * Run: node scripts/test-agent-delete-cascade.js
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmp = mkdtempSync(join(tmpdir(), 'agentos-agentdel-'));
process.env.AGENT_OS_DATA_DIR = tmp;

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  OK:', msg);
  else {
    fails += 1;
    console.error('  FAIL:', msg);
  }
}

const COO = 'coo-test';
const AGENT = 'balasocial-test';
const CHILD = 'child-test';
const SHARED = 'onmain-test';
const CEO = 'ceo-bala';

try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  initDb();
  const db = getDb();

  const {
    deleteAgentCascade,
    isAgentTombstoned,
    clearAgentTombstone,
    exclusiveOpenClawBaseIds,
  } = await import('../src/services/agent-delete.js');

  console.log('== preconditions ==');
  check(db.pragma('foreign_keys', { simple: true }) === 1, 'PRAGMA foreign_keys is ON (FKs enforced)');

  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, role, enabled)
     VALUES (?, ?, 'x', ?, 'ceo', 1)`
  ).run(CEO, 'bala@test.local', 'Balaji Ranganathan');

  const insertAgent = db.prepare(
    `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertAgent.run(COO, 'BalServe', 'COO', null, '/ws/coo', COO, 1, 'standard', null);
  insertAgent.run(AGENT, 'BalaSocial', 'Social', COO, '/ws/social', AGENT, 0, 'standard', CEO);
  insertAgent.run(CHILD, 'Helper', 'Helper', AGENT, '/ws/helper', CHILD, 0, 'custom', CEO);
  // Real VPS shape: an agent parked on the shared `main` OpenClaw runtime.
  insertAgent.run(SHARED, 'OnMain', 'Social', COO, '/ws/main', 'main', 0, 'custom', CEO);

  db.prepare(`INSERT INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, 1)`).run(CEO, AGENT);
  db.prepare(`INSERT INTO agent_tool_grants (agent_id, tool_name) VALUES (?, ?)`).run(AGENT, 'summarize_url');
  db.prepare(`INSERT INTO chat_turns (agent_id, role, content) VALUES (?, 'user', 'hi')`).run(AGENT);
  db.prepare(`INSERT INTO activities (agent_id, type, payload) VALUES (?, 'note', '{}')`).run(AGENT);

  const standupId = db
    .prepare(`INSERT INTO standups (scheduled_at, status) VALUES (datetime('now'), 'scheduled')`)
    .run().lastInsertRowid;
  db.prepare(`INSERT INTO standup_responses (standup_id, agent_id, content) VALUES (?, ?, 'done')`).run(
    standupId,
    AGENT
  );
  const delegationId = db
    .prepare(
      `INSERT INTO agent_delegation_tasks (standup_id, request_id, to_agent_id, prompt)
       VALUES (?, 'req-1', ?, 'do it')`
    )
    .run(standupId, AGENT).lastInsertRowid;

  // The row that used to make the delete fail: a kanban card assigned to the agent,
  // also linked to one of the agent's delegation rows.
  db.prepare(
    `INSERT INTO kanban_tasks (title, status, assigned_agent_id, agent_delegation_task_id)
     VALUES ('Post to LinkedIn', 'open', ?, ?)`
  ).run(AGENT, delegationId);
  db.prepare(`INSERT INTO kanban_tasks (title, status, assigned_agent_id) VALUES ('Draft copy', 'open', ?)`).run(
    AGENT
  );

  console.log('== old behaviour still reproduces (FK really is the blocker) ==');
  let rawFailed = '';
  try {
    db.prepare('DELETE FROM agents WHERE id = ?').run(AGENT);
  } catch (e) {
    rawFailed = e.message;
  }
  check(/FOREIGN KEY/i.test(rawFailed), `bare DELETE blocked by FK (${rawFailed || 'no error'})`);

  console.log('== cascade delete ==');
  const result = deleteAgentCascade(db, AGENT, { deletedBy: CEO });
  check(!db.prepare('SELECT 1 FROM agents WHERE id = ?').get(AGENT), 'agent row deleted');
  check(result.cleared['kanban_tasks.assigned_agent_id'] === 2, 'both kanban cards unassigned');
  check(
    db.prepare('SELECT COUNT(*) AS n FROM kanban_tasks').get().n === 2,
    'kanban cards kept (history preserved, not deleted)'
  );
  check(
    db.prepare('SELECT COUNT(*) AS n FROM kanban_tasks WHERE assigned_agent_id IS NOT NULL').get().n === 0,
    'no kanban card still points at the agent'
  );
  check(
    db.prepare('SELECT COUNT(*) AS n FROM chat_turns WHERE agent_id = ?').get(AGENT).n === 0,
    'chat turns cleared'
  );
  check(
    db.prepare('SELECT COUNT(*) AS n FROM agent_delegation_tasks WHERE to_agent_id = ?').get(AGENT).n === 0,
    'delegation tasks cleared'
  );
  check(
    db.prepare('SELECT COUNT(*) AS n FROM user_agents WHERE agent_id = ?').get(AGENT).n === 0,
    'grant revoked'
  );
  check(
    db.prepare('SELECT parent_id FROM agents WHERE id = ?').get(CHILD)?.parent_id === COO,
    'child reparented to the deleted agent parent (org chart stays connected)'
  );

  console.log('== failed delete leaves no damage ==');
  db.prepare(`INSERT INTO chat_turns (agent_id, role, content) VALUES (?, 'user', 'keep me')`).run(COO);
  let cooErr = null;
  try {
    deleteAgentCascade(db, COO, { deletedBy: CEO });
  } catch (e) {
    cooErr = e;
  }
  check(cooErr?.code === 'AGENT_IS_COO', 'COO delete rejected');
  check(
    db.prepare('SELECT COUNT(*) AS n FROM chat_turns WHERE agent_id = ?').get(COO).n === 1,
    'COO chat history untouched by the rejected delete'
  );

  console.log('== tombstone blocks resurrection ==');
  check(isAgentTombstoned(db, AGENT), 'agent is tombstoned');
  check(isAgentTombstoned(db, AGENT.toUpperCase()), 'tombstone lookup is case-insensitive');
  check(!isAgentTombstoned(db, CHILD), 'live agent is not tombstoned');

  const { listStandardAgentIds, grantStandardAgents, isPrivilegedFullAgentGrantUser } = await import(
    '../src/services/users.js'
  );
  check(isPrivilegedFullAgentGrantUser(CEO), 'ceo-bala is a full-catalog CEO (the re-grant path)');
  // Simulate a seed script recreating the row: the catalog re-grant must not take it back.
  insertAgent.run(AGENT, 'BalaSocial', 'Social', COO, '/ws/social', AGENT, 0, 'standard', CEO);
  check(!listStandardAgentIds().includes(AGENT), 'tombstoned id excluded from standard catalog');
  grantStandardAgents(CEO);
  check(
    db.prepare('SELECT COUNT(*) AS n FROM user_agents WHERE user_id = ? AND agent_id = ?').get(CEO, AGENT).n === 0,
    'startup re-grant does not resurrect the deleted agent'
  );
  db.prepare('DELETE FROM agents WHERE id = ?').run(AGENT);

  console.log('== shared / reserved OpenClaw runtime is never claimed ==');
  check(
    result.openclaw_base_ids.includes(AGENT),
    'exclusive base id reported for purge from openclaw.json'
  );
  const sharedResult = deleteAgentCascade(db, SHARED, { deletedBy: CEO });
  check(
    !sharedResult.openclaw_base_ids.includes('main'),
    'shared `main` runtime not purged from openclaw.json'
  );
  check(
    !isAgentTombstoned(db, 'main'),
    'deleting an agent parked on `main` does not tombstone `main` for everyone'
  );
  check(isAgentTombstoned(db, SHARED), 'that agent id is still tombstoned by its own id');
  check(
    !exclusiveOpenClawBaseIds(db, { id: CHILD, openclaw_agent_id: COO }).includes(COO),
    'base id used by a surviving agent is not exclusive'
  );

  console.log('== explicit re-create clears the tombstone ==');
  clearAgentTombstone(db, AGENT);
  check(!isAgentTombstoned(db, AGENT), 'tombstone cleared so the id is reusable');

  console.log('== delete of unknown agent ==');
  let missingErr = null;
  try {
    deleteAgentCascade(db, 'does-not-exist');
  } catch (e) {
    missingErr = e;
  }
  check(missingErr?.code === 'AGENT_NOT_FOUND' && missingErr.status === 404, 'unknown agent → 404');
} catch (e) {
  fails += 1;
  console.error('FAIL (exception):', e?.stack || e?.message || e);
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* temp dir cleanup is best-effort */
  }
}

console.log(fails === 0 ? '\nALL AGENT DELETE TESTS PASSED' : `\n${fails} AGENT DELETE TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
