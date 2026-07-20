/**
 * Reset platform admin password on a VPS / Docker volume.
 *
 * Inside the backend container:
 *   NEW_PASS='YourStrongPass' node /opt/agent-os/deploy/scripts/vps-reset-admin-password.js
 *
 * Or from the host (compose project dir):
 *   docker compose exec -e NEW_PASS='YourStrongPass' backend \
 *     node /opt/agent-os/deploy/scripts/vps-reset-admin-password.js
 *
 * Optional: ADMIN_EMAIL=admin@agent-os.local (default)
 */
import Database from 'better-sqlite3';
import { hashPassword } from '../../backend/src/services/auth/password.js';

const email = (process.env.ADMIN_EMAIL || process.env.AGENT_OS_ADMIN_EMAIL || 'admin@agent-os.local')
  .trim()
  .toLowerCase();
const pass = process.env.NEW_PASS || process.env.AGENT_OS_ADMIN_PASSWORD;
if (!pass) {
  console.error('NEW_PASS (or AGENT_OS_ADMIN_PASSWORD) required');
  process.exit(1);
}

const dataDir = (process.env.AGENT_OS_DATA_DIR || '/data/agent-os').replace(/\/$/, '');
const dbPath = `${dataDir}/agent-os.db`;
const db = new Database(dbPath);

const users = db.prepare('SELECT id, email, role, enabled FROM platform_users').all();
console.log(
  'USERS',
  users.map((u) => `${u.email}:${u.role}:enabled=${u.enabled}`).join(' | ') || '(none)'
);

const hash = hashPassword(pass);
let r = db.prepare('UPDATE platform_users SET password_hash = ?, enabled = 1 WHERE lower(email) = ?').run(hash, email);
if (!r.changes) {
  r = db.prepare("UPDATE platform_users SET password_hash = ?, enabled = 1 WHERE role = 'admin'").run(hash);
}
if (!r.changes) {
  console.error(
    `No admin row updated. Set AGENT_OS_ADMIN_EMAIL / AGENT_OS_ADMIN_PASSWORD in deploy/.env and recreate the DB volume, or insert an admin user.`
  );
  process.exit(1);
}
console.log(`UPDATED ${r.changes} row(s). Login with email=${email} on the Admin login form.`);
