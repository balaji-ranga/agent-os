/**
 * Durable per-user per-agent chat sessions (active + archived history).
 * OpenClaw thread affinity stays in chat_session_meta; this table is the UI history list.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { chatCompletions } from '../config/llm.js';
import { isPlatformLocalOllama } from './platform-llm-settings.js';
import {
  ensureChatSessionMetaTable,
  getChatThreadId,
  setChatThreadId,
  newChatThreadId,
} from './chat-session-policy.js';
import { clearOpenClawSessionForUser } from './agent-chat-scope.js';
import { stripOpenClawDeliveryNoise } from './openclaw-runtime-tools.js';

const HISTORY_DAYS = 30;
const TITLE_MAX = 72;

export function ensureChatHistorySchema() {
  const db = getDb();
  ensureChatSessionMetaTable();
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      archived_at TEXT,
      summary TEXT,
      oc_thread_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_owner_agent ON chat_sessions(owner_user_id, agent_id, status, archived_at DESC)`
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_chat_sessions_active ON chat_sessions(agent_id, owner_user_id, status)`
  );
  try {
    db.exec(`ALTER TABLE chat_turns ADD COLUMN session_id TEXT`);
  } catch (_) {}
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, created_at)`);
  } catch (_) {}
  try {
    db.exec(`ALTER TABLE chat_sessions ADD COLUMN restored INTEGER NOT NULL DEFAULT 0`);
  } catch (_) {}
}

function db() {
  ensureChatHistorySchema();
  return getDb();
}

function fallbackTitle(startedAt) {
  const d = startedAt ? new Date(String(startedAt).includes('T') ? startedAt : `${startedAt}Z`) : new Date();
  const label = Number.isNaN(d.getTime())
    ? new Date().toLocaleString()
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return `Chat · ${label}`;
}

/** Content-based title when LLM is skipped/fails — first user turn, not date-only. */
function heuristicTitleFromTurns(turns) {
  const user = (turns || []).find((t) => t.role === 'user' && String(t.content || '').trim());
  if (!user) return '';
  let t = String(user.content || '')
    .replace(/\s+/g, ' ')
    .replace(/^\[System[^\]]*\]\s*/i, '')
    .trim();
  if (!t) return '';
  if (t.length > TITLE_MAX) t = `${t.slice(0, TITLE_MAX - 1).trim()}…`;
  return t;
}

function isDateOnlyChatTitle(title) {
  return /^Chat\s*[·\-–—]\s+/i.test(String(title || '').trim());
}

function calendarDayKey(isoOrSql, timeZone = 'UTC') {
  try {
    const raw = String(isoOrSql || '');
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  } catch {
    return null;
  }
}

export function getActiveChatSession(agentId, ownerUserId) {
  return (
    db()
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE agent_id = ? AND owner_user_id = ? AND status = 'active'
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(agentId, ownerUserId) || null
  );
}

function createActiveSessionRow(
  agentId,
  ownerUserId,
  { title = '', ocThreadId = null, startedAt = null, restored = false } = {}
) {
  const id = randomUUID();
  const threadId = ocThreadId || getChatThreadId(agentId, ownerUserId) || newChatThreadId();
  const started = startedAt && String(startedAt).trim() ? String(startedAt).trim() : null;
  const restoredFlag = restored ? 1 : 0;
  if (started) {
    db()
      .prepare(
        `INSERT INTO chat_sessions (id, agent_id, owner_user_id, title, status, started_at, oc_thread_id, updated_at, restored)
         VALUES (?, ?, ?, ?, 'active', ?, ?, datetime('now'), ?)`
      )
      .run(id, agentId, ownerUserId, title || 'Current chat', started, threadId, restoredFlag);
  } else {
    db()
      .prepare(
        `INSERT INTO chat_sessions (id, agent_id, owner_user_id, title, status, started_at, oc_thread_id, updated_at, restored)
         VALUES (?, ?, ?, ?, 'active', datetime('now'), ?, datetime('now'), ?)`
      )
      .run(id, agentId, ownerUserId, title || 'Current chat', threadId, restoredFlag);
  }
  setChatThreadId(agentId, ownerUserId, threadId);
  return getSessionById(id, ownerUserId);
}

/** Day anchor for rollover: restored chats use started_at; normal chats use earliest turn. */
function sessionDayAnchorAt(session) {
  if (!session) return null;
  if (Number(session.restored) === 1 || String(session.title || '').startsWith('Restored ·')) {
    return session.started_at;
  }
  const turnMin = earliestTurnCreatedAt({ sessionId: session.id });
  if (!turnMin) return session.started_at;
  if (!session.started_at) return turnMin;
  return turnMin < session.started_at ? turnMin : session.started_at;
}

/** Earliest turn timestamp for a session (or agent/owner orphans). */
function earliestTurnCreatedAt({ sessionId = null, agentId = null, ownerUserId = null } = {}) {
  if (sessionId) {
    return (
      db()
        .prepare(`SELECT MIN(created_at) AS m FROM chat_turns WHERE session_id = ?`)
        .get(sessionId)?.m || null
    );
  }
  if (agentId && ownerUserId) {
    return (
      db()
        .prepare(
          `SELECT MIN(created_at) AS m FROM chat_turns WHERE agent_id = ? AND owner_user_id = ?`
        )
        .get(agentId, ownerUserId)?.m || null
    );
  }
  return null;
}

export function getSessionById(sessionId, ownerUserId = null) {
  if (ownerUserId) {
    return db()
      .prepare('SELECT * FROM chat_sessions WHERE id = ? AND owner_user_id = ?')
      .get(sessionId, ownerUserId);
  }
  return db().prepare('SELECT * FROM chat_sessions WHERE id = ?').get(sessionId);
}

/**
 * Backfill: if turns exist without sessions, wrap them in one active session.
 * started_at is taken from the earliest turn so daily rollover still works for legacy chats.
 */
function backfillActiveSession(agentId, ownerUserId) {
  const existing = getActiveChatSession(agentId, ownerUserId);
  if (existing) {
    const orphanInfo = db()
      .prepare(
        `SELECT COUNT(*) AS n, MIN(created_at) AS earliest
         FROM chat_turns
         WHERE agent_id = ? AND owner_user_id = ? AND (session_id IS NULL OR session_id = '')`
      )
      .get(agentId, ownerUserId);
    const orphanCount = orphanInfo?.n || 0;
    if (orphanCount > 0) {
      db()
        .prepare(
          `UPDATE chat_turns SET session_id = ?
           WHERE agent_id = ? AND owner_user_id = ? AND (session_id IS NULL OR session_id = '')`
        )
        .run(existing.id, agentId, ownerUserId);
      // Only pull started_at backward when real orphans were attached — never for
      // restored copies that intentionally keep historical created_at under a fresh session day.
      const earliest = orphanInfo?.earliest;
      if (earliest && (!existing.started_at || earliest < existing.started_at)) {
        db()
          .prepare(
            `UPDATE chat_sessions SET started_at = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(earliest, existing.id);
        return getSessionById(existing.id, ownerUserId);
      }
    }
    return existing;
  }

  const orphanCount = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM chat_turns WHERE agent_id = ? AND owner_user_id = ?`
    )
    .get(agentId, ownerUserId)?.n;
  const earliest = orphanCount ? earliestTurnCreatedAt({ agentId, ownerUserId }) : null;
  const session = createActiveSessionRow(agentId, ownerUserId, {
    title: 'Current chat',
    ocThreadId: getChatThreadId(agentId, ownerUserId),
    startedAt: earliest,
  });
  if (orphanCount) {
    db()
      .prepare(
        `UPDATE chat_turns SET session_id = ?
         WHERE agent_id = ? AND owner_user_id = ? AND (session_id IS NULL OR session_id = '')`
      )
      .run(session.id, agentId, ownerUserId);
  }
  return session;
}

/**
 * Ensure an active session exists. If the chat's day anchor is before today,
 * archive and open a fresh chat. Visit-time daily rollover — no cron.
 * Restored sessions anchor on restore day (started_at); normal sessions use
 * earliest turn so multi-day active chats still roll on open.
 */
export async function ensureActiveChatSession({
  agentId,
  ownerUserId,
  openclawAgentId = null,
  timeZone = process.env.TZ || 'UTC',
  generateTitle = true,
} = {}) {
  let active = backfillActiveSession(agentId, ownerUserId);
  const today = calendarDayKey(new Date().toISOString(), timeZone);
  const startedDay = calendarDayKey(sessionDayAnchorAt(active), timeZone);
  if (today && startedDay && today !== startedDay) {
    const turnCount = countSessionTurns(active.id);
    if (turnCount > 0) {
      await archiveChatSession({
        sessionId: active.id,
        ownerUserId,
        agentId,
        openclawAgentId,
        generateTitle,
      });
    } else {
      // Empty overnight session — just bump started_at / rotate quietly
      db()
        .prepare(
          `UPDATE chat_sessions SET started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
        )
        .run(active.id);
      return { session: getSessionById(active.id, ownerUserId), rolled_over: false };
    }
    active = createActiveSessionRow(agentId, ownerUserId, {
      ocThreadId: newChatThreadId(),
    });
    return { session: active, rolled_over: true };
  }
  return { session: active, rolled_over: false };
}

export function countSessionTurns(sessionId) {
  return (
    db().prepare('SELECT COUNT(*) AS n FROM chat_turns WHERE session_id = ?').get(sessionId)?.n || 0
  );
}

export function listSessionTurns(sessionId, { limit = 200, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  return db()
    .prepare(
      `SELECT id, agent_id, owner_user_id, role, content, created_at, session_id
       FROM chat_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC LIMIT ? OFFSET ?`
    )
    .all(sessionId, lim, off)
    .map((row) =>
      row.role === 'assistant'
        ? { ...row, content: stripOpenClawDeliveryNoise(row.content) }
        : row
    );
}

export function listActiveSessionTurns(agentId, ownerUserId, { limit = 200, offset = 0 } = {}) {
  const active = backfillActiveSession(agentId, ownerUserId);
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const total = countSessionTurns(active.id);
  return {
    session: active,
    turns: listSessionTurns(active.id, { limit: lim, offset: off }),
    total,
    limit: lim,
    offset: off,
    has_more: off + Math.min(lim, Math.max(0, total - off)) < total,
  };
}

export function insertChatTurn({ agentId, ownerUserId, role, content, sessionId = null }) {
  const sid = sessionId || backfillActiveSession(agentId, ownerUserId).id;
  const stored =
    role === 'assistant' ? stripOpenClawDeliveryNoise(content) : content;
  db()
    .prepare(
      `INSERT INTO chat_turns (agent_id, owner_user_id, role, content, session_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(agentId, ownerUserId, role, stored, sid);
  return sid;
}

async function generateSessionTitleAndSummary(turns, ownerUserId) {
  const heuristic = heuristicTitleFromTurns(turns);
  const sample = (turns || [])
    .slice(0, 16)
    .map((t) => `${t.role}: ${String(t.content || '').slice(0, 280)}`)
    .join('\n');
  if (!sample.trim()) {
    return { title: fallbackTitle(new Date().toISOString()), summary: '' };
  }
  if (isPlatformLocalOllama()) {
    console.info('[chat-history] skip LLM archive title (local Ollama); using heuristic');
    return { title: heuristic || fallbackTitle(new Date().toISOString()), summary: '' };
  }
  try {
    const { content } = await chatCompletions({
      ownerUserId,
      maxTokens: 220,
      toolName: 'chat_archive_title',
      messages: [
        {
          role: 'system',
          content:
            'You title and summarize chat archives. Reply with JSON only: {"title":"...","summary":"..."}. ' +
            `Title <= ${TITLE_MAX} chars, no quotes inside title. Summary 2-4 sentences.`,
        },
        {
          role: 'user',
          content: `Create an archive title and summary for this chat:\n\n${sample.slice(0, 6000)}`,
        },
      ],
    });
    const raw = String(content || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/g, '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.warn('[chat-history] title JSON parse failed:', parseErr.message);
      }
    }
    const title = String(parsed?.title || parsed?.Title || '')
      .replace(/["\n]/g, ' ')
      .trim()
      .slice(0, TITLE_MAX);
    const summary = String(parsed?.summary || parsed?.Summary || '')
      .trim()
      .slice(0, 2000);
    if (!title) {
      console.warn('[chat-history] title LLM returned empty title; using heuristic');
    }
    return {
      title: title || heuristic || fallbackTitle(new Date().toISOString()),
      summary,
    };
  } catch (e) {
    console.warn('[chat-history] title/summary LLM failed:', e.message);
    return {
      title: heuristic || fallbackTitle(new Date().toISOString()),
      summary: '',
    };
  }
}

/**
 * Archive an active session (LLM title) and clear OpenClaw affinity for its thread.
 */
export async function archiveChatSession({
  sessionId,
  ownerUserId,
  agentId,
  openclawAgentId = null,
  generateTitle = true,
} = {}) {
  const session = getSessionById(sessionId, ownerUserId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
  if (session.status === 'archived') return session;

  const turns = listSessionTurns(session.id);
  let title = session.title && session.title !== 'Current chat' ? session.title : '';
  let summary = session.summary || '';
  if (generateTitle && turns.length) {
    const gen = await generateSessionTitleAndSummary(turns, ownerUserId);
    title = gen.title;
    summary = gen.summary || summary;
  } else if (turns.length && (!title || isDateOnlyChatTitle(title))) {
    // Rollover/path skipped LLM — still prefer first-user-message over "Chat · date"
    title = heuristicTitleFromTurns(turns) || title;
  }
  if (!title) title = fallbackTitle(session.started_at);
  if (isDateOnlyChatTitle(title) && turns.length) {
    const heur = heuristicTitleFromTurns(turns);
    if (heur) title = heur;
  }

  const threadId = session.oc_thread_id || getChatThreadId(agentId || session.agent_id, ownerUserId);
  db()
    .prepare(
      `UPDATE chat_sessions
       SET status = 'archived', title = ?, summary = ?, archived_at = datetime('now'),
           oc_thread_id = ?, updated_at = datetime('now')
       WHERE id = ? AND owner_user_id = ?`
    )
    .run(title, summary || null, threadId, session.id, ownerUserId);

  if (openclawAgentId) {
    clearOpenClawSessionForUser(agentId || session.agent_id, openclawAgentId, ownerUserId, threadId);
  }
  return getSessionById(session.id, ownerUserId);
}

/**
 * New chat: archive current (if it has turns) + create fresh active session.
 */
export async function startArchivingNewChatSession({
  agentId,
  openclawAgentId,
  ownerUserId,
  generateTitle = true,
} = {}) {
  const prevThread = getChatThreadId(agentId, ownerUserId);
  const active = backfillActiveSession(agentId, ownerUserId);
  const turnCount = countSessionTurns(active.id);
  let archived = null;
  if (turnCount > 0) {
    archived = await archiveChatSession({
      sessionId: active.id,
      ownerUserId,
      agentId,
      openclawAgentId,
      generateTitle,
    });
  } else {
    // Empty active — replace in place
    db().prepare('DELETE FROM chat_sessions WHERE id = ?').run(active.id);
  }

  const threadId = newChatThreadId();
  if (openclawAgentId) {
    clearOpenClawSessionForUser(agentId, openclawAgentId, ownerUserId, prevThread);
  }
  const session = createActiveSessionRow(agentId, ownerUserId, { ocThreadId: threadId });
  return {
    ok: true,
    thread_id: threadId,
    previous_thread_id: prevThread,
    session,
    archived,
    message: archived
      ? `New chat started. Previous chat archived as "${archived.title}".`
      : 'New chat started.',
  };
}

/**
 * Fat-context split: archive full session, keep last N turns in a new active session.
 */
export async function autoSplitArchivingChatSession({
  agentId,
  openclawAgentId,
  ownerUserId,
  historyTurns = [],
  keepCount = 4,
} = {}) {
  const prevThread = getChatThreadId(agentId, ownerUserId);
  const active = backfillActiveSession(agentId, ownerUserId);
  const archived = await archiveChatSession({
    sessionId: active.id,
    ownerUserId,
    agentId,
    openclawAgentId,
    generateTitle: true,
  });

  const threadId = newChatThreadId();
  const session = createActiveSessionRow(agentId, ownerUserId, { ocThreadId: threadId });
  const keep = (historyTurns || []).slice(-Math.max(2, keepCount));
  const insert = db().prepare(
    `INSERT INTO chat_turns (agent_id, owner_user_id, role, content, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );
  for (const t of keep) {
    insert.run(
      agentId,
      ownerUserId,
      t.role === 'assistant' ? 'assistant' : 'user',
      String(t.content || ''),
      session.id,
      t.created_at || null
    );
  }

  return {
    ok: true,
    auto_split: true,
    thread_id: threadId,
    previous_thread_id: prevThread,
    kept_turns: keep.length,
    session,
    archived,
    message:
      'Chat context was reset automatically because the conversation grew too large (TPM/context protection). Recent messages were kept; earlier chat was archived.',
  };
}

export function listArchivedChatSessions(agentId, ownerUserId, { days = HISTORY_DAYS, limit = 50, offset = 0, paginated = true } = {}) {
  const d = Math.min(Math.max(Number(days) || HISTORY_DAYS, 1), HISTORY_DAYS);
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);
  const total =
    db()
      .prepare(
        `SELECT COUNT(*) AS n FROM chat_sessions
         WHERE agent_id = ? AND owner_user_id = ? AND status = 'archived'
           AND archived_at >= datetime('now', ?)`
      )
      .get(agentId, ownerUserId, `-${d} days`)?.n ?? 0;
  const sessions = db()
    .prepare(
      `SELECT id, agent_id, owner_user_id, title, status, started_at, archived_at, summary, oc_thread_id, created_at
       FROM chat_sessions
       WHERE agent_id = ? AND owner_user_id = ? AND status = 'archived'
         AND archived_at >= datetime('now', ?)
       ORDER BY archived_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(agentId, ownerUserId, `-${d} days`, lim, off);
  if (!paginated) return sessions;
  return { sessions, total, limit: lim, offset: off, has_more: off + sessions.length < total, days: d };
}

/**
 * Restore archived session into a NEW active chat.
 * mode=as_is copies turns; mode=summarized seeds one summary user/assistant pair.
 */
export async function restoreChatSession({
  sessionId,
  ownerUserId,
  agentId,
  openclawAgentId,
  mode = 'as_is',
} = {}) {
  const archived = getSessionById(sessionId, ownerUserId);
  if (!archived || archived.agent_id !== agentId) {
    throw Object.assign(new Error('Session not found'), { status: 404 });
  }
  if (archived.status !== 'archived') {
    throw Object.assign(new Error('Only archived sessions can be restored'), { status: 400 });
  }

  // Archive current active if it has content
  const current = getActiveChatSession(agentId, ownerUserId);
  if (current && countSessionTurns(current.id) > 0) {
    await archiveChatSession({
      sessionId: current.id,
      ownerUserId,
      agentId,
      openclawAgentId,
      generateTitle: true,
    });
  } else if (current) {
    db().prepare('DELETE FROM chat_sessions WHERE id = ?').run(current.id);
  }

  const threadId = newChatThreadId();
  if (openclawAgentId) {
    clearOpenClawSessionForUser(agentId, openclawAgentId, ownerUserId, getChatThreadId(agentId, ownerUserId));
  }
  const session = createActiveSessionRow(agentId, ownerUserId, {
    title: `Restored · ${archived.title || 'chat'}`.slice(0, TITLE_MAX),
    ocThreadId: threadId,
    restored: true,
  });

  const insert = db().prepare(
    `INSERT INTO chat_turns (agent_id, owner_user_id, role, content, session_id, created_at)
     VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`
  );

  if (mode === 'summarized') {
    let summary = archived.summary;
    if (!summary) {
      const turns = listSessionTurns(archived.id);
      const gen = await generateSessionTitleAndSummary(turns, ownerUserId);
      summary = gen.summary || `Summary of archived chat "${archived.title}".`;
      db()
        .prepare(`UPDATE chat_sessions SET summary = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(summary, archived.id);
    }
    insert.run(
      agentId,
      ownerUserId,
      'user',
      `Continue from this archived chat summary (restored):\n\n${summary}`,
      session.id,
      null
    );
    insert.run(
      agentId,
      ownerUserId,
      'assistant',
      'Understood — I have the archived summary as context. How would you like to continue?',
      session.id,
      null
    );
  } else {
    const turns = listSessionTurns(archived.id);
    for (const t of turns) {
      // Preserve original timestamps so restored history does not look like "chatted today".
      insert.run(agentId, ownerUserId, t.role, t.content, session.id, t.created_at || null);
    }
  }

  return {
    ok: true,
    mode,
    session,
    source: archived,
    turns: listSessionTurns(session.id),
    message:
      mode === 'summarized'
        ? `Restored summarized context from "${archived.title}".`
        : `Restored full history from "${archived.title}".`,
  };
}

export function formatSessionForApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    agent_id: row.agent_id,
    owner_user_id: row.owner_user_id,
    title: row.title,
    status: row.status,
    started_at: row.started_at,
    archived_at: row.archived_at,
    summary: row.summary || null,
    has_summary: !!(row.summary && String(row.summary).trim()),
  };
}
