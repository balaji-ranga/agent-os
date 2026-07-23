/**
 * Verify OC console cookie dies when Flowlah admin session is revoked.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession, revokeSession, getSessionUser } from '../src/services/auth/session.js';
import {
  createOcConsoleLaunchCookie,
  adminFromOcConsoleCookie,
  clearOcConsoleCookieHeader,
} from '../src/services/openconnector-console-proxy.js';

initDb();
const db = getDb();
const admin = db.prepare(`SELECT id, role FROM platform_users WHERE role = 'admin' LIMIT 1`).get();
if (!admin) {
  console.error('no admin user');
  process.exit(1);
}

const session = createSession(admin.id);
const token = session.token || session;
console.log('session', !!getSessionUser(token));

const cookie = createOcConsoleLaunchCookie(admin, token);
const fakeReq = { headers: { cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}` } };
console.log('cookie_ok_before_logout', !!adminFromOcConsoleCookie(fakeReq));

revokeSession(token);
console.log('session_after_logout', !!getSessionUser(token));
console.log('cookie_ok_after_logout', !!adminFromOcConsoleCookie(fakeReq));
console.log('clear_header', clearOcConsoleCookieHeader(true).slice(0, 60));

if (adminFromOcConsoleCookie(fakeReq)) {
  console.error('FAIL cookie still valid after session revoke');
  process.exit(1);
}
console.log('OC_SESSION_BIND_OK');
