/**
 * Smoke: broadcast → techresearcher with notify_ceo prompt.
 * Usage: node scripts/test-broadcast-notify-ceo.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { createSession } from '../src/services/auth/session.js';
import { listNotificationsForUser } from '../src/services/platform-notifications.js';

initDb();

const owner = process.env.WORKFLOW_TEST_OWNER_USER_ID || getBalaCeoAuthId();
const { token } = createSession(owner);
const base = (process.env.TOOLS_BASE_URL || process.env.AGENT_OS_BASE_URL || 'http://127.0.0.1:3001').replace(
  /\/$/,
  ''
);

const before = Date.now();
const msg =
  'Anyone who specializes in tech research: reach me via the notify_ceo tool now with title "TechResearcher ready" and a short body about a use-case chat. Do not only reply in text — call notify_ceo.';

console.log('POST /api/broadcast as', owner);
const res = await fetch(`${base}/api/broadcast`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ message: msg, agent_ids: ['techresearcher'] }),
  signal: AbortSignal.timeout(300000),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('broadcast failed', res.status, data);
  process.exit(1);
}

const row = (data.results || []).find((r) => r.agent_id === 'techresearcher');
console.log('techresearcher result:', row?.error ? `ERROR ${row.error}` : (row?.reply || '').slice(0, 300));
if (row?.error) process.exit(1);
if (!row) {
  console.error('techresearcher missing from results', data.results);
  process.exit(1);
}

// Wait briefly for async tool logging / notification insert
await new Promise((r) => setTimeout(r, 2000));

const logs = getDb()
  .prepare(
    `SELECT id, tool_name, status, created_at, request_payload
     FROM content_tool_logs
     WHERE tool_name = 'notify_ceo' AND created_at >= datetime('now', '-5 minutes')
     ORDER BY id DESC LIMIT 10`
  )
  .all();
console.log('recent notify_ceo logs:', logs.length, logs.map((l) => ({ id: l.id, status: l.status, at: l.created_at })));

const listed = listNotificationsForUser(owner, { limit: 20 });
const hit = listed.find(
  (n) =>
    (n.created_at && new Date(n.created_at).getTime() >= before - 5000) ||
    /TechResearcher ready|tech research|use.?case/i.test(`${n.title || ''} ${n.body || ''}`)
);
console.log('CEO notifications hit:', hit ? { title: hit.title, body: (hit.body || '').slice(0, 120) } : null);

if (!logs.length && !hit) {
  console.warn(
    'WARN: no notify_ceo log or CEO bell entry yet — agent may have replied in text only. Check TOOLS.md on live workspace.'
  );
  process.exit(2);
}

console.log('BROADCAST_NOTIFY_CEO_OK');
