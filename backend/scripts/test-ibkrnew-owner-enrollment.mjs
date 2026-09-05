import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ibkrnew-owner-enrollment-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'data');
process.env.OPENCLAW_DIR = join(root, 'openclaw');
process.env.OPENCLAW_CONFIG_PATH = join(root, 'openclaw', 'openclaw.json');

const { initDb, getDb } = await import('../src/db/schema.js');
const { closeCeoDb } = await import('../src/db/ceo-db.js');
const { registerCeoUser } = await import('../src/services/users.js');
const { setUiNavHidden, getUiNavHidden } = await import('../src/services/ui-nav-prefs.js');
const { enrollIbkrNewOwner } = await import('../src/services/ibkrnew-owner-enrollment.js');

let owner;
try {
  initDb();
  owner = await registerCeoUser({
    accept_terms: true,
    email: `ibkrnew-enrollment-${Date.now()}@test.local`,
    password: 'test-only-password-12345',
    name: 'IBKRNew Enrollment Test Owner',
  });
  setUiNavHidden(owner.id, ['ibkrnew0', 'ibkrnew0-live', 'workflows']);

  const first = await enrollIbkrNewOwner(owner.id);
  const second = await enrollIbkrNewOwner(owner.id);

  assert.equal(first.enabled_agents, 6);
  assert.equal(first.enabled_workflows, 6);
  assert.equal(first.config_kinds.length, 5);
  assert.equal(first.agents.filter((agent) => agent.created).length, 6);
  assert.equal(second.agents.filter((agent) => agent.created).length, 0);
  assert.equal(getDb().prepare(
    `SELECT COUNT(*) count FROM agents WHERE owner_user_id = ? AND source_kind = 'ibkrnew'`
  ).get(owner.id).count, 6);
  assert.equal(getDb().prepare(
    `SELECT COUNT(*) count FROM agent_tool_grants g JOIN agents a ON a.id = g.agent_id WHERE a.owner_user_id = ? AND a.source_kind = 'ibkrnew'`
  ).get(owner.id).count, 0);
  assert.deepEqual(getUiNavHidden(owner.id), ['workflows']);
  assert.equal(first.bridge_created, false);
  assert.equal(first.execution_enabled, false);
  assert.equal(first.live_trading_enabled, false);
  console.log('IBKRNew owner enrollment tests passed');
} finally {
  if (typeof owner?.id === 'string') closeCeoDb(owner.id);
  try {
    getDb().close();
  } catch {
    // The assertion failure may occur before database initialization completes.
  }
  rmSync(root, { recursive: true, force: true });
}
