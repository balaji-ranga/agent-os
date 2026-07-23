#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import * as store from './src/services/agent-workflow-store.js';
initDb();
const db = getDb();
const run = db.prepare(`SELECT id, status, progress_pct, started_at, completed_at, updated_at, context_json FROM agent_workflow_runs WHERE id = 519`).get();
console.log('run', {
  id: run.id,
  status: run.status,
  progress_pct: run.progress_pct,
  started_at: run.started_at,
  completed_at: run.completed_at,
  updated_at: run.updated_at,
});
const steps = db.prepare(`
  SELECT id, node_id, node_type, status, started_at, completed_at, error_message
  FROM agent_workflow_run_steps WHERE run_id = 519 ORDER BY id
`).all();
console.log('steps_timeline');
for (const s of steps) {
  console.log(`  #${s.id} ${s.node_id} (${s.node_type}) ${s.status} start=${s.started_at} end=${s.completed_at}`);
}
const def = store.getDefinition('certify-ibkr-llm-mrxmpmlm-mrxmppqd', 'ceo-bala');
const g = def?.published_graph || { nodes: [], edges: [] };
const outs = {};
for (const e of g.edges || []) {
  outs[e.source] = outs[e.source] || [];
  outs[e.source].push(`${e.target}${e.sourceHandle ? '['+e.sourceHandle+']' : ''}`);
}
console.log('outgoing_from_key_nodes', {
  'merge-1': outs['merge-1'] || [],
  'maker-1': outs['maker-1'] || [],
  'stub-history': outs['stub-history'] || [],
  'checker-1': outs['checker-1'] || [],
});
NODE
