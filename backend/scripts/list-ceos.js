import { initDb, getDb } from '../src/db/schema.js';
initDb();
const rows = getDb()
  .prepare("SELECT id, email FROM platform_users WHERE role='ceo' AND enabled=1 ORDER BY rowid LIMIT 10")
  .all();
for (const r of rows) console.log(`${r.id}\t${r.email}`);
