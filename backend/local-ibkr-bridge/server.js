/**
 * Local IBKR HTTP bridge - loopback JSON API for W2 desktop execution.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadConfig, isPaperAccount } from './src/config.js';
import { assertLoopbackHost, checkBearerAuth } from './src/auth.js';
import { createIbkrApi } from './src/ibkr.js';
import { createWebhookPusher } from './src/webhook-pusher.js';
import { onBridgeEvent, emitBridgeEvent, BRIDGE_EVENTS } from './src/event-bus.js';
import { logInfo, logWarn, logError } from './src/log.js';

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('invalid JSON: ' + (e.message || String(e))));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(raw);
}

/**
 * @param {ReturnType<typeof loadConfig>} [cfgOverride]
 */
export async function startBridge(cfgOverride = null) {
  const cfg = cfgOverride || loadConfig();
  assertLoopbackHost(cfg.host);

  if (cfg.ephemeralToken) {
    logWarn('ephemeral LOCAL_BRIDGE_TOKEN minted (logged once; not persisted)', {
      token_prefix: cfg.token.slice(0, 8) + '...',
      hint: 'set LOCAL_BRIDGE_TOKEN in .env for stable auth',
    });
    console.log('[bridge] EPHEMERAL_TOKEN=' + cfg.token);
  }

  const ibkr = createIbkrApi({ mockIbkr: cfg.mockIbkr });
  const pusher = createWebhookPusher(cfg);
  pusher.start();

  const unsub = onBridgeEvent((envelope) => {
    pusher.push(envelope).catch((e) => {
      logError('event push failed', { error: e.message || String(e) });
    });
  });

  let equityTimer = null;

  async function pushEquityMark(extra = {}) {
    const snap = await ibkr.fetchAccountSnapshot({});
    const mark = ibkr.equityFromSnapshot(snap);
    const envelope = emitBridgeEvent(BRIDGE_EVENTS.EQUITY_MARK, { ...mark, ...extra });
    return { ok: true, event: envelope.event, payload: envelope.payload };
  }

  async function pushEodSnapshot(extra = {}) {
    const snap = await ibkr.fetchAccountSnapshot({});
    const mark = ibkr.equityFromSnapshot(snap);
    const envelope = emitBridgeEvent(BRIDGE_EVENTS.EOD_SNAPSHOT, {
      ...mark,
      snapshot: snap,
      ...extra,
    });
    return { ok: true, event: envelope.event, payload: { ...mark, ...extra } };
  }

  if (cfg.equityMarkIntervalSec > 0) {
    const ms = cfg.equityMarkIntervalSec * 1000;
    equityTimer = setInterval(() => {
      pushEquityMark({ scheduled: true }).catch((e) => {
        logWarn('scheduled equity mark failed', { error: e.message || String(e) });
      });
    }, ms);
    if (typeof equityTimer.unref === 'function') equityTimer.unref();
    logInfo('equity mark interval armed', { sec: cfg.equityMarkIntervalSec });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://' + cfg.host + ':' + cfg.port);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = (req.method || 'GET').toUpperCase();

    try {
      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, {
          ok: true,
          paper: isPaperAccount(),
          host: cfg.host,
          port: cfg.port,
          mock: cfg.mockIbkr,
          trading_enabled: cfg.ibkr.tradingEnabled,
        });
        return;
      }

      if (!checkBearerAuth(req, cfg.token)) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      if (method === 'GET' && path === '/ping') {
        sendJson(res, 200, await ibkr.ping());
        return;
      }

      if (method === 'POST' && path === '/account-snapshot') {
        const body = await readJson(req);
        sendJson(
          res,
          200,
          await ibkr.fetchAccountSnapshot({
            allowlist: body.allowlist || null,
            timeoutMs: body.timeoutMs,
          })
        );
        return;
      }

      if (method === 'POST' && path === '/place-bracket') {
        const body = await readJson(req);
        const trades = body.trades || body.orders || [];
        const result = await ibkr.placeBracket(trades, {
          ownerUserId: body.owner_user_id || null,
          postAckWatchMs: body.postAckWatchMs,
        });
        sendJson(res, result.ok === false ? 400 : 200, result);
        return;
      }

      if (method === 'POST' && path === '/sell-to-close') {
        const body = await readJson(req);
        const trade = body.trade || body;
        const result = await ibkr.sellToClose(trade);
        sendJson(res, result.ok === false ? 400 : 200, result);
        return;
      }

      if (method === 'POST' && path === '/modify-stop') {
        const body = await readJson(req);
        const result = await ibkr.modifyStop(body);
        sendJson(res, result.ok === false ? 400 : 200, result);
        return;
      }

      if (method === 'POST' && path === '/cancel') {
        const body = await readJson(req);
        const result = await ibkr.cancel(body);
        sendJson(res, result.ok === false ? 400 : 200, result);
        return;
      }

      if (method === 'GET' && path === '/open-orders') {
        sendJson(res, 200, await ibkr.listOpenOrders());
        return;
      }

      if (method === 'POST' && path === '/push-equity-mark') {
        const body = await readJson(req);
        sendJson(res, 200, await pushEquityMark(body || {}));
        return;
      }

      if (method === 'POST' && path === '/push-eod-snapshot') {
        const body = await readJson(req);
        sendJson(res, 200, await pushEodSnapshot(body || {}));
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      logError('request failed', { path, method, error: e.message || String(e) });
      sendJson(res, 500, { ok: false, error: e.message || String(e) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(cfg.port, cfg.host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  logInfo('listening', {
    url: 'http://' + cfg.host + ':' + cfg.port,
    paper: isPaperAccount(),
    mock: cfg.mockIbkr,
    webhook_configured: Boolean(cfg.webhookUrl),
  });

  function stop() {
    unsub();
    if (equityTimer) clearInterval(equityTimer);
    pusher.stop();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  return { server, cfg, ibkr, pusher, stop, pushEquityMark, pushEodSnapshot };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  startBridge().catch((e) => {
    logError('fatal', { error: e.message || String(e) });
    process.exit(1);
  });
}
