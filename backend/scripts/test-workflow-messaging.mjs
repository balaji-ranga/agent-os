import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import http from 'http';

const dataDir = mkdtempSync(join(tmpdir(), 'flolah-messaging-'));
process.env.AGENT_OS_DATA_DIR = dataDir;
process.env.MESSAGING_SERVICE_TOKEN = 'local-harness-token';
const calls = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    assert.equal(req.headers.authorization, 'Bearer local-harness-token');
    calls.push({ url: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, messageId: 'msg-harness-1' }));
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
process.env.MESSAGING_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;

try {
  const { initDb, getDb } = await import('../src/db/schema.js');
  const messaging = await import('../src/services/workflow-messaging.js');
  const store = await import('../src/services/agent-workflow-store.js');
  const { startAgentWorkflowRun } = await import('../src/services/agent-workflow-runner.js');
  const db = initDb();
  messaging.ensureWorkflowMessagingSchema();
  for (const id of ['owner-a', 'owner-b']) {
    db.prepare(`INSERT INTO platform_users (id,email,password_hash,name,role,enabled) VALUES (?,?,?,?,?,1)`).run(id, `${id}@example.test`, 'not-used', id, 'ceo');
  }
  db.prepare(`INSERT INTO user_api_keys (id,owner_user_id,key_name,secret_value,is_encrypted,key_hint) VALUES (?,?,?,?,0,?)`).run('key-a', 'owner-a', 'broker-password', 'vault-secret-value', 'configured');

  assert.throws(() => messaging.saveMessagingConnection('owner-a', { name: 'bad', protocol: 'mqtt', endpoint: 'mqtt://user:pass@broker.test' }), /inline credentials/);
  const connection = messaging.saveMessagingConnection('owner-a', { name: 'Harness broker', protocol: 'mock', endpoint: 'mock://local', vault_refs: { passwordRef: 'broker-password' } });
  assert.equal(messaging.getMessagingConnection('owner-b', connection.id), null, 'connection is tenant scoped');
  assert(!JSON.stringify(connection).includes('vault-secret-value'), 'public connection does not reveal secret');
  assert.equal(messaging.resolveMessagingConnection('owner-a', connection.id).credentials.password, 'vault-secret-value');

  const trigger = { id: 'trigger-1', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Trigger', triggerModes: ['manual'] } };
  const send = { id: 'send-1', type: 'message_send', position: { x: 220, y: 0 }, data: { label: 'Send Message', taskConfig: { connectionId: connection.id, destination: 'events.out', destinationType: 'topic' }, inputBindings: [{ id: 'payload', label: 'Message payload', mode: 'dynamic', sourceNodeId: 'trigger-1', sourceOutputKey: 'trigger_input' }] } };
  store.createDefinition({ id: 'wf-send', name: 'Send harness', ownerUserId: 'owner-a', actor: { id: 'owner-a' }, trigger_modes: ['manual'], graph: { nodes: [trigger, send], edges: [{ id: 'e1', source: 'trigger-1', target: 'send-1' }] } });
  store.publishDefinition('wf-send', 'owner-a', { id: 'owner-a' });
  const started = await startAgentWorkflowRun('wf-send', 'owner-a', { input: { hello: 'world' }, actor: { id: 'owner-a' } });
  for (let i = 0; i < 40; i += 1) { const row = store.getRun(started.id, 'owner-a'); if (row.status !== 'running') break; await new Promise((r) => setTimeout(r, 25)); }
  const finished = store.getRun(started.id, 'owner-a');
  assert.equal(finished.status, 'completed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/v1/publish');
  assert.equal(calls[0].body.connection.credentials.password, 'vault-secret-value');
  assert.equal(calls[0].body.destination, 'events.out');

  const messageTrigger = { id: 'trigger-message', type: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Message Trigger', triggerModes: ['message'], messageConnectionId: connection.id, messageDestination: 'events.in', messageDestinationType: 'topic', messageConsumerGroup: 'harness' } };
  store.createDefinition({ id: 'wf-receive', name: 'Receive harness', ownerUserId: 'owner-a', actor: { id: 'owner-a' }, trigger_modes: ['message'], graph: { nodes: [messageTrigger], edges: [] } });
  store.publishDefinition('wf-receive', 'owner-a', { id: 'owner-a' });
  const subscriptions = messaging.listResolvedMessageSubscriptions();
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].credentials.password, 'vault-secret-value');
  const delivered = await messaging.deliverWorkflowMessage({ subscriptionId: subscriptions[0].id, envelope: { messageId: 'fixed-id', payload: { order: 7 } } });
  assert.equal(delivered.ok, true);
  const duplicate = await messaging.deliverWorkflowMessage({ subscriptionId: subscriptions[0].id, envelope: { messageId: 'fixed-id', payload: { order: 7 } } });
  assert.equal(duplicate.duplicate, true);
  const run = getDb().prepare(`SELECT * FROM agent_workflow_runs WHERE id=?`).get(delivered.runId);
  assert.equal(run.trigger, 'message');
  assert(JSON.parse(run.context_json).initial_input.payload.order === 7);

  console.log(JSON.stringify({ ok: true, cases: ['vault-reference-only', 'tenant-isolation', 'send-node', 'message-trigger', 'deduplication'], sendRun: started.id, receiveRun: delivered.runId }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
  try { const { getDb } = await import('../src/db/schema.js'); getDb().close(); } catch { /* test cleanup */ }
  rmSync(dataDir, { recursive: true, force: true });
}
