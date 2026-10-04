import 'dotenv/config';
import { existsSync, readFileSync } from 'fs';
import { IBKRNewBridgeCore, IBKRNewFeatureEngine, commandMatchesBootstrap, selectUniverseProfiles } from './core.js';
import { IBKRNewGateway } from './gateway.js';

const cfg = {
  apiUrl: process.env.IBKRNEW_API_URL,
  bridgeId: process.env.IBKRNEW_BRIDGE_ID,
  token: process.env.IBKRNEW_BRIDGE_TOKEN,
  spoolDir: process.env.IBKRNEW_SPOOL_DIR || './data',
};
const core = new IBKRNewBridgeCore(cfg);
const mock = process.env.IBKRNEW_MOCK === '1';
const featureEngine = new IBKRNewFeatureEngine();
const accountSnapshotIntervalMs = Math.max(5000, Number(process.env.IBKRNEW_ACCOUNT_SNAPSHOT_INTERVAL_MS || 15000));
const cycleIntervalMs = Math.max(1000, Number(process.env.IBKRNEW_CYCLE_INTERVAL_MS || 5000));
let gateway = null;
let boot = null;
let lastAccountSnapshotAt = 0;
let reconnectAttempt = 0;

function gatewayConfig() {
  return {
    host: process.env.IBKRNEW_GATEWAY_HOST || '127.0.0.1',
    port: Number(process.env.IBKRNEW_GATEWAY_PORT || 4002),
    clientId: Number(process.env.IBKRNEW_CLIENT_ID || 41),
    accountId: process.env.IBKRNEW_ACCOUNT_ID,
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
  const profileFile = process.env.IBKRNEW_INSTRUMENT_PROFILES_FILE;
  if (!profileFile || !existsSync(profileFile)) return [];
  return selectUniverseProfiles(JSON.parse(readFileSync(profileFile, 'utf8')), boot.configs.universe);
}

async function connectPaperGateway({ reconnect = false } = {}) {
  const candidate = new IBKRNewGateway(gatewayConfig(), onGatewayEvent);
  try {
    await candidate.connect();
    boot = await core.bootstrap();
    const profiles = loadUniverseProfiles();
    for (const profile of profiles) core.emitInstrumentProfile(profile);
    const symbols = [...new Set([...(boot.configs.universe.allowlist || []), ...profiles.map((profile) => profile.symbol)])];
    symbols.slice(0, boot.configs.universe.maximum_active_subscriptions || 40).forEach((symbol, i) => candidate.subscribe(symbol, 1000 + i));
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
    await connectPaperGateway({ reconnect: true });
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
  try {
    await ensureGatewayConnected();
    const gatewayHealth = gateway?.health() || { connected: false };
    core.emit('bridge.heartbeat', {
      bridge_version: '1.2.0',
      gateway_connected: gatewayHealth.connected,
      mode: mock ? 'paper_mock' : 'paper',
      spool_depth: core.spoolDepth(),
      components: [
        { component_id: 'IBKRNewDesktopRuntime', component_type: 'desktop_runtime', status: 'online', version: process.version },
        { component_id: 'IBKRNewDurableSpool', component_type: 'event_spool', status: 'online', depth: core.spoolDepth() },
        { component_id: 'IBKRNewGateway', component_type: 'ibkr_gateway', status: gatewayHealth.connected ? 'online' : 'offline', ...gatewayHealth },
      ],
    });
    if (gatewayHealth.connected && Date.now() - lastAccountSnapshotAt >= accountSnapshotIntervalMs) {
      core.emit('account.snapshot', gateway.snapshot());
      lastAccountSnapshotAt = Date.now();
    }
    await core.flush();
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
    setTimeout(runCycle, cycleIntervalMs);
  }
}

if (!mock) {
  if (process.env.IBKRNEW_PAPER_EXECUTION_ENABLED !== '1' || !String(process.env.IBKRNEW_ACCOUNT_ID || '').startsWith('DU')) {
    throw new Error('IBKRNew real adapter requires the explicit paper gate and a DU paper account');
  }
  await connectPaperGateway();
}

console.log(`IBKRNew bridge ${cfg.bridgeId} started in ${mock ? 'mock' : 'paper Gateway'} mode; no public listener is opened.`);
setTimeout(runCycle, 0);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try { gateway?.disconnect(); } catch {}
    process.exit(0);
  });
}
