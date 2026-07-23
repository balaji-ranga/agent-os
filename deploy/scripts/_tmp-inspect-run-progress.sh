#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
initDb();
const db = getDb();
const rows = db
  .prepare(
    `SELECT r.id, r.run_number, r.status, r.progress_pct, r.trigger, r.error_message,
            d.name, d.id AS wid
     FROM agent_workflow_runs r
     JOIN agent_workflow_definitions d ON d.id = r.definition_id
     WHERE d.owner_user_id = 'ceo-bala'
       AND (d.name LIKE 'certify-ibkr%' OR d.name LIKE 'Schema name%' OR d.id LIKE 'schema-name-dob%' OR d.id LIKE 'certify-ibkr%')
     ORDER BY r.id DESC
     LIMIT 12`
  )
  .all();
console.log(JSON.stringify(rows, null, 2));
for (const r of rows.slice(0, 3)) {
  const steps = db
    .prepare(
      `SELECT node_id, node_type, node_label, status, error_message
       FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
    )
    .all(r.id);
  console.log('--- run', r.id, r.name, 'status', r.status, 'pct', r.progress_pct);
  console.log(JSON.stringify(steps, null, 2));
}
NODE
