import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectorExecutionError, invokeConnectorTransport, readConnectorMessagePages, retryConnectorRead } from '../src/services/connector-execution-policy.js';

const quota = connectorExecutionError(403, { errorCode: 'authorization_failed', message: "Quota exceeded for quota metric 'Total Query Cost' and limit 'Units per minute per user'" });
assert.equal(quota.code, 'rate_limited');
assert.equal(quota.status, 429);
assert.equal(quota.provider_status, 403);
assert.equal(connectorExecutionError(403, { message: 'Insufficient Permission', errorCode: 'authorization_failed' }).code, 'authorization_failed');
assert.equal(connectorExecutionError(403, { message: 'Daily quota exceeded' }).code, 'quota_exceeded');
assert.equal(connectorExecutionError(401, { message: 'Invalid Credentials', errorCode: 'authorization_failed' }).status, 401);
assert.equal(connectorExecutionError(429, {}, '12').retry_after_ms, 12000);

let mcpCalls = 0;
for (const error of [quota, new Error('fetch failed'), connectorExecutionError(401, {}), connectorExecutionError(400, {}), connectorExecutionError(500, {}), connectorExecutionError(404, { errorCode: 'not_found', message: 'Message not found' })]) {
  await assert.rejects(invokeConnectorTransport(async () => { throw error; }, async () => { mcpCalls++; }), (out) => out === error);
}
assert.equal(mcpCalls, 0, 'provider failures must not replay through MCP');
assert.equal(await invokeConnectorTransport(async () => { throw connectorExecutionError(405, {}); }, async () => 'legacy'), 'legacy');

let attempts = 0;
const waits = [];
assert.equal(await retryConnectorRead(async () => { if (++attempts === 1) throw quota; return 'ok'; }, { readOnly: true, retryDelayMs: 10, sleep: async (ms) => waits.push(ms) }), 'ok');
assert.deepEqual(waits, [10]);
attempts = 0;
await assert.rejects(retryConnectorRead(async () => { attempts++; throw quota; }, { readOnly: true, sleep: async () => {} }), /Quota/);
assert.equal(attempts, 2, 'rate retries must be bounded');
attempts = 0;
await assert.rejects(retryConnectorRead(async () => { attempts++; throw quota; }, { readOnly: false }), /Quota/);
assert.equal(attempts, 1, 'never replay writes');
await assert.rejects(retryConnectorRead(async () => { throw connectorExecutionError(429, {}, '120'); }, { readOnly: true, sleep: async () => assert.fail('must honor longer provider cooldown') }));

const inputs = [];
const result = await readConnectorMessagePages({ query: 'scope', maxResults: 52, detail: 'full' }, async (input) => {
  inputs.push(input);
  const offset = Number(input.pageToken || 0);
  return { ok: true, data: { success: true, data: { messages: Array.from({ length: input.maxResults }, (_, i) => ({ messageId: `mail-${offset+i}` })), nextPageToken: String(offset + input.maxResults) } }, text: '' };
});
assert.deepEqual(inputs.map((x) => x.maxResults), [25,25,2]);
assert.deepEqual(inputs.map((x) => x.pageToken), [undefined,'25','50']);
assert.equal(result.data.data.messages.length, 52);
assert.equal(result.data.data.nextPageToken, '52');
assert.equal(JSON.parse(result.text).data.messages.length, 52);
assert.ok(inputs.every((x) => x.query === 'scope' && x.detail === 'full'));
await assert.rejects(readConnectorMessagePages({ maxResults: 0 }, async () => assert.fail()), /maxResults/);
await assert.rejects(readConnectorMessagePages({ maxResults: 50 }, async () => ({ data: { messages: [], nextPageToken: 'same' } })), /repeated/);
await assert.rejects(readConnectorMessagePages({}, async () => ({ ok: true, data: {} })), /messages page/);

// Exercise the real facade against a mocked HTTP gateway, in a disposable DB.
const dir = mkdtempSync(join(tmpdir(), 'flolah-connector-policy-'));
process.env.AGENT_OS_DATA_DIR = dir;
process.env.OPENCONNECTOR_URL = 'https://connector.invalid';
const originalFetch = globalThis.fetch;
let db;
try {
  db = (await import('../src/db/schema.js')).initDb();
  const { defaultExecutionBehaviour } = await import('../src/services/tool-execution-governor.js');
  const { getPlatformTimeoutMs, updatePlatformTimeouts } = await import('../src/services/platform-timeout-settings.js');
  assert.equal(defaultExecutionBehaviour('gmail_mailbox_review').timeout_ms, 300000);
  assert.equal(defaultExecutionBehaviour('connector_execute_action').timeout_ms, 300000);
  assert.equal(defaultExecutionBehaviour('ceo_profile').timeout_ms, 60000);
  updatePlatformTimeouts({ connector_operation: 240000 });
  assert.equal(defaultExecutionBehaviour('gmail_mailbox_review').timeout_ms, getPlatformTimeoutMs('connector_operation'));
  const { upsertOpenConnectorLink, executeConnectorAction } = await import('../src/services/openconnector.js');
  for (const owner of ['test-ceo-a', 'test-ceo-b']) {
    db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role) VALUES (?,?,'not-a-real-hash',?,'ceo')").run(owner, `${owner}@example.test`, owner);
    upsertOpenConnectorLink(owner, { runtime_token: `fixture-${owner}`, connection_name: `alias-${owner}` });
  }
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    const input = JSON.parse(options.body).input;
    return Response.json({ success: true, data: { messages: Array.from({ length: input.maxResults }, (_, i) => ({ messageId: `${input.pageToken || '0'}-${i}` })), nextPageToken: '25' } });
  };
  const paged = await executeConnectorAction('test-ceo-a', 'gmail.fetch_emails', { maxResults: 26, detail: 'ids' });
  assert.equal(paged.data.data.messages.length, 26);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => r.headers.Authorization === 'Bearer fixture-test-ceo-a' && r.headers['x-oo-connector-alias'] === 'alias-test-ceo-a'));
  await executeConnectorAction('test-ceo-b', 'gmail.fetch_emails', { maxResults: 1, detail: 'ids' });
  assert.equal(requests.at(-1).headers['x-oo-connector-alias'], 'alias-test-ceo-b');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM connector_read_budget').get().n, 2);
  requests.length = 0;
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ success: false, errorCode: 'authorization_failed', message: 'Quota exceeded per minute per user' }, { status: 403, headers: { 'Retry-After': '120' } });
  };
  await assert.rejects(executeConnectorAction('test-ceo-a', 'gmail.send_email', {}), (e) => e.code === 'rate_limited' && e.status === 429);
  assert.equal(requests.length, 1, 'no retry or MCP fallback on a rejected send');
  globalThis.fetch = async () => Response.json({ success: false, errorCode: 'authorization_failed', message: 'Invalid Credentials' }, { status: 401 });
  await assert.rejects(executeConnectorAction('test-ceo-a', 'gmail.get_message', {}, { authorizationRetryDelaysMs: [] }), (e) => e.status === 401 && e.code === 'authorization_failed');
  globalThis.fetch = async () => Response.json({ success: false, errorCode: 'invalid_input', message: 'Missing recipient' });
  await assert.rejects(executeConnectorAction('test-ceo-a', 'gmail.send_email', {}), /Missing recipient/);
  console.log('CONNECTOR_EXECUTION_POLICY_OK: error fidelity, bounded read retries, write safety, pagination, owner-scoped pacing');
} finally {
  globalThis.fetch = originalFetch;
  db?.close();
  rmSync(dir, { recursive: true, force: true });
}
