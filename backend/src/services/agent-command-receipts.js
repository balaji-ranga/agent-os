import { createHash } from 'node:crypto';
// A lost response must never silently repeat a potentially mutating tool.
export function createCommandReceiptStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_command_receipts (
    owner_user_id TEXT NOT NULL, actor_user_id TEXT NOT NULL, agent_id TEXT NOT NULL,
    request_key TEXT NOT NULL, command_hash TEXT NOT NULL, state TEXT NOT NULL,
    response_json TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(owner_user_id,actor_user_id,agent_id,request_key))`);
  const fail = message => { throw Object.assign(new Error(message), { status: 409 }); };
  const args = c => [c.ownerUserId, c.actor.id, c.agentId, c.idempotencyKey];
  return {
    claim(context) {
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(context.idempotencyKey || '')) throw Object.assign(new Error('A stable idempotency_key is required for tool commands'), { status: 400 });
      const hash = createHash('sha256').update(JSON.stringify([context.tool_name, context.params])).digest('hex');
      return db.transaction(() => {
        const row = db.prepare('SELECT * FROM agent_command_receipts WHERE owner_user_id=? AND actor_user_id=? AND agent_id=? AND request_key=?').get(...args(context));
        if (row) {
          if (row.command_hash !== hash) fail('Request key already used for a different command');
          if (row.state !== 'completed') fail('Command already submitted; outcome unverified. Check execution logs before submitting again.');
          return JSON.parse(row.response_json);
        }
        db.prepare("INSERT INTO agent_command_receipts(owner_user_id,actor_user_id,agent_id,request_key,command_hash,state) VALUES(?,?,?,?,?,'submitted')").run(...args(context), hash);
        return null;
      })();
    },
    complete(context, result) {
      db.prepare("UPDATE agent_command_receipts SET state='completed',response_json=? WHERE owner_user_id=? AND actor_user_id=? AND agent_id=? AND request_key=?").run(JSON.stringify(result), ...args(context));
    },
  };
}
