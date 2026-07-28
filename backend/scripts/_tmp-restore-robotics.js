import { initDb, getDb } from "../src/db/schema.js";
initDb();
const db = getDb();
const k = db.prepare("SELECT * FROM kanban_tasks WHERE id = 2041").get();
if (!k) { console.log("missing kanban 2041"); process.exit(1); }
const d = k.agent_delegation_task_id
  ? db.prepare("SELECT * FROM agent_delegation_tasks WHERE id = ?").get(k.agent_delegation_task_id)
  : null;
console.log("before", { kanban: k.status, del: d?.id, delStatus: d?.status, err: d?.error_message });
if (d && d.error_message === "budget-gate test cleanup") {
  db.prepare(`
    UPDATE agent_delegation_tasks
    SET status = 'pending', error_message = NULL, completed_at = NULL
    WHERE id = ?
  `).run(d.id);
  const note = "\n\n---\n[System] Restored after deploy smoke incorrectly failed this live TechResearcher task (budget-gate test cleanup).";
  db.prepare(`
    UPDATE kanban_tasks
    SET status = 'in_progress',
        description = CASE
          WHEN description LIKE '%Restored after deploy smoke%' THEN description
          ELSE coalesce(description,'') || ?
        END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(note, k.id);
  const k2 = db.prepare("SELECT id, status, agent_delegation_task_id FROM kanban_tasks WHERE id = 2041").get();
  const d2 = db.prepare("SELECT id, status, error_message FROM agent_delegation_tasks WHERE id = ?").get(d.id);
  console.log("restored", { kanban: k2, del: d2 });
} else {
  console.log("not restoring — unexpected state", d?.error_message);
}