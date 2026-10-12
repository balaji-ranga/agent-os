import { randomUUID } from 'node:crypto';
import { copilotError } from './ui-copilot-contract.js';

// Session persistence is independent of the LLM transcript and scoped to BOTH
// the company and the initiating human. CAS prevents competing-tab overwrites.
export function uiCopilotStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ui_copilot_sessions (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, actor TEXT NOT NULL,
    version INTEGER NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS ui_copilot_actor ON ui_copilot_sessions(owner,actor,expires_at);`);
  const decode = row => row && ({ id: row.id, version: row.version, expires_at: row.expires_at, ...JSON.parse(row.state) });
  function cleanup() { db.prepare('DELETE FROM ui_copilot_sessions WHERE expires_at <= ?').run(Date.now()); }
  return {
    latest(owner, actor) { cleanup(); return decode(db.prepare('SELECT * FROM ui_copilot_sessions WHERE owner=? AND actor=? ORDER BY expires_at DESC LIMIT 1').get(owner, actor)); },
    create(owner, actor, state) {
      cleanup();
      const id = randomUUID(), expires = Date.now() + 7 * 86400000;
      db.prepare('INSERT INTO ui_copilot_sessions VALUES (?,?,?,1,?,?)').run(id, owner, actor, JSON.stringify(state), expires);
      return { id, version: 1, expires_at: expires, ...state };
    },
    get(owner, actor, id) {
      const row = db.prepare('SELECT * FROM ui_copilot_sessions WHERE owner=? AND actor=? AND id=? AND expires_at>?').get(owner, actor, id, Date.now());
      if (!row) throw copilotError('Assistance session not found or expired', 404);
      return decode(row);
    },
    update(owner, actor, id, version, state) {
      const result = db.prepare('UPDATE ui_copilot_sessions SET state=?,version=version+1 WHERE owner=? AND actor=? AND id=? AND version=? AND expires_at>?').run(JSON.stringify(state), owner, actor, id, version, Date.now());
      if (!result.changes) throw copilotError('Session changed or expired. Reload before continuing.', 409);
      return this.get(owner, actor, id);
    },
  };
}
