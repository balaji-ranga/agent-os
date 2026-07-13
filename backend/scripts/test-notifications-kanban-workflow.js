/**
 * Smoke: kanban create → platform notification → complete clears it.
 * Usage: node scripts/test-notifications-kanban-workflow.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  listNotificationsForUser,
  notifyWorkflowNodeEvent,
  markNotificationsRead,
} from '../src/services/platform-notifications.js';

initDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
const CEO = getBalaCeoAuthId();
const token = createSession(CEO).token;
let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const health = await fetch(`${BASE}/health`).catch(() => null);
assert(!!health?.ok, 'backend up');

console.log('\n=== Kanban create notifies ===');
const created = await api('POST', '/api/kanban/tasks', {
  title: `Notify test ${Date.now()}`,
  description: 'notification smoke',
});
assert(created.status === 201, `create ${created.status}`);
const taskId = created.data?.id;
const list1 = await api('GET', '/api/platform-notifications?limit=20');
assert(list1.status === 200, 'list ok');
const found = (list1.data.notifications || []).find(
  (n) => n.source === 'kanban_task' && String(n.source_key) === String(taskId)
);
assert(!!found, `kanban notif for task ${taskId}`);

console.log('\n=== Complete clears notification ===');
const patched = await api('PATCH', `/api/kanban/tasks/${taskId}`, { status: 'completed' });
assert(patched.status === 200, `patch ${patched.status}`);
const list2 = await api('GET', '/api/platform-notifications?limit=20');
const still = (list2.data.notifications || []).find(
  (n) => n.source === 'kanban_task' && String(n.source_key) === String(taskId)
);
assert(!still, 'kanban notif removed after complete');

console.log('\n=== Workflow node notify (direct) ===');
notifyWorkflowNodeEvent({
  ownerUserId: CEO,
  runId: 999001,
  runNumber: 1,
  definitionName: 'Smoke WF',
  definitionId: 'smoke',
  node: { id: 'n1', type: 'email', data: { label: 'Send', send_notification: true } },
  phase: 'started',
});
notifyWorkflowNodeEvent({
  ownerUserId: CEO,
  runId: 999001,
  runNumber: 1,
  definitionName: 'Smoke WF',
  definitionId: 'smoke',
  node: { id: 'n1', type: 'email', data: { label: 'Send', send_notification: true } },
  phase: 'completed',
});
const list3 = listNotificationsForUser(CEO, { limit: 30 });
const started = list3.find((n) => n.source_key === 'run:999001:node:n1:started');
const completed = list3.find((n) => n.source_key === 'run:999001:node:n1:completed');
assert(!!started, 'workflow started notif');
assert(!!completed, 'workflow completed notif');
assert(started.link_url === '/workflows?run_id=999001', `link=${started.link_url}`);

markNotificationsRead(CEO, [started.id, completed.id]);
const list4 = listNotificationsForUser(CEO, { limit: 30 });
assert(!list4.some((n) => n.id === started.id || n.id === completed.id), 'marked read hidden');

console.log(failed ? `\nFAILED ${failed}` : '\nALL NOTIFICATION TESTS PASSED');
process.exit(failed ? 1 : 0);
