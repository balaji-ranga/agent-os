/**
 * IBKR portfolio analytics: durable fills, position snapshots, P&L, cash events.
 * All queries are owner-scoped (owner_user_id required — set from session, not spoofed).
 */
import { getDb } from '../db/schema.js';

const SNAPSHOT_RETENTION_DAYS = 90;
const CASH_EPS = 0.50;

export function ensureIbkrAnalyticsTables() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ibkr_fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      reservation_id INTEGER,
      run_id INTEGER,
      symbol_key TEXT NOT NULL,
      symbol TEXT,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      fill_price REAL,
      notional_usd REAL,
      ib_order_id INTEGER,
      source TEXT,
      filled_at TEXT NOT NULL DEFAULT (datetime('now')),
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_fills_owner_filled
      ON ibkr_fills(owner_user_id, filled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ibkr_fills_symbol
      ON ibkr_fills(owner_user_id, symbol_key, filled_at DESC);

    CREATE TABLE IF NOT EXISTS ibkr_position_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      symbol_key TEXT NOT NULL,
      symbol TEXT,
      exchange TEXT,
      currency TEXT,
      qty REAL NOT NULL,
      avg_cost REAL,
      mark_price REAL,
      market_value_usd REAL,
      unrealized_pnl_usd REAL,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_pos_snap_owner
      ON ibkr_position_snapshots(owner_user_id, captured_at DESC);

    CREATE TABLE IF NOT EXISTS ibkr_realized_pnl (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      fill_id INTEGER,
      reservation_id INTEGER,
      run_id INTEGER,
      symbol_key TEXT NOT NULL,
      qty REAL NOT NULL,
      exit_price REAL,
      avg_cost REAL,
      realized_pnl_usd REAL NOT NULL,
      realized_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_realized_owner
      ON ibkr_realized_pnl(owner_user_id, realized_at DESC);

    CREATE TABLE IF NOT EXISTS ibkr_cash_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      amount_usd REAL,
      balance_usd REAL,
      status TEXT NOT NULL DEFAULT 'recorded',
      source TEXT,
      note TEXT,
      event_at TEXT NOT NULL DEFAULT (datetime('now')),
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_cash_owner
      ON ibkr_cash_events(owner_user_id, event_at DESC);

    /* Last full book pushed from laptop bridge (positions + cash + open orders). */
    CREATE TABLE IF NOT EXISTS ibkr_account_snapshot_cache (
      owner_user_id TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      cash_usd REAL,
      equity_usd REAL,
      account_id TEXT,
      source TEXT,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_acct_snap_cache_captured
      ON ibkr_account_snapshot_cache(captured_at DESC);
  `);
}

/**
 * Normalize bridge / gateway snapshot-ish payload for ingest.
 * Accepts: full snap, equity_mark payload { positions, cash_usd, equity_usd }, or envelope.
 */
export function normalizeBridgeSnapshotPayload(raw = {}) {
  let obj = raw && typeof raw === 'object' ? raw : {};
  if (obj.payload && typeof obj.payload === 'object') {
    // Prefer nested snapshot when present (eod envelope).
    if (obj.payload.snapshot && typeof obj.payload.snapshot === 'object') {
      obj = { ...obj.payload.snapshot, ...obj.payload, snapshot: undefined };
    } else {
      obj = obj.payload;
    }
  }
  if (obj.snapshot && typeof obj.snapshot === 'object') {
    obj = {
      ...obj.snapshot,
      cash_usd: obj.cash_usd ?? obj.snapshot.cash_usd,
      equity_usd: obj.equity_usd ?? obj.snapshot.equity_usd,
      source: obj.source || obj.snapshot.source,
    };
  }

  const tagNum = (tag) => {
    const summary = obj.summary && typeof obj.summary === 'object' ? obj.summary : null;
    if (!summary) return null;
    const raw = summary[tag];
    if (raw == null) return null;
    const v = typeof raw === 'object' ? raw.value ?? raw.amount : raw;
    return num(v != null ? String(v).replace(/,/g, '').trim() : null);
  };
  // Prefer Gateway tags: cash ≠ equity. Never copy cash into equity (prior bug).
  const cash =
    tagNum('TotalCashValue') ??
    tagNum('SettledCash') ??
    tagNum('CashBalance') ??
    tagNum('TotalCashBalance') ??
    num(obj.cash_usd ?? obj.cash);
  let equity = tagNum('NetLiquidation') ?? num(obj.equity_usd ?? obj.equity);
  if (
    equity != null &&
    cash != null &&
    equity === cash &&
    tagNum('NetLiquidation') == null &&
    (tagNum('TotalCashValue') != null || num(obj.cash_usd) != null)
  ) {
    // Drop prior bad persistence where equity_usd was fallback-copied from cash.
    equity = null;
  }
  const positions = Array.isArray(obj.positions) ? obj.positions : [];
  const openOrders = Array.isArray(obj.open_orders)
    ? obj.open_orders
    : Array.isArray(obj.openOrders)
      ? obj.openOrders
      : [];
  const capturedAt =
    String(obj.captured_at || obj.capturedAt || obj.ts || new Date().toISOString()).trim() ||
    new Date().toISOString();

  return {
    ok: obj.ok !== false,
    mock: !!obj.mock,
    account: obj.account || obj.account_id || obj.accountId || null,
    cash_usd: cash,
    equity_usd: equity,
    summary: obj.summary && typeof obj.summary === 'object' ? obj.summary : null,
    positions,
    open_orders: openOrders,
    pending_sells: Array.isArray(obj.pending_sells) ? obj.pending_sells : [],
    pending_sell_symbols: Array.isArray(obj.pending_sell_symbols) ? obj.pending_sell_symbols : [],
    reference_prices:
      obj.reference_prices && typeof obj.reference_prices === 'object' ? obj.reference_prices : {},
    captured_at: capturedAt,
    source: String(obj.source || 'local-ibkr-bridge').slice(0, 80),
    session_ok: obj.session_ok !== false,
  };
}

/**
 * Persist full laptop/gateway account snapshot for W1 / Summary when VPS has no live Gateway.
 * @param {string} ownerUserId
 * @param {object} rawPayload
 * @param {{ source?: string, recordEquityMark?: boolean }} [opts]
 */
export function ingestAccountSnapshotFromBridge(ownerUserId, rawPayload = {}, opts = {}) {
  ensureIbkrAnalyticsTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');

  const snap = normalizeBridgeSnapshotPayload(rawPayload);
  if (opts.source) snap.source = String(opts.source).slice(0, 80);

  // Require successful session-shaped payload (cash or positions or open orders or equity).
  const hasBook =
    snap.cash_usd != null ||
    snap.equity_usd != null ||
    (snap.positions && snap.positions.length > 0) ||
    (snap.open_orders && snap.open_orders.length > 0) ||
    (snap.summary && Object.keys(snap.summary).length > 0);
  if (!hasBook) {
    throw new Error('snapshot payload empty (need cash, equity, positions, open_orders, or summary)');
  }

  const analytics = persistAccountAnalyticsSnapshot(owner, {
    positions: snap.positions,
    cashUsd: snap.cash_usd,
    referencePrices: snap.reference_prices,
    accountSummary: snap.summary,
    source: snap.source || 'bridge_push',
  });

  const db = getDb();
  const envelope = {
    ...snap,
    received_at: new Date().toISOString(),
    analytics_persist: analytics,
  };
  db.prepare(
    `INSERT INTO ibkr_account_snapshot_cache (
       owner_user_id, captured_at, cash_usd, equity_usd, account_id, source, snapshot_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id) DO UPDATE SET
       captured_at = excluded.captured_at,
       cash_usd = excluded.cash_usd,
       equity_usd = excluded.equity_usd,
       account_id = excluded.account_id,
       source = excluded.source,
       snapshot_json = excluded.snapshot_json,
       updated_at = datetime('now')`
  ).run(
    owner,
    snap.captured_at,
    snap.cash_usd,
    snap.equity_usd,
    snap.account,
    snap.source || 'bridge_push',
    JSON.stringify(envelope)
  );

  return {
    ok: true,
    owner_user_id: owner,
    captured_at: snap.captured_at,
    cash_usd: snap.cash_usd,
    equity_usd: snap.equity_usd,
    position_count: (snap.positions || []).length,
    open_orders_count: (snap.open_orders || []).length,
    source: snap.source,
    analytics_persist: analytics,
  };
}

/**
 * Latest laptop-pushed full account snapshot (maker / W1 friendly).
 */
export function getLatestAccountSnapshot(ownerUserId) {
  ensureIbkrAnalyticsTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const row = getDb()
    .prepare(`SELECT * FROM ibkr_account_snapshot_cache WHERE owner_user_id = ?`)
    .get(owner);
  if (!row) {
    return {
      ok: false,
      source: 'none',
      error: 'no_cached_snapshot',
      message:
        'No laptop IBKR account snapshot has been pushed yet. Run the local bridge with WEBHOOK_URL (or push after a successful Gateway session).',
      positions: [],
      cash_usd: null,
      equity_usd: null,
    };
  }
  let snap = null;
  try {
    snap = JSON.parse(row.snapshot_json);
  } catch {
    snap = null;
  }
  const positions = Array.isArray(snap?.positions)
    ? snap.positions
    : listPositionSnapshots(owner, { latestOnly: true });
  // Re-resolve cash/equity from stored summary tags so mis-copied columns correct themselves.
  const repaired = normalizeBridgeSnapshotPayload({
    ...(snap && typeof snap === 'object' ? snap : {}),
    cash_usd: row.cash_usd != null ? Number(row.cash_usd) : snap?.cash_usd,
    equity_usd: row.equity_usd != null ? Number(row.equity_usd) : snap?.equity_usd,
    account: row.account_id || snap?.account,
    captured_at: row.captured_at || snap?.captured_at,
  });
  return {
    ok: true,
    source: 'bridge_cache',
    account: repaired.account || row.account_id || snap?.account || null,
    cash_usd: repaired.cash_usd,
    equity_usd: repaired.equity_usd,
    captured_at: row.captured_at,
    updated_at: row.updated_at,
    push_source: row.source,
    positions,
    open_orders: Array.isArray(snap?.open_orders) ? snap.open_orders : repaired.open_orders || [],
    pending_sells: Array.isArray(snap?.pending_sells) ? snap.pending_sells : [],
    pending_sell_symbols: Array.isArray(snap?.pending_sell_symbols) ? snap.pending_sell_symbols : [],
    summary: snap?.summary || null,
    reference_prices: snap?.reference_prices || {},
    mock: !!snap?.mock,
  };
}

function num(v, d = null) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function symbolFromKey(key) {
  const k = String(key || '');
  return k.includes(':') ? k.split(':').pop() : k;
}

/** Idempotent-ish fill row + optional realized PnL for sells. */
export function recordFill({
  ownerUserId,
  reservationId = null,
  runId = null,
  symbolKey,
  symbol = null,
  side,
  qty,
  fillPrice = null,
  notionalUsd = null,
  ibOrderId = null,
  source = 'system',
  filledAt = null,
  avgCostForPnl = null,
  detail = null,
} = {}) {
  ensureIbkrAnalyticsTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('recordFill requires ownerUserId');
  const key = String(symbolKey || '').toUpperCase();
  if (!key) throw new Error('recordFill requires symbolKey');
  const q = num(qty, 0);
  if (!(q > 0)) throw new Error('recordFill requires qty > 0');

  const db = getDb();
  // Dedup: same reservation + filled status already recorded
  if (reservationId != null) {
    const existing = db
      .prepare(
        `SELECT id FROM ibkr_fills WHERE owner_user_id = ? AND reservation_id = ? LIMIT 1`
      )
      .get(owner, reservationId);
    if (existing) return { ok: true, fill_id: existing.id, deduped: true };
  }

  const price = num(fillPrice);
  const notional =
    notionalUsd != null ? num(notionalUsd) : price != null ? Number((price * q).toFixed(4)) : null;
  const sideU = String(side || 'BUY').toUpperCase();
  const at = filledAt || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const info = db
    .prepare(
      `INSERT INTO ibkr_fills (
        owner_user_id, reservation_id, run_id, symbol_key, symbol, side, qty,
        fill_price, notional_usd, ib_order_id, source, filled_at, detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      owner,
      reservationId,
      runId,
      key,
      symbol || symbolFromKey(key),
      sideU,
      q,
      price,
      notional,
      ibOrderId,
      source,
      at,
      detail != null ? JSON.stringify(detail) : null
    );

  const fillId = info.lastInsertRowid;
  let realized = null;

  if (sideU === 'SELL' || sideU === 'SELL_TO_CLOSE') {
    let cost = num(avgCostForPnl);
    if (cost == null) {
      const snap = db
        .prepare(
          `SELECT avg_cost FROM ibkr_position_snapshots
           WHERE owner_user_id = ? AND symbol_key = ?
           ORDER BY captured_at DESC, id DESC LIMIT 1`
        )
        .get(owner, key);
      cost = num(snap?.avg_cost);
    }
    if (cost == null) {
      const buy = db
        .prepare(
          `SELECT fill_price FROM ibkr_fills
           WHERE owner_user_id = ? AND symbol_key = ? AND side = 'BUY'
           ORDER BY filled_at DESC, id DESC LIMIT 1`
        )
        .get(owner, key);
      cost = num(buy?.fill_price);
    }
    if (price != null && cost != null) {
      const pnl = Number(((price - cost) * q).toFixed(4));
      const r = db
        .prepare(
          `INSERT INTO ibkr_realized_pnl (
            owner_user_id, fill_id, reservation_id, run_id, symbol_key, qty,
            exit_price, avg_cost, realized_pnl_usd, source, detail_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          owner,
          fillId,
          reservationId,
          runId,
          key,
          q,
          price,
          cost,
          pnl,
          source,
          JSON.stringify({ note: 'computed_from_fill' })
        );
      realized = { id: r.lastInsertRowid, realized_pnl_usd: pnl };
    }
  }

  return { ok: true, fill_id: fillId, deduped: false, realized };
}

/**
 * Persist a full book snapshot (positions + cash). Computes unrealized PnL when mark available.
 */
export function persistAccountAnalyticsSnapshot(
  ownerUserId,
  {
    positions = [],
    cashUsd = null,
    referencePrices = {},
    accountSummary = null,
    source = 'account_snapshot',
  } = {}
) {
  ensureIbkrAnalyticsTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('ownerUserId required');
  const db = getDb();
  const capturedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const priceMap = referencePrices || {};

  const insertPos = db.prepare(
    `INSERT INTO ibkr_position_snapshots (
      owner_user_id, captured_at, symbol_key, symbol, exchange, currency, qty,
      avg_cost, mark_price, market_value_usd, unrealized_pnl_usd, detail_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let unrealizedTotal = 0;
  const rows = [];

  const tx = db.transaction(() => {
    for (const p of positions || []) {
      const key = String(p.key || `${p.exchange || 'SMART'}:${p.symbol}` || p.symbol || '')
        .toUpperCase()
        .replace(/^:/, '');
      if (!key || !p.symbol) continue;
      const qty = num(p.qty, 0);
      if (!(qty > 0)) continue;
      const avg = num(p.avg_cost ?? p.avgCost);
      const mark =
        num(p.mark_price ?? p.market_price) ??
        num(priceMap[key]) ??
        num(priceMap[String(p.symbol || '').toUpperCase()]);
      const mkt = mark != null ? Number((mark * qty).toFixed(4)) : null;
      let upnl = null;
      if (mark != null && avg != null) {
        upnl = Number(((mark - avg) * qty).toFixed(4));
        unrealizedTotal += upnl;
      }
      insertPos.run(
        owner,
        capturedAt,
        key,
        p.symbol,
        p.exchange || '',
        p.currency || 'USD',
        qty,
        avg,
        mark,
        mkt,
        upnl,
        JSON.stringify({ source, sec_type: p.sec_type || p.secType || null })
      );
      rows.push({ symbol_key: key, qty, avg_cost: avg, mark_price: mark, unrealized_pnl_usd: upnl });
    }

    // Cash / deposit-style events
    const cash = num(cashUsd);
    if (cash != null) {
      const last = db
        .prepare(
          `SELECT balance_usd, event_type FROM ibkr_cash_events
           WHERE owner_user_id = ? AND balance_usd IS NOT NULL
           ORDER BY event_at DESC, id DESC LIMIT 1`
        )
        .get(owner);

      db.prepare(
        `INSERT INTO ibkr_cash_events (
          owner_user_id, event_type, amount_usd, balance_usd, status, source, note, event_at, detail_json
        ) VALUES (?, 'balance_snapshot', NULL, ?, 'recorded', ?, ?, ?, ?)`
      ).run(
        owner,
        cash,
        source,
        'Gateway cash snapshot',
        capturedAt,
        accountSummary ? JSON.stringify({ summary_keys: Object.keys(accountSummary || {}) }) : null
      );

      if (last?.balance_usd != null) {
        const delta = Number((cash - Number(last.balance_usd)).toFixed(4));
        if (Math.abs(delta) >= CASH_EPS) {
          // Infer funding-like move when cash jumps without us classifying the trade impact precisely
          const eventType = delta > 0 ? 'inferred_inflow' : 'inferred_outflow';
          db.prepare(
            `INSERT INTO ibkr_cash_events (
              owner_user_id, event_type, amount_usd, balance_usd, status, source, note, event_at, detail_json
            ) VALUES (?, ?, ?, ?, 'pending_review', ?, ?, ?, ?)`
          ).run(
            owner,
            eventType,
            delta,
            cash,
            source,
            'Cash balance change vs prior snapshot (may include fills, deposits, or FX). Treat as pending until classified.',
            capturedAt,
            JSON.stringify({ prior_balance: last.balance_usd, delta })
          );
        }
      }
    }

    // Prune old snapshots
    db.prepare(
      `DELETE FROM ibkr_position_snapshots
       WHERE owner_user_id = ? AND captured_at < datetime('now', ?)`
    ).run(owner, `-${SNAPSHOT_RETENTION_DAYS} days`);
  });
  tx();

  return {
    ok: true,
    captured_at: capturedAt,
    position_rows: rows.length,
    unrealized_pnl_usd: Number(unrealizedTotal.toFixed(4)),
  };
}

export function listFills(ownerUserId, { days = 30, limit = 100, symbolKey = null } = {}) {
  ensureIbkrAnalyticsTables();
  const dayWindow = Math.min(Math.max(Number(days) || 30, 1), 365);
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const db = getDb();
  if (symbolKey) {
    return db
      .prepare(
        `SELECT * FROM ibkr_fills
         WHERE owner_user_id = ? AND symbol_key = ?
           AND filled_at >= datetime('now', ?)
         ORDER BY filled_at DESC, id DESC LIMIT ?`
      )
      .all(ownerUserId, String(symbolKey).toUpperCase(), `-${dayWindow} days`, lim);
  }
  return db
    .prepare(
      `SELECT * FROM ibkr_fills
       WHERE owner_user_id = ? AND filled_at >= datetime('now', ?)
       ORDER BY filled_at DESC, id DESC LIMIT ?`
    )
    .all(ownerUserId, `-${dayWindow} days`, lim);
}

export function listPositionSnapshots(ownerUserId, { limit = 50, latestOnly = true } = {}) {
  ensureIbkrAnalyticsTables();
  const db = getDb();
  if (latestOnly) {
    const latest = db
      .prepare(
        `SELECT captured_at FROM ibkr_position_snapshots
         WHERE owner_user_id = ? ORDER BY captured_at DESC, id DESC LIMIT 1`
      )
      .get(ownerUserId);
    if (!latest) return [];
    return db
      .prepare(
        `SELECT * FROM ibkr_position_snapshots
         WHERE owner_user_id = ? AND captured_at = ?
         ORDER BY symbol_key`
      )
      .all(ownerUserId, latest.captured_at);
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return db
    .prepare(
      `SELECT * FROM ibkr_position_snapshots
       WHERE owner_user_id = ?
       ORDER BY captured_at DESC, id DESC LIMIT ?`
    )
    .all(ownerUserId, lim);
}

export function listRealizedPnl(ownerUserId, { days = 30, limit = 100 } = {}) {
  ensureIbkrAnalyticsTables();
  const dayWindow = Math.min(Math.max(Number(days) || 30, 1), 365);
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return getDb()
    .prepare(
      `SELECT * FROM ibkr_realized_pnl
       WHERE owner_user_id = ? AND realized_at >= datetime('now', ?)
       ORDER BY realized_at DESC, id DESC LIMIT ?`
    )
    .all(ownerUserId, `-${dayWindow} days`, lim);
}

export function listCashEvents(ownerUserId, { days = 30, limit = 100, pendingOnly = false } = {}) {
  ensureIbkrAnalyticsTables();
  const dayWindow = Math.min(Math.max(Number(days) || 30, 1), 365);
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  if (pendingOnly) {
    return getDb()
      .prepare(
        `SELECT * FROM ibkr_cash_events
         WHERE owner_user_id = ? AND status = 'pending_review'
           AND event_at >= datetime('now', ?)
         ORDER BY event_at DESC, id DESC LIMIT ?`
      )
      .all(ownerUserId, `-${dayWindow} days`, lim);
  }
  return getDb()
    .prepare(
      `SELECT * FROM ibkr_cash_events
       WHERE owner_user_id = ? AND event_at >= datetime('now', ?)
       ORDER BY event_at DESC, id DESC LIMIT ?`
    )
    .all(ownerUserId, `-${dayWindow} days`, lim);
}

export function getWorkflowTradeStats(ownerUserId, { days = 30 } = {}) {
  ensureIbkrAnalyticsTables();
  const dayWindow = Math.min(Math.max(Number(days) || 30, 1), 365);
  const db = getDb();
  const reservations = db
    .prepare(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(notional_usd),0) AS notional
       FROM ibkr_trade_reservations
       WHERE owner_user_id = ? AND created_at >= datetime('now', ?)
       GROUP BY status`
    )
    .all(ownerUserId, `-${dayWindow} days`);
  const fills = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(notional_usd),0) AS notional
       FROM ibkr_fills
       WHERE owner_user_id = ? AND filled_at >= datetime('now', ?)`
    )
    .get(ownerUserId, `-${dayWindow} days`);
  const byStatus = Object.fromEntries(reservations.map((r) => [r.status, { count: r.n, notional_usd: r.notional }]));
  return {
    window_days: dayWindow,
    reservations_by_status: byStatus,
    fills_count: fills?.n || 0,
    fills_notional_usd: Number(fills?.notional || 0),
    executed_count: fills?.n || byStatus.filled?.count || 0,
  };
}

/**
 * Portfolio analytics summary for API / agent tools.
 */
export async function getPortfolioAnalytics(
  ownerUserId,
  { days = 30, includeLive = true, liveSnapshot = null } = {}
) {
  ensureIbkrAnalyticsTables();
  if (!ownerUserId) throw new Error('owner_user_id required');

  const { getDayStatus, ensureIbkrLedgerTables } = await import('./ibkr-trading-ledger.js');
  ensureIbkrLedgerTables();

  let live = liveSnapshot;
  if (includeLive && !live) {
    try {
      const { fetchAccountSnapshot } = await import('./ibkr-gateway-client.js');
      live = await fetchAccountSnapshot({});
    } catch (e) {
      live = { ok: false, error: e.message };
    }
  }
  if ((!live || live.ok === false) && !liveSnapshot) {
    try {
      const cached = getLatestAccountSnapshot(ownerUserId);
      if (cached.ok) live = { ...cached, live_source: 'bridge_cache' };
    } catch {
      /* ignore */
    }
  }

  const day = getDayStatus(ownerUserId, {
    // portfolio analytics: snapshot cash first; do not pass live NetLiq as cash
    workflowCash: live?.cash_usd != null ? { cash_usd: Number(live.cash_usd) } : null,
    snapshot: live?.ok !== false && live?.cash_usd != null ? live : null,
  });
  const fills = listFills(ownerUserId, { days, limit: 200 });
  const realized = listRealizedPnl(ownerUserId, { days, limit: 200 });
  const cashEvents = listCashEvents(ownerUserId, { days, limit: 50 });
  const pendingDeposits = listCashEvents(ownerUserId, { days, limit: 50, pendingOnly: true }).filter(
    (e) => e.event_type === 'inferred_inflow' || e.event_type === 'pending_deposit'
  );
  const latestPositions = listPositionSnapshots(ownerUserId, { latestOnly: true });
  const tradeStats = getWorkflowTradeStats(ownerUserId, { days });

  const realizedTotal = realized.reduce((s, r) => s + (Number(r.realized_pnl_usd) || 0), 0);
  const unrealizedFromSnap = latestPositions.reduce(
    (s, p) => s + (Number(p.unrealized_pnl_usd) || 0),
    0
  );

  // Prefer live positions for "stocks in hand"
  const stocksInHand = (live?.positions || []).map((p) => ({
    key: p.key || `${p.exchange}:${p.symbol}`,
    symbol: p.symbol,
    qty: p.qty,
    avg_cost: p.avg_cost,
    exchange: p.exchange,
  }));

  return {
    ok: true,
    owner_user_id: ownerUserId,
    window_days: days,
    as_of: new Date().toISOString(),
    budget: {
      day: day.day,
      budget_usd: day.budget_usd,
      reserved_usd: day.reserved_usd,
      consumed_usd: day.consumed_usd,
      budget_remaining_usd: day.budget_remaining_usd,
      spendable_usd: day.spendable_usd,
      trades_placed: day.trades_placed,
      trades_remaining: day.trades_remaining,
    },
    cash: {
      live_cash_usd: live?.cash_usd ?? null,
      live_ok: live?.ok !== false,
      live_error: live?.error || null,
      pending_deposit_like_events: pendingDeposits,
      recent_cash_events: cashEvents.slice(0, 10),
    },
    positions: {
      live: stocksInHand,
      last_persisted_snapshot: latestPositions,
      last_snapshot_at: latestPositions[0]?.captured_at || null,
    },
    pnl: {
      realized_usd: Number(realizedTotal.toFixed(4)),
      unrealized_usd_from_last_snapshot: Number(unrealizedFromSnap.toFixed(4)),
      realized_trades: realized.length,
    },
    trades: {
      ...tradeStats,
      recent_fills: fills.slice(0, 20),
    },
    open_orders_count: (live?.open_orders || []).length,
  };
}
