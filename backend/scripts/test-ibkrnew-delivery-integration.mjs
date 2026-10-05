import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'ibkrnew-delivery-integration-'));
process.env.AGENT_OS_DATA_DIR = join(root, 'database');
const { initDb, getDb } = await import('../src/db/schema.js'); initDb();
const service = await import('../src/services/ibkrnew-event-trader.js');
const { IBKRNewBridgeCore } = await import('../ibkrnew-event-bridge/src/core.js');
const owner = 'IBKRNewDeliveryIntegrationOwner';
const credentials = service.registerBridge(owner);
const bridge = service.authenticateBridge(credentials.bridge_id, credentials.token);
const ids = [];
let core;
let inject = true;
try {
  core = new IBKRNewBridgeCore({ apiUrl: 'https://test.invalid', bridgeId: credentials.bridge_id, token: credentials.token, spoolDir: join(root, 'spool'), fetchImpl: async (_url, request) => {
    const event = JSON.parse(request.body);
    ids.push(event.event_id);
    // Inject broker callbacks while a real server receipt is in flight.
    if (inject) {
      inject = false;
      await new Promise((resolve) => setTimeout(resolve, 10));
      core.emit('account.snapshot', { cash_usd: 8000, eligible_capital_usd: 8000, positions: [], open_orders: [] });
    }
    const receipt = service.ingestBridgeEvent(bridge, event);
    return { ok: true, status: 202, json: async () => receipt };
  } });
  core.emit('bridge.heartbeat', { gateway_connected: true, account_attestation: { environment: 'paper', status: 'verified', execution_ready: true }, components: [{ component_id: 'IBKRNewDurableSpool', component_type: 'event_spool', status: 'online' }] });
  await core.flush();
  assert.equal(core.sequence, 2); assert.equal(core.spoolDepth(), 0);
  assert.equal(service.getDashboard(owner).account.cash_usd, 8000);
  assert.equal(service.getIbkrNewExecutionMode(owner).active_mode, 'paper');

  // Reproduce the production gap; real 202 rejection must halt delivery.
  core.sequence += 1;
  core.emit('account.snapshot', { cash_usd: 8100, eligible_capital_usd: 8100, positions: [], open_orders: [] });
  await assert.rejects(() => core.flush(), (error) => error.code === 'IBKRNEW_SEQUENCE_GAP');
  assert.equal(service.getDashboard(owner).account.cash_usd, 8000);
  core.synchronizeSequence(service.reconcileIbkrNewBridgeSequence(bridge.bridge_id));
  await core.flush();
  assert.equal(service.getDashboard(owner).account.cash_usd, 8100);
  assert.equal(core.spoolDepth(), 0);
  assert.equal(service.reconcileIbkrNewBridgeSequence(bridge.bridge_id), 3);

  // Response lost after the real transaction commits: retry is idempotent.
  const originalFetch = core.fetch;
  core.fetch = async (...args) => { await originalFetch(...args); throw new Error('lost response'); };
  const event = core.emit('account.snapshot', { cash_usd: 8200, eligible_capital_usd: 8200, positions: [], open_orders: [] });
  await assert.rejects(() => core.flush(), /lost response/);
  core.fetch = originalFetch;
  await core.flush();
  assert.equal(getDb().prepare('SELECT COUNT(*) count FROM ibkrnew_events WHERE bridge_id=? AND source_event_id=?').get(bridge.bridge_id, event.event_id).count, 1);
  assert.equal(service.reconcileIbkrNewBridgeSequence(bridge.bridge_id), 4);
  assert.equal(service.getDashboard(owner).account.cash_usd, 8200);
  // A broker submission followed by an unavailable cloud acknowledgement must
  // survive restart and TTL expiry without freeing budget or placing it twice.
  const db = getDb(); const ts = new Date().toISOString();
  const authId = 'IBKRNewAuthorization_ack-expiry'; const commandId = 'IBKRNewCommand_ack-expiry';
  db.prepare(`INSERT INTO ibkrnew_authorizations(authorization_id,owner_user_id,account_id,bridge_id,signal_event_id,expression,authorization_json,status,expires_at,created_at) VALUES(?,?,?,?,?,'LONG_STOCK','{}','issued',?,?)`).run(authId, owner, bridge.account_id, bridge.bridge_id, 'ack-expiry-signal', new Date(Date.now() + 60000).toISOString(), ts);
  db.prepare(`INSERT INTO ibkrnew_budget_reservations(reservation_id,owner_user_id,account_id,trading_day,authorization_id,expression,daily_reserved_usd,gross_reserved_usd,status,created_at,updated_at) VALUES('ack-expiry-reservation',?,?,?,?,'LONG_STOCK',100,100,'reserved',?,?)`).run(owner, bridge.account_id, ts.slice(0,10), authId, ts, ts);
  db.prepare(`INSERT INTO ibkrnew_command_outbox(command_id,owner_user_id,account_id,bridge_id,authorization_id,command_json,signature,status,available_at,expires_at,claimed_at,created_at) VALUES(?,?,?,?,?,'{}','test','claimed',?,?,?,?)`).run(commandId, owner, bridge.account_id, bridge.bridge_id, authId, ts, new Date(Date.now() + 60000).toISOString(), ts, ts);
  let failedAck = true; let placed = 0;
  const ackFetch = async (_url, request) => {
    if (failedAck) { failedAck = false; throw new Error('cloud acknowledgement unavailable'); }
    const body = JSON.parse(request.body); const receipt = service.acknowledgeCommand(bridge, commandId, body.status, body.detail);
    return { ok: true, json: async () => receipt };
  };
  const execution = new IBKRNewBridgeCore({ apiUrl: 'https://test.invalid', bridgeId: bridge.bridge_id, token: credentials.token, spoolDir: join(root,'execution'), fetchImpl: ackFetch });
  execution.bootstrap = async () => ({ environment: 'paper', account_ref: bridge.account_id, execution_mode: { requested_mode: 'paper', execution_enabled: true }, goal: { opening_trades_allowed: true, cycle: { cycle_id: 'test-cycle' } } });
  await assert.rejects(() => execution.executeCommand({ command_id: commandId, authorization: { environment: 'paper', account_ref: bridge.account_id, goal: { cycle_id: 'test-cycle' } } }, { placeProtected: async () => { placed++; return { entry_order_id: 7 }; } }), /acknowledgement unavailable/);
  db.prepare(`UPDATE ibkrnew_authorizations SET expires_at=? WHERE authorization_id=?`).run(new Date(Date.now()-60000).toISOString(), authId);
  service.getDashboard(owner);
  assert.equal(db.prepare('SELECT status FROM ibkrnew_command_outbox WHERE command_id=?').get(commandId).status, 'uncertain');
  assert.equal(db.prepare('SELECT status FROM ibkrnew_budget_reservations WHERE authorization_id=?').get(authId).status, 'reserved');
  const restart = new IBKRNewBridgeCore({ apiUrl: execution.apiUrl, bridgeId: execution.bridgeId, token: execution.token, spoolDir: execution.spoolDir, fetchImpl: ackFetch });
  await restart.retryAcknowledgements();
  assert.equal(placed, 1); assert.equal(restart.commandSeen(commandId).ack_pending, false);
  assert.equal(db.prepare('SELECT status FROM ibkrnew_command_outbox WHERE command_id=?').get(commandId).status, 'acknowledged');
  assert.equal(db.prepare('SELECT status FROM ibkrnew_budget_reservations WHERE authorization_id=?').get(authId).status, 'reserved');
  console.log('IBKRNew bridge ↔ backend integration passed: callback race, quarantine/recovery, lost receipts, idempotency and submitted-order acknowledgement after restart/expiry');
} finally {
  getDb().close();
  rmSync(root, { recursive: true, force: true });
}
