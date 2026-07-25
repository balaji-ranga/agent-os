/**
 * Resolve the agent-chat conversation behind a Kanban card.
 *
 * Kanban chat is mirrored into `chat_turns` with a `[Kanban #<id>]` marker, and cards are often
 * worked entirely inside the agent chat. Once that chat is archived the card looked empty, so the
 * drawer now reads turns straight from `chat_turns` (active *and* archived sessions).
 */
import { formatServerDateTime } from '../utils/format-datetime.js';

const MAX_TURNS = 60;

function sessionsById(db, ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const rows = db
    .prepare(
      `SELECT id, title, status, started_at, archived_at
       FROM chat_sessions WHERE id IN (${clean.map(() => '?').join(',')})`
    )
    .all(...clean);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

function decorate(db, turns) {
  const sessions = sessionsById(db, turns.map((t) => t.session_id));
  return turns.map((t) => {
    const s = t.session_id ? sessions[t.session_id] : null;
    return {
      id: t.id,
      role: t.role,
      content: t.content,
      created_at: t.created_at,
      created_at_display: formatServerDateTime(t.created_at),
      session_id: t.session_id || null,
      session_title: s?.title || null,
      session_status: s?.status || null,
      session_archived: s?.status === 'archived',
    };
  });
}

/**
 * @param {import('better-sqlite3').Database} db per-CEO database handle
 * @param {{ id: number, owner_user_id?: string, assigned_agent_id?: string, created_at?: string }} task
 * @returns {{ turns: Array, source: string, archived_sessions: Array, agent_id: string|null }}
 */
export function resolveKanbanChatContext(db, task, { limit = MAX_TURNS } = {}) {
  const empty = { turns: [], source: 'none', archived_sessions: [], agent_id: null };
  const agentId = task?.assigned_agent_id || null;
  const ownerUserId = task?.owner_user_id || null;
  if (!agentId || !ownerUserId || !task?.id) return empty;

  const cap = Math.min(200, Math.max(1, Number(limit) || MAX_TURNS));
  let source = 'kanban_marker';
  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT id, role, content, created_at, session_id
         FROM chat_turns
         WHERE agent_id = ? AND owner_user_id = ? AND content LIKE ?
         ORDER BY created_at ASC, id ASC
         LIMIT ?`
      )
      .all(agentId, ownerUserId, `%[Kanban #${task.id}]%`, cap);
  } catch (e) {
    console.warn('[kanban-chat-context] marker lookup failed', task.id, e?.message || e);
    return empty;
  }

  // Card never chatted through Kanban: fall back to the chat session that was open when the
  // card was created, so delegated work done in the agent chat is still visible after archive.
  if (!rows.length && task.created_at) {
    try {
      const session = db
        .prepare(
          `SELECT id FROM chat_sessions
           WHERE agent_id = ? AND owner_user_id = ?
             AND datetime(started_at) <= datetime(?, '+5 minutes')
             AND (archived_at IS NULL OR datetime(archived_at) >= datetime(?))
           ORDER BY datetime(started_at) DESC
           LIMIT 1`
        )
        .get(agentId, ownerUserId, task.created_at, task.created_at);
      if (session?.id) {
        rows = db
          .prepare(
            `SELECT id, role, content, created_at, session_id
             FROM chat_turns
             WHERE session_id = ?
               AND datetime(created_at) >= datetime(?, '-30 minutes')
               AND datetime(created_at) <= datetime(?, '+4 hours')
             ORDER BY created_at ASC, id ASC
             LIMIT ?`
          )
          .all(session.id, task.created_at, task.created_at, Math.min(cap, 20));
        source = rows.length ? 'session_window' : 'none';
      }
    } catch (e) {
      console.warn('[kanban-chat-context] session fallback failed', task.id, e?.message || e);
    }
  }

  if (!rows.length) return { ...empty, agent_id: agentId };

  const turns = decorate(db, rows);
  const archived = [];
  const seen = new Set();
  for (const t of turns) {
    if (t.session_archived && t.session_id && !seen.has(t.session_id)) {
      seen.add(t.session_id);
      archived.push({ id: t.session_id, title: t.session_title });
    }
  }
  return { turns, source, archived_sessions: archived, agent_id: agentId };
}
