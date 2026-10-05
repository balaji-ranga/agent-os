import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireBridgeRuntimeLock, IBKRNewBridgeCore } from '../src/core.js';
import { IBKRNewGateway } from '../src/gateway.js';

const roots = [];
const make = (fetchImpl, spoolDir = null) => {
  const dir = spoolDir || mkdtempSync(join(tmpdir(), 'ibkrnew-delivery-'));
  if (!spoolDir) roots.push(dir);
  return new IBKRNewBridgeCore({ apiUrl: 'https://example.test', bridgeId: 'bridge-test', token: 'test', spoolDir: dir, fetchImpl });
};
const accepted = () => ({ ok: true, json: async () => ({ accepted: true, status: 'accepted' }) });
try {
  // The actual production race: a broker callback appends while upload awaits.
  const received = [];
  let concurrent;
  concurrent = make(async (_url, request) => {
    const event = JSON.parse(request.body); received.push(event);
    if (event.sequence === 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent.emit('execution.fill', { execution_id: 'fill-while-uploading' });
    }
    return accepted();
  });
  concurrent.emit('bridge.heartbeat', {});
  await Promise.all([concurrent.flush(), concurrent.flush()]);
  assert.deepEqual(received.map((event) => event.sequence), [1, 2]);
  assert.equal(received[1].payload.execution_id, 'fill-while-uploading');
  assert.equal(concurrent.spoolDepth(), 0);

  // A lost acknowledgement survives process restart and replays the same id.
  const ambiguous = make(async () => { throw new Error('connection lost after server commit'); });
  const original = ambiguous.emit('commission.report', { execution_id: 'commission-once' });
  await assert.rejects(() => ambiguous.flush(), /connection lost/);
  assert.ok(existsSync(ambiguous.batchPath));
  const restarted = make(async (_url, request) => {
    assert.equal(JSON.parse(request.body).event_id, original.event_id);
    return accepted();
  }, ambiguous.spoolDir);
  await restarted.flush();
  assert.equal(restarted.spoolDepth(), 0);

  // HTTP 202 quarantined is not an acknowledgement. Preserve broker events,
  // archive the original queue, rebase only unaccepted ids and retry in order.
  const rejected = make(async () => ({ ok: true, status: 202, json: async () => ({ accepted: false, status: 'quarantined', reason: 'sequence_gap_expected_1' }) }));
  rejected.sequence = 1;
  const fill = rejected.emit('execution.fill', { execution_id: 'recover-me' });
  await assert.rejects(() => rejected.flush(), (error) => error.code === 'IBKRNEW_SEQUENCE_GAP');
  assert.equal(rejected.spoolDepth(), 1);
  rejected.emit('commission.report', { execution_id: 'recover-me', commission_usd: 1 });
  const recovery = rejected.synchronizeSequence(0);
  assert.ok(existsSync(recovery.archived_spool));
  const replay = rejected.pendingLines().map(JSON.parse);
  assert.deepEqual(replay.map((event) => event.sequence), [1, 2]);
  assert.equal(replay[0].event_id, fill.event_id);
  assert.equal(replay[0].payload.execution_id, 'recover-me');
  rejected.fetch = async () => accepted();
  await rejected.flush();
  assert.equal(rejected.spoolDepth(), 0);

  // Cursor accepted on server but ack lost: drop committed prefix on bootstrap.
  const committed = make(async () => accepted());
  committed.emit('execution.fill', {}); committed.emit('commission.report', {});
  committed.synchronizeSequence(1);
  assert.deepEqual(committed.pendingLines().map((line) => JSON.parse(line).sequence), [2]);
  assert.equal(committed.sequence, 2);

  // Invalid success receipt and hard failures cannot silently discard events.
  const invalid = make(async () => ({ ok: true, json: async () => ({}) }));
  invalid.emit('account.snapshot', {});
  await assert.rejects(() => invalid.flush(), /invalid receipt/);
  assert.equal(invalid.spoolDepth(), 1);

  // One runtime owns a spool, including a manually started foreground process.
  const release = acquireBridgeRuntimeLock(invalid.spoolDir);
  assert.throws(() => acquireBridgeRuntimeLock(invalid.spoolDir), /already owns/);
  release();
  const releaseAgain = acquireBridgeRuntimeLock(invalid.spoolDir); releaseAgain();

  // Crash between recovery spool replacement and batch deletion may duplicate
  // local rows. Their stable event ids must be deduplicated before replay.
  const duplicate = make(async () => accepted());
  const event = duplicate.emit('order.status_changed', {});
  writeFileSync(duplicate.batchPath, `${JSON.stringify(event)}\n`);
  duplicate.synchronizeSequence(0);
  assert.equal(duplicate.spoolDepth(), 1);
  assert.equal(JSON.parse(readFileSync(duplicate.spoolPath, 'utf8')).event_id, event.event_id);
  const execution = make(async () => accepted());
  execution.bootstrap = async () => ({ environment: 'paper', account_ref: 'account-test', execution_mode: { requested_mode: 'paper', execution_enabled: true }, goal: { opening_trades_allowed: true, cycle: { cycle_id: 'cycle-test' } } });
  const command = { command_id: 'command-test', authorization: { environment: 'paper', account_ref: 'account-test', goal: { cycle_id: 'cycle-test' } } };
  let submitted = 0;
  const acknowledgements = [];
  execution.acknowledge = async (_id, status) => { acknowledgements.push(status); if (acknowledgements.length === 1) throw new Error('ack unavailable'); return { ok: true }; };
  await assert.rejects(() => execution.executeCommand(command, { placeProtected: async () => { submitted += 1; return { entry_order_id: 1 }; } }), /ack unavailable/);
  assert.equal(execution.commandSeen(command.command_id).status, 'submitted');
  await execution.executeCommand(command, { placeProtected: async () => { submitted += 1; } });
  assert.equal(submitted, 1); assert.deepEqual(acknowledgements, ['submitted', 'submitted']);

  const retryCalls = [];
  const retry = make(async (url, request) => { retryCalls.push({ url, body: JSON.parse(request.body) }); return { ok: true, json: async () => ({ ok: true, status: JSON.parse(request.body).status }) }; });
  retry.markCommand('expired-submitted', 'submitted', { entry_order_id: 123 });
  retry.markCommand('crashed-executing', 'executing');
  const restartedRetry = new IBKRNewBridgeCore({ apiUrl: retry.apiUrl, bridgeId: retry.bridgeId, token: retry.token, spoolDir: retry.spoolDir, fetchImpl: retry.fetch });
  await restartedRetry.retryAcknowledgements();
  assert.deepEqual(retryCalls.map(c => c.body.status), ['submitted','uncertain']);
  assert.equal(retryCalls.every(c => c.url.endsWith('/ack')), true, 'persisted outcomes are acknowledged without claiming or resubmitting expired orders');
  await restartedRetry.retryAcknowledgements();
  assert.equal(retryCalls.length, 2, 'acknowledged outcomes are not repeated');

  const broker = Object.create(IBKRNewGateway.prototype);
  broker.config = { environment: 'paper', executionEnabled: true }; broker.connected = true;
  broker.accountAttestation = { status: 'verified', execution_ready: true };
  broker.nextOrderId = 1; broker.orderMap = new Map();
  broker.snapshotQuote = async () => ({ ask: 100, bid: 100, last: 100 });
  let brokerCalls = 0;
  broker.ib = { placeOrder: () => { brokerCalls += 1; if (brokerCalls === 2) throw new Error('transport broke after parent'); } };
  const partialCommand = { authorization: { environment: 'paper', authorization_id: 'auth-test', expires_at: new Date(Date.now() + 60000).toISOString(), side: 'BUY', quantity: 1, contract: { symbol: 'TEST' }, entry: { order_type: 'LIMIT', limit_price: 100 }, protection: { stop_price: 95, targets: [{ limit_price: 110 }] } } };
  await assert.rejects(() => broker.placeProtected(partialCommand), (error) => error.submission_uncertain === true);
  execution.acknowledge = async (_id, status) => { assert.equal(status, 'uncertain'); return { ok: true }; };
  await execution.executeCommand({ ...command, command_id: 'uncertain-command' }, { placeProtected: async () => { throw Object.assign(new Error('partial submission'), { submission_uncertain: true }); } });
  assert.equal(execution.commandSeen('uncertain-command').status, 'uncertain');
  broker.snapshotQuote = async () => { broker.connected = false; broker.accountAttestation.execution_ready = false; return { ask: 100 }; };
  await assert.rejects(() => broker.placeProtected(partialCommand), /GATEWAY_RECONCILIATION_CHANGED/);
  assert.equal(brokerCalls, 2, 'a disconnect while awaiting the local quote cannot submit any new order');
  console.log('IBKRNew delivery race, crash, quarantine, recovery and singleton tests passed');
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
}
