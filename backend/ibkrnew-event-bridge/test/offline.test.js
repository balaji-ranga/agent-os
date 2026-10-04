import assert from 'assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { IBKRNewBridgeCore, IBKRNewFeatureEngine, buildBarFeatures, commandMatchesBootstrap, selectUniverseProfiles } from '../src/core.js';
import { IBKRNewGateway, normalizeAccountValuesToUsd } from '../src/gateway.js';

const dir = mkdtempSync(join(tmpdir(), 'ibkrnew-'));
let calls = 0;
const fakeFetch = async () => ({ ok: ++calls !== 2, status: calls === 2 ? 503 : 202, json: async () => ({ commands: [] }) });
const core = new IBKRNewBridgeCore({ apiUrl: 'https://example.test/api/ibkrnew-event-trader', bridgeId: 'IBKRNewBridge_test', token: 'secret', spoolDir: dir, fetchImpl: fakeFetch });
core.emit('bridge.heartbeat', {}); core.emit('market.bar_closed', {});
const partial = await core.flush(); assert.deepEqual(partial, { sent: 1, remaining: 1 });
assert.equal(readFileSync(join(dir, 'IBKRNew-events.jsonl'), 'utf8').trim().split(/\r?\n/).length, 1);
const signed = { command_id: 'IBKRNewCommand_test', type: 'test' }; const key = crypto.createHash('sha256').update('secret').digest('hex');
const signature = crypto.createHmac('sha256', key).update(JSON.stringify(signed)).digest('hex');
assert.equal(core.verifyCommand({ ...signed, signature, expires_at: new Date(Date.now() + 10000).toISOString() }), true);
assert.equal(core.verifyCommand({ ...signed, signature: '0'.repeat(64) }), false);
assert.equal(commandMatchesBootstrap({ authorization: { account_ref: 'IBKRNewAccount_current', goal: { cycle_id: 'IBKRNewGoalCycle_current' } } }, { account_ref: 'IBKRNewAccount_current', goal: { opening_trades_allowed: true, cycle: { cycle_id: 'IBKRNewGoalCycle_current' } } }), true);
assert.equal(commandMatchesBootstrap({ authorization: { account_ref: 'IBKRNewAccount_old' } }, { account_ref: 'IBKRNewAccount_current' }), false);
assert.equal(commandMatchesBootstrap({ authorization: { account_ref: 'IBKRNewAccount_current', goal: { cycle_id: 'IBKRNewGoalCycle_old' } } }, { account_ref: 'IBKRNewAccount_current', goal: { opening_trades_allowed: false, cycle: { cycle_id: 'IBKRNewGoalCycle_current' } } }), false);
assert.equal(commandMatchesBootstrap({ authorization: { account_id: 'DU1234567' } }, { account_ref: 'IBKRNewAccount_current' }), false);
assert.equal(core.commandSeen('IBKRNewCommand_once'), null); core.markCommand('IBKRNewCommand_once', 'executing'); assert.equal(core.commandSeen('IBKRNewCommand_once').status, 'executing');
const profileEvent = core.emitInstrumentProfile({ symbol: 'aapl', security_type: 'STK', index_memberships: ['SPX'], fundamentals: { market_cap_usd: 1 } });
assert.equal(profileEvent.event_type, 'instrument.profile_refreshed'); assert.equal(profileEvent.payload.symbol, 'AAPL');
assert.throws(() => core.emitInstrumentProfile({ symbol: 'SPY', security_type: 'OPT' }), /STK or ETF/);
const selected = selectUniverseProfiles([{ symbol: 'AAPL', security_type: 'STK', index_memberships: ['SPX'] }, { symbol: 'MSFT', security_type: 'STK', index_memberships: ['NDX'] }, { symbol: 'SPY', security_type: 'ETF', etf_categories: ['EQUITY'] }], { allowlist: [], denylist: [], filters: { stock: { enabled: true, indexes: ['NDX'], index_match: 'ANY' }, etf: { enabled: true, allowlist: [], denylist: [], categories: ['EQUITY'] } } });
assert.deepEqual(selected.map((item) => item.symbol), ['MSFT', 'SPY']);
const bars = Array.from({ length: 21 }, (_, i) => ({ close: 100 + i, volume: 1000, at: new Date().toISOString() }));
const features = buildBarFeatures({ bars, relativeVolume: 1.5, confirmed15m: true });
assert.ok(features.ema_fast > features.ema_slow); assert.ok(features.vwap > 0);
const engine = new IBKRNewFeatureEngine(); let closed = null; const policy = { budgets: { max_stock_position_usd: 750, max_short_position_usd: 500 }, loss_limits: { max_planned_loss_per_trade_usd: 50 } };
for (let minute = 0; minute < 23; minute++) for (let tick = 0; tick < 12; tick++) closed = engine.ingest({ symbol: 'AAPL', at: new Date(Date.UTC(2026, 0, 2, 14, minute, tick * 5)).toISOString(), open: 100 + minute, high: 101 + minute, low: 99 + minute, close: 100.5 + minute, volume: 100 }, policy) || closed;
assert.equal(closed.symbol, 'AAPL'); assert.ok(closed.quantity > 0); assert.ok(closed.protection.stop_price < closed.last);
const gateway = Object.create(IBKRNewGateway.prototype); gateway.connected = true; gateway.positions = []; gateway.openOrders = []; gateway.config = { accountId: 'DU1234567' };
assert.deepEqual(gateway.health(), { connected: true, positions: 0, open_orders: 0 }, 'desktop health must not transmit the local IBKR account identifier');
gateway.accountValues = new Map([
  ['NetLiquidation', { value: 1278.6874, currency: 'SGD' }],
  ['TotalCashValue', { value: 639.3437, currency: 'SGD' }],
  ['$LEDGER-ExchangeRate:USD', { value: 1.2786874, currency: 'USD' }],
]);
assert.deepEqual(gateway.snapshot(), { eligible_capital_usd: 1000, cash_usd: 500, realized_pnl_day_usd: 0, unrealized_pnl_usd: 0, positions: [], open_orders: [] });
assert.deepEqual(normalizeAccountValuesToUsd(new Map([
  ['NetLiquidation', { value: 1278.6874, currency: 'SGD' }],
  ['TotalCashValue', { value: 639.3437, currency: 'SGD' }],
  ['$LEDGER-RealizedPnL:BASE', { value: 12.786874, currency: 'BASE' }],
  ['$LEDGER-UnrealizedPnL:BASE', { value: -6.393437, currency: 'BASE' }],
  ['$LEDGER-ExchangeRate:USD', { value: 1.2786874, currency: 'USD' }],
])), { eligible_capital_usd: 1000, cash_usd: 500, realized_pnl_day_usd: 10, unrealized_pnl_usd: -5 });
assert.deepEqual(normalizeAccountValuesToUsd(new Map([
  ['NetLiquidation', { value: 2000, currency: 'USD' }],
  ['TotalCashValue', { value: 750, currency: 'USD' }],
])), { eligible_capital_usd: 2000, cash_usd: 750, realized_pnl_day_usd: 0, unrealized_pnl_usd: 0 });
assert.equal(normalizeAccountValuesToUsd(new Map([['NetLiquidation', { value: 2000, currency: 'SGD' }]])).eligible_capital_usd, 0, 'non-USD capital must fail closed when the USD exchange rate is unavailable');
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const installerPath = join(packageRoot, 'scripts', 'Install-IBKRNewBridgeTask.ps1');
const runnerPath = join(packageRoot, 'scripts', 'Run-IBKRNewBridgeTask.ps1');
assert.equal(existsSync(installerPath), true, 'Windows Scheduled Task installer must ship with the bridge package');
assert.equal(existsSync(runnerPath), true, 'Windows Scheduled Task supervisor must ship with the bridge package');
const installer = readFileSync(installerPath, 'utf8');
assert.match(installer, /New-ScheduledTaskTrigger -AtLogOn/);
assert.doesNotMatch(installer, /New-ScheduledTaskAction[^\r\n]+-WorkingDirectory/, 'the supervisor resolves its own package root; Task Scheduler working-directory failures must be avoided');
assert.match(installer, /New-ScheduledTaskAction -Execute \$Node -Argument/);
assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$PowerShell/, 'Task Scheduler must supervise Node directly instead of relying on a PowerShell child launch');
assert.match(installer, /-StartWhenAvailable/);
assert.match(installer, /-RestartCount 999/);
assert.match(installer, /-WakeToRun/);
assert.match(installer, /function Protect-InstallAcl/);
assert.match(installer, /icacls\.exe \$Path '\/inheritance:e'/, 'user-profile inheritance must remain enabled for restricted Windows user tokens');
assert.doesNotMatch(installer, /'\/inheritance:r'/, 'the installer must not remove capability ACLs required by a restricted Windows user token');
assert.match(installer, /\$ChildPattern = Join-Path \$Path '\*'/);
assert.match(installer, /icacls\.exe \$ChildPattern '\/reset' '\/T' '\/C'/);
assert.match(installer, /New-Item -ItemType Directory -Path \$ResolvedInstall -Force \| Out-Null\s+Protect-InstallAcl \$ResolvedInstall\s+foreach/, 'existing installs must be repaired before package files are overwritten');
assert.doesNotMatch(installer, /icacls\.exe \$Path[^\r\n]+ '\/T'/, 'the root ACL command must not disable inheritance on every child');
const supervisor = readFileSync(runnerPath, 'utf8');
assert.match(supervisor, /while \(\$true\)/);
assert.doesNotMatch(supervisor, /IBKRNEW_BRIDGE_TOKEN|IBKRNEW_ACCOUNT_ID/);
const privacyDir = mkdtempSync(join(tmpdir(), 'ibkrnew-privacy-')); const sentBodies = [];
const privacyCore = new IBKRNewBridgeCore({ apiUrl: 'https://example.test/api/ibkrnew-event-trader', bridgeId: 'IBKRNewBridge_privacy', token: 'secret', spoolDir: privacyDir, fetchImpl: async (_url, request) => { sentBodies.push(request?.body || ''); return { ok: true, status: 202, json: async () => ({}) }; } });
privacyCore.emit('bridge.gateway_error', { account_id: 'DU1234567', message: 'Account DU1234567 is invalid', nested: [{ acctCode: 'DU1234567' }] });
assert.doesNotMatch(readFileSync(join(privacyDir, 'IBKRNew-events.jsonl'), 'utf8'), /DU1234567|account_id|acctCode/);
writeFileSync(join(privacyDir, 'IBKRNew-events.jsonl'), `${JSON.stringify({ event_id: 'legacy', sequence: 2, event_type: 'desktop.component_error', payload: { message: 'Legacy DU7654321 error' } })}\n`);
await privacyCore.flush(); assert.doesNotMatch(sentBodies.at(-1), /DU7654321/);
await privacyCore.acknowledge('IBKRNewCommand_privacy', 'rejected', { error: 'Account DU9999999 rejected', acctNumber: 'DU9999999' });
assert.doesNotMatch(sentBodies.at(-1), /DU9999999|acctNumber/);
console.log('IBKRNew desktop bridge offline tests passed');
