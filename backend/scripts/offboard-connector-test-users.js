/**
 * Offboard platform users whose display name starts with "Connector Test"
 * (OpenConnector e2e leftovers): DB rows, tenant files, OpenClaw tenant workspaces.
 *
 * Usage (inside backend container or with AGENT_OS_DATA_DIR set):
 *   node scripts/offboard-connector-test-users.js --dry-run
 *   node scripts/offboard-connector-test-users.js --confirm
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { offboardUser, isProtectedFromOffboard } from '../src/services/user-offboard.js';

const PREFIX = 'Connector Test';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--confirm');

initDb();
const db = getDb();
const candidates = db
  .prepare(
    `SELECT id, name, email, role, enabled
     FROM platform_users
     WHERE name LIKE ?
     ORDER BY name, id`
  )
  .all(`${PREFIX}%`);

console.log(
  dryRun
    ? `DRY RUN — would offboard ${candidates.length} user(s) matching name LIKE '${PREFIX}%'`
    : `CONFIRM — offboarding ${candidates.length} user(s) matching name LIKE '${PREFIX}%'`
);

const removed = [];
const skipped = [];
const errors = [];

for (const u of candidates) {
  if (isProtectedFromOffboard(u)) {
    skipped.push({ id: u.id, name: u.name, reason: 'protected' });
    console.log('SKIP protected', u.id, u.name);
    continue;
  }
  try {
    const result = offboardUser(u.id, {
      dryRun,
      actor: { id: 'system', name: 'offboard-connector-test-users' },
    });
    removed.push({ id: u.id, name: u.name, email: u.email, result });
    console.log(dryRun ? 'WOULD RM' : 'REMOVED', u.id, u.name, u.email || '-');
    if (!dryRun && result?.steps) {
      const s = result.steps;
      console.log(
        '  openclaw_tenant=',
        s.openclaw_tenant_removed || '(none)',
        'agents_scrubbed=',
        s.openclaw_agents?.removed ?? 0,
        'platform_user_deleted=',
        s.platform_user_deleted
      );
    }
  } catch (e) {
    errors.push({ id: u.id, name: u.name, error: e?.message || String(e) });
    console.error('ERR', u.id, u.name, e?.message || e);
  }
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      dry_run: dryRun,
      matched: candidates.length,
      removed: removed.length,
      skipped: skipped.length,
      errors: errors.length,
      remaining_connector_test: dryRun
        ? null
        : db
            .prepare(`SELECT COUNT(*) AS n FROM platform_users WHERE name LIKE ?`)
            .get(`${PREFIX}%`)?.n,
    },
    null,
    2
  )
);

if (errors.length) process.exit(1);