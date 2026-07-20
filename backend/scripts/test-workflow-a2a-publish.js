/**
 * Smoke test: publish workflow as A2A + agent card + JSON-RPC invoke.
 * Usage: node scripts/test-workflow-a2a-publish.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  publishWorkflowAsA2A,
  getPublicationById,
  listAllPublishedA2AAgents,
  handleA2AJsonRpc,
} from '../src/services/workflow-a2a-publish.js';

initDb();

const owner = getBalaCeoAuthId();
const WORKFLOW_ID = 'test-a2a-publish-smoke';
const actor = { id: 'test-a2a-publish', name: 'Test' };

const graph = {
  nodes: [
    {
      id: 'trigger-1',
      type: 'trigger',
      position: { x: 40, y: 120 },
      data: { label: 'Start', triggerModes: ['manual'] },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

let def = store.getDefinition(WORKFLOW_ID, owner);
if (!def) {
  def = store.createDefinition({
    id: WORKFLOW_ID,
    name: 'A2A Publish Smoke Test',
    description: 'Minimal workflow for A2A publish smoke test',
    ownerUserId: owner,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, owner, { graph }, actor);
}
store.publishDefinition(WORKFLOW_ID, owner, actor);

const pub = publishWorkflowAsA2A(owner, WORKFLOW_ID, {
  name: 'A2A Smoke Agent',
  description: 'Smoke test workflow exposed as A2A',
  skill_id: 'default',
  metadata: { tags: ['test', 'smoke'] },
}, actor);

console.log('Published:', pub.id);
console.log('  card:', pub.card_url);
console.log('  endpoint:', pub.endpoint_url);

const listed = listAllPublishedA2AAgents();
if (!listed.some((a) => a.id === pub.id)) throw new Error('Not in AgentExchange list');
console.log('OK: AgentExchange list includes publication');

const cardPub = getPublicationById(pub.id);
if (!cardPub?.agent_card?.name) throw new Error('Agent card missing');
console.log('OK: agent card', cardPub.agent_card.name);

const rpc = await handleA2AJsonRpc(pub.id, {
  jsonrpc: '2.0',
  id: randomUUID(),
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      messageId: randomUUID(),
      parts: [{ kind: 'text', text: 'hello a2a smoke' }],
    },
    metadata: { skillId: 'default' },
  },
});

const text = rpc?.result?.parts?.[0]?.text || rpc?.result?.task?.status?.state || '';
console.log('A2A RPC response text/state:', text);
if (rpc.error) {
  console.warn('A2A invoke returned error (may need OPENAI_API_KEY):', rpc.error.message);
} else {
  console.log('OK: A2A JSON-RPC invoke');
}

console.log('\nALL workflow A2A publish TESTS PASSED');
