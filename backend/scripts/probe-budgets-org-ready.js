/**
 * Quick VPS probe for budgets/org feature readiness (run inside backend container).
 */
import { initDb, getDb } from '../src/db/schema.js';
import { listDocuments } from '../src/services/master-data.js';

initDb();
const db = getDb();

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('agent_ops_budgets','token_usage','org_agent_members','org_member_invocations')`
  )
  .all()
  .map((r) => r.name);
console.log('tables', tables.join(',') || '(none)');

const kanbanCols = db.prepare('PRAGMA table_info(kanban_tasks)').all().map((c) => c.name);
console.log('kanban.assigned_member_key', kanbanCols.includes('assigned_member_key') ? 'yes' : 'no');

const ceos = db.prepare("SELECT id FROM platform_users WHERE role='ceo' AND enabled=1 LIMIT 5").all();
let helpHits = 0;
for (const c of ceos) {
  const docs = listDocuments(c.id) || [];
  const hit = docs.filter(
    (d) =>
      String(d.title || '').includes('Agent Budgets Org Members') ||
      String(d.filename || '').includes('18-agent-budgets')
  );
  helpHits += hit.length;
  if (hit.length) console.log('help doc for', c.id, hit.map((d) => d.title).join(' | '));
}
console.log('help_doc_rows', helpHits, 'across', ceos.length, 'ceos');
