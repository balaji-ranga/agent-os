/**
 * Verify Admin disable removes workflow schedule registry rows.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { setUserEnabled } from '../src/services/users.js';
import { listScheduledFromRegistry } from '../src/services/agent-workflow-store.js';

initDb();
const db = getDb();
const ceo = db.prepare(`SELECT id FROM platform_users WHERE role='ceo' ORDER BY rowid LIMIT 1`).get();
const id = `wf-disable-smoke-${Date.now()}`;
db.prepare(
  `INSERT INTO agent_workflow_definitions
   (id, name, description, owner_user_id, draft_graph_json, status, schedule_cron, chat_trigger_phrase, trigger_modes)
   VALUES (?, 'Disable smoke', '', ?, '{}', 'published', '* * * * *', '', 'manual,schedule')`
).run(id, ceo.id);
db.prepare(
  `INSERT INTO agent_workflow_schedules
   (definition_id, owner_user_id, workflow_name, schedule_cron, enabled, updated_at)
   VALUES (?, ?, 'Disable smoke', '* * * * *', 1, datetime('now'))`
).run(id, ceo.id);

const before = db.prepare('SELECT COUNT(*) AS c FROM agent_workflow_schedules WHERE owner_user_id = ?').get(ceo.id).c;
const was = !!db.prepare('SELECT enabled FROM platform_users WHERE id = ?').get(ceo.id).enabled;
setUserEnabled(ceo.id, false);
const after = db.prepare('SELECT COUNT(*) AS c FROM agent_workflow_schedules WHERE owner_user_id = ?').get(ceo.id).c;
const listed = listScheduledFromRegistry().filter((d) => d.owner_user_id === ceo.id).length;
setUserEnabled(ceo.id, was);
db.prepare('DELETE FROM agent_workflow_schedules WHERE definition_id = ?').run(id);
db.prepare('DELETE FROM agent_workflow_definitions WHERE id = ?').run(id);

const ok = before > 0 && after === 0 && listed === 0;
console.log(JSON.stringify({ before, after, listed, ok }));
if (!ok) process.exit(1);
console.log('PASS: disable removes workflow schedules');
