/**
 * Agent deletion: transactional cascade + tombstone.
 *
 * Two problems this solves, both seen in production:
 *
 *  1. `agents` is referenced by six tables with `NO ACTION` foreign keys and
 *     `PRAGMA foreign_keys` is ON. The old delete cleaned five of them and left
 *     `kanban_tasks.assigned_agent_id`, so `DELETE FROM agents` raised
 *     "FOREIGN KEY constraint failed". Because the statements ran outside a
 *     transaction, chat history / grants were already gone by then — a failed
 *     delete still destroyed data. Everything now runs in one transaction and
 *     every referrer is handled.
 *
 *  2. A deleted agent came back. Privileged CEOs are re-granted the whole
 *     standard catalog on every boot (`grantStandardAgents`), and
 *     `POST /api/openclaw/sync` re-inserts any logical id still present in
 *     openclaw.json. Both keyed off rows/entries the delete left behind, so the
 *     agent reappeared after a restart or a sync. A `deleted_agents` tombstone
 *     makes the deletion durable: sync refuses to recreate a tombstoned id, and
 *     only an explicit create clears it.
 *
 * Kanban cards are unassigned rather than deleted — the board is the CEO's
 * record of work, not the agent's.
 */
import { log } from '../utils/logger.js';

const DELETED_AGENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS deleted_agents (
    agent_id TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    openclaw_agent_id TEXT DEFAULT '',
    owner_user_id TEXT DEFAULT '',
    deleted_by TEXT DEFAULT '',
    deleted_at TEXT DEFAULT (datetime('now'))
  )
`;

/**
 * Tables whose rows must go before `agents`, in dependency order.
 * `mode: 'null'` keeps the row and clears the pointer; `'delete'` removes it.
 */
const AGENT_REFERRERS = [
  { table: 'activities', column: 'agent_id', mode: 'delete' },
  { table: 'chat_turns', column: 'agent_id', mode: 'delete' },
  { table: 'standup_responses', column: 'agent_id', mode: 'delete' },
  { table: 'user_agents', column: 'agent_id', mode: 'delete' },
  { table: 'agent_tool_grants', column: 'agent_id', mode: 'delete' },
  { table: 'kanban_tasks', column: 'assigned_agent_id', mode: 'null' },
];

/** Agent-scoped rows with no FK — orphans rather than blockers, cleared best-effort. */
const AGENT_ORPHANS = [
  { table: 'chat_sessions', column: 'agent_id' },
  { table: 'agent_ops_budgets', column: 'agent_id' },
];

/**
 * OpenClaw base ids that back the runtime itself. Several agents may sit on
 * `main`, so these are never tombstoned or purged with a single agent —
 * doing so would block every other CEO's sync for that runtime.
 */
export const RESERVED_OPENCLAW_BASE_IDS = new Set(['main', 'default']);

/**
 * OpenClaw base ids belonging to this agent alone: its own id plus its base id,
 * minus reserved runtimes and anything a surviving agent still uses. These are
 * the ids that are safe to tombstone and to strip from openclaw.json.
 *
 * Call after the row is gone, or the agent counts as its own user.
 */
export function exclusiveOpenClawBaseIds(db, agent) {
  const candidates = new Set(
    [agent?.id, agent?.openclaw_agent_id]
      .map((v) => String(v || '').trim().toLowerCase())
      .filter(Boolean)
  );
  let stillUsed = new Set();
  try {
    stillUsed = new Set(
      db
        .prepare(`SELECT LOWER(id) AS id, LOWER(COALESCE(openclaw_agent_id, '')) AS oc FROM agents`)
        .all()
        .flatMap((r) => [r.id, r.oc])
        .filter(Boolean)
    );
  } catch {
    /* fall through: treat as unused */
  }
  return [...candidates].filter(
    (id) => !RESERVED_OPENCLAW_BASE_IDS.has(id) && !stillUsed.has(id)
  );
}

export function ensureDeletedAgentsTable(db) {
  try {
    db.exec(DELETED_AGENTS_TABLE_SQL);
  } catch (e) {
    log.warn(`[agent-delete] could not ensure deleted_agents table: ${e?.message || e}`);
  }
}

function tableHasColumn(db, table, column) {
  try {
    return db
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column) != null;
  } catch {
    return false;
  }
}

/** Record that an agent was deliberately deleted so nothing recreates it implicitly. */
export function tombstoneAgent(db, agent, deletedBy = '') {
  ensureDeletedAgentsTable(db);
  try {
    db.prepare(
      `INSERT INTO deleted_agents (agent_id, name, openclaw_agent_id, owner_user_id, deleted_by, deleted_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(agent_id) DO UPDATE SET
         name = excluded.name,
         openclaw_agent_id = excluded.openclaw_agent_id,
         owner_user_id = excluded.owner_user_id,
         deleted_by = excluded.deleted_by,
         deleted_at = excluded.deleted_at`
    ).run(
      String(agent?.id || ''),
      String(agent?.name || ''),
      String(agent?.openclaw_agent_id || ''),
      String(agent?.owner_user_id || ''),
      String(deletedBy || '')
    );
  } catch (e) {
    log.warn(`[agent-delete] could not tombstone agent ${agent?.id}: ${e?.message || e}`);
  }
}

/**
 * True when this logical id was explicitly deleted and must not be recreated
 * implicitly. Matches the agent id and the OpenClaw base id, because sync only
 * ever sees the latter. Reserved runtime ids never match, so one CEO deleting an
 * agent that sat on `main` cannot block anyone else's sync.
 */
export function isAgentTombstoned(db, agentId) {
  const id = String(agentId || '').trim();
  if (!id) return false;
  const reserved = RESERVED_OPENCLAW_BASE_IDS.has(id.toLowerCase());
  try {
    const sql = reserved
      ? `SELECT 1 FROM deleted_agents WHERE LOWER(agent_id) = LOWER(?)`
      : `SELECT 1 FROM deleted_agents
         WHERE LOWER(agent_id) = LOWER(?) OR LOWER(openclaw_agent_id) = LOWER(?)`;
    const args = reserved ? [id] : [id, id];
    return db.prepare(sql).get(...args) != null;
  } catch {
    return false;
  }
}

/** Called when an agent id is deliberately (re)created, so the id is usable again. */
export function clearAgentTombstone(db, agentId) {
  const id = String(agentId || '').trim();
  if (!id) return;
  try {
    db.prepare(
      `DELETE FROM deleted_agents
       WHERE LOWER(agent_id) = LOWER(?) OR LOWER(openclaw_agent_id) = LOWER(?)`
    ).run(id, id);
  } catch {
    /* table may not exist on an older DB — nothing to clear */
  }
}

/**
 * Delete an agent and everything that points at it, in a single transaction.
 *
 * @param {import('better-sqlite3').Database} db platform DB
 * @param {string} agentId
 * @param {{ deletedBy?: string, allowCoo?: boolean }} [opts]
 * @returns {{ id: string, name: string, cleared: Record<string, number>,
 *   children_reparented_to: string|null, openclaw_base_ids: string[] }}
 * @throws {Error & { code: 'AGENT_NOT_FOUND'|'AGENT_IS_COO', status: number }}
 */
export function deleteAgentCascade(db, agentId, opts = {}) {
  const { deletedBy = '', allowCoo = false } = opts;
  const id = String(agentId || '').trim();

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  if (!agent) {
    const err = new Error('Agent not found');
    err.code = 'AGENT_NOT_FOUND';
    err.status = 404;
    throw err;
  }
  if (agent.is_coo && !allowCoo) {
    const err = new Error('Cannot delete the COO agent');
    err.code = 'AGENT_IS_COO';
    err.status = 400;
    throw err;
  }

  ensureDeletedAgentsTable(db);

  const cleared = {};
  const bump = (key, changes) => {
    if (changes) cleared[key] = (cleared[key] || 0) + changes;
  };

  const run = db.transaction(() => {
    // Kanban cards can point at the agent's delegation rows; clear that link
    // first or deleting the delegation rows trips its own FK.
    if (tableHasColumn(db, 'kanban_tasks', 'agent_delegation_task_id')) {
      const r = db
        .prepare(
          `UPDATE kanban_tasks SET agent_delegation_task_id = NULL
           WHERE agent_delegation_task_id IN
             (SELECT id FROM agent_delegation_tasks WHERE to_agent_id = ?)`
        )
        .run(id);
      bump('kanban_tasks.agent_delegation_task_id', r.changes);
    }
    bump(
      'agent_delegation_tasks',
      db.prepare('DELETE FROM agent_delegation_tasks WHERE to_agent_id = ?').run(id).changes
    );

    for (const { table, column, mode } of AGENT_REFERRERS) {
      if (!tableHasColumn(db, table, column)) continue;
      const sql =
        mode === 'null'
          ? `UPDATE ${table} SET ${column} = NULL WHERE ${column} = ?`
          : `DELETE FROM ${table} WHERE ${column} = ?`;
      bump(`${table}.${column}`, db.prepare(sql).run(id).changes);
    }

    for (const { table, column } of AGENT_ORPHANS) {
      if (!tableHasColumn(db, table, column)) continue;
      try {
        bump(`${table}.${column}`, db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(id).changes);
      } catch (e) {
        log.warn(`[agent-delete] skip orphan cleanup ${table}.${column}: ${e?.message || e}`);
      }
    }

    // Keep the org chart connected: children move up to the deleted agent's parent.
    const newParent = agent.parent_id && agent.parent_id !== id ? agent.parent_id : null;
    bump(
      'agents.parent_id',
      db.prepare('UPDATE agents SET parent_id = ? WHERE parent_id = ?').run(newParent, id).changes
    );

    const r = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
    if (r.changes === 0) {
      const err = new Error('Agent not found');
      err.code = 'AGENT_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    // Row is gone, so surviving agents are what remains: only now can we tell
    // which OpenClaw base ids were this agent's alone.
    const exclusiveBaseIds = exclusiveOpenClawBaseIds(db, agent);
    const ownsItsBaseId = exclusiveBaseIds.includes(
      String(agent.openclaw_agent_id || '').trim().toLowerCase()
    );
    tombstoneAgent(
      db,
      { ...agent, openclaw_agent_id: ownsItsBaseId ? agent.openclaw_agent_id : '' },
      deletedBy
    );
    return { newParent, exclusiveBaseIds };
  });

  const { newParent: childrenReparentedTo, exclusiveBaseIds } = run();

  log.info(
    `[agent-delete] deleted agent ${id} (${agent.name || 'unnamed'}) by ${deletedBy || 'unknown'}; ` +
      `cleared=${JSON.stringify(cleared)}`
  );

  return {
    id,
    name: agent.name || '',
    openclaw_agent_id: agent.openclaw_agent_id || '',
    owner_user_id: agent.owner_user_id || '',
    cleared,
    children_reparented_to: childrenReparentedTo,
    /** Base ids this agent alone used — safe to strip from openclaw.json. */
    openclaw_base_ids: exclusiveBaseIds,
  };
}
