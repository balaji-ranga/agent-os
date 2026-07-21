/**
 * Fix HN sample schema generation + validate hacker-news-connector-demo for ceo-bala.
 */
import { initDb, getDb } from '../src/db/schema.js';
import {
  exampleInputFromSchema,
  executeConnectorAction,
  listConnectorActions,
} from '../src/services/openconnector.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';

initDb();
const db = getDb();

const printSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer', exclusiveMinimum: 0 },
    print: { const: 'pretty', type: 'string' },
  },
  required: ['id'],
};
console.log('example fix check', JSON.stringify(exampleInputFromSchema(printSchema)));

// Live story id
const top = await executeConnectorAction('ceo-bala', 'hackernews.get_top_stories', { print: 'pretty' });
const ids = top?.data?.data?.story_ids || top?.data?.story_ids || [];
const storyId = Number(ids[0]) || 1;
console.log('top stories ok', top.ok, 'sample id', storyId);

const itemEx = exampleInputFromSchema({
  type: 'object',
  properties: {
    id: { type: 'integer', exclusiveMinimum: 0, maximum: 9007199254740991 },
    print: { const: 'pretty', type: 'string' },
  },
  required: ['id'],
});
itemEx.id = storyId;
console.log('get_item input', itemEx);
const item = await executeConnectorAction('ceo-bala', 'hackernews.get_item', itemEx);
console.log('get_item ok', item.ok, JSON.stringify(item.data).slice(0, 250));

// Update demo workflow HN + any get_item / get_*_stories nodes with bad print:""
const WF = 'hacker-news-connector-demo-mruj9965';
const row = db
  .prepare(
    `SELECT id, draft_graph_json, published_graph_json FROM agent_workflow_definitions WHERE id = ?`
  )
  .get(WF);

function parse(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function fixNodeInput(n, storyId) {
  if (n.type !== 'connector') return false;
  const cfg = { ...(n.data?.taskConfig || {}) };
  const actionId = String(cfg.actionId || '');
  if (!actionId.startsWith('hackernews.')) return false;

  let input = {};
  try {
    const raw = String(cfg.staticInputJson || '').trim();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {};
  }

  let changed = false;
  if (Object.prototype.hasOwnProperty.call(input, 'print') && input.print !== 'pretty') {
    input.print = 'pretty';
    changed = true;
  }
  // Ensure print is pretty when present in generated samples for HN firebase actions
  if (/get_(top|new|best|ask|show|job)_stories|get_updates|get_max_item|get_item$|get_user/.test(actionId)) {
    if (input.print !== 'pretty') {
      input.print = 'pretty';
      changed = true;
    }
  }
  if (actionId === 'hackernews.get_item') {
    if (!input.id || Number(input.id) <= 0) {
      input.id = storyId;
      changed = true;
    }
  }
  if (actionId === 'hackernews.get_item_with_id') {
    if (!input.item_id || input.item_id === '' || Number(input.item_id) <= 0) {
      input.item_id = storyId;
      changed = true;
    }
    if (input.max_depth == null) input.max_depth = 2;
    if (input.max_children == null) input.max_children = 10;
    if (input.truncate_text == null) input.truncate_text = true;
    changed = true;
  }
  if (actionId.includes('get_user') && !input.username) {
    input.username = 'pg';
    changed = true;
  }

  if (changed || !cfg.staticInputJson) {
    // For top stories empty {} is OK, but print:"" is not — prefer valid sample
    if (actionId === 'hackernews.get_top_stories' || actionId === 'hackernews.get_new_stories') {
      cfg.staticInputJson = JSON.stringify({ print: 'pretty' }, null, 2);
    } else {
      cfg.staticInputJson = JSON.stringify(input, null, 2);
    }
    n.data = { ...(n.data || {}), taskConfig: cfg };
    console.log('fixed node', n.id, actionId, cfg.staticInputJson);
    return true;
  }
  return false;
}

function fixGraph(g) {
  if (!g?.nodes) return { g, fixed: false };
  let fixed = false;
  for (const n of g.nodes) {
    if (fixNodeInput(n, storyId)) fixed = true;
  }
  return { g, fixed };
}

const draft = parse(row.draft_graph_json) || { nodes: [], edges: [] };
const published = parse(row.published_graph_json);
const d = fixGraph(draft);
const p = published ? fixGraph(published) : { g: null, fixed: false };

if (d.fixed || p.fixed) {
  db.prepare(
    `UPDATE agent_workflow_definitions
     SET draft_graph_json = ?, published_graph_json = COALESCE(?, published_graph_json), updated_at = datetime('now')
     WHERE id = ?`
  ).run(JSON.stringify(d.g), p.g ? JSON.stringify(p.g) : null, WF);
  console.log('workflow graphs updated');
} else {
  console.log('workflow already ok');
}

console.log('\n== run workflow ==');
const run = await startAgentWorkflowRun(WF, 'ceo-bala', {
  trigger: 'manual',
  actor: { id: 'ceo-bala', role: 'ceo', name: 'Balaji' },
});
const runId = run?.id || run;
console.log('run', runId);
for (let i = 0; i < 25; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const status = db.prepare(`SELECT status, error_message FROM agent_workflow_runs WHERE id = ?`).get(runId);
  console.log(status?.status, status?.error_message || '');
  if (status && !['running', 'pending', 'queued'].includes(status.status)) {
    const steps = db
      .prepare(
        `SELECT node_id, status, error_message, substr(cast(output_json as text),1,200) as outp
         FROM agent_workflow_run_steps WHERE run_id = ? ORDER BY id`
      )
      .all(runId);
    console.log(JSON.stringify(steps, null, 2));
    process.exit(status.status === 'completed' ? 0 : 1);
  }
}
process.exit(2);
