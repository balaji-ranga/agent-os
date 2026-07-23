/**
 * Update hacker-news-connector-demo: GitHub get_user username from trigger input.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';

initDb();
const db = getDb();
const WF = 'hacker-news-connector-demo-mruj9965';

const row = db
  .prepare(
    `SELECT id, name, owner_user_id, draft_graph_json, published_graph_json
     FROM agent_workflow_definitions WHERE id = ?`
  )
  .get(WF);
if (!row) {
  console.error('workflow not found', WF);
  process.exit(1);
}

function parse(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function patchGraph(raw) {
  const g = structuredClone(parse(raw) || { nodes: [], edges: [] });
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const trigger = nodes.find((n) => n.type === 'trigger' || String(n.id || '').startsWith('trigger'));
  const triggerId = trigger?.id || 'trigger-1';
  let patched = false;

  for (const n of nodes) {
    const cfg = n.data?.taskConfig || n.data?.config || {};
    const actionId = String(cfg.actionId || cfg.action_id || '');
    const appId = String(cfg.appId || cfg.app_id || '');
    const isGhUser =
      actionId === 'github.get_user' ||
      (appId === 'github' && /get.?user/i.test(actionId));
    if (!isGhUser) continue;

    if (!n.data) n.data = {};
    if (!n.data.taskConfig) n.data.taskConfig = { ...cfg };
    // Username comes from Inputs (templates). Clear hardcoded static username.
    n.data.taskConfig.staticInputJson = '{}';
    n.data.inputBindings = [
      {
        id: 'input',
        label: 'Action input (JSON)',
        mode: 'static',
        value: JSON.stringify({ username: `{{${triggerId}.trigger_input}}` }),
        sourceNodeId: '',
        sourceOutputKey: 'result',
      },
    ];
    patched = true;
    console.log('patched', n.id, actionId, n.data.inputBindings[0].value);
  }

  if (!patched) {
    console.log(
      'nodes',
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        actionId: n.data?.taskConfig?.actionId,
        appId: n.data?.taskConfig?.appId,
        staticInputJson: n.data?.taskConfig?.staticInputJson,
        bindings: n.data?.inputBindings,
      }))
    );
    throw new Error('No github.get_user node found');
  }
  return g;
}

const draft = patchGraph(row.draft_graph_json);
const published = patchGraph(row.published_graph_json || row.draft_graph_json);

db.prepare(
  `UPDATE agent_workflow_definitions
   SET draft_graph_json = ?, published_graph_json = ?, updated_at = datetime('now')
   WHERE id = ?`
).run(JSON.stringify(draft), JSON.stringify(published), WF);
console.log('workflow graphs updated');

const username = process.env.TEST_GH_USER || 'balaji-ranga';
console.log('== run with trigger input:', username);
const run = await startAgentWorkflowRun(WF, row.owner_user_id, {
  trigger: 'manual',
  input: username,
  actor: { id: row.owner_user_id, role: 'ceo', name: 'Balaji' },
});
const runId = run?.id || run;
console.log('run', runId);

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const status = db.prepare(`SELECT status, error_message FROM agent_workflow_runs WHERE id = ?`).get(runId);
  console.log(status?.status, status?.error_message || '');
  if (status && !['running', 'pending', 'queued'].includes(status.status)) {
    const steps = db
      .prepare(
        `SELECT node_id, status, error_message,
                substr(cast(input_json as text),1,300) as inp,
                substr(cast(output_json as text),1,300) as outp
         FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
      )
      .all(runId);
    console.log(JSON.stringify(steps, null, 2));
    process.exit(status.status === 'completed' ? 0 : 1);
  }
}
process.exit(2);
