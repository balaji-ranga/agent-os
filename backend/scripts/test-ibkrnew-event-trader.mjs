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
assert.equal(configs.strategy_skill.agent_name, 'IBKRNewStrategyPlanner');
assert.match(configs.strategy_skill.skill_path, /ibkrnew-trade-strategy/);
assert.throws(() => service.publishConfig(owner, 'policy', { ...configs.policy, commissions: { ...configs.policy.commissions, maximum_round_trip_commission_pct_of_expected_gross_profit: 101 } }), /between 0 and 100/);
assert.ok(service.getDashboard(owner).reactions.every((x) => x.agent_name.startsWith('IBKRNew')));
assert.throws(() => service.publishConfig(owner, 'policy', { ...configs.policy, environment: 'live' }), /paper-only/);

const credentials = service.registerBridge(owner, 'DU-IBKRNEW-PAPER');
const bridge = service.authenticateBridge(credentials.bridge_id, credentials.token);
assert.equal(bridge.owner_user_id, owner); assert.equal(service.authenticateBridge(credentials.bridge_id, 'wrong'), null);
assert.equal(service.getDashboard(other).events.length, 0);
service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-1', sequence: 1, event_type: 'account.snapshot', payload: {} }).duplicate, true);

const signal = (eventId, sequence, extra = {}) => service.ingestBridgeEvent(bridge, { event_id: eventId, sequence, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'AAPL', quantity: 2, bid: 99.9, ask: 100, last: 100, limit_price: 100, quote_at: new Date().toISOString(), planned_loss_usd: 20, protection: { stop_price: 95, targets: [{ limit_price: 110, quantity: 2 }] }, ...extra } });
const first = signal('desktop-2', 2); assert.equal(first.reaction.decision, 'authorized');
assert.ok(first.reaction.reserved_usd > 200, 'opening reservation includes estimated commissions');
assert.ok(first.reaction.economics.estimated_round_trip_commission_usd > 0);
assert.ok(first.reaction.economics.expected_net_profit_usd < first.reaction.economics.expected_gross_profit_usd);
assert.ok(first.reaction.economics.required_profitable_exit_price > 100);
const commands = service.claimCommands(bridge); assert.equal(commands.length, 1); assert.ok(commands[0].command_id.startsWith('IBKRNew'));
service.acknowledgeCommand(bridge, commands[0].command_id, 'rejected'); assert.equal(service.getDashboard(owner).budgets.daily_used_usd, 0);
const gap = service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 4, event_type: 'bridge.heartbeat', payload: {} }); assert.equal(gap.status, 'quarantined'); assert.match(gap.reason, /expected_3/);
const option = signal('desktop-3', 3, { expression: 'LONG_CALL', quantity: 1, limit_price: 2, bid: 1.95, ask: 2, multiplier: 100, dte: 30, open_interest: 1000, daily_volume: 100, delta: 0.6, protection: { stop_price: 1.5, targets: [{ limit_price: 3, quantity: 1 }] } });
assert.equal(option.reaction.decision, 'authorized');
assert.ok(option.reaction.reserved_usd > 200, 'option premium applies 100x multiplier and includes commission');
assert.equal(service.ingestBridgeEvent(bridge, { event_id: 'desktop-gap', sequence: 4, event_type: 'bridge.heartbeat', payload: {} }).status, 'accepted');

const policy = structuredClone(service.getPublishedConfig(owner, 'policy'));
delete policy.id; delete policy.version; delete policy.status; policy.feature_switches.short_stock_enabled = false;
service.publishConfig(owner, 'policy', policy);
const short = service.ingestBridgeEvent(bridge, { event_id: 'desktop-5', sequence: 5, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'SHORT_STOCK', symbol: 'TSLA', quantity: 1, last: 200, ask: 200, limit_price: 200, quote_at: new Date().toISOString(), shortable: true, planned_loss_usd: 20, protection: { stop_price: 210 } } });
assert.equal(short.reaction.reason, 'short_stock_enabled_disabled');
const stale = signal('desktop-6', 6, { quote_at: new Date(Date.now() - 60000).toISOString() }); assert.equal(stale.reaction.reason, 'stale_quote');
let sequence = 7; let capacityBlock = null;
for (; sequence <= 20; sequence++) {
  const result = signal(`desktop-${sequence}`, sequence).reaction;
  if (result.decision === 'blocked') { capacityBlock = result; break; }
  assert.equal(result.decision, 'authorized');
}
assert.ok(capacityBlock, 'allocation eventually reaches the daily capacity');
assert.ok(['daily_budget_exceeded', 'allocation_capacity_too_small', 'commission_drag_excessive'].includes(capacityBlock.reason), `unexpected capacity block: ${capacityBlock.reason}`);
assert.ok(service.getDashboard(owner).budgets.daily_used_usd <= 1000, 'commission-aware reservations never exceed daily opening budget');
const approvalOwner = 'IBKRNewOwner_Approval'; const approvalDefaults = service.ensureIbkrNewDefaults(approvalOwner);
const approvalPolicy = structuredClone(approvalDefaults.policy); delete approvalPolicy.id; delete approvalPolicy.version; delete approvalPolicy.status; approvalPolicy.feature_switches.ceo_approval_required = true;
service.publishConfig(approvalOwner, 'policy', approvalPolicy, { confirmRiskLoosening: true });
const approvalCredentials = service.registerBridge(approvalOwner, 'DU-APPROVAL'); const approvalBridge = service.authenticateBridge(approvalCredentials.bridge_id, approvalCredentials.token);
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-1', sequence: 1, event_type: 'account.snapshot', occurred_at: new Date().toISOString(), payload: { eligible_capital_usd: 10000, cash_usd: 10000, positions: [], open_orders: [] } });
const pending = service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-2', sequence: 2, event_type: 'market.signal', occurred_at: new Date().toISOString(), payload: { expression: 'LONG_STOCK', symbol: 'MSFT', quantity: 1, bid: 99.9, ask: 100, last: 100, limit_price: 100, quote_at: new Date().toISOString(), planned_loss_usd: 5, protection: { stop_price: 95, targets: [{ limit_price: 112, quantity: 1 }] } } });
assert.equal(pending.reaction.decision, 'pending_approval'); assert.equal(service.claimCommands(approvalBridge).length, 0);
assert.throws(() => service.approveAuthorization(other, pending.reaction.authorization_id), /not found/);
assert.ok(service.approveAuthorization(approvalOwner, pending.reaction.authorization_id).command_id.startsWith('IBKRNewCommand'));
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-3', sequence: 3, event_type: 'bridge.heartbeat', occurred_at: new Date().toISOString(), payload: { gateway_connected: true, bridge_version: '1.1.0', components: [{ component_id: 'IBKRNewSpool', component_type: 'durable_spool', status: 'online', depth: 0 }] } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-4', sequence: 4, event_type: 'execution.fill', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, execution_id: 'exec-approval-1', order_role: 'entry', side: 'BUY', quantity: 1, price: 100 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-5', sequence: 5, event_type: 'commission.report', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, execution_id: 'exec-approval-1', commission_usd: 1.25 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-6', sequence: 6, event_type: 'order.status_changed', occurred_at: new Date().toISOString(), payload: { authorization_id: pending.reaction.authorization_id, order_role: 'entry', status: 'Filled', filled: 1, remaining: 0 } });
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-7', sequence: 7, event_type: 'position.changed', occurred_at: new Date().toISOString(), payload: { positions: [{ symbol: 'MSFT', security_type: 'STK', quantity: 1, market_price: 101 }] } });
const transferredReservation = getDb().prepare(`SELECT gross_reserved_usd,gross_released_usd FROM ibkrnew_budget_reservations WHERE authorization_id=?`).get(pending.reaction.authorization_id);
assert.equal(transferredReservation.gross_released_usd, transferredReservation.gross_reserved_usd, 'broker position replaces pending gross reservation without double counting');
service.ingestBridgeEvent(approvalBridge, { event_id: 'approval-8', sequence: 8, event_type: 'desktop.component_error', occurred_at: new Date().toISOString(), payload: { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', code: 'TEST_DISCONNECT', message: 'test gateway disconnect' } });
const summary = service.getIbkrNewSummary(approvalOwner);
assert.equal(summary.totals.trade_count, 1);
assert.equal(summary.totals.actual_commission_usd, 1.25);
assert.equal(summary.trades[0].status, 'open');
assert.equal(summary.trades[0].gross_pnl_usd, 0, 'an open position must not report its entry notional as a realized loss');
assert.equal(summary.trades[0].net_pnl_usd, -1.25, 'open net P&L reflects incurred commission until realized P&L arrives');
assert.ok(summary.trades[0].required_profitable_exit_price > 100);
const live = service.getIbkrNewLiveOperations(approvalOwner);
assert.ok(live.health.some((component) => component.component_id === 'IBKRNewSpool'));
assert.ok(live.errors.some((error) => error.error_code === 'TEST_DISCONNECT'));
assert.ok(live.snapshots.some((snapshot) => snapshot.snapshot_type === 'positions'));
assert.equal(live.executions[0].commission_usd, 1.25);
assert.equal(service.getIbkrNewSummary(other).totals.trade_count, 0, 'reports remain owner scoped');
assert.equal(getDb().prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name LIKE 'ibkr\\_%' ESCAPE '\\'").get().count, legacyTableCountBefore, 'must not create or alter the legacy IBKR table set');
console.log('IBKRNew event trader service tests passed');
