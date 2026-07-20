/**
 * VPS: test Balaji Ranganathan (ceo-bala) agents — Kanban create/move + short chat.
 * Usage (in backend container): node scripts/vps-test-balaji-agents-kanban.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { createSession } from '../src/services/auth/session.js';
import { grantKanbanToolsToAllAgents } from '../src/services/agent-feedback.js';
import { syncAllowlistsFile, writeAgentToolsMd, getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';
import { ensureTenantOpenClawAgent } from '../src/services/openclaw-tenant.js';
import { listAgentsForUser } from '../src/services/users.js';
import { registerOpenClawSessionOwner } from '../src/services/tool-owner-scope.js';
import * as openclaw from '../src/gateway/openclaw.js';

initDb();
const db = getDb();
const BASE = (process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

const CEO =
  db.prepare(`SELECT id, name, email FROM platform_users WHERE name = ?`).get('Balaji Ranganathan') ||
  db.prepare(`SELECT id, name, email FROM platform_users WHERE id = 'ceo-bala'`).get();
if (!CEO) throw new Error('Balaji Ranganathan / ceo-bala not found');
console.log('CEO', CEO);

const granted = grantKanbanToolsToAllAgents();
syncAllowlistsFile();
console.log('kanban grants added', granted);

const token = createSession(CEO.id).token;
const agents = listAgentsForUser(CEO.id).filter((a) => a.enabled !== 0);
console.log(
  'agents',
  agents.map((a) => a.id).join(', ')
);

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL:', msg);
  } else console.log('OK:', msg);
}

async function api(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const coreAgents = [
  'balserve',
  'socialasstant',
  'techresearcher',
  'expensemanager',
  'codeassist',
  'workflowbuilder',
].filter((id) => agents.some((a) => a.id === id));

console.log('\n=== 1) Grants + TOOLS.md refresh ===');
for (const id of coreAgents) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  const grants = getAgentToolGrants(id);
  ok(grants.includes('kanban_create_task'), `${id} has kanban_create_task`);
  ok(grants.includes('kanban_move_status'), `${id} has kanban_move_status`);
  try {
    await writeAgentToolsMd(agent, grants);
    ok(true, `${id} TOOLS.md refreshed`);
  } catch (e) {
    ok(false, `${id} TOOLS.md refresh: ${e.message}`);
  }
  ensureTenantOpenClawAgent(agent, CEO.id);
}

console.log('\n=== 2) Kanban create + move via tools API ===');
for (const id of coreAgents) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  const ensured = ensureTenantOpenClawAgent(agent, CEO.id);
  const ocId = ensured.openclawAgentId;
  const sessionUser = openclaw.sessionUserFor(id, CEO.id);
  const sessionKey = openclaw.sessionKeyFor(ocId, sessionUser);
  registerOpenClawSessionOwner(sessionKey, CEO.id);

  const title = `VPS smoke ${id} ${Date.now()}`;
  const create = await api(
    'POST',
    '/api/tools/kanban-create-task',
    { title, description: `Created by ${id} smoke test`, assign_to: id },
    {
      'x-openclaw-agent-id': ocId,
      'x-openclaw-session-key': sessionKey,
      'x-ceo-user-id': CEO.id,
    }
  );
  const taskId = create.data?.task_id || create.data?.id || create.data?.task?.id;
  ok(create.status < 400 && taskId, `${id} create task status=${create.status} id=${taskId} err=${create.data?.error || ''}`);

  if (!taskId) continue;

  const move = await api(
    'POST',
    '/api/tools/kanban-move-status',
    { task_id: taskId, new_status: 'in_progress' },
    {
      'x-openclaw-agent-id': ocId,
      'x-openclaw-session-key': sessionKey,
      'x-ceo-user-id': CEO.id,
    }
  );
  ok(move.status < 400 && move.data?.ok !== false, `${id} move in_progress status=${move.status} err=${move.data?.error || ''}`);

  const done = await api(
    'POST',
    '/api/tools/kanban-move-status',
    { task_id: taskId, new_status: 'completed' },
    {
      'x-openclaw-agent-id': ocId,
      'x-openclaw-session-key': sessionKey,
      'x-ceo-user-id': CEO.id,
    }
  );
  ok(done.status < 400 && done.data?.ok !== false, `${id} move completed status=${done.status} err=${done.data?.error || ''}`);
}

console.log('\n=== 3) Dashboard chat (short) ===');
const chatTargets = ['balserve', 'socialasstant', 'techresearcher', 'expensemanager'].filter((id) =>
  agents.some((a) => a.id === id)
);
for (const id of chatTargets) {
  const chat = await api('POST', `/api/agents/${id}/chat`, {
    message: 'Reply with exactly: READY',
  });
  const reply = String(chat.data?.reply || chat.data?.error || '');
  ok(
    chat.status < 400 && reply.length > 0 && !/error|timeout|ECONNREFUSED/i.test(reply.slice(0, 80)),
    `${id} chat status=${chat.status} reply=${reply.slice(0, 120).replace(/\s+/g, ' ')}`
  );
}

console.log('\n=== 4) Chat: create Kanban via agent LLM ===');
{
  const id = 'socialasstant';
  const chat = await api('POST', `/api/agents/${id}/chat`, {
    message:
      'Create a Kanban task titled "Social smoke kanban" assigned to yourself using kanban_create_task, then move it to in_progress with kanban_move_status. Reply with the task id.',
  });
  const reply = String(chat.data?.reply || chat.data?.error || '');
  ok(chat.status < 400 && reply.length > 0, `social kanban-via-chat status=${chat.status}`);
  console.log('social reply:', reply.slice(0, 400).replace(/\s+/g, ' '));

  const row = db
    .prepare(
      `SELECT id, title, status, assigned_agent_id FROM kanban_tasks
       WHERE title LIKE '%Social smoke kanban%'
       ORDER BY id DESC LIMIT 1`
    )
    .get();
  ok(!!row, `kanban row exists from social chat: ${row ? JSON.stringify(row) : 'none'}`);
}

console.log('\n=== DONE ===');
if (failed) {
  console.error(`FAILED ${failed} check(s)`);
  process.exit(1);
}
console.log('ALL_PASSED');
