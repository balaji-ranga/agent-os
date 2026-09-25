import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/adapters.js';

test('mock adapter publishes normalized messages to a subscribed destination', async () => {
  process.env.NODE_ENV = 'test';
  const connection = { protocol: 'mock', endpoint: 'mock://local', config: {}, credentials: {} };
  const adapter = await createAdapter(connection);
  let received;
  const close = await adapter.subscribe({ id: 's1', destination: 'orders' }, async (message) => { received = message; });
  const receipt = await adapter.publish({ destination: 'orders', payload: { id: 42 }, headers: { source: 'test' } });
  assert.equal(received.destination, 'orders');
  assert.deepEqual(received.payload, { id: 42 });
  assert.equal(received.headers.source, 'test');
  assert.equal(received.messageId, receipt.messageId);
  await close();
});

test('private broker endpoints are denied unless explicitly enabled', async () => {
  delete process.env.MESSAGING_ALLOW_PRIVATE_BROKERS;
  await assert.rejects(() => createAdapter({ protocol: 'mqtt', endpoint: 'mqtt://127.0.0.1:1883', config: {}, credentials: {} }), /Private broker endpoints/);
});
