#!/usr/bin/env bash
set -euo pipefail
cd /opt/agent-os/deploy
docker compose exec -T backend node --input-type=module <<'NODE'
import { initDb, getDb } from './src/db/schema.js';
import * as store from './src/services/agent-workflow-store.js';
initDb();
const db = getDb();
const wid = 'certify-ibkr-llm-mrxmpmlm-mrxmppqd';
const def = store.getDefinition(wid, 'ceo-bala');
const row = db.prepare(`SELECT id, name, owner_user_id, status, updated_at FROM agent_workflow_definitions WHERE id = ?`).get(wid);
console.log('def_row', row);
console.log('store_found', !!def);

function summarize(label, g) {
  if (!g) {
    console.log(label, null);
    return;
  }
  const edges = (g.edges || []).map((e) => `${e.source}->${e.target}${e.sourceHandle ? '[' + e.sourceHandle + ']' : ''}`);
  const outs = {};
  for (const e of g.edges || []) {
    outs[e.source] = outs[e.source] || [];
    outs[e.source].push(e.target + (e.sourceHandle ? '[' + e.sourceHandle + ']' : ''));
  }
  console.log('\n===' + label + '===');
  console.log('nodes', (g.nodes || []).length, 'edges', edges.length);
  console.log('edges', edges);
  console.log('merge-1 outs', outs['merge-1'] || []);
  console.log('maker-1 outs', outs['maker-1'] || []);
  console.log('stub-history outs', outs['stub-history'] || []);
  console.log('parallel-1 outs', outs['parallel-1'] || []);
  console.log('trigger-1 outs', outs['trigger-1'] || []);
}

summarize('published', def?.published_graph);
summarize('draft', def?.draft_graph);

const draftRaw = JSON.parse(db.prepare(`SELECT draft_graph_json FROM agent_workflow_definitions WHERE id = ?`).get(wid).draft_graph_json || 'null');
const pubRaw = JSON.parse(db.prepare(`SELECT published_graph_json FROM agent_workflow_definitions WHERE id = ?`).get(wid).published_graph_json || 'null');
summarize('raw_draft', draftRaw);
summarize('raw_published', pubRaw);

const same =
  JSON.stringify(draftRaw?.edges || []) === JSON.stringify(pubRaw?.edges || []);
console.log('\ndraft_edges_eq_published', same);

const runs = db
  .prepare(
    `SELECT id, run_number, status, progress_pct, started_at, completed_at, updated_at
     FROM agent_workflow_runs WHERE definition_id = ? ORDER BY id DESC`
  )
  .all(wid);
console.log('\nruns', runs);
NODE
