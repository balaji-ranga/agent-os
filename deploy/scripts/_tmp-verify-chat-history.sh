#!/bin/bash
# Verify chat history APIs on VPS for ceo-bala + techresearcher (entitlement-scoped).
set -euo pipefail
ROOT=/opt/agent-os
cd "$ROOT/deploy"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml:docker-compose.browser.yml}"

echo "==> API e2e (ceo-bala)"
docker compose exec -T backend node <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import { createSession } from './src/services/auth/session.js';
import {
  ensureChatHistorySchema,
  insertChatTurn,
  listArchivedChatSessions,
  getActiveChatSession,
  startArchivingNewChatSession,
  ensureActiveChatSession,
  restoreChatSession,
  listActiveSessionTurns,
} from './src/services/chat-history.js';

initDb();
ensureChatHistorySchema();
const db = getDb();
const owner = 'ceo-bala';
const agentId = 'techresearcher';
const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
if (!agent) throw new Error('techresearcher missing');

const token = createSession(owner).token;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const base = 'http://127.0.0.1:3001/api';

// Service-level isolation smoke
const tAgent = `tmp-hist-${Date.now()}`;
db.prepare(`INSERT OR IGNORE INTO agents (id, name, role, openclaw_agent_id) VALUES (?, 'T', 't', ?)`).run(tAgent, tAgent);
insertChatTurn({ agentId: tAgent, ownerUserId: owner, role: 'user', content: 'iso A' });
insertChatTurn({ agentId: tAgent, ownerUserId: 'other-fake', role: 'user', content: 'iso B' });
if (listActiveSessionTurns(tAgent, owner).turns.length !== 1) throw new Error('owner isolation fail');
await startArchivingNewChatSession({ agentId: tAgent, ownerUserId: owner, openclawAgentId: null, generateTitle: false });
console.log('SERVICE_ISO_OK');

insertChatTurn({
  agentId,
  ownerUserId: owner,
  role: 'user',
  content: `[chat-history-e2e] seed ${new Date().toISOString()}`,
});
insertChatTurn({
  agentId,
  ownerUserId: owner,
  role: 'assistant',
  content: 'Acknowledged seed for history e2e.',
});

const newRes = await fetch(`${base}/agents/${agentId}/sessions/new`, {
  method: 'POST',
  headers,
  body: '{}',
});
const newJson = await newRes.json();
if (!newRes.ok) throw new Error(`sessions/new ${newRes.status} ${JSON.stringify(newJson)}`);
console.log('NEW', { status: newRes.status, title: newJson.archived?.title, msg: newJson.message });

const histRes = await fetch(`${base}/agents/${agentId}/chat/history`, { headers });
const histJson = await histRes.json();
if (!histRes.ok) throw new Error(`history ${histRes.status} ${JSON.stringify(histJson)}`);
if (!Array.isArray(histJson.sessions)) throw new Error('sessions array missing');
console.log('HISTORY_COUNT', histJson.sessions.length, 'latest', histJson.sessions[0]?.title);

const chatRes = await fetch(`${base}/agents/${agentId}/chat?tz=UTC`, { headers });
const chatJson = await chatRes.json();
if (!chatRes.ok) throw new Error(`chat GET ${chatRes.status} ${JSON.stringify(chatJson)}`);
if (!Array.isArray(chatJson.turns)) throw new Error('chat turns missing — is GET /chat updated?');
if (chatJson.turns.length !== 0) throw new Error(`expected empty active after new, got ${chatJson.turns.length}`);
console.log('ACTIVE_EMPTY_OK', chatJson.session?.id);

const sourceId = newJson.archived?.id || histJson.sessions[0]?.id;
if (!sourceId) throw new Error('no archived session to restore');

const restoreRes = await fetch(`${base}/agents/${agentId}/chat/history/${sourceId}/restore`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ mode: 'summarized' }),
});
const restoreJson = await restoreRes.json();
if (!restoreRes.ok) throw new Error(`restore ${restoreRes.status} ${JSON.stringify(restoreJson)}`);
if (!Array.isArray(restoreJson.turns) || restoreJson.turns.length < 1) {
  throw new Error('restore summarized should seed turns');
}
console.log('RESTORE_SUMMARIZED_OK', restoreJson.turns.length, restoreJson.message);

const other = db.prepare(`SELECT id FROM platform_users WHERE id != ? AND role = 'ceo' LIMIT 1`).get(owner);
if (other?.id) {
  const tok2 = createSession(other.id).token;
  const h2 = await fetch(`${base}/agents/${agentId}/chat/history`, {
    headers: { Authorization: `Bearer ${tok2}` },
  });
  const j2 = await h2.json();
  const leak = (j2.sessions || []).some((s) => s.owner_user_id === owner || s.id === sourceId);
  if (leak) throw new Error('HISTORY_LEAK_TO_OTHER_CEO');
  console.log('ENTITLEMENT_OK', other.id, 'sessions', (j2.sessions || []).length);
} else {
  console.log('ENTITLEMENT_SKIP no other ceo');
}

const active = getActiveChatSession(agentId, owner);
db.prepare(`UPDATE chat_sessions SET started_at = datetime('now', '-2 days') WHERE id = ?`).run(active.id);
insertChatTurn({ agentId, ownerUserId: owner, role: 'user', content: 'stale day message' });
const rollRes = await fetch(`${base}/agents/${agentId}/chat?tz=UTC`, { headers });
const rollJson = await rollRes.json();
if (!rollRes.ok) throw new Error(`rollover GET ${rollRes.status}`);
if (!rollJson.rolled_over) throw new Error('expected rolled_over true');
if ((rollJson.turns || []).length !== 0) throw new Error('rollover should open empty chat');
console.log('DAILY_ROLLOVER_OK');

console.log('CHAT_HISTORY_VPS_E2E_OK');
NODE

echo "==> frontend History panel asset"
docker compose exec -T frontend sh -c 'grep -Rql chat-history-panel /usr/share/nginx/html/assets && echo FRONTEND_HISTORY_UI_OK'

echo DONE
