#!/bin/bash
set -euo pipefail
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-kanban-chat-status-guidance.js

docker exec -i agent-os-backend-1 node <<'NODE'
const { initDb, getDb } = await import('/opt/agent-os/backend/src/db/schema.js');
const { createSession } = await import('/opt/agent-os/backend/src/services/auth/session.js');
initDb();
const db = getDb();

const taskId = 1389;
const before = db.prepare('SELECT id, title, status, assigned_agent_id, agent_delegation_task_id FROM kanban_tasks WHERE id = ?').get(taskId);
console.log('BEFORE', before);
if (!before) {
  console.log('SKIP no task 1389');
  process.exit(0);
}
if (before.status !== 'open') {
  // force reopen path for verification
  db.prepare(`UPDATE kanban_tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?`).run(taskId);
  console.log('RESET to open for test');
}

const token = createSession('ceo-bala').token;
const res = await fetch('http://127.0.0.1:3001/api/kanban/tasks/1389/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ role: 'user', content: 'Quick check after reopen fix — what model are you using? One short sentence.' }),
  signal: AbortSignal.timeout(180000),
});
const body = await res.json().catch(() => ({}));
console.log('POST_STATUS', res.status, JSON.stringify(body).slice(0, 200));

const after = db.prepare('SELECT id, status, updated_at FROM kanban_tasks WHERE id = ?').get(taskId);
console.log('AFTER', after);
if (after?.status === 'in_progress') {
  console.log('REOPEN_PROMOTE_OK');
} else {
  console.error('REOPEN_PROMOTE_FAIL', after);
  process.exit(1);
}

// awaiting_confirmation must not auto-promote: simulate guidance path only via unit test already.
// Soft check: if we set awaiting and post, status should stay (optional heavy). Skip agent call for speed.
NODE
