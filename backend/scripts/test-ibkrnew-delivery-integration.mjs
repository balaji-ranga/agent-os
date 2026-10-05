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
  console.log('IBKRNew bridge ↔ backend delivery integration passed: callback race, real quarantine/recovery, lost receipt and idempotency');
} finally {
  getDb().close();
  rmSync(root, { recursive: true, force: true });
}
