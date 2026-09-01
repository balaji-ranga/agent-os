import 'dotenv/config';
import { IBKRNewBridgeCore, IBKRNewFeatureEngine } from './core.js';
import { IBKRNewGateway } from './gateway.js';

const cfg = {
  apiUrl: process.env.IBKRNEW_API_URL,
  bridgeId: process.env.IBKRNEW_BRIDGE_ID,
  token: process.env.IBKRNEW_BRIDGE_TOKEN,
  spoolDir: process.env.IBKRNEW_SPOOL_DIR || './data',
};
const core = new IBKRNewBridgeCore(cfg);
const mock = process.env.IBKRNEW_MOCK === '1'; let gateway = null; let boot = null; const featureEngine = new IBKRNewFeatureEngine();
if (!mock) {
  if (process.env.IBKRNEW_PAPER_EXECUTION_ENABLED !== '1' || !String(process.env.IBKRNEW_ACCOUNT_ID || '').startsWith('DU')) throw new Error('IBKRNew real adapter requires the explicit paper gate and a DU paper account');
  gateway = new IBKRNewGateway({ host: process.env.IBKRNEW_GATEWAY_HOST || '127.0.0.1', port: Number(process.env.IBKRNEW_GATEWAY_PORT || 4002), clientId: Number(process.env.IBKRNEW_CLIENT_ID || 41), accountId: process.env.IBKRNEW_ACCOUNT_ID }, (type, payload) => { if (type === 'instrument.shortability_changed') featureEngine.setShortable(payload.symbol, payload.shortable); if (type === 'market.realtime_bar' && boot) { const closed = featureEngine.ingest(payload, boot.configs.policy); if (closed) core.emit('market.bar_closed', closed); } else core.emit(type, payload); });
  await gateway.connect(); boot = await core.bootstrap(); const symbols = boot.configs.universe.allowlist || [];
  symbols.slice(0, boot.configs.universe.maximum_active_subscriptions || 40).forEach((symbol, i) => gateway.subscribe(symbol, 1000 + i));
}
console.log(`IBKRNew bridge ${cfg.bridgeId} started in ${mock ? 'mock' : 'paper Gateway'} mode; no public listener is opened.`);
setInterval(async () => {
  try { core.emit('bridge.heartbeat', { gateway_connected: !!gateway, mode: mock ? 'paper_mock' : 'paper' }); await core.flush(); for (const command of await core.claim(10)) { if (!gateway) continue; const seen = core.commandSeen(command.command_id); if (seen) { await core.acknowledge(command.command_id, 'uncertain', { reason: 'durable_command_journal_reclaim', prior: seen }); continue; } try { core.markCommand(command.command_id, 'executing'); const detail = await gateway.placeProtected(command); core.markCommand(command.command_id, 'submitted', detail); await core.acknowledge(command.command_id, 'submitted', detail); } catch (e) { core.markCommand(command.command_id, 'rejected', { error: e.message }); await core.acknowledge(command.command_id, 'rejected', { error: e.message }); } } }
  catch (e) { console.warn(`IBKRNew offline: ${e.message}`); }
}, 5000);
