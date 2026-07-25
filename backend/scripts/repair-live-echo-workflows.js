/**
 * Repair the live validation workflows: remove the non-existent `output` node.
 *
 * There is no "Output" node in the workflow editor palette. The earlier live fixture invented
 * one; the runner skipped it and A2A fell back to "Workflow completed successfully."
 * Use a trigger-only published graph (valid editor shape) so the workflows remain callable.
 *
 * Does NOT re-run delegations or clean anything else up.
 *
 * Usage: node backend/scripts/repair-live-echo-workflows.js
 */
import { getDb, initDb } from '../src/db/schema.js';

const OWNER = process.env.LIVE_OWNER || 'ceo-bala';
const WORKFLOWS = ['live-org-a2a-priorart', 'live-org-a2a-ops-echo'];

initDb();
const db = getDb();
const now = new Date().toISOString();
const graph = JSON.stringify({
  nodes: [{ id: 't1', type: 'trigger', data: { label: 'Trigger' } }],
  edges: [],
});

for (const id of WORKFLOWS) {
  const row = db
    .prepare(`SELECT id FROM agent_workflow_definitions WHERE id = ? AND owner_user_id = ?`)
    .get(id, OWNER);
  if (!row) {
    console.log(`[repair] skip missing workflow ${id}`);
    continue;
  }
  db.prepare(
    `UPDATE agent_workflow_definitions
     SET draft_graph_json = ?, published_graph_json = ?, status = 'published', updated_at = ?
     WHERE id = ? AND owner_user_id = ?`
  ).run(graph, graph, now, id, OWNER);
  console.log(`[repair] ${id}: removed bogus output node → trigger-only graph`);
}

// Drop the unused echo scripts if they were created by the previous repair attempt.
db.prepare(
  `DELETE FROM custom_scripts WHERE id LIKE 'script-live-echo-%' AND owner_user_id = ?`
).run(OWNER);

console.log('[repair] DONE');
