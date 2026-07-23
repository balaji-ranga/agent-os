/**
 * Local unit smoke for chat history sessions (no OpenClaw).
 * Usage: node scripts/test-chat-history-sessions.js
 */
import { getDb } from '../src/db/schema.js';
import {
  ensureChatHistorySchema,
  insertChatTurn,
  listActiveSessionTurns,
  listArchivedChatSessions,
  startArchivingNewChatSession,
  ensureActiveChatSession,
  restoreChatSession,
  getActiveChatSession,
} from '../src/services/chat-history.js';

const agentId = `test-chat-hist-${Date.now()}`;
const ownerA = 'ceo-test-a';
const ownerB = 'ceo-test-b';

ensureChatHistorySchema();
const db = getDb();
db.prepare(
  `INSERT OR IGNORE INTO agents (id, name, role, openclaw_agent_id) VALUES (?, 'Test', 'tester', ?)`
).run(agentId, agentId);

insertChatTurn({ agentId, ownerUserId: ownerA, role: 'user', content: 'Hello from A' });
insertChatTurn({ agentId, ownerUserId: ownerA, role: 'assistant', content: 'Hi A' });
insertChatTurn({ agentId, ownerUserId: ownerB, role: 'user', content: 'Hello from B' });

const activeA = listActiveSessionTurns(agentId, ownerA);
if (activeA.turns.length !== 2) throw new Error(`owner A expected 2 turns, got ${activeA.turns.length}`);
const activeB = listActiveSessionTurns(agentId, ownerB);
if (activeB.turns.length !== 1) throw new Error(`owner B expected 1 turn, got ${activeB.turns.length}`);

const archived = await startArchivingNewChatSession({
  agentId,
  openclawAgentId: null,
  ownerUserId: ownerA,
  generateTitle: false,
});
if (!archived.archived) throw new Error('expected archived session for owner A');
const hist = listArchivedChatSessions(agentId, ownerA);
if (!hist.length) throw new Error('expected history list for owner A');
if (listArchivedChatSessions(agentId, ownerB).length) throw new Error('owner B must not see A history');

const afterNew = listActiveSessionTurns(agentId, ownerA);
if (afterNew.turns.length !== 0) throw new Error('new chat should be empty');

const restored = await restoreChatSession({
  sessionId: archived.archived.id,
  ownerUserId: ownerA,
  agentId,
  openclawAgentId: null,
  mode: 'as_is',
});
if ((restored.turns || []).length !== 2) throw new Error('restore as_is should copy 2 turns');

// Daily rollover: backdate active session
const cur = getActiveChatSession(agentId, ownerA);
db.prepare(`UPDATE chat_sessions SET started_at = datetime('now', '-2 days') WHERE id = ?`).run(cur.id);
insertChatTurn({ agentId, ownerUserId: ownerA, role: 'user', content: 'old day msg' });
const rolled = await ensureActiveChatSession({
  agentId,
  ownerUserId: ownerA,
  openclawAgentId: null,
  timeZone: 'UTC',
  generateTitle: false,
});
if (!rolled.rolled_over) throw new Error('expected daily rollover');
if (listActiveSessionTurns(agentId, ownerA).turns.length !== 0) {
  throw new Error('after rollover active chat should be empty');
}

// Legacy backfill bug: started_at=now but turns are old → still rollover
const agent2 = `test-chat-hist-legacy-${Date.now()}`;
db.prepare(
  `INSERT OR IGNORE INTO agents (id, name, role, openclaw_agent_id) VALUES (?, 'Test2', 'tester', ?)`
).run(agent2, agent2);
db.prepare(
  `INSERT INTO chat_turns (agent_id, owner_user_id, role, content, created_at)
   VALUES (?, ?, 'user', 'legacy old', datetime('now', '-3 days'))`
).run(agent2, ownerA);
db.prepare(
  `INSERT INTO chat_turns (agent_id, owner_user_id, role, content, created_at)
   VALUES (?, ?, 'assistant', 'legacy reply', datetime('now', '-3 days'))`
).run(agent2, ownerA);
const legacy = await ensureActiveChatSession({
  agentId: agent2,
  ownerUserId: ownerA,
  openclawAgentId: null,
  timeZone: 'UTC',
  generateTitle: false,
});
if (!legacy.rolled_over) throw new Error('expected legacy-turn rollover despite started_at=now');
if (listActiveSessionTurns(agent2, ownerA).turns.length !== 0) {
  throw new Error('legacy rollover should leave empty active chat');
}
if (!listArchivedChatSessions(agent2, ownerA).length) {
  throw new Error('legacy rollover should create archive');
}

console.log('CHAT_HISTORY_SESSIONS_OK', {
  agentId,
  archivedTitle: archived.archived.title,
  historyCount: listArchivedChatSessions(agentId, ownerA).length,
  legacyRollover: true,
});
