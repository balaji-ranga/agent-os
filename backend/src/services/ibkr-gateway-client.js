/**
 * Direct IB Gateway / TWS socket client for paper bracket placement.
 * Uses @stoqey/ib — does not require MCP for order submission.
 */
import { IBApi, EventName, OrderType, OrderAction, SecType, TimeInForce } from '@stoqey/ib';
import { getIbkrTradingConfig } from './ibkr-trading-rules.js';

function gatewayOptions() {
  return {
    host: process.env.IBKR_HOST || '127.0.0.1',
    port: Number(process.env.IBKR_PORT || 4002),
    clientId: Number(process.env.IBKR_CLIENT_ID || 17),
  };
}

function assertPaperSafe({ requireTradingEnabled = true } = {}) {
  const cfg = getIbkrTradingConfig();
  if (!cfg.isPaper && process.env.IBKR_ALLOW_LIVE !== '1') {
    throw new Error('Refusing non-paper IBKR orders — set IBKR_IS_PAPER=true or IBKR_ALLOW_LIVE=1');
  }
  if (requireTradingEnabled && !cfg.tradingEnabled) {
    throw new Error('IBKR_TRADING_ENABLED is off');
  }
}

function toContract(trade) {
  const symbol = String(trade.symbol || '').toUpperCase();
  const currency = String(trade.currency || 'USD').toUpperCase();
  const exchange = String(trade.exchange || '').toUpperCase();
  const primary = exchange === 'BATS' ? 'BATS' : exchange === 'SGX' ? 'SGX' : exchange || undefined;
  return {
    symbol,
    secType: SecType.STK,
    exchange: exchange === 'SGX' ? 'SGX' : 'SMART',
    primaryExch: primary && primary !== 'SMART' ? primary : undefined,
    currency,
  };
}

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Connect briefly, run fn(ib, { nextId, account }), disconnect.
 */
export async function withIbGateway(fn, { timeoutMs = 45000, requireTradingEnabled = true } = {}) {
  assertPaperSafe({ requireTradingEnabled });
  const opts = gatewayOptions();
  const ib = new IBApi(opts);

  return new Promise((resolve, reject) => {
    let settled = false;
    let nextId = null;
    let account = process.env.IBKR_ACCOUNT_ID || null;
    const timer = setTimeout(() => {
      cleanup(new Error(`IB Gateway timeout after ${timeoutMs}ms (${opts.host}:${opts.port})`));
    }, timeoutMs);

    const cleanup = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ib.disconnect();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(value);
    };

    ib.on(EventName.error, (err, code, reqId) => {
      const msg = err?.message || String(err);
      // Informational IB codes (2104 market data farm, etc.) — ignore soft ones
      if ([2104, 2106, 2158, 2119].includes(Number(code))) return;
      if (settled) return;
      // Hard failures during connect / place
      if (Number(code) >= 500 || Number(reqId) === -1) {
        cleanup(new Error(`IB error ${code}: ${msg}`));
      }
    });

    ib.on(EventName.connected, () => {
      ib.reqIds();
      if (!account) ib.reqManagedAccts();
    });

    ib.on(EventName.managedAccounts, (accountsList) => {
      if (!account && accountsList) {
        account = String(accountsList).split(',')[0]?.trim() || null;
      }
    });

    ib.once(EventName.nextValidId, async (id) => {
      nextId = id;
      try {
        // brief wait for managed accounts if needed
        if (!account) {
          await new Promise((r) => setTimeout(r, 500));
        }
        const result = await fn(ib, { nextId, account, opts });
        cleanup(null, result);
      } catch (e) {
        cleanup(e);
      }
    });

    try {
      ib.connect();
    } catch (e) {
      cleanup(e);
    }
  });
}

/**
 * Place a BUY bracket (entry LMT + TP LMT + SL STP) or plain SELL_TO_CLOSE LMT.
 * @returns {{ orderIds: number[], account: string, key: string, side: string }}
 */
export async function placeBracketTrade(trade) {
  const side = String(trade.side || 'BUY').toUpperCase();
  const qty = Number(trade.qty);
  if (!qty || qty <= 0) throw new Error(`Invalid qty for ${trade.key || trade.symbol}`);

    if (side === 'SELL_TO_CLOSE' || side === 'SELL') {
      // Cancel resting bracket children / parents for this symbol first
      try {
        await cancelOpenOrdersForSymbol(trade.symbol || trade.key?.split(':')?.pop());
      } catch {
        /* best-effort */
      }
      return withIbGateway(async (ib, { nextId, account }) => {
        if (!account) throw new Error('No IBKR account id');
        const contract = toContract(trade);
        const oid = nextId;
        const order = {
          orderId: oid,
          action: OrderAction.SELL,
          orderType: OrderType.LMT,
          totalQuantity: qty,
          lmtPrice: roundPrice(trade.entry_price ?? trade.reference_price),
          tif: TimeInForce.DAY,
          account,
          transmit: true,
          outsideRth: false,
        };
        const ack = new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error(`No openOrder ack for order ${oid}`)), 15000);
          const onOpen = (id) => {
            if (id === oid) {
              clearTimeout(t);
              ib.off(EventName.openOrder, onOpen);
              resolve();
            }
          };
          ib.on(EventName.openOrder, onOpen);
        });
        ib.placeOrder(oid, contract, order);
        await ack;
        return { orderIds: [oid], account, key: trade.key, side, contract };
      });
    }

    return withIbGateway(async (ib, { nextId, account }) => {
    if (!account) throw new Error('No IBKR account id (set IBKR_ACCOUNT_ID or wait for managedAccounts)');
    const contract = toContract(trade);
    let orderId = nextId;
    const orderIds = [];

    const waitAck = (oid) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`No openOrder ack for order ${oid}`)), 15000);
        const onOpen = (id) => {
          if (id === oid) {
            clearTimeout(t);
            ib.off(EventName.openOrder, onOpen);
            ib.off(EventName.error, onErr);
            resolve();
          }
        };
        const onErr = (err, code, reqId) => {
          if (reqId === oid && ![2104, 2106, 2158].includes(Number(code))) {
            clearTimeout(t);
            ib.off(EventName.openOrder, onOpen);
            ib.off(EventName.error, onErr);
            reject(new Error(`Order ${oid} rejected (${code}): ${err?.message || err}`));
          }
        };
        ib.on(EventName.openOrder, onOpen);
        ib.on(EventName.error, onErr);
      });

    // BUY bracket
    const parentId = orderId++;
    const tpId = orderId++;
    const slId = orderId++;
    orderIds.push(parentId, tpId, slId);

    const entry = roundPrice(trade.entry_price);
    const tp = roundPrice(trade.tp_price);
    const stop = roundPrice(trade.stop_price);

    const parent = {
      orderId: parentId,
      action: OrderAction.BUY,
      orderType: OrderType.LMT,
      totalQuantity: qty,
      lmtPrice: entry,
      tif: TimeInForce.DAY,
      account,
      transmit: false,
      outsideRth: false,
    };
    const takeProfit = {
      orderId: tpId,
      action: OrderAction.SELL,
      orderType: OrderType.LMT,
      totalQuantity: qty,
      lmtPrice: tp,
      tif: TimeInForce.GTC,
      account,
      parentId,
      transmit: false,
      outsideRth: false,
    };
    const stopLoss = {
      orderId: slId,
      action: OrderAction.SELL,
      orderType: OrderType.STP,
      totalQuantity: qty,
      auxPrice: stop,
      tif: TimeInForce.GTC,
      account,
      parentId,
      transmit: true,
      outsideRth: false,
    };

    const ackParent = waitAck(parentId);
    ib.placeOrder(parentId, contract, parent);
    ib.placeOrder(tpId, contract, takeProfit);
    ib.placeOrder(slId, contract, stopLoss);
    await ackParent;
    await new Promise((r) => setTimeout(r, 800));

    return {
      orderIds,
      account,
      key: trade.key,
      side: 'BUY',
      contract,
      entry,
      take_profit: tp,
      stop,
    };
  });
}

/** Place many trades sequentially; returns per-trade results. */
export async function placeBracketTrades(trades = []) {
  const results = [];
  for (const trade of trades) {
    try {
      const placed = await placeBracketTrade(trade);
      results.push({ ok: true, ...placed });
    } catch (e) {
      results.push({
        ok: false,
        key: trade.key,
        error: e.message || String(e),
      });
    }
  }
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

export async function pingIbGateway() {
  return withIbGateway(
    async (_ib, ctx) => ({
      ok: true,
      account: ctx.account,
      nextId: ctx.nextId,
      host: ctx.opts.host,
      port: ctx.opts.port,
    }),
    { requireTradingEnabled: false }
  );
}

function cashFromSummary(summary = {}) {
  const prefer = ['TotalCashValue', 'AvailableFunds', 'NetLiquidation'];
  for (const tag of prefer) {
    const n = Number(summary[tag]?.value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Live paper/live book snapshot: cash, positions, open orders, pending sells.
 */
export async function fetchAccountSnapshot({ timeoutMs = 60000 } = {}) {
  return withIbGateway(
    async (ib, { account }) => {
      const summary = {};
      const positions = [];
      const openOrders = [];

      await new Promise((resolve, reject) => {
        const reqId = 9101;
        const t = setTimeout(() => reject(new Error('accountSummary timeout')), 20000);
        const onSum = (id, acct, tag, value, currency) => {
          if (id !== reqId) return;
          summary[tag] = { value, currency, account: acct };
        };
        const onEnd = (id) => {
          if (id !== reqId) return;
          clearTimeout(t);
          ib.off(EventName.accountSummary, onSum);
          ib.off(EventName.accountSummaryEnd, onEnd);
          resolve();
        };
        ib.on(EventName.accountSummary, onSum);
        ib.on(EventName.accountSummaryEnd, onEnd);
        ib.reqAccountSummary(reqId, 'All', 'TotalCashValue,AvailableFunds,NetLiquidation,BuyingPower');
      });

      await new Promise((resolve) => {
        const t = setTimeout(resolve, 10000);
        const onPos = (acct, contract, pos, avgCost) => {
          if (!contract?.symbol || Number(pos) === 0) return;
          positions.push({
            account: acct,
            symbol: contract.symbol,
            exchange: contract.primaryExch || contract.exchange || '',
            currency: contract.currency || 'USD',
            qty: Number(pos),
            avg_cost: avgCost != null ? Number(avgCost) : null,
            sec_type: contract.secType,
          });
        };
        const onEnd = () => {
          clearTimeout(t);
          ib.off(EventName.position, onPos);
          ib.off(EventName.positionEnd, onEnd);
          resolve();
        };
        ib.on(EventName.position, onPos);
        ib.on(EventName.positionEnd, onEnd);
        ib.reqPositions();
      });

      await new Promise((resolve) => {
        const t = setTimeout(resolve, 10000);
        const onOpen = (orderId, contract, order, orderState) => {
          openOrders.push({
            order_id: orderId,
            symbol: contract?.symbol || '',
            exchange: contract?.primaryExch || contract?.exchange || '',
            action: order?.action || '',
            order_type: order?.orderType || '',
            qty: order?.totalQuantity != null ? Number(order.totalQuantity) : null,
            lmt_price: order?.lmtPrice,
            aux_price: order?.auxPrice,
            parent_id: order?.parentId || 0,
            status: orderState?.status || '',
          });
        };
        const onEnd = () => {
          clearTimeout(t);
          ib.off(EventName.openOrder, onOpen);
          ib.off(EventName.openOrderEnd, onEnd);
          resolve();
        };
        ib.on(EventName.openOrder, onOpen);
        ib.on(EventName.openOrderEnd, onEnd);
        ib.reqAllOpenOrders();
      });

      const pendingSells = openOrders.filter((o) => String(o.action).toUpperCase() === 'SELL');
      const cashUsd = cashFromSummary(summary);
      return {
        ok: true,
        account,
        cash_usd: cashUsd,
        summary,
        positions,
        open_orders: openOrders,
        pending_sells: pendingSells,
        pending_sell_symbols: [...new Set(pendingSells.map((o) => String(o.symbol).toUpperCase()).filter(Boolean))],
        captured_at: new Date().toISOString(),
      };
    },
    { requireTradingEnabled: false, timeoutMs }
  );
}

/** Cancel all open orders (paper cleanup / E2E). */
export async function cancelAllOpenOrders() {
  return withIbGateway(
    async (ib) => {
      const ids = [];
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 10000);
        const onOpen = (orderId) => {
          if (orderId != null) ids.push(orderId);
        };
        const onEnd = () => {
          clearTimeout(t);
          ib.off(EventName.openOrder, onOpen);
          ib.off(EventName.openOrderEnd, onEnd);
          resolve();
        };
        ib.on(EventName.openOrder, onOpen);
        ib.on(EventName.openOrderEnd, onEnd);
        ib.reqAllOpenOrders();
      });
      const unique = [...new Set(ids)];
      for (const id of unique) {
        try {
          ib.cancelOrder(id);
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
      return { ok: true, cancelled: unique };
    },
    { requireTradingEnabled: true, timeoutMs: 45000 }
  );
}

/** Cancel open orders for a symbol (parents + children) before SELL_TO_CLOSE. */
export async function cancelOpenOrdersForSymbol(symbol) {
  const sym = String(symbol || '').toUpperCase();
  if (!sym) return { ok: true, cancelled: [] };
  return withIbGateway(
    async (ib) => {
      const toCancel = [];
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 8000);
        const onOpen = (orderId, contract) => {
          if (String(contract?.symbol || '').toUpperCase() === sym) toCancel.push(orderId);
        };
        const onEnd = () => {
          clearTimeout(t);
          ib.off(EventName.openOrder, onOpen);
          ib.off(EventName.openOrderEnd, onEnd);
          resolve();
        };
        ib.on(EventName.openOrder, onOpen);
        ib.on(EventName.openOrderEnd, onEnd);
        ib.reqAllOpenOrders();
      });
      for (const id of toCancel) {
        try {
          ib.cancelOrder(id);
        } catch {
          /* ignore */
        }
      }
      await new Promise((r) => setTimeout(r, 500));
      return { ok: true, cancelled: toCancel, symbol: sym };
    },
    { requireTradingEnabled: true, timeoutMs: 30000 }
  );
}
