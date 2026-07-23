#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import * as store from './src/services/agent-workflow-store.js';
initDb();
const db = getDb();
const def = store.getDefinition('certify-ibkr-llm-mrxmpmlm-mrxmppqd', 'ceo-bala');
const g = def?.published_graph || def?.draft_graph || { nodes: [], edges: [] };
const nodes = (g.nodes || []).map((n) => ({ id: n.id, type: n.type, label: n.data?.label || n.label }));
console.log('node_count', nodes.length);
console.log(JSON.stringify(nodes, null, 2));
const steps = db.prepare(`SELECT node_id, status FROM agent_workflow_run_steps WHERE run_id = 519 ORDER BY id`).all();
console.log('steps', steps.length, steps);
const missing = nodes.filter((n) => !steps.some((s) => s.node_id === n.id));
console.log('never_executed', missing);
const edges = (g.edges || []).map((e) => `${e.source}->${e.target}${e.sourceHandle ? '['+e.sourceHandle+']' : ''}`);
console.log('edges', edges);
NODE
