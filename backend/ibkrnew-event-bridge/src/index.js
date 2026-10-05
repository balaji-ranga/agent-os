import { config as loadDotEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
import { IBKRNewBridgeCore, IBKRNewFeatureEngine, acquireBridgeRuntimeLock, bridgeRuntimeStalled, buildMarketSubscriptionComponent, selectUniverseProfiles } from './core.js';
import { IBKRNewGateway } from './gateway.js';
import { tradingSession } from './session.js';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const packagePath = (value, fallback) => {
  const configured = value || fallback;
  return isAbsolute(configured) ? configured : resolve(packageRoot, configured);
};

// The installer validates and protects this owner-scoped file. Task Scheduler
// can retain an old environment block across upgrades, so inherited IBKRNEW_*
// values must never override the installed package configuration.
loadDotEnv({ path: resolve(packageRoot, '.env'), override: true });

const httpTimeoutMs = Math.max(1000, Number(process.env.IBKRNEW_HTTP_TIMEOUT_MS) || 15000);
const cfg = {
  apiUrl: process.env.IBKRNEW_API_URL,
  bridgeId: process.env.IBKRNEW_BRIDGE_ID,
  token: process.env.IBKRNEW_BRIDGE_TOKEN,
  spoolDir: packagePath(process.env.IBKRNEW_SPOOL_DIR, './data'),
  requestTimeoutMs: httpTimeoutMs,
};
const releaseRuntimeLock = acquireBridgeRuntimeLock(cfg.spoolDir);
process.on('exit', releaseRuntimeLock);
const core = new IBKRNewBridgeCore(cfg);
const mock = process.env.IBKRNEW_MOCK === '1';
const tradingMode = String(process.env.IBKRNEW_TRADING_MODE || 'paper').trim().toLowerCase();
if (!['paper', 'live'].includes(tradingMode)) throw new Error('IBKRNEW_TRADING_MODE must be paper or live');
const localExecutionEnabled = process.env.IBKRNEW_EXECUTION_ENABLED === '1';
const featureEngine = new IBKRNewFeatureEngine();
const accountSnapshotIntervalMs = Math.max(5000, Number(process.env.IBKRNEW_ACCOUNT_SNAPSHOT_INTERVAL_MS || 15000));
const cycleIntervalMs = Math.max(1000, Number(process.env.IBKRNEW_CYCLE_INTERVAL_MS || 5000));
const stallTimeoutMs = Math.max(httpTimeoutMs * 2, Number(process.env.IBKRNEW_STALL_TIMEOUT_MS) || 120000);
const watchdogIntervalMs = Math.max(1000, Number(process.env.IBKRNEW_WATCHDOG_INTERVAL_MS || 10000));
let gateway = null;
let boot = null;
let lastAccountSnapshotAt = 0;
let reconnectAttempt = 0;
let cycleStartedAt = Date.now();
let activeSubscriptionSymbols = [];
let capacityLimitedSymbols = [];
let profilesBySymbol = new Map();
let nextReconnectAt = 0;
let lastMarketBarAt = null;
let subscriptionSignature = null;
let lastProfileError = null;

const watchdog = setInterval(() => {
  if (!bridgeRuntimeStalled({ cycleStartedAt, stallTimeoutMs })) return;
  const stalledForMs = Date.now() - cycleStartedAt;
  console.error(`IBKRNew watchdog exiting stalled runtime after ${stalledForMs}ms; the Windows supervisor will restart it.`);
  process.exit(78);
}, watchdogIntervalMs);

function gatewayConfig() {
  return {
    host: process.env.IBKRNEW_GATEWAY_HOST || '127.0.0.1',
    port: Number(process.env.IBKRNEW_GATEWAY_PORT || (tradingMode === 'live' ? 4001 : 4002)),
    clientId: Number(process.env.IBKRNEW_CLIENT_ID || 41),
    accountId: process.env.IBKRNEW_ACCOUNT_ID,
    environment: tradingMode,
    executionEnabled: localExecutionEnabled,
    correlationPath: resolve(cfg.spoolDir, 'IBKRNew-broker-correlation.json'),
  };
}

function onGatewayEvent(type, payload) {
  if (type === 'account.snapshot') lastAccountSnapshotAt = Date.now();
  if (type === 'instrument.shortability_changed') featureEngine.setShortable(payload.symbol, payload.shortable);
  if (type === 'market.realtime_bar' && boot) {
    lastMarketBarAt = new Date().toISOString();
    const closed = featureEngine.ingest(payload, boot.configs.policy, boot.configs.strategy);
    if (closed && gateway?.connected) {
      const currentGateway = gateway;
      currentGateway.executableFeatures(closed, profilesBySymbol.get(closed.symbol) || {}, boot.configs.policy)
        .then(async enriched => { if (gateway === currentGateway && gateway.connected) { core.emit('market.bar_closed', enriched); await core.flush(); } })
        .catch(error => core.emit('desktop.component_error', { component_id: 'IBKRNewMarketObserver', code: 'EXECUTABLE_QUOTE_UNAVAILABLE', message: error.message, symbol: closed.symbol }));
    }
    return;
  }
  core.emit(type, payload);
}

function loadUniverseProfiles() {
  const configuredProfileFile = process.env.IBKRNEW_INSTRUMENT_PROFILES_FILE;
  const profileFile = configuredProfileFile ? packagePath(configuredProfileFile) : null;
  if (!profileFile || !existsSync(profileFile)) return [];
  return selectUniverseProfiles(JSON.parse(readFileSync(profileFile, 'utf8')), boot.configs.universe);
}

function refreshUniverseSubscriptions(candidate = gateway) {
  if (!candidate?.connected) return;
  const profiles = loadUniverseProfiles();
  const signature = JSON.stringify({ universe: boot.configs.universe, profiles });
  if (candidate === gateway && subscriptionSignature === signature) { candidate.refreshSubscriptions(); return; }
  const selected = new Map(profiles.map(p => [p.symbol.toUpperCase(), p]));
  // Retain configured ETFs, then take highest-cap ranked stocks within the
  // existing subscription capacity. Never silently raise a user's line limit.
  const etfs = profiles.filter(p => p.security_type === 'ETF');
  const symbols = [...new Set([...etfs.map(p => p.symbol), ...(boot.configs.universe.allowlist || []), ...profiles.map(p => p.symbol)])].slice(0, boot.configs.universe.maximum_active_subscriptions || 40);
  for (const profile of profiles) core.emitInstrumentProfile(profile);
  candidate.setSubscriptionProfiles(symbols.map(symbol => selected.get(symbol.toUpperCase()) || { symbol, security_type: 'STK' }));
  const eligibleSymbols = [...new Set([...etfs.map(p => p.symbol), ...(boot.configs.universe.allowlist || []), ...profiles.map(p => p.symbol)])];
  candidate.setVolumeProfiles(eligibleSymbols.map(symbol => selected.get(symbol.toUpperCase()) || { symbol, security_type: 'STK' }));
  capacityLimitedSymbols = eligibleSymbols.filter(symbol => !symbols.includes(symbol));
  profilesBySymbol = selected; activeSubscriptionSymbols = symbols;
  subscriptionSignature = signature; lastProfileError = null;
}

async function connectGateway({ reconnect = false } = {}) {
  // Resynchronize while disconnected, before new broker callbacks can allocate
  // sequences. Callbacks from a retired connection must not enter the spool.
  boot = await core.bootstrap();
  if (boot.environment !== tradingMode) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
  const recovery = core.synchronizeSequence(boot.last_sequence);
  let acceptingEvents = true;
  const candidate = new IBKRNewGateway(gatewayConfig(), (type, payload) => { if (acceptingEvents) onGatewayEvent(type, payload); });
  const disconnectCandidate = candidate.disconnect.bind(candidate);
  candidate.disconnect = () => { acceptingEvents = false; disconnectCandidate(); };
  try {
    await candidate.connect();
    if (recovery.changed) core.emit('bridge.sequence_recovered', { component_id: 'IBKRNewDurableSpool', component_type: 'event_spool', message: 'Event delivery cursor reconciled; pending broker events preserved and account/open orders requested again.' });
    try { refreshUniverseSubscriptions(candidate); }
    catch (error) {
      lastProfileError = error.message;
      core.emit('desktop.component_error', { component_id: 'IBKRNewMarketSubscriptions', code: 'PROFILE_REFRESH_FAILED', message: 'Current instrument profile refresh could not be validated; keeping the last validated subscriptions where available.' });
      candidate.setSubscriptionProfiles(activeSubscriptionSymbols.map(symbol => profilesBySymbol.get(symbol) || { symbol, security_type: 'STK' }));
    }
    const previous = gateway;
    gateway = candidate;
    reconnectAttempt = 0;
    if (previous && previous !== candidate) {
      try { previous.disconnect(); } catch {}
    }
    if (reconnect) {
      core.emit('bridge.gateway_reconnected', {
        component_id: 'IBKRNewGateway',
        component_type: 'ibkr_gateway',
        message: 'IBKR Gateway connection restored by the desktop bridge supervisor',
      });
    }
  } catch (error) {
    try { candidate.disconnect(); } catch {}
    throw error;
  }
}

async function ensureGatewayConnected() {
  if (mock || gateway?.health().connected || Date.now() < nextReconnectAt) return;
  reconnectAttempt += 1;
  try {
    await connectGateway({ reconnect: true });
  } catch (error) {
    core.emit('desktop.component_error', {
      component_id: 'IBKRNewGateway',
      component_type: 'ibkr_gateway',
      code: 'GATEWAY_RECONNECT_FAILED',
      message: `IBKR Gateway reconnect attempt ${reconnectAttempt} failed: ${error.message}`,
    });
    nextReconnectAt = Date.now() + Math.min(60000, 5000 * reconnectAttempt);
  }
}

async function runCycle() {
  cycleStartedAt = Date.now();
  try {
    await ensureGatewayConnected();
    const gatewayHealth = gateway?.health() || { connected: false };
    core.emit('bridge.heartbeat', {
      bridge_version: '1.2.5',
      gateway_connected: gatewayHealth.connected,
      mode: mock ? `${tradingMode}_mock` : tradingMode,
      account_attestation: gatewayHealth.account_attestation || { status: mock ? 'verified' : 'failed', environment: tradingMode, execution_ready: mock, reason_code: mock ? null : 'GATEWAY_NOT_ATTESTED' },
      spool_depth: core.spoolDepth(),
      components: [
        { component_id: 'IBKRNewDesktopRuntime', component_type: 'desktop_runtime', status: 'online', version: process.version },
        { component_id: 'IBKRNewDurableSpool', component_type: 'event_spool', status: 'online', depth: core.spoolDepth() },
        { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', status: gatewayHealth.connected ? 'online' : 'offline', ...gatewayHealth },
        { ...buildMarketSubscriptionComponent(activeSubscriptionSymbols), ...gateway?.marketSubscriptions?.health(), capacity_limited_symbols: capacityLimitedSymbols, status: !gatewayHealth.connected ? 'offline' : !tradingSession().regular ? 'waiting_market' : activeSubscriptionSymbols.length && gateway?.marketSubscriptions?.health().pending_symbols.length === 0 ? 'online' : 'degraded', last_market_event_at:lastMarketBarAt },
        ...(gateway?.volumeProfiles ? [gateway.volumeProfiles.health()] : []),
      ],
    });
    if (gatewayHealth.connected && Date.now() - lastAccountSnapshotAt >= accountSnapshotIntervalMs) {
      core.emit('account.snapshot', gateway.snapshot());
      lastAccountSnapshotAt = Date.now();
    }
    const delivery = await core.flush();
    if (delivery.remaining > 0) return;
    boot = await core.bootstrap();
    if (boot.environment !== tradingMode) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
    try { refreshUniverseSubscriptions(); }
    catch (error) {
      if (lastProfileError !== error.message) core.emit('desktop.component_error', { component_id: 'IBKRNewMarketSubscriptions', code: 'PROFILE_REFRESH_FAILED', message: 'Current instrument profile refresh could not be validated; keeping the last validated subscriptions. Complete fresh S&P 500 profiles are required for SPX_TOP100.' });
      lastProfileError = error.message;
      // Keep the last validated subscriptions; backend freshness guards still
      // veto stale eligibility. Protective order management is not interrupted.
      gateway?.refreshSubscriptions();
    }
    if (gatewayHealth.account_attestation?.execution_ready !== true) return;
    await core.retryAcknowledgements();
    for (const command of await core.claim(10)) {
      if (!gatewayHealth.connected) continue;
      await core.executeCommand(command, gateway);
    }
  } catch (error) {
    if (error.code === 'IBKRNEW_SEQUENCE_GAP') {
      // No commands are claimed on this path. The next cycle bootstraps and
      // reconciles the broker before execution can become ready again.
      try { gateway?.disconnect(); } catch {}
      gateway = null;
      activeSubscriptionSymbols = [];
      if (mock) { boot = await core.bootstrap(); core.synchronizeSequence(boot.last_sequence); }
      console.warn('IBKRNew event sequence gap: preserving queued events and reconnecting for reconciliation.');
      return;
    }
    core.emit('desktop.component_error', { component_id: 'IBKRNewDesktopRuntime', component_type: 'desktop_runtime', code: 'LOOP_ERROR', message: error.message });
    console.warn(`IBKRNew offline: ${error.message}`);
  } finally {
    cycleStartedAt = 0;
    setTimeout(runCycle, cycleIntervalMs);
  }
}

if (mock) {
  boot = await core.bootstrap();
  if (boot.environment !== tradingMode) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
  core.synchronizeSequence(boot.last_sequence);
} else {
  const accountId = String(process.env.IBKRNEW_ACCOUNT_ID || '').trim();
  if (!localExecutionEnabled) throw new Error(`IBKRNew ${tradingMode} execution requires its explicit local execution gate`);
  if (!accountId || tradingMode === 'paper' && !accountId.toUpperCase().startsWith('DU') || tradingMode === 'live' && accountId.toUpperCase().startsWith('DU')) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
  // Broker availability must not decide whether the outbound bridge can report
  // its own health. Reconnection failures are reported and retried by runCycle.
  boot = await core.bootstrap();
  if (boot.environment !== tradingMode) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
  core.synchronizeSequence(boot.last_sequence);
}

cycleStartedAt = 0;
console.log(`IBKRNew bridge ${cfg.bridgeId} started in ${mock ? `${tradingMode} mock` : `${tradingMode} Gateway`} mode; no public listener is opened.`);
setTimeout(runCycle, 0);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(watchdog);
    try { gateway?.disconnect(); } catch {}
    process.exit(0);
  });
}
