/**
 * Create/cleanup the isolated CEO used by deploy/scripts/vps-regression-full.sh.
 * The strict email+name markers prevent this utility from selecting real users.
 *
 *   node scripts/regression-test-user.mjs create
 *   node scripts/regression-test-user.mjs cleanup <user-id>
 *   node scripts/regression-test-user.mjs cleanup-stale
 */
import { randomBytes } from 'node:crypto';
import { initDb, getDb } from '../src/db/schema.js';
import { registerCeoUser } from '../src/services/users.js';
import { createSession } from '../src/services/auth/session.js';
import { isProtectedFromOffboard, offboardUser } from '../src/services/user-offboard.js';
import { removeToolServiceCredentialsForOwner } from '../src/services/tool-scoped-token.js';

initDb();
const db = getDb();
const command = String(process.argv[2] || '').trim();
const requestedId = String(process.argv[3] || '').trim();
const EMAIL_LIKE = 'flolah-regression-%@example.invalid';
const NAME_LIKE = 'Flolah Regression %';

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function isRegressionUser(row) {
  return (
    row?.role === 'ceo' &&
    String(row?.email || '').startsWith('flolah-regression-') &&
    String(row?.email || '').endsWith('@example.invalid') &&
    String(row?.name || '').startsWith('Flolah Regression ')
  );
}

function residualRows(userId) {
  const userColumns = new Set([
    'owner_user_id',
    'user_id',
    'ceo_user_id',
    'source_owner_user_id',
    'initiator_user_id',
    'assigned_user_id',
  ]);
  const leftovers = [];
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  for (const { name } of tables) {
    let cols = [];
    try {
      cols = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all().map((c) => c.name);
    } catch (_) {
      continue;
    }
    const scoped = cols.filter((c) => userColumns.has(c));
    if (!scoped.length) continue;
    const where = scoped.map((c) => `${quoteIdent(c)} = ?`).join(' OR ');
    try {
      const count = db
        .prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(name)} WHERE ${where}`)
        .get(...scoped.map(() => userId))?.n;
      if (Number(count) > 0) leftovers.push({ table: name, count: Number(count) });
    } catch (_) {}
  }
  return leftovers;
}

function cleanupRouterTestRows() {
  try {
    return db.prepare("DELETE FROM chat_work_units WHERE owner_user_id LIKE 'router-test-%'").run().changes || 0;
  } catch (_) {
    return 0;
  }
}

function cleanupOne(row) {
  if (!isRegressionUser(row) || isProtectedFromOffboard(row)) {
    throw new Error(`Refusing cleanup for untagged/protected user ${row?.id || '(missing)'}`);
  }
  const result = offboardUser(row.id, {
    confirmEmail: row.email,
    actor: { id: 'regression-cleanup', name: 'Regression cleanup' },
  });
  const leftovers = residualRows(row.id);
  if (leftovers.length) {
    throw new Error(`Residual rows remain for ${row.id}: ${JSON.stringify(leftovers)}`);
  }
  return result;
}

function candidates() {
  return db
    .prepare(`SELECT id,email,name,role,enabled FROM platform_users
      WHERE email LIKE ? AND name LIKE ? AND role='ceo' ORDER BY created_at`)
    .all(EMAIL_LIKE, NAME_LIKE)
    .filter(isRegressionUser);
}

if (command === 'create') {
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const email = `flolah-regression-${stamp}@example.invalid`;
  const name = `Flolah Regression ${stamp}`;
  const password = `Rg!${randomBytes(16).toString('hex')}Aa9`;
  const user = await registerCeoUser({
    email,
    password,
    name,
    country: 'SG',
    region: '',
    mfa_policy: 'off',
    ceo_db_mode: 'tenant',
    industry: 'personal',
    business_name: '',
    require_terms_accept: false,
  });
  const token = createSession(user.id).token;
  // Machine-readable final line; registration logs may precede it.
  console.log(`REGRESSION_FIXTURE|${user.id}|${email}|${token}`);
} else if (command === 'cleanup') {
  const row = db.prepare('SELECT id,email,name,role,enabled FROM platform_users WHERE id=?').get(requestedId);
  if (row) cleanupOne(row);
  const routerRows = cleanupRouterTestRows();
  console.log(`REGRESSION_CLEANUP_OK|${requestedId}|router_rows=${routerRows}`);
} else if (command === 'cleanup-stale') {
  const rows = candidates();
  for (const row of rows) cleanupOne(row);
  // An interrupted older cleanup may remove the fixture user before its opaque
  // credentials. This sweep is restricted to the generated fixture ID namespace.
  const orphanCredentialOwners = db
    .prepare(`SELECT DISTINCT owner_user_id FROM tool_service_credentials
      WHERE owner_user_id LIKE 'ceo-flolah-regression-%'`)
    .all();
  for (const { owner_user_id } of orphanCredentialOwners) {
    removeToolServiceCredentialsForOwner(owner_user_id);
  }
  // Repair residues left by older fixture teardown implementations after the
  // tagged platform_users row was already gone. Never matches a normal CEO ID.
  for (const table of [
    'agent_delegation_tasks',
    'standups',
    'ibkr_budget_days',
    'chat_session_meta',
    'agent_ops_budgets',
    'deleted_agents',
  ]) {
    try {
      db.prepare(`DELETE FROM ${quoteIdent(table)} WHERE owner_user_id LIKE 'ceo-flolah-regression-%'`).run();
    } catch (_) {}
  }
  const routerRows = cleanupRouterTestRows();
  const remaining = candidates();
  if (remaining.length) throw new Error(`Regression users remain: ${remaining.map((r) => r.id).join(',')}`);
  console.log(`REGRESSION_STALE_CLEANUP_OK|users=${rows.length}|router_rows=${routerRows}`);
} else {
  console.error('Usage: regression-test-user.mjs create|cleanup <user-id>|cleanup-stale');
  process.exit(2);
}
