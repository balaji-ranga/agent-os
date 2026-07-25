/**
 * Inside backend container: print callback inbox entries for TASK_ID.
 *   TASK_ID=... node scripts/check-a2a-callback-inbox.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';

initDb();

const taskId = String(process.env.TASK_ID || '').trim();
const db = getDb();
const u =
  db.prepare(`SELECT id FROM platform_users WHERE id = 'ceo-bala' OR name = 'Balaji Ranganathan' LIMIT 1`).get() ||
  db.prepare(`SELECT id FROM platform_users WHERE role IN ('ceo','admin') LIMIT 1`).get();
if (!u) throw new Error('No CEO user for session');
const { token } = createSession(u.id, { userAgent: 'check-a2a-callback-inbox' });

const q = taskId ? `?task_id=${encodeURIComponent(taskId)}&limit=10` : '?limit=10';
const res = await fetch(`http://127.0.0.1:3001/api/a2a-callback-inbox${q}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const json = await res.json();
const entry = json.entries?.[0] || null;
console.log(
  JSON.stringify({
    status: res.status,
    count: json.count,
    task_id: taskId || null,
    entry,
  })
);
