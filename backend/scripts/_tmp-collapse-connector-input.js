/**
 * Collapse connector inputs: move staticInputJson → Inputs Action input; clear legacy field.
 * Validates hacker-news-connector-demo still runs with trigger username → github.get_user.
 */
import { initDb, getDb } from '../src/db/schema.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';

initDb();
const db = getDb();
const WF = 'hacker-news-connector-demo-mruj9965';

const row = db
  .prepare(
    `SELECT id, owner_user_id, draft_graph_json, published_graph_json
     FROM agent_workflow_definitions WHERE id = ?`
  )
  .get(WF);
if (!row) {
  console.error('workflow not found');
  process.exit(1);
}

function parse(raw) {
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function isEmpty(v) {
  const cur = String(v ?? '').trim();
  return !cur || cur === '{}' || cur === '{\n}' || cur === '{{input}}';
}

function patchGraph(raw) {
  const g = structuredClone(parse(raw) || { nodes: [], edges: [] });
  const trigger = (g.nodes || []).find((n) => n.type === 'trigger' || String(n.id).startsWith('trigger'));
  const triggerId = trigger?.id || 'trigger-1';

  for (const n of g.nodes || []) {
    if (n.type !== 'connector') continue;
    if (!n.data) n.data = {};
    const cfg = { ...(n.data.taskConfig || {}) };
    const actionId = String(cfg.actionId || '');
    const legacy = String(cfg.staticInputJson || '').trim();
    const bindings = Array.isArray(n.data.inputBindings) ? [...n.data.inputBindings] : [];
    let idx = bindings.findIndex((b) => b.id === 'input');
    if (idx < 0) {
      bindings.push({
        id: 'input',
        label: 'Action input',
        mode: 'static',
        value: '{}',
        sourceNodeId: '',
        sourceOutputKey: 'result',
      });
      idx = bindings.length - 1;
    }
    const b = bindings[idx];

    if (actionId === 'github.get_user') {
      bindings[idx] = {
        ...b,
        label: 'Action input',
        mode: 'static',
        value: JSON.stringify({ username: `{{${triggerId}.trigger_input}}` }),
        sourceNodeId: '',
        sourceOutputKey: 'result',
      };
    } else if (actionId.includes('hackernews') || actionId.includes('get_top_stories')) {
      const value =
        !isEmpty(b.value) && b.mode === 'static'
          ? b.value
          : legacy && legacy !== '{}'
            ? legacy
            : JSON.stringify({ print: 'pretty' }, null, 2);
      bindings[idx] = {
        ...b,
        label: 'Action input',
        mode: 'static',
        value,
        sourceNodeId: '',
        sourceOutputKey: 'result',
      };
    } else if (isEmpty(b.value) && legacy && legacy !== '{}') {
      bindings[idx] = {
        ...b,
        label: 'Action input',
        mode: 'static',
        value: legacy,
        sourceNodeId: '',
        sourceOutputKey: 'result',
      };
    } else {
      bindings[idx] = { ...b, label: 'Action input' };
    }

    cfg.staticInputJson = '{}';
    n.data.taskConfig = cfg;
    n.data.inputBindings = bindings;
    console.log(n.id, actionId, bindings[idx].value);
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
console.log('updated');

const username = process.env.TEST_GH_USER || 'octocat';
const run = await startAgentWorkflowRun(WF, row.owner_user_id, {
  trigger: 'manual',
  input: username,
  actor: { id: row.owner_user_id, role: 'ceo' },
});
const runId = run?.id || run;
console.log('run', runId, 'input', username);
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const status = db.prepare(`SELECT status, error_message FROM agent_workflow_runs WHERE id = ?`).get(runId);
  console.log(status?.status, status?.error_message || '');
  if (status && !['running', 'pending', 'queued'].includes(status.status)) {
    const steps = db
      .prepare(
        `SELECT node_id, status, error_message, substr(cast(input_json as text),1,240) as inp
         FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
      )
      .all(runId);
    console.log(JSON.stringify(steps, null, 2));
    process.exit(status.status === 'completed' ? 0 : 1);
  }
}
process.exit(2);
