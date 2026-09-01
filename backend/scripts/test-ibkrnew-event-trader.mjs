import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.AGENT_OS_DATA_DIR = mkdtempSync(join(tmpdir(), 'ibkrnew-service-'));
const { initDb, getDb } = await import('../src/db/schema.js'); initDb();
const legacyTableCountBefore = getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'ibkr\\_%' ESCAPE '\\'").get().count;
const service = await import('../src/services/ibkrnew-event-trader.js');

const owner = 'IBKRNewOwner_A'; const other = 'IBKRNewOwner_B';
const configs = service.ensureIbkrNewDefaults(owner);
assert.equal(configs.policy.budgets.daily_opening_exposure_usd, 1000);
assert.equal(configs.policy.budgets.total_gross_exposure_usd, 10000);
assert.ok(service.getDashboard(owner).reactions.every((x) => x.agent_name.startsWith('IBKRNew')));
assert.throws(() => service.publishConfig(owner, 'policy', { ...configs.policy, environment: 'live' }), /paper-only/);

const credentials = service.registerBridge(owner, 'DU-IBKRNEW-PAPER');
const bridge = service.authenticateBridge(credentials.bridge_id, credentials.token);
assert.equal(bridge.owner_user_id, owner); assert.equal(service.authenticateBridge(credentials.bridge_id, 'wrong'), null);
assert.equal(service.getDashboard(other).events.length, 0);
service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', payload: {} }).duplicate, true);

const signal = (eventId, sequence, extra = {}) => service.ingestBridgeEvent(bridge, { event_id: eventId, sequence, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', quantity: 2, bid: 99.9, ask: 100, last: 100, limit_price: 100, quote_at: new Date().toISOString(), planned_loss_usd: 20, protection: { stop_price: 95, targets: [{ limit_price: 110, quantity: 2 }] }, ...extra } });
const first = signal('desktop-2', 2); assert.equal(first.reaction.decision, 'authorized'); assert.equal(first.reaction.reserved_usd, 200);
const commands = service.claimCommands(bridge); assert.equal(commands.length, 1); assert.ok(commands[0].command_id.startsWith('IBKRNew'));
service.acknowledgeCommand(bridge, commands[0].command_id, 'rejected'); assert.equal(service.getDashboard(owner).budgets.daily_used_usd, 0);
const gap = service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 4, event_type: 'bridge.heartbeat', payload: {} }); assert.equal(gap.status, 'quarantined'); assert.match(gap.reason, /expected_3/);
const option = signal('desktop-3', 3, { expression: 'LONG_CALL', quantity: 1, limit_price: 2, bid: 1.95, ask: 2, multiplier: 100, dte: 30, open_interest: 1000, daily_volume: 100, delta: 0.6, protection: { stop_price: 1.5, targets: [{ limit_price: 3, quantity: 1 }] } });
assert.equal(option.reaction.decision, 'authorized'); assert.equal(option.reaction.reserved_usd, 200, 'option premium applies 100x multiplier');
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 4, event_type: 'bridge.heartbeat', payload: {} }).status, 'accepted');

const policy = structuredClone(service.getPublishedConfig(owner, 'policy'));
delete policy.id; delete policy.version; delete policy.status; policy.feature_switches.short_stock_enabled = false;
service.publishConfig(owner, 'policy', policy);
const short = service.ingestBridgeEvent(bridge, { event_id: 'desktop-5', sequence: 5, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'SHORT_STOCK', symbol: 'TSLA', quantity: 1, last: 200, ask: 200, limit_price: 200, quote_at: new Date().toISOString(), shortable: true, planned_loss_usd: 20, protection: { stop_price: 210 } } });
assert.equal(short.reaction.reason, 'short_stock_enabled_disabled');
const stale = signal('desktop-6', 6, { quote_at: new Date(Date.now() - 60000).toISOString() }); assert.equal(stale.reaction.reason, 'stale_quote');
for (let i = 7; i <= 10; i++) assert.equal(signal(`desktop-${i}`, i).reaction.decision, 'authorized');
assert.equal(signal('desktop-11', 11).reaction.reason, 'daily_budget_exceeded', 'atomic reservations must cap daily opening exposure');
assert.equal(service.getDashboard(owner).budgets.daily_used_usd, 1000);
const approvalOwner = 'IBKRNewOwner_Approval'; const approvalDefaults = service.ensureIbkrNewDefaults(approvalOwner);
const approvalPolicy = structuredClone(approvalDefaults.policy); delete approvalPolicy.id; delete approvalPolicy.version; delete approvalPolicy.status; approvalPolicy.feature_switches.ceo_approval_required = true;
service.publishConfig(approvalOwner, 'policy', approvalPolicy, { confirmRiskLoosening: true });
const approvalCredentials = service.registerBridge(approvalOwner, 'DU-APPROVAL'); const approvalBridge = service.authenticateBridge(approvalCredentials.bridge_id, approvalCredentials.token);
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
const pending = service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-2', sequence: 2, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'MSFT', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 110, quantity: 1 }] } } });
assert.equal(pending.reaction.decision, 'pending_approval'); assert.equal(service.claimCommands(approvalBridge).length, 0);
assert.throws(() => service.approveAuthorization(other, pending.reaction.authorization_id), /not found/);
assert.ok(service.approveAuthorization(approvalOwner, pending.reaction.authorization_id).command_id.startsWith('IBKRNewCommand'));
assert.equal(getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'ibkr\\_%' ESCAPE '\\'").get().count, legacyTableCountBefore, 'must not create or alter the legacy IBKR table set');
console.log('IBKRNew event trader service tests passed');
