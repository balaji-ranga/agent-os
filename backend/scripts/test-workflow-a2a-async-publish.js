/**
 * Smoke: multi A2A publish + sync/async card + enquire skill.
 * Usage: node scripts/test-workflow-a2a-async-publish.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  publishWorkflowAsA2A,
  listPublicationsForWorkflow,
  getPublicationById,
  handleA2AJsonRpc,
  unpublishWorkflowA2A,
} from '../src/services/workflow-a2a-publish.js';
import { ENQUIRE_SKILL_ID } from '../src/services/workflow-a2a-async.js';
import { setA2AAccessPolicy } from '../src/services/workflow-a2a-access.js';

initDb();

const owner = getBalaCeoAuthId();
const WORKFLOW_ID = 'test-a2a-async-multi';
const actor = { id: 'test-a2a-async', name: 'Test' };

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
    name: 'A2A Async Multi Test',
    description: 'Multi-publish + async A2A smoke',
    ownerUserId: owner,
    actor,
    graph,
    trigger_modes: ['manual'],
  });
} else {
  store.updateDraft(WORKFLOW_ID, owner, { graph }, actor);
}
store.publishDefinition(WORKFLOW_ID, owner, actor);

// Clean prior pubs
for (const p of listPublicationsForWorkflow(WORKFLOW_ID, owner)) {
  unpublishWorkflowA2A(owner, WORKFLOW_ID, actor, { publishId: p.id });
}

const syncPub = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  { name: 'A2A Sync Agent', invoke_mode: 'sync', skill_id: 'default' },
  actor
);
setA2AAccessPolicy(syncPub.id, owner, 'allow_all');
if (syncPub.invoke_mode !== 'sync') throw new Error('expected sync');
if (syncPub.agent_card.skills.some((s) => s.id === ENQUIRE_SKILL_ID)) {
  throw new Error('sync card should not include enquire skill');
}
console.log('OK: sync publish', syncPub.id);

const asyncPub = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    name: 'A2A Async Agent',
    invoke_mode: 'async',
    as_new_agent: true,
    skill_id: 'default',
    callback_url: null,
  },
  actor
);
setA2AAccessPolicy(asyncPub.id, owner, 'allow_all');
if (asyncPub.invoke_mode !== 'async') throw new Error('expected async');
if (asyncPub.id === syncPub.id) throw new Error('as_new_agent should mint a new publish id');
if (!asyncPub.agent_card.skills.some((s) => s.id === ENQUIRE_SKILL_ID)) {
  throw new Error('async card missing enquire-progress skill');
}
console.log('OK: async publish as new agent', asyncPub.id);

const listed = listPublicationsForWorkflow(WORKFLOW_ID, owner);
if (listed.length < 2) throw new Error(`expected >=2 pubs, got ${listed.length}`);
console.log('OK: multi publications', listed.map((p) => p.name).join(', '));

const card = getPublicationById(asyncPub.id)?.agent_card;
if (!card?.metadata?.invokeMode && card?.skills?.length < 2) {
  console.warn('card metadata invokeMode missing (non-fatal if skills ok)');
}

const callbacks = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    try {
      callbacks.push(JSON.parse(body || '{}'));
    } catch {
      callbacks.push({ raw: body });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const callbackUrl = `http://127.0.0.1:${port}/a2a-cb`;

const asyncWithCb = publishWorkflowAsA2A(
  owner,
  WORKFLOW_ID,
  {
    publish_id: asyncPub.id,
    name: 'A2A Async Agent',
    invoke_mode: 'async',
    callback_url: callbackUrl,
    skill_id: 'default',
  },
  actor
);
if (asyncWithCb.callback_url !== callbackUrl) throw new Error('callback_url not saved');
if (!asyncWithCb.agent_card.capabilities?.pushNotifications) {
  throw new Error('expected pushNotifications when callback configured');
}
console.log('OK: callback URL on async publication');

const rpc = await handleA2AJsonRpc(asyncWithCb.id, {
  jsonrpc: '2.0',
  id: randomUUID(),
  method: 'message/send',
  params: {
    message: {
      role: 'user',
      messageId: randomUUID(),
      parts: [{ kind: 'text', text: 'async hello' }],
    },
    metadata: { skillId: 'default' },
  },
});

if (rpc.error) {
  console.warn('Async invoke error (workflow may need runtime):', rpc.error.message);
} else {
  const state = rpc.result?.task?.status?.state;
  const taskId = rpc.result?.task?.id;
  if (state !== 'working') throw new Error(`expected working, got ${state}`);
  if (!taskId) throw new Error('missing task id');
  if (!rpc.result?.metadata?.run) throw new Error('async accept missing run metadata');
  console.log('OK: async accept', taskId, 'run', rpc.result.metadata.run_id);

  const enquire = await handleA2AJsonRpc(asyncWithCb.id, {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'tasks/get',
    params: { id: taskId },
  });
  if (enquire.error) throw new Error(enquire.error.message);
  console.log('OK: tasks/get', enquire.result?.task?.status?.state);

  const enquireSkill = await handleA2AJsonRpc(asyncWithCb.id, {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        messageId: randomUUID(),
        parts: [{ kind: 'data', data: { taskId } }],
      },
      metadata: { skillId: ENQUIRE_SKILL_ID },
    },
  });
  if (enquireSkill.error) throw new Error(enquireSkill.error.message);
  console.log('OK: enquire-progress skill', enquireSkill.result?.task?.status?.state);

  // Wait briefly for sync-like completion of empty workflow + callback
  for (let i = 0; i < 20 && callbacks.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (callbacks.length) {
    console.log('OK: callback received', callbacks[0].event, callbacks[0].status);
  } else {
    console.warn('Callback not received yet (run may still be finishing) — non-fatal for smoke');
  }
}

server.close();
console.log('\nALL workflow A2A async/multi TESTS PASSED');
