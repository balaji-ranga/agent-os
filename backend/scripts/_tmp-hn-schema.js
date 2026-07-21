import { initDb, getDb } from '../src/db/schema.js';
import {
  exampleInputFromSchema,
  executeConnectorAction,
  getConnectorActionGuide,
  listConnectorActions,
} from '../src/services/openconnector.js';
import { startAgentWorkflowRun } from '../src/services/agent-workflow-runner.js';

initDb();
const db = getDb();

const actions = await listConnectorActions('ceo-bala', 'hackernews');
const hits = (actions.actions || []).filter((a) =>
  /stor|id|item|latest/i.test(`${a.id} ${a.description || ''}`)
);
console.log(
  'hn actions sample',
  hits.slice(0, 20).map((a) => ({ id: a.id, desc: a.description, required: a.input_schema?.required }))
);

const candidates = (actions.actions || []).filter((a) => {
  const s = a.input_schema;
  return s?.properties?.print || /get_.*stor|item|by.?id/i.test(a.id);
});
console.log(
  'with print or get',
  candidates.map((a) => a.id)
);

for (const id of [
  'hackernews.get_item',
  'hackernews.get_story',
  'hackernews.get_stories',
  'hackernews.get_latest_stories',
  'hackernews.get_top_stories',
  ...candidates.map((a) => a.id),
]) {
  const a = (actions.actions || []).find((x) => x.id === id);
  if (!a) continue;
  console.log('\n===', a.id);
  console.log('schema', JSON.stringify(a.input_schema, null, 2));
  console.log('current example', JSON.stringify(a.example_input));
  console.log('fixed example', JSON.stringify(exampleInputFromSchema(a.input_schema || {})));
}

// Find print:const in any hn action
for (const a of actions.actions || []) {
  const print = a.input_schema?.properties?.print;
  if (print) {
    console.log('\nPRINT FIELD', a.id, JSON.stringify(print));
    const guide = await getConnectorActionGuide('ceo-bala', a.id);
    console.log('guide example', JSON.stringify(guide.example_input));
  }
}
