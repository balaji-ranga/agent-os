/**
 * Repair restored chat sessions whose turns were all stamped with restore-time.
 * Matches active "Restored · …" turns to archived source by order and copies created_at.
 */
import { initDb, getDb } from '../src/db/schema.js';

initDb();
const db = getDb();

const restored = db
  .prepare(
    `SELECT id, agent_id, owner_user_id, title, started_at
     FROM chat_sessions
     WHERE status = 'active' AND title LIKE 'Restored · %'`
  )
  .all();

let fixedSessions = 0;
let fixedTurns = 0;

for (const active of restored) {
  const sourceTitle = String(active.title || '').replace(/^Restored ·\s*/, '').trim();
  const archived = db
    .prepare(
      `SELECT id, title FROM chat_sessions
       WHERE owner_user_id = ? AND agent_id = ? AND status = 'archived'
         AND title = ?
       ORDER BY archived_at DESC LIMIT 1`
    )
    .get(active.owner_user_id, active.agent_id, sourceTitle);
  if (!archived) {
    console.warn('no archive match', active.id, sourceTitle);
    continue;
  }
  const srcTurns = db
    .prepare(
      `SELECT id, role, content, created_at FROM chat_turns
       WHERE session_id = ? ORDER BY created_at ASC, id ASC`
    )
    .all(archived.id);
  const dstTurns = db
    .prepare(
      `SELECT id, role, content, created_at FROM chat_turns
       WHERE session_id = ? ORDER BY id ASC`
    )
    .all(active.id);
  if (!srcTurns.length || srcTurns.length !== dstTurns.length) {
    console.warn(
      'length mismatch',
      active.agent_id,
      'src',
      srcTurns.length,
      'dst',
      dstTurns.length,
      active.id
    );
    continue;
  }
  const upd = db.prepare(`UPDATE chat_turns SET created_at = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (let i = 0; i < dstTurns.length; i++) {
      const s = srcTurns[i];
      const d = dstTurns[i];
      if (s.role !== d.role || String(s.content) !== String(d.content)) {
        throw new Error(`content mismatch at ${i} session=${active.id}`);
      }
      if (d.created_at !== s.created_at) {
        upd.run(s.created_at, d.id);
        fixedTurns += 1;
      }
    }
  });
  try {
    tx();
    fixedSessions += 1;
    console.log(
      'fixed',
      active.agent_id,
      active.owner_user_id,
      'turns',
      dstTurns.length,
      'from archive',
      archived.id
    );
  } catch (e) {
    console.warn('skip', active.id, e.message);
  }
}

console.log(
  JSON.stringify({
    restored_active: restored.length,
    fixedSessions,
    fixedTurns,
    ok: true,
  })
);
