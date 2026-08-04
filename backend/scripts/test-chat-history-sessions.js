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
const hist = listArchivedChatSessions(agentId, ownerA, { paginated: false });
if (!hist.length) throw new Error('expected history list for owner A');
if (listArchivedChatSessions(agentId, ownerB, { paginated: false }).length) {
  throw new Error('owner B must not see A history');
}

const afterNew = listActiveSessionTurns(agentId, ownerA);
if (afterNew.turns.length !== 0) throw new Error('new chat should be empty');

const sourceTurns = db
  .prepare(
    `SELECT role, content, created_at FROM chat_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC`
  )
  .all(archived.archived.id);

const restored = await restoreChatSession({
  sessionId: archived.archived.id,
  ownerUserId: ownerA,
  agentId,
  openclawAgentId: null,
  mode: 'as_is',
});
if ((restored.turns || []).length !== 2) throw new Error('restore as_is should copy 2 turns');
for (let i = 0; i < sourceTurns.length; i++) {
  if (restored.turns[i].created_at !== sourceTurns[i].created_at) {
    throw new Error(
      `restore must preserve created_at (got ${restored.turns[i].created_at} vs ${sourceTurns[i].created_at})`
    );
  }
}
const restoredRow = getActiveChatSession(agentId, ownerA);
if (!Number(restoredRow?.restored)) throw new Error('restored session must set restored=1');
// Restored old timestamps must not force an immediate daily rollover
const restoredStay = await ensureActiveChatSession({
  agentId,
  ownerUserId: ownerA,
  openclawAgentId: null,
  timeZone: 'UTC',
  generateTitle: false,
});
if (restoredStay.rolled_over) {
  throw new Error('restored session with historical turn times must stay active today');
}
if (listActiveSessionTurns(agentId, ownerA).turns.length !== 2) {
  throw new Error('restored turns must remain in active chat');
}

// Non-restored multi-day turns under today's started_at must still roll on open
const agentRoll = `test-chat-hist-roll-${Date.now()}`;
db.prepare(
  `INSERT OR IGNORE INTO agents (id, name, role, openclaw_agent_id) VALUES (?, 'TestRoll', 'tester', ?)`
).run(agentRoll, agentRoll);
insertChatTurn({ agentId: agentRoll, ownerUserId: ownerA, role: 'user', content: 'day1' });
const rollActive = getActiveChatSession(agentRoll, ownerA);
db.prepare(
  `UPDATE chat_turns SET created_at = datetime('now', '-2 days') WHERE session_id = ?`
).run(rollActive.id);
db.prepare(
  `UPDATE chat_sessions SET started_at = datetime('now'), restored = 0 WHERE id = ?`
).run(rollActive.id);
const multiDayRoll = await ensureActiveChatSession({
  agentId: agentRoll,
  ownerUserId: ownerA,
  openclawAgentId: null,
  timeZone: 'UTC',
  generateTitle: false,
});
if (!multiDayRoll.rolled_over) {
  throw new Error('expected rollover when earliest turn is prior day even if started_at is today');
}

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
if (!listArchivedChatSessions(agent2, ownerA, { paginated: false }).length) {
  throw new Error('legacy rollover should create archive');
}

console.log('CHAT_HISTORY_SESSIONS_OK', {
  agentId,
  archivedTitle: archived.archived.title,
  historyCount: listArchivedChatSessions(agentId, ownerA, { paginated: false }).length,
  legacyRollover: true,
});
