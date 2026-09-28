import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-agent-human-kanban-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  database = initDb();
  const { humanAssignmentTarget, resolveCompanyEmployee } = await import('../src/services/kanban-human-assignment.js');

  database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)')
    .run('ceo-a', 'a@example.test', 'x', 'CEO A', 'ceo');
  database.prepare('INSERT INTO platform_users(id,email,password_hash,name,role,enabled) VALUES(?,?,?,?,?,1)')
    .run('ceo-b', 'b@example.test', 'x', 'CEO B', 'ceo');
  const addEmployee = database.prepare(`INSERT INTO platform_users
    (id,email,password_hash,name,role,enabled,owner_user_id,department)
    VALUES(?,?,?,?,?,?,?,?)`);
  addEmployee.run('user-raji', 'raji@example.test', 'x', 'Raji Employee', 'org_user', 1, 'ceo-a', 'Operations');
  addEmployee.run('user-disabled', 'disabled@example.test', 'x', 'Disabled Employee', 'org_user', 0, 'ceo-a', 'Operations');
  addEmployee.run('user-other', 'other@example.test', 'x', 'Other Employee', 'org_user', 1, 'ceo-b', 'Operations');

  assert.equal(humanAssignmentTarget({ assigned_user_id: 'user-raji' }), 'user-raji');
  assert.equal(humanAssignmentTarget({ to_user_id: 'Raji Employee' }), 'Raji Employee');
  assert.equal(humanAssignmentTarget({ assign_to: 'user:user-raji' }), 'user-raji');
  assert.equal(humanAssignmentTarget({ assign_to: 'ai-agent' }), '');
  assert.equal(resolveCompanyEmployee('ceo-a', 'user-raji', database).name, 'Raji Employee');
  assert.equal(resolveCompanyEmployee('ceo-a', 'raji employee', database).id, 'user-raji');
  assert.throws(() => resolveCompanyEmployee('ceo-a', 'user-disabled', database), /not found/i);
  assert.throws(() => resolveCompanyEmployee('ceo-a', 'user-other', database), /not found/i);

  const route = readFileSync(new URL('../src/routes/tools.js', import.meta.url), 'utf8');
  assert.match(route, /SET assigned_user_id = \?, assigned_agent_id = NULL, status = 'open'/);
  assert.match(route, /notifyKanbanTaskCreated\(\{ userId: person\.id/);
  assert.match(route, /Only COO can assign a task to another AI agent/);

  for (const relative of [
    '../../openclaw-extensions/agent-os-content-tools/index.js',
    '../../openclaw-extensions/agent-os-content-tools/index.ts',
  ]) {
    const plugin = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(plugin, /kanban_create_task:\s*\{/);
    assert.match(plugin, /assigned_user_id: \{ type: "string"/);
    assert.match(plugin, /to_user_id: \{ type: "string"/);
  }

  console.log('agent-human-kanban-assignment: OK');
} finally {
  try { database?.close(); } catch {}
  rmSync(dataDir, { recursive: true, force: true });
}
