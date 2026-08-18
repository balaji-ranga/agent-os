/**
 * Offboard platform users whose display name starts with given prefixes
 * (Social Research import leftovers, OpenConnector e2e leftovers, etc.).
 *
 * Usage (inside backend container or with AGENT_OS_DATA_DIR set):
 *   node scripts/offboard-users-by-name-prefix.js --dry-run
 *   node scripts/offboard-users-by-name-prefix.js --confirm
 *   node scripts/offboard-users-by-name-prefix.js --confirm --prefix="SR Import" --prefix="Connector Test"
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { offboardUser, isProtectedFromOffboard } from '../src/services/user-offboard.js';

const DEFAULT_PREFIXES = ['SR Import', 'Connector Test'];
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--confirm');
const prefixes = args
  .filter((a) => a.startsWith('--prefix='))
  .map((a) => a.slice('--prefix='.length).trim())
  .filter(Boolean);
const PREFIXES = prefixes.length ? prefixes : DEFAULT_PREFIXES;

initDb();
const db = getDb();

const seen = new Set();
const candidates = [];
for (const prefix of PREFIXES) {
  const rows = db
    .prepare(
      `SELECT id, name, email, role, enabled
       FROM platform_users
       WHERE name LIKE ?
       ORDER BY name, id`
    )
    .all(`${prefix}%`);
  for (const u of rows) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    candidates.push({ ...u, matched_prefix: prefix });
  }
}

console.log(
  dryRun
    ? `DRY RUN — would offboard ${candidates.length} user(s) matching prefixes ${JSON.stringify(PREFIXES)}`
    : `CONFIRM — offboarding ${candidates.length} user(s) matching prefixes ${JSON.stringify(PREFIXES)}`
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
      actor: { id: 'system', name: 'offboard-users-by-name-prefix' },
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

const remaining = {};
for (const prefix of PREFIXES) {
  remaining[prefix] = dryRun
    ? null
    : db.prepare(`SELECT COUNT(*) AS n FROM platform_users WHERE name LIKE ?`).get(`${prefix}%`)?.n;
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      dry_run: dryRun,
      prefixes: PREFIXES,
      matched: candidates.length,
      removed: removed.length,
      skipped: skipped.length,
      errors: errors.length,
      remaining,
    },
    null,
    2
  )
);

if (errors.length) process.exit(1);
