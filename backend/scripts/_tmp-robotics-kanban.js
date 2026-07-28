import { initDb, getDb } from "../src/db/schema.js";
initDb();
const db = getDb();
const cols = db.prepare("PRAGMA table_info(kanban_tasks)").all().map(c => c.name);
console.log("cols", cols.join(","));
const rows = db.prepare(`
  SELECT k.id, k.title, k.status, k.assigned_agent_id, k.owner_user_id, k.updated_at, k.created_at,
         k.agent_delegation_task_id,
         substr(k.description,1,800) AS desc_snip
  FROM kanban_tasks k
  WHERE lower(coalesce(k.title,'')) LIKE '%robot%'
     OR lower(coalesce(k.description,'')) LIKE '%robot%'
     OR lower(coalesce(k.title,'')) LIKE '%hospitality%'
     OR lower(coalesce(k.description,'')) LIKE '%hospitality%'
  ORDER BY k.updated_at DESC
  LIMIT 20
`).all();
console.log("count", rows.length);
for (const k of rows) {
  console.log("---KANBAN---");
  console.log(JSON.stringify({ id:k.id, title:k.title, status:k.status, agent:k.assigned_agent_id, owner:k.owner_user_id, del:k.agent_delegation_task_id, updated:k.updated_at, created:k.created_at }, null, 2));
  console.log("DESC:", k.desc_snip);
  const dels = db.prepare(`
    SELECT id, status, to_agent_id, substr(coalesce(error_message,''),1,400) AS err,
           created_at, completed_at, substr(coalesce(prompt,''),1,100) AS prompt
    FROM agent_delegation_tasks
    WHERE id = ? OR id IN (
      SELECT agent_delegation_task_id FROM kanban_tasks WHERE id = ?
    )
    ORDER BY id DESC LIMIT 5
  `).all(k.agent_delegation_task_id || -1, k.id);
  // also search related by request_id orphan-kanbanid
  const related = db.prepare(`
    SELECT id, status, to_agent_id, substr(coalesce(error_message,''),1,400) AS err,
           created_at, completed_at
    FROM agent_delegation_tasks
    WHERE request_id LIKE ? OR prompt LIKE ?
    ORDER BY id DESC LIMIT 15
  `).all(`orphan-${k.id}%`, `%${k.id}%`);
  console.log("DELS", JSON.stringify(dels, null, 2));
  console.log("RELATED", JSON.stringify(related, null, 2));
}