#!/bin/bash
set -euo pipefail
docker exec -i agent-os-backend-1 node <<'NODE'
const { initDb, getDb } = await import('/opt/agent-os/backend/src/db/schema.js');
initDb();
const db = getDb();

const users = db.prepare(`
  SELECT id, email, name, role FROM platform_users
  WHERE id='ceo-bala' OR lower(name) LIKE '%balaji%' OR lower(email) LIKE '%balaji%' OR lower(email) LIKE '%rangan%'
`).all();
console.log('USERS', JSON.stringify(users, null, 2));

const grants = db.prepare(`
  SELECT agent_id, tool_name FROM agent_tool_grants
  WHERE tool_name LIKE 'kanban_%'
    AND (agent_id='techresearcher' OR agent_id LIKE '%techresearcher%')
  ORDER BY agent_id, tool_name
`).all();
console.log('GRANTS', JSON.stringify(grants, null, 2));

const ua = db.prepare(`
  SELECT user_id, agent_id, enabled FROM user_agents
  WHERE agent_id='techresearcher' OR agent_id LIKE '%techresearcher%'
`).all();
console.log('USER_AGENTS', JSON.stringify(ua, null, 2));

const tasks = db.prepare(`
  SELECT id, title, status, assigned_agent_id, owner_user_id, agent_delegation_task_id,
         updated_at, substr(description,1,120) AS desc_head
  FROM kanban_tasks
  WHERE (owner_user_id='ceo-bala' OR owner_user_id IN (SELECT id FROM platform_users WHERE lower(name) LIKE '%balaji%'))
    AND (assigned_agent_id LIKE '%techresearcher%' OR assigned_agent_id='techresearcher' OR title LIKE '%Tech%' OR title LIKE '%Research%')
  ORDER BY updated_at DESC
  LIMIT 8
`).all();
console.log('TASKS', JSON.stringify(tasks, null, 2));

const openTasks = db.prepare(`
  SELECT id, title, status, assigned_agent_id, owner_user_id, agent_delegation_task_id, updated_at
  FROM kanban_tasks
  WHERE owner_user_id IN ('ceo-bala') AND status='open'
  ORDER BY updated_at DESC LIMIT 10
`).all();
console.log('OPEN_CEO_BALA', JSON.stringify(openTasks, null, 2));

for (const t of [...tasks, ...openTasks].slice(0, 5)) {
  const logs = db.prepare(`
    SELECT id, tool_name, source, status, created_at,
           substr(request_payload,1,220) AS req,
           substr(response_payload,1,220) AS res
    FROM content_tool_logs
    WHERE tool_name LIKE 'kanban_%'
      AND (request_payload LIKE '%' || ? || '%' OR request_payload LIKE '%"task_id":' || ? || '%' OR request_payload LIKE '%"task_id": ' || ? || '%')
    ORDER BY id DESC LIMIT 8
  `).all(String(t.id), String(t.id), String(t.id));
  console.log('LOGS_FOR_TASK', t.id, JSON.stringify(logs, null, 2));
}

const recent = db.prepare(`
  SELECT id, tool_name, source, status, created_at, substr(response_payload,1,180) AS res
  FROM content_tool_logs
  WHERE tool_name LIKE 'kanban_%'
    AND (source LIKE '%techresearcher%' OR source LIKE '%TechResearcher%' OR source LIKE '%t-%--techresearcher%')
  ORDER BY id DESC LIMIT 15
`).all();
console.log('RECENT_TECH_KANBAN_LOGS', JSON.stringify(recent, null, 2));
NODE
