/**
 * Verify OpenSearch console cookie dies when Flowlah admin session is revoked.
 * Run inside backend container:
 *   node scripts/test-os-console-logout.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession, revokeSession, getSessionUser } from '../src/services/auth/session.js';
import {
  createOsConsoleLaunchCookie,
  adminFromOsConsoleCookie,
} from '../src/services/opensearch/console-proxy.js';

initDb();
const admin = getDb()
  .prepare(`SELECT id, email, role FROM platform_users WHERE role = 'admin' AND enabled = 1 LIMIT 1`)
  .get();
if (!admin) {
  console.error('FAIL: no admin user');
  process.exit(1);
}

const { token } = createSession(admin.id);
const cookie = createOsConsoleLaunchCookie(admin, token);
const req = {
  headers: { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` },
};

const before = adminFromOsConsoleCookie(req);
if (!before || !getSessionUser(token)) {
  console.error('FAIL: cookie should work before revoke');
  process.exit(1);
}

revokeSession(token);
const after = adminFromOsConsoleCookie(req);
if (after || getSessionUser(token)) {
  console.error('FAIL: cookie still valid after revoke', { after: !!after });
  process.exit(1);
}

console.log('OK: OpenSearch console cookie invalid after session revoke');
process.exit(0);
