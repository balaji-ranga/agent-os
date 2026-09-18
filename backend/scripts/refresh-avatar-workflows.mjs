import { initDb, getDb } from '../src/db/schema.js';
import { assignAvatarAgent } from '../src/services/ceo-avatars.js';

initDb();

const rows = getDb()
  .prepare(`
    SELECT id, owner_user_id, agent_id
    FROM ceo_avatars
    WHERE agent_id IS NOT NULL AND TRIM(agent_id) != ''
    ORDER BY owner_user_id, id
  `)
  .all();

let refreshed = 0;
const failures = [];
for (const row of rows) {
  try {
    assignAvatarAgent(row.owner_user_id, row.id, row.agent_id, {
      id: row.owner_user_id,
      name: 'avatar-template-refresh',
    });
    refreshed += 1;
  } catch (error) {
    failures.push({ avatar_id: row.id, error: error?.message || String(error) });
  }
}

console.log(JSON.stringify({ ok: failures.length === 0, mapped: rows.length, refreshed, failures }, null, 2));
if (failures.length) process.exitCode = 1;
