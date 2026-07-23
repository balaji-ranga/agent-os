#!/bin/bash
set -euo pipefail
docker exec -w /opt/agent-os/backend agent-os-backend-1 node scripts/test-kanban-chat-status-guidance.js || true

docker exec -i agent-os-backend-1 node <<'NODE'
const { initDb, getDb } = await import('/opt/agent-os/backend/src/db/schema.js');
const { createSession } = await import('/opt/agent-os/backend/src/services/auth/session.js');
initDb();
const db = getDb();

const taskId = 1389;
db.prepare(`UPDATE kanban_tasks SET status = 'open', updated_at = datetime('now') WHERE id = ?`).run(taskId);
const before = db.prepare('SELECT id, status, assigned_agent_id, owner_user_id FROM kanban_tasks WHERE id = ?').get(taskId);
console.log('BEFORE', before);

const token = createSession('ceo-bala').token;
const turnsBefore = db.prepare(`SELECT COUNT(*) AS n FROM chat_turns WHERE agent_id='techresearcher' AND owner_user_id='ceo-bala'`).get().n;

const res = await fetch(`http://127.0.0.1:3001/api/kanban/tasks/${taskId}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ role: 'user', content: 'what model are you using? One short sentence.' }),
  signal: AbortSignal.timeout(180000),
});
console.log('POST', res.status);
const after = db.prepare('SELECT id, status, updated_at FROM kanban_tasks WHERE id = ?').get(taskId);
console.log('AFTER', after);

const mirrored = db.prepare(`
  SELECT id, role, substr(content,1,120) AS preview FROM chat_turns
  WHERE agent_id='techresearcher' AND owner_user_id='ceo-bala' AND content LIKE '%Kanban #1389%'
  ORDER BY id DESC LIMIT 4
`).all();
console.log('MIRRORED', JSON.stringify(mirrored, null, 2));
const turnsAfter = db.prepare(`SELECT COUNT(*) AS n FROM chat_turns WHERE agent_id='techresearcher' AND owner_user_id='ceo-bala'`).get().n;
console.log('CHAT_TURNS_DELTA', turnsAfter - turnsBefore);

if (after?.status !== 'completed') {
  console.error('COMPLETE_FAIL');
  process.exit(1);
}
if (!mirrored.length) {
  console.error('MIRROR_FAIL');
  process.exit(1);
}
console.log('KANBAN_COMPLETE_AND_MIRROR_OK');
NODE
