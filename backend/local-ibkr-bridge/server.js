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
import { loadPlanMap } from './src/plan-map.js';

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

  /**
   * After a successful IBKR Gateway read, push full book to VPS (W3 → ingest).
   * Call regardless of whether placement succeeded — only requires session snapshot ok.
   * @param {object} snap
   * @param {object} [extra]
   */
  function pushAccountSnapshotFromSession(snap, extra = {}) {
    if (!snap || snap.ok === false) {
      return { ok: false, skipped: true, reason: 'session_snapshot_unavailable' };
    }
    const mark = ibkr.equityFromSnapshot(snap);
    const payload = {
      ...mark,
      summary: snap.summary || null,
      reference_prices: snap.reference_prices || {},
      mock: !!snap.mock,
      session_ok: true,
      ...extra,
    };
    const envelope = emitBridgeEvent(BRIDGE_EVENTS.ACCOUNT_SNAPSHOT, payload);
    logInfo('account_snapshot queued for VPS', {
      event: envelope.event,
      cash_usd: payload.cash_usd,
      equity_usd: payload.equity_usd,
      positions: (payload.positions || []).length,
      reason: extra.reason || extra.phase || null,
    });
    return { ok: true, event: envelope.event, payload };
  }

  /**
   * Fetch snapshot once Gateway session works; always push account_snapshot on success.
   * @param {object} [extra]
   * @param {{ alsoEquityMark?: boolean, alsoEod?: boolean }} [opts]
   */
  async function fetchAndPushSessionSnapshot(extra = {}, opts = {}) {
    const snap = await ibkr.fetchAccountSnapshot({});
    if (!snap || snap.ok === false) {
      throw new Error(snap?.error || 'account snapshot failed');
    }
    const pushed = pushAccountSnapshotFromSession(snap, extra);
    let equity = null;
    let eod = null;
    if (opts.alsoEquityMark) {
      const mark = ibkr.equityFromSnapshot(snap);
      const envelope = emitBridgeEvent(BRIDGE_EVENTS.EQUITY_MARK, { ...mark, ...extra });
      equity = { ok: true, event: envelope.event, payload: envelope.payload };
    }
    if (opts.alsoEod) {
      const mark = ibkr.equityFromSnapshot(snap);
      const envelope = emitBridgeEvent(BRIDGE_EVENTS.EOD_SNAPSHOT, {
        ...mark,
        snapshot: snap,
        ...extra,
      });
      eod = { ok: true, event: envelope.event, payload: envelope.payload };
    }
    return { ok: true, snapshot: snap, account_snapshot: pushed, equity_mark: equity, eod_snapshot: eod };
  }

  async function pushEquityMark(extra = {}) {
    return fetchAndPushSessionSnapshot({ ...extra, phase: 'equity_mark' }, { alsoEquityMark: true });
  }

  async function pushEodSnapshot(extra = {}) {
    return fetchAndPushSessionSnapshot({ ...extra, phase: 'eod_snapshot' }, { alsoEod: true });
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
        const snap = await ibkr.fetchAccountSnapshot({
          allowlist: body.allowlist || null,
          timeoutMs: body.timeoutMs,
        });
        // Successful Gateway session → push book to VPS for W1 learnings (async via webhook).
        if (snap?.ok !== false && body.push !== false && body.skip_push !== true) {
          try {
            pushAccountSnapshotFromSession(snap, {
              reason: 'local_account_snapshot',
              phase: 'account-snapshot',
            });
          } catch (e) {
            logWarn('account_snapshot push skip', { error: e.message || String(e) });
          }
        }
        sendJson(res, 200, snap);
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

      /**
       * Map Maker day-plan actions → place-bracket / modify-stop / sell-to-close.
       * Accepts open-plans API body, a plan row, or raw maker JSON with actions[].
       */
      if (method === 'POST' && path === '/map-day-plan') {
        const body = await readJson(req);
        const { mapDayPlanToBridgeOrders } = await loadPlanMap();
        const mapping = mapDayPlanToBridgeOrders(body, {
          respectCeoApproval: body.respect_ceo_approval !== false,
        });
        sendJson(res, mapping.ok ? 200 : 400, mapping);
        return;
      }

      if (method === 'POST' && path === '/execute-day-plan') {
        const body = await readJson(req);
        const { mapDayPlanToBridgeOrders, suggestExecutionStatus } = await loadPlanMap();
        const mapping = mapDayPlanToBridgeOrders(body, {
          respectCeoApproval: body.respect_ceo_approval !== false,
        });
        if (!mapping.ok) {
          sendJson(res, 400, {
            ok: false,
            error: mapping.error || 'map_failed',
            mapping,
            suggested_status: 'failed',
          });
          return;
        }

        logInfo('execute-day-plan mapping', {
          plan_date: mapping.plan_date,
          trades: mapping.summary.trade_count,
          stops: mapping.summary.stop_count,
          sells: mapping.summary.sell_count,
          skipped: mapping.summary.skipped_count,
        });

        const place_bracket = await ibkr.placeBracket(mapping.trades, {
          ownerUserId: body.owner_user_id || null,
          postAckWatchMs: body.postAckWatchMs,
        });

        const modify_stops = [];
        for (const s of mapping.modify_stops) {
          // eslint-disable-next-line no-await-in-loop
          const r = await ibkr.modifyStop(s);
          modify_stops.push({ request: s, result: r, ok: r?.ok !== false });
        }

        const sell_to_close = [];
        for (const s of mapping.sells) {
          // eslint-disable-next-line no-await-in-loop
          const r = await ibkr.sellToClose(s);
          sell_to_close.push({ request: s, result: r, ok: r?.ok !== false });
        }

        const suggested_status = suggestExecutionStatus(
          mapping,
          place_bracket,
          modify_stops.map((x) => x.result),
          sell_to_close.map((x) => x.result)
        );

        const dry =
          place_bracket?.dry_run === true ||
          modify_stops.some((x) => x.result?.dry_run) ||
          sell_to_close.some((x) => x.result?.dry_run);

        // Always try a post-session snapshot for VPS learnings — independent of place success.
        let session_snapshot_push = null;
        try {
          session_snapshot_push = await fetchAndPushSessionSnapshot({
            reason: 'after_execute_day_plan',
            phase: 'execute-day-plan',
            plan_date: mapping.plan_date,
            suggested_status,
            place_ok: place_bracket?.ok !== false,
          });
        } catch (e) {
          logWarn('post execute-day-plan snapshot push failed', {
            error: e.message || String(e),
          });
          session_snapshot_push = { ok: false, error: e.message || String(e) };
        }

        sendJson(res, 200, {
          ok: true,
          dry_run: !!dry,
          plan_date: mapping.plan_date,
          selected_plan: mapping.selected_plan,
          mapping: {
            summary: mapping.summary,
            trades: mapping.trades,
            modify_stops: mapping.modify_stops,
            sells: mapping.sells,
            skipped: mapping.skipped,
          },
          place_bracket,
          modify_stops,
          sell_to_close,
          suggested_status,
          session_snapshot_push,
        });
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

      if (method === 'POST' && path === '/push-account-snapshot') {
        const body = await readJson(req);
        try {
          const r = await fetchAndPushSessionSnapshot({
            reason: body.reason || 'manual_push',
            phase: 'push-account-snapshot',
            ...(body || {}),
          });
          sendJson(res, 200, r);
        } catch (e) {
          sendJson(res, 503, { ok: false, error: e.message || String(e) });
        }
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

  return { server, cfg, ibkr, pusher, stop, pushEquityMark, pushEodSnapshot, fetchAndPushSessionSnapshot };
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entry && import.meta.url === entry) {
  startBridge().catch((e) => {
    logError('fatal', { error: e.message || String(e) });
    process.exit(1);
  });
}
