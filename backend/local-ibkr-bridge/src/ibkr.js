/**
 * Thin wrappers around backend ibkr-gateway-client (dynamic import).
 * Mock mode (BRIDGE_MOCK_IBKR=1) never touches the Gateway.
 *
 * Resolve order: BRIDGE_GATEWAY_MODULE → vendor/ (standalone zip) → backend/src/services.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKEND_ROOT, BRIDGE_ROOT, isTradingEnabled } from './config.js';
import { emitBridgeEvent, BRIDGE_EVENTS } from './event-bus.js';
import { logInfo, logWarn } from './log.js';

function resolveGatewayPath() {
  const fromEnv = String(process.env.BRIDGE_GATEWAY_MODULE || '').trim();
  if (fromEnv) return resolve(fromEnv);
  const vendor = join(BRIDGE_ROOT, 'vendor', 'ibkr-gateway-client.js');
  if (existsSync(vendor)) return vendor;
  return resolve(BACKEND_ROOT, 'src/services/ibkr-gateway-client.js');
}

let gatewayModPromise = null;
let gatewayPathCached = null;

async function loadGateway() {
  const GATEWAY_PATH = resolveGatewayPath();
  if (gatewayModPromise && gatewayPathCached === GATEWAY_PATH) return gatewayModPromise;
  gatewayPathCached = GATEWAY_PATH;
  gatewayModPromise = import(pathToFileURL(GATEWAY_PATH).href).catch((e) => {
    gatewayModPromise = null;
    gatewayPathCached = null;
    throw new Error(
      `Failed to import ibkr-gateway-client from ${GATEWAY_PATH}: ${e.message || e}`
    );
  });
  return gatewayModPromise;
}

function mockSnapshot() {
  return {
    ok: true,
    mock: true,
    account: 'DU_MOCK',
    cash_usd: 100000,
    equity_usd: 100000,
    summary: {
      TotalCashValue: { value: '100000', currency: 'USD' },
      NetLiquidation: { value: '100000', currency: 'USD' },
    },
    positions: [],
    open_orders: [],
    pending_sells: [],
    pending_sell_symbols: [],
    reference_prices: {},
    captured_at: new Date().toISOString(),
  };
}

function classifyOrderEvent(result) {
  if (!result) return null;
  if (result.terminal_cancelled || /reject/i.test(result.terminal_status || '')) {
    return BRIDGE_EVENTS.REJECT;
  }
  const status = String(result.terminal_status || result.status || '').toLowerCase();
  if (status.includes('fill') || result.filled) return BRIDGE_EVENTS.FILL;
  if (status.includes('stop')) return BRIDGE_EVENTS.STOP_OUT;
  return BRIDGE_EVENTS.ORDER_STATUS;
}

/**
 * @param {{ mockIbkr?: boolean }} opts
 */
export function createIbkrApi(opts = {}) {
  const mock = !!opts.mockIbkr;

  return {
    async ping() {
      if (mock) {
        return {
          ok: true,
          mock: true,
          account: 'DU_MOCK',
          host: process.env.IBKR_HOST || '127.0.0.1',
          port: Number(process.env.IBKR_PORT || 4002),
        };
      }
      const gw = await loadGateway();
      return gw.pingIbGateway();
    },

    async fetchAccountSnapshot(args = {}) {
      if (mock) return mockSnapshot();
      const gw = await loadGateway();
      return gw.fetchAccountSnapshot(args);
    },

    async listOpenOrders() {
      const snap = await this.fetchAccountSnapshot({});
      return {
        ok: true,
        mock: !!snap.mock,
        open_orders: snap.open_orders || [],
        account: snap.account,
        captured_at: snap.captured_at,
      };
    },

    /**
     * Place brackets / sells. Respects IBKR_TRADING_ENABLED dry-run.
     * @param {object[]} trades
     */
    async placeBracket(trades = [], placeOpts = {}) {
      const list = Array.isArray(trades) ? trades : [];
      if (!list.length) return { ok: false, error: 'trades[] required' };

      if (!isTradingEnabled()) {
        logInfo('place-bracket dry-run (IBKR_TRADING_ENABLED off)', {
          count: list.length,
          symbols: list.map((t) => t.symbol || t.key).slice(0, 10),
        });
        const dry = list.map((t, i) => ({
          ok: true,
          dry_run: true,
          key: t.key || t.symbol,
          side: t.side || 'BUY',
          orderIds: [900000 + i],
        }));
        emitBridgeEvent(BRIDGE_EVENTS.ORDER_STATUS, {
          dry_run: true,
          results: dry,
        });
        return { ok: true, dry_run: true, results: dry };
      }

      if (mock) {
        const results = list.map((t, i) => ({
          ok: true,
          mock: true,
          key: t.key || t.symbol,
          side: t.side || 'BUY',
          orderIds: [800000 + i],
        }));
        emitBridgeEvent(BRIDGE_EVENTS.ORDER_STATUS, { mock: true, results });
        return { ok: true, mock: true, results };
      }

      const gw = await loadGateway();
      const placed = await gw.placeBracketTrades(list, placeOpts);
      for (const r of placed.results || []) {
        const ev = classifyOrderEvent(r);
        if (ev) emitBridgeEvent(ev, { trade: { key: r.key, side: r.side }, result: r });
      }
      return placed;
    },

    async sellToClose(trade = {}) {
      const body = { ...trade, side: 'SELL_TO_CLOSE' };
      return this.placeBracket([body]);
    },

    /**
     * Best-effort stop modify: cancel matching STP for symbol, place new STP.
     * IB TWS API has no reliable in-place auxPrice amend for child stops in all cases.
     */
    async modifyStop({
      symbol,
      stop_price,
      qty,
      order_id = null,
      exchange = '',
      currency = 'USD',
      secType = 'STK',
    } = {}) {
      const sym = String(symbol || '').toUpperCase();
      const stop = Number(stop_price);
      if (!sym || !(stop > 0)) {
        return { ok: false, error: 'symbol and stop_price required' };
      }

      if (!isTradingEnabled()) {
        logInfo('modify-stop dry-run', { symbol: sym, stop_price: stop });
        return {
          ok: true,
          dry_run: true,
          method: 'cancel_replace',
          limitation:
            'IB API: best-effort cancel+replace STP; no guaranteed in-place stop amend',
          symbol: sym,
          stop_price: stop,
        };
      }

      if (mock) {
        return {
          ok: true,
          mock: true,
          method: 'cancel_replace',
          symbol: sym,
          stop_price: stop,
          cancelled: order_id ? [order_id] : [],
          new_order_id: 810001,
        };
      }

      const gw = await loadGateway();
      const { EventName, OrderType, OrderAction, SecType, TimeInForce } = await import('@stoqey/ib');

      // Cancel+replace only STP sells — leave take-profit LMT alone when possible.
      const result = await gw.withIbGateway(async (ib, { nextId, account }) => {
        if (!account) throw new Error('No IBKR account id');

        const stopOrders = [];
        await new Promise((resolveList) => {
          const t = setTimeout(resolveList, 8000);
          const onOpen = (oid, contract, order) => {
            const oSym = String(contract?.symbol || '').toUpperCase();
            const oType = String(order?.orderType || '').toUpperCase();
            const oAction = String(order?.action || '').toUpperCase();
            if (oSym !== sym) return;
            if (order_id != null && Number(oid) === Number(order_id)) {
              stopOrders.push({ order_id: oid });
              return;
            }
            if (order_id == null && oAction === 'SELL' && oType.includes('STP')) {
              stopOrders.push({ order_id: oid });
            }
          };
          const onEnd = () => {
            clearTimeout(t);
            ib.off(EventName.openOrder, onOpen);
            ib.off(EventName.openOrderEnd, onEnd);
            resolveList();
          };
          ib.on(EventName.openOrder, onOpen);
          ib.on(EventName.openOrderEnd, onEnd);
          ib.reqAllOpenOrders();
        });

        const cancelled = [];
        for (const row of stopOrders) {
          try {
            ib.cancelOrder(row.order_id);
            cancelled.push(row.order_id);
          } catch {
            /* ignore */
          }
        }
        if (cancelled.length) await new Promise((r) => setTimeout(r, 500));
        if (!stopOrders.length) {
          logWarn('modify-stop: no STP found for symbol; placing new stop', { symbol: sym });
        }

        const q = Number(qty);
        if (!(q > 0)) {
          throw new Error('modify-stop requires qty when placing replacement STP');
        }

        const oid = nextId;
        const isCrypto = String(secType).toUpperCase() === 'CRYPTO';
        const contract = isCrypto
          ? {
              symbol: sym,
              secType: SecType.CRYPTO,
              exchange: exchange || 'PAXOS',
              currency: currency || 'USD',
            }
          : {
              symbol: sym,
              secType: SecType.STK,
              exchange: 'SMART',
              primaryExch: exchange || undefined,
              currency: currency || 'USD',
            };

        const order = {
          orderId: oid,
          action: OrderAction.SELL,
          orderType: OrderType.STP,
          totalQuantity: q,
          auxPrice: stop,
          tif: TimeInForce.GTC,
          account,
          transmit: true,
          outsideRth: false,
        };

        const ack = new Promise((resolveAck, reject) => {
          const t = setTimeout(() => reject(new Error(`No openOrder ack for stop ${oid}`)), 15000);
          const onOpen = (id) => {
            if (id === oid) {
              clearTimeout(t);
              ib.off(EventName.openOrder, onOpen);
              resolveAck();
            }
          };
          ib.on(EventName.openOrder, onOpen);
        });
        ib.placeOrder(oid, contract, order);
        await ack;
        return { order_id: oid, account, cancelled };
      });

      emitBridgeEvent(BRIDGE_EVENTS.ORDER_STATUS, {
        action: 'modify_stop',
        symbol: sym,
        stop_price: stop,
        cancelled: result.cancelled,
        new_order_id: result.order_id,
      });

      return {
        ok: true,
        method: 'cancel_replace',
        limitation:
          'IB API does not reliably support in-place STP amend; cancelled matching STP sells and placed a new STP (TP LMT left intact when possible)',
        symbol: sym,
        stop_price: stop,
        cancelled: result.cancelled,
        new_order_id: result.order_id,
        account: result.account,
      };
    },

    async cancel({ order_id = null, symbol = null, all = false } = {}) {
      if (!isTradingEnabled()) {
        return {
          ok: true,
          dry_run: true,
          order_id,
          symbol,
          all,
        };
      }
      if (mock) {
        return { ok: true, mock: true, cancelled: order_id != null ? [order_id] : [], symbol };
      }
      const gw = await loadGateway();
      if (all) {
        return gw.cancelAllOpenOrders({ cancelSource: 'bridge_cancel' });
      }
      if (symbol) {
        return gw.cancelOpenOrdersForSymbol(symbol, { cancelSource: 'bridge_cancel' });
      }
      if (order_id != null) {
        return gw.withIbGateway(async (ib) => {
          ib.cancelOrder(Number(order_id));
          await new Promise((r) => setTimeout(r, 500));
          return { ok: true, cancelled: [Number(order_id)] };
        });
      }
      return { ok: false, error: 'provide order_id, symbol, or all: true' };
    },

    /**
     * Cash + equity from snapshot for webhook equity_mark / eod.
     */
    equityFromSnapshot(snap) {
      const cash =
        snap?.cash_usd != null
          ? Number(snap.cash_usd)
          : Number(snap?.summary?.TotalCashValue?.value);
      const equity =
        Number(snap?.summary?.NetLiquidation?.value) ||
        (Number.isFinite(cash) ? cash : null) ||
        Number(snap?.equity_usd);
      return {
        cash_usd: Number.isFinite(cash) ? cash : null,
        equity_usd: Number.isFinite(equity) ? equity : null,
        account: snap?.account || null,
        positions: snap?.positions || [],
        open_orders: snap?.open_orders || [],
        captured_at: snap?.captured_at || new Date().toISOString(),
      };
    },
  };
}
