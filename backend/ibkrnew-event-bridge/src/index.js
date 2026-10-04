import { config as loadDotEnv } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { fileURLToPath } from 'url';
import { IBKRNewBridgeCore, IBKRNewFeatureEngine, bridgeRuntimeStalled, buildMarketSubscriptionComponent, commandMatchesBootstrap, selectUniverseProfiles } from './core.js';
import { IBKRNewGateway } from './gateway.js';

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
  };
}

function onGatewayEvent(type, payload) {
  if (type === 'account.snapshot') lastAccountSnapshotAt = Date.now();
  if (type === 'instrument.shortability_changed') featureEngine.setShortable(payload.symbol, payload.shortable);
  if (type === 'market.realtime_bar' && boot) {
    const closed = featureEngine.ingest(payload, boot.configs.policy);
    if (closed) core.emit('market.bar_closed', closed);
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

async function connectGateway({ reconnect = false } = {}) {
  const candidate = new IBKRNewGateway(gatewayConfig(), onGatewayEvent);
  try {
    await candidate.connect();
    boot = await core.bootstrap();
    if (boot.environment !== tradingMode) throw new Error('ACCOUNT_ENVIRONMENT_MISMATCH');
    core.synchronizeSequence(boot.last_sequence);
    const profiles = loadUniverseProfiles();
    for (const profile of profiles) core.emitInstrumentProfile(profile);
    const symbols = [...new Set([...(boot.configs.universe.allowlist || []), ...profiles.map((profile) => profile.symbol)])];
    activeSubscriptionSymbols = symbols.slice(0, boot.configs.universe.maximum_active_subscriptions || 40);
    activeSubscriptionSymbols.forEach((symbol, i) => candidate.subscribe(symbol, 1000 + i));
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
  if (mock || gateway?.health().connected) return;
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
    throw error;
  }
}

async function runCycle() {
  cycleStartedAt = Date.now();
  try {
    await ensureGatewayConnected();
    const gatewayHealth = gateway?.health() || { connected: false };
    core.emit('bridge.heartbeat', {
      bridge_version: '1.2.0',
      gateway_connected: gatewayHealth.connected,
      mode: mock ? `${tradingMode}_mock` : tradingMode,
      account_attestation: gatewayHealth.account_attestation || { status: mock ? 'verified' : 'failed', environment: tradingMode, execution_ready: mock, reason_code: mock ? null : 'GATEWAY_NOT_ATTESTED' },
      spool_depth: core.spoolDepth(),
      components: [
        { component_id: 'IBKRNewDesktopRuntime', component_type: 'desktop_runtime', status: 'online', version: process.version },
        { component_id: 'IBKRNewDurableSpool', component_type: 'event_spool', status: 'online', depth: core.spoolDepth() },
        { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', status: gatewayHealth.connected ? 'online' : 'offline', ...gatewayHealth },
        buildMarketSubscriptionComponent(activeSubscriptionSymbols),
      ],
    });
    if (gatewayHealth.connected && Date.now() - lastAccountSnapshotAt >= accountSnapshotIntervalMs) {
      core.emit('account.snapshot', gateway.snapshot());
      lastAccountSnapshotAt = Date.now();
    }
    await core.flush();
    if (gatewayHealth.account_attestation?.execution_ready !== true) return;
    for (const command of await core.claim(10)) {
      if (!gatewayHealth.connected) continue;
      const seen = core.commandSeen(command.command_id);
      if (seen) {
        await core.acknowledge(command.command_id, 'uncertain', { reason: 'durable_command_journal_reclaim', prior: seen });
        continue;
      }
      try {
        const executionBoot = await core.bootstrap();
        if (!commandMatchesBootstrap(command, executionBoot)) throw new Error('account reference epoch changed before execution');
        core.markCommand(command.command_id, 'executing');
        const detail = await gateway.placeProtected(command);
        core.markCommand(command.command_id, 'submitted', detail);
        await core.acknowledge(command.command_id, 'submitted', detail);
      } catch (error) {
        core.markCommand(command.command_id, 'rejected', { error: error.message });
        core.emit('desktop.component_error', { component_id: 'IBKRNewExecutionAdapter', component_type: 'execution_adapter', code: 'COMMAND_REJECTED', message: error.message, command_id: command.command_id });
        await core.acknowledge(command.command_id, 'rejected', { error: error.message });
      }
    }
  } catch (error) {
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
  await connectGateway();
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
