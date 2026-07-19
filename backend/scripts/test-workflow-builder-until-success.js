/**
 * Focused until_success + entitlement smoke (no LLM chat).
 * Usage: node scripts/test-workflow-builder-until-success.js
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
import { applyWorkflowBuilderActions } from '../src/services/agent-workflow-builder.js';
import { diagnoseWorkflowGraph } from '../src/services/agent-workflow-agent-troubleshoot.js';
import {
  parseUntilSuccessIntent,
  executeUntilSuccess,
  runMeetsSuccessCriteria,
} from '../src/services/agent-workflow-agent-until-success.js';
import { listWorkflowsForAgent } from '../src/services/agent-workflow-chat-tools.js';
import { bodyWithoutSpoofedOwner } from '../src/services/tool-owner-scope.js';
import { getDb } from '../src/db/schema.js';

initDb();
seedWorkflowBuilderAgent();

const owner = getBalaCeoAuthId();
const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };
const stamp = Date.now().toString(36);
let failed = 0;
function assert(c, m) {
  if (c) console.log(`  OK: ${m}`);
  else {
    failed++;
    console.error(`  FAIL: ${m}`);
  }
}

console.log('=== until_success smoke ===');

assert(!!parseUntilSuccessIntent('keep iterating until it works'), 'intent parse');
assert(runMeetsSuccessCriteria({ status: 'completed', steps: [] }), 'success criteria');

const grants = getDb()
  .prepare('SELECT tool_name FROM agent_tool_grants WHERE agent_id = ?')
  .all('workflowbuilder')
  .map((r) => r.tool_name);
assert(grants.includes('agent_workflow_mutate'), 'mutate grant');
assert(grants.includes('agent_workflow_list'), 'list grant');
assert(grants.includes('agent_workflow_trigger'), 'trigger grant');

const spoof = bodyWithoutSpoofedOwner({ ceo_user_id: 'attacker', owner_user_id: 'x', query: 'all' });
assert(!('ceo_user_id' in spoof) && !('owner_user_id' in spoof), 'spoofed owner fields stripped');

const create = await applyWorkflowBuilderActions(
  owner,
  null,
  [
    {
      action: 'create_workflow',
      name: `Until Smoke ${stamp}`,
      trigger_modes: ['manual'],
      graph: {
        nodes: [
          {
            id: 'trigger-1',
            type: 'trigger',
            position: { x: 0, y: 0 },
            data: { label: 'Start', triggerModes: ['manual'], outputs: [{ id: 'trigger_input', label: 'in' }] },
          },
          {
            id: 'orphan-1',
            type: 'api',
            position: { x: 200, y: 0 },
            data: {
              label: 'Orphan',
              inputBindings: [{ id: 'url', mode: 'static', value: 'https://example.com' }],
              taskConfig: { method: 'GET', authType: 'none', timeoutMs: 5000, timeoutAction: 'fail' },
              outputs: [{ id: 'ok', label: 'ok' }],
            },
          },
        ],
        edges: [],
      },
    },
  ],
  actor
);
const id = create.workflow_id;
assert(diagnoseWorkflowGraph(store.getDefinition(id, owner)).issues.some((i) => i.code === 'orphan_node'), 'orphan');

const outcome = await executeUntilSuccess({
  ownerUserId: owner,
  workflowId: id,
  actor,
  input: 'smoke',
  successCriteria: 'completed',
  maxAttempts: 1,
  timeoutMs: 15000,
});
assert(outcome.attempts?.length > 0, 'attempts');
const def = store.getDefinition(id, owner);
assert(
  (def.draft_graph?.edges || def.published_graph?.edges || []).some(
    (e) => e.source === 'trigger-1' && e.target === 'orphan-1'
  ),
  'healed edge'
);
assert(def.status === 'published', 'published');
assert(!listWorkflowsForAgent('not-the-owner', { includeDrafts: true }).some((w) => w.id === id), 'owner scoped');

await applyWorkflowBuilderActions(owner, id, [{ action: 'delete_workflow', workflow_id: id }], actor);

console.log(failed ? `\nFAIL ${failed}` : '\nPASS');
process.exit(failed ? 1 : 0);
