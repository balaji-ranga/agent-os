/**
 * Chat session threads + fat-context auto-split (TPM mitigation).
 */
import { getDb } from '../db/schema.js';
import * as openclaw from '../gateway/openclaw.js';

const FAT_CONTEXT_CHAR_LIMIT = Math.max(
  20000,
  parseInt(process.env.CHAT_FAT_CONTEXT_CHARS || '80000', 10) || 80000
);
const HISTORY_KEEP_AFTER_SPLIT = Math.max(
  2,
  parseInt(process.env.CHAT_SPLIT_KEEP_TURNS || '4', 10) || 4
);

export function ensureChatSessionMetaTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS chat_session_meta (
      agent_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      thread_id TEXT NOT NULL DEFAULT 'main',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (agent_id, owner_user_id)
    )
  `);
}

export function getChatThreadId(agentId, ownerUserId) {
  ensureChatSessionMetaTable();
  const row = getDb()
    .prepare('SELECT thread_id FROM chat_session_meta WHERE agent_id = ? AND owner_user_id = ?')
    .get(agentId, ownerUserId);
  return row?.thread_id || 'main';
}

export function setChatThreadId(agentId, ownerUserId, threadId) {
  ensureChatSessionMetaTable();
  const tid = String(threadId || 'main').trim() || 'main';
  getDb()
    .prepare(
      `INSERT INTO chat_session_meta (agent_id, owner_user_id, thread_id, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id, owner_user_id) DO UPDATE SET
         thread_id = excluded.thread_id,
         updated_at = datetime('now')`
    )
    .run(agentId, ownerUserId, tid);
  return tid;
}

export function newChatThreadId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function estimateTurnsChars(turns = []) {
  return turns.reduce((n, t) => n + String(t?.content || '').length, 0);
}

export function shouldAutoSplitFatContext(historyTurns = [], nextMessage = '') {
  const total = estimateTurnsChars(historyTurns) + String(nextMessage || '').length;
  return total >= FAT_CONTEXT_CHAR_LIMIT;
}

/**
 * Start a fresh chat: archive current session (LLM title) instead of deleting turns.
 */
export async function startNewChatSession({ agentId, openclawAgentId, ownerUserId }) {
  const { startArchivingNewChatSession } = await import('./chat-history.js');
  return startArchivingNewChatSession({ agentId, openclawAgentId, ownerUserId, generateTitle: true });
}

/**
 * Auto-split: archive full session, keep only last N turns in a new active session.
 */
export async function autoSplitFatChatSession({ agentId, openclawAgentId, ownerUserId, historyTurns = [] }) {
  const { autoSplitArchivingChatSession } = await import('./chat-history.js');
  return autoSplitArchivingChatSession({
    agentId,
    openclawAgentId,
    ownerUserId,
    historyTurns,
    keepCount: HISTORY_KEEP_AFTER_SPLIT,
  });
}

export function sessionUserForThread(agentId, ownerUserId, threadId = null) {
  const tid = threadId || getChatThreadId(agentId, ownerUserId);
  return openclaw.sessionUserFor(agentId, ownerUserId, tid);
}

/**
 * Cheap topic-shift heuristic (no LLM): specialty keywords vs current agent id.
 * Returns null when no shift, or { reason, suggestion }.
 */
export function detectTopicShiftHeuristic(message, currentAgentId) {
  const msg = String(message || '').toLowerCase();
  const agent = String(currentAgentId || '').toLowerCase();
  if (msg.length < 12) return null;

  const rules = [
    {
      id: 'vedic-astrology',
      re: /\b(vedic|jyotish|kundli|kundali|horoscope|birth\s*chart|dasha|nakshatra|muhurta)\b/i,
    },
    {
      id: 'techresearcher',
      re: /\b(deep\s*research|research\s+(on|about)|literature\s+review|technical\s+analysis)\b/i,
    },
    {
      id: 'codeassist',
      re: /\b(write\s+(code|a\s+script)|debug|refactor|pull\s*request|typescript|python\s+function|pie\s*chart|bar\s*chart|plot\s+chart)\b/i,
    },
    {
      id: 'weather',
      re: /\b(weather|forecast|temperature|humidity|rain\s+tomorrow)\b/i,
    },
  ];

  for (const rule of rules) {
    if (!rule.re.test(msg)) continue;
    if (agent === rule.id || agent.includes(rule.id.replace(/-/g, ''))) continue;
    // Vedic agent asked for pie chart → shift to code
    if (agent.includes('vedic') && /pie\s*chart|population|male\s+and\s+female/i.test(msg)) {
      return {
        reason: 'topic_shift',
        suggested_agent_id: 'codeassist',
        hint: 'This looks like a general charting/data ask — consider starting a new chat with Code Assist.',
      };
    }
    return {
      reason: 'topic_shift',
      suggested_agent_id: rule.id,
      hint: `This looks like a different specialty — consider a new chat with agent "${rule.id}".`,
    };
  }
  return null;
}

export function fatContextLimit() {
  return FAT_CONTEXT_CHAR_LIMIT;
}
