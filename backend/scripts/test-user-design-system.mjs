import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-design-system-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.OPENSEARCH_ENABLED = '0';

let database;
try {
  const { initDb } = await import('../src/db/schema.js');
  database = initDb();
  database
    .prepare(
      `INSERT INTO platform_users(id,email,password_hash,name,role,enabled)
       VALUES(?,?,?,?,?,1)`
    )
    .run('design-user', 'design-user@example.test', 'x', 'Design User', 'ceo');

  const users = await import('../src/services/users.js');
  assert.equal(
    users.getUserById('design-user').ui_design_system,
    'classic',
    'existing and new profiles must default to the current Classic UI'
  );

  assert.equal(
    users.updateUserProfile('design-user', { ui_design_system: 'immersive' }).ui_design_system,
    'immersive',
    'immersive selection must persist on the user profile'
  );
  assert.equal(
    database.prepare('SELECT ui_design_system FROM platform_users WHERE id = ?').get('design-user')
      .ui_design_system,
    'immersive'
  );

  assert.equal(
    users.updateUserProfile('design-user', { ui_design_system: 'classic' }).ui_design_system,
    'classic',
    'users must be able to switch back without migrating any page data'
  );
  assert.throws(
    () => users.updateUserProfile('design-user', { ui_design_system: 'unknown' }),
    /must be classic or immersive/,
    'the server must reject unknown design systems'
  );

  database.close();
  database = null;
  console.log('user-design-system: OK');
} finally {
  try {
    if (database?.open) database.close();
  } catch {
    /* best effort */
  }
  rmSync(dataDir, { recursive: true, force: true });
}
