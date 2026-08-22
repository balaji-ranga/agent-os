/**
 * Workflow Builder create + inline edit (GitHub connector).
 *
 * Default: local apply-path (alias lookup → add_node). No LLM.
 * Live chat (VPS): WF_BUILDER_LIVE_CHAT=1 node scripts/test-workflow-builder-create-edit.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  applyWorkflowBuilderActions,
  canonicalizeBuilderActionName,
  buildEditFallbackActions,
} from '../src/services/agent-workflow-builder.js';
import { runWorkflowBuilderChat } from '../src/services/agent-workflow-agent.js';
import { isWorkflowEditIntent } from '../src/services/agent-workflow-recipes.js';
import { deleteDefinitionWithCleanup } from '../src/services/agent-workflow-run-manager.js';

initDb();
seedWorkflowBuilderAgent();

const owner = getBalaCeoAuthId();
const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };
const stamp = Date.now().toString(36);
const created = [];
let failed = 0;

function assert(cond, msg) {
  if (cond) console.log(`  OK: ${msg}`);
  else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

function remember(id) {
  if (id) created.push(id);
  return id;
}

function typesOf(id) {
  const def = store.getDefinition(id, owner);
  return (def?.draft_graph?.nodes || []).map((n) => n.type);
}

console.log('=== Workflow Builder create + edit ===');
console.log('Owner:', owner);

assert(
  canonicalizeBuilderActionName('connectorsearchactions') === 'search_connectors',
  'alias connectorsearchactions'
);
assert(
  canonicalizeBuilderActionName('connector_list_apps') === 'list_connectors',
  'alias connector_list_apps'
);
assert(
  isWorkflowEditIntent('Add a GitHub connector to this workflow', { workflowOpen: true }),
  'edit intent'
);

const createdRes = await applyWorkflowBuilderActions(
  owner,
  null,
  [
    {
      action: 'create_workflow',
      name: `CreateEdit Probe ${stamp}`,
      trigger_modes: ['manual', 'chat'],
      graph: {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger',
            position: { x: 80, y: 180 },
            data: { label: 'Start', taskConfig: { triggerModes: ['manual', 'chat'] } },
          },
        ],
        edges: [],
      },
    },
  ],
  actor
);
const wfId = remember(createdRes.workflow_id);
assert(!!wfId, `created workflow ${wfId || 'none'}`);

const mapped = await applyWorkflowBuilderActions(
  owner,
  wfId,
  [
    { action: 'connectorsearchactions', query: 'github' },
    { action: 'connectorsearchactions', query: 'github' },
    { action: 'connectorlistapps' },
  ],
  actor,
  { message: 'Add a GitHub connector to this workflow' }
);
assert(
  mapped.results.every((r) => !/Unknown action/i.test(String(r.error || ''))),
  `lookups mapped (${mapped.results.map((r) => r.action).join(',')})`
);
assert(
  mapped.results.some((r) => r.action === 'search_connectors'),
  'search_connectors ran'
);

const fallback = buildEditFallbackActions(
  'Add a GitHub connector to this workflow',
  store.getDefinition(wfId, owner),
  mapped.results
);
assert(fallback[0]?.node_type === 'connector', 'fallback connector node');
await applyWorkflowBuilderActions(owner, wfId, fallback, actor, {
  message: 'Add a GitHub connector to this workflow',
});
assert(typesOf(wfId).includes('connector'), `apply-path graph types=${typesOf(wfId).join(',')}`);

if (process.env.WF_BUILDER_LIVE_CHAT === '1') {
  console.log('\n— Live chat create + edit');
  const liveName = `CreateEdit Live ${stamp}`;
  const createdChat = await runWorkflowBuilderChat({
    ownerUserId: owner,
    workflowId: null,
    message: `Create a draft workflow called ${liveName} that summarizes the run input. Do not publish or test yet.`,
    history: [],
    actor,
    persist: false,
  });
  const liveId = remember(createdChat.workflow_id);
  assert(!!liveId, `live create workflow_id=${liveId || 'none'}`);
  assert(
    !(createdChat.actions_applied || []).some((a) => /Unknown action/i.test(String(a.error || ''))),
    `live create has no unknown actions (${(createdChat.actions_applied || []).map((a) => a.action).join(',')})`
  );

  const edited = await runWorkflowBuilderChat({
    ownerUserId: owner,
    workflowId: liveId,
    message: 'Add a GitHub connector to this workflow',
    history: [],
    actor,
    persist: false,
  });
  const unknown = (edited.actions_applied || []).filter((a) => /Unknown action/i.test(String(a.error || '')));
  assert(!unknown.length, `live edit unknown=${unknown.map((a) => a.action).join(',') || 'none'}`);
  assert(
    (edited.actions_applied || []).some((a) => a.action === 'add_node' && a.ok) ||
      typesOf(liveId).includes('connector'),
    `live edit added a node types=${typesOf(liveId).join(',')} applied=${(edited.actions_applied || []).map((a) => a.action).join(',')}`
  );
}

for (const id of created) {
  try {
    deleteDefinitionWithCleanup(id, owner);
  } catch (e) {
    console.warn('cleanup skip', id, e?.message || e);
  }
}

if (failed) {
  console.error(`WF_CREATE_EDIT_FAIL ${failed}`);
  process.exit(1);
}
console.log('WF_CREATE_EDIT_OK');
