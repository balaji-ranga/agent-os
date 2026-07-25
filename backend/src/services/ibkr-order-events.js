/**
 * IBKR order event log (30-day retention) + reservation reconcile + maker learnings.
 */
import { getDb } from '../db/schema.js';
import {
  ensureToolSummaryCacheTable,
  fullRebuildDays,
  planSummaryCache,
  readToolSummaryCache,
  scopeKeyFor,
  todayUtc,
  watermarkFor,
  writeToolSummaryCache,
} from './tool-summary-cache.js';

const ORDER_SUMMARY_CACHE_KIND = 'order_learnings';

/** Standard reason codes for cancel / lifecycle events. */
export const IBKR_ORDER_REASON = Object.freeze({
  PLACED_ACK: 'placed_ack',
  PLACE_FAILED: 'place_failed',
  PLACE_REJECTED_IB: 'place_rejected_ib',
  /** Day-plan or poller cancelled open orders before SELL_TO_CLOSE */
  WORKFLOW_CANCEL_BEFORE_SELL: 'workflow_cancel_before_sell',
  /** Explicit cancel-all from day-plan / ops (rare) */
  WORKFLOW_DAYPLAN_CANCEL: 'workflow_dayplan_cancel',
  /** Explicit cancel from poller path */
  WORKFLOW_POLLER_CANCEL: 'workflow_poller_cancel',
  /** E2E / script cancel-all */
  WORKFLOW_E2E_CANCEL_ALL: 'workflow_e2e_cancel_all',
  /** Generic workflow cancel when source unknown */
  WORKFLOW_CANCEL: 'workflow_cancel',
  IB_SYSTEM_CANCEL: 'ib_system_cancel',
  /** IBKR Lite: order not eligible for commission-free; resubmit on Fixed/regular commission */
  IB_COMMISSION_FREE_REJECT: 'ib_commission_free_reject',
  IB_TIF_DAY_EXPIRED: 'ib_tif_day_expired',
  IB_TIF_MINUTES_EXPIRED: 'ib_tif_minutes_expired',
  RECONCILE_MISSING: 'reconcile_missing_from_open_orders',
  FILLED: 'filled',
  RESERVATION_RELEASED: 'reservation_released',
});

/** Detect IBKR Lite commission-free eligibility rejects. */
export function isCommissionFreeRejectText(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  return (
    t.includes('commission free') ||
    t.includes('commission-free') ||
    t.includes('not eligible for commission') ||
    (t.includes('regular commission') && (t.includes('resubmit') || t.includes('eligible'))) ||
    (t.includes('fixed commission') && (t.includes('resubmit') || t.includes('eligible')))
  );
}

/**
 * Pull advancedErrorOverride tags from IB advancedOrderReject JSON (various shapes).
 * @returns {string|null} comma-separated override tags
 */
export function extractAdvancedErrorOverride(reject) {
  if (reject == null || reject === '') return null;
  let obj = reject;
  if (typeof reject === 'string') {
    const s = reject.trim();
    if (!s) return null;
    try {
      obj = JSON.parse(s);
    } catch {
      // bare tag list already?
      if (/^[A-Za-z0-9_,]+$/.test(s) && s.length < 200) return s;
      return null;
    }
  }
  if (typeof obj !== 'object') return null;
  if (typeof obj.advancedErrorOverride === 'string' && obj.advancedErrorOverride.trim()) {
    return obj.advancedErrorOverride.trim();
  }
  if (typeof obj['8229'] === 'string' && obj['8229'].trim()) return obj['8229'].trim();
  const tags = [];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && !tags.includes(s)) tags.push(s);
  };
  for (const row of obj.rules || obj.errors || obj.args || []) {
    if (!row || typeof row !== 'object') continue;
    if (row.id != null) push(row.id);
    if (row.tag != null) push(row.tag);
    if (row.value != null && String(row.key || row.id || '') === '8229') push(row.value);
    if (row.key === '8229' || row.key === 8229) push(row.value);
  }
  // Nested message blobs
  for (const key of ['message', 'error', 'errorMsg', 'reason']) {
    if (typeof obj[key] === 'string' && isCommissionFreeRejectText(obj[key])) {
      /* keep searching tags */
    }
  }
  return tags.length ? tags.join(',') : null;
}

const RETENTION_DAYS = 30;
/** Don't reconcile away a just-placed reservation (seconds). */
const RECONCILE_GRACE_SEC = 120;

export function ensureIbkrOrderEventTables(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ibkr_order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      reservation_id INTEGER,
      run_id INTEGER,
      symbol_key TEXT,
      symbol TEXT,
      side TEXT,
      ib_order_id INTEGER,
      status TEXT NOT NULL,
      reason_code TEXT,
      reason_text TEXT,
      source TEXT,
      error_code INTEGER,
      qty REAL,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ibkr_order_events_owner_created
      ON ibkr_order_events(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ibkr_order_events_symbol
      ON ibkr_order_events(owner_user_id, symbol_key, created_at DESC);
  `);
}

export function pruneIbkrOrderEventsOlderThan(days = RETENTION_DAYS, db = getDb()) {
  ensureIbkrOrderEventTables(db);
  const info = db
    .prepare(
      `DELETE FROM ibkr_order_events
       WHERE created_at < datetime('now', ?)`
    )
    .run(`-${Number(days) || RETENTION_DAYS} days`);
  return { deleted: info.changes || 0, retention_days: Number(days) || RETENTION_DAYS };
}

/**
 * @param {object} evt
 * @returns {{ id: number }}
 */
export function recordOrderEvent(evt = {}) {
  ensureIbkrOrderEventTables();
  const db = getDb();
  pruneIbkrOrderEventsOlderThan(RETENTION_DAYS, db);
  const owner = String(evt.owner_user_id || evt.ownerUserId || '').trim();
  if (!owner) throw new Error('recordOrderEvent requires owner_user_id');
  const status = String(evt.status || 'unknown').slice(0, 64);
  const info = db
    .prepare(
      `INSERT INTO ibkr_order_events
        (owner_user_id, reservation_id, run_id, symbol_key, symbol, side, ib_order_id,
         status, reason_code, reason_text, source, error_code, qty, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      owner,
      evt.reservation_id ?? evt.reservationId ?? null,
      evt.run_id ?? evt.runId ?? null,
      evt.symbol_key || evt.symbolKey || null,
      evt.symbol || null,
      evt.side || null,
      evt.ib_order_id ?? evt.ibOrderId ?? null,
      status,
      evt.reason_code || evt.reasonCode || null,
      evt.reason_text || evt.reasonText || null,
      evt.source || null,
      evt.error_code ?? evt.errorCode ?? null,
      evt.qty != null ? Number(evt.qty) : null,
      evt.detail != null || evt.detail_json != null
        ? JSON.stringify(evt.detail ?? evt.detail_json)
        : null
    );
  return { id: Number(info.lastInsertRowid) };
}

export function listOrderEvents(
  ownerUserId,
  { days = RETENTION_DAYS, limit = 100, symbolKey = null } = {}
) {
  ensureIbkrOrderEventTables();
  const db = getDb();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const dayWindow = Math.min(Math.max(Number(days) || RETENTION_DAYS, 1), RETENTION_DAYS);
  if (symbolKey) {
    return db
      .prepare(
        `SELECT * FROM ibkr_order_events
         WHERE owner_user_id = ?
           AND UPPER(symbol_key) = UPPER(?)
           AND created_at >= datetime('now', ?)
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(ownerUserId, symbolKey, `-${dayWindow} days`, lim);
  }
  return db
    .prepare(
      `SELECT * FROM ibkr_order_events
       WHERE owner_user_id = ?
         AND created_at >= datetime('now', ?)
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(ownerUserId, `-${dayWindow} days`, lim);
}

function classifyReasonText(text = '') {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (isCommissionFreeRejectText(t)) {
    return IBKR_ORDER_REASON.IB_COMMISSION_FREE_REJECT;
  }
  if (t.includes('margin calculation') || t.includes('not available for trading')) {
    return IBKR_ORDER_REASON.IB_SYSTEM_CANCEL;
  }
  if (t.includes('day') && (t.includes('expired') || t.includes('cancelled'))) {
    return IBKR_ORDER_REASON.IB_TIF_DAY_EXPIRED;
  }
  if (t.includes('minutes') || t.includes('ioc')) {
    return IBKR_ORDER_REASON.IB_TIF_MINUTES_EXPIRED;
  }
  return IBKR_ORDER_REASON.IB_SYSTEM_CANCEL;
}

function openOrderSymbolSet(openOrders = []) {
  const set = new Set();
  for (const o of openOrders || []) {
    const sym = String(o.symbol || '').toUpperCase();
    if (sym) set.add(sym);
    const ex = String(o.exchange || '').toUpperCase();
    if (sym && ex) set.add(`${ex}:${sym}`);
  }
  return set;
}

function positionKeySet(positions = []) {
  const set = new Set();
  for (const p of positions || []) {
    if (!(Number(p.qty) > 0)) continue;
    const key = String(p.key || '').toUpperCase();
    const sym = String(p.symbol || '').toUpperCase();
    if (key) set.add(key);
    if (sym) set.add(sym);
    if (p.exchange && sym) set.add(`${String(p.exchange).toUpperCase()}:${sym}`);
  }
  return set;
}

function reservationMatchesOpen(row, openSet) {
  const key = String(row.symbol_key || '').toUpperCase();
  const sym = key.includes(':') ? key.split(':').pop() : key;
  if (key && openSet.has(key)) return true;
  if (sym && openSet.has(sym)) return true;
  return false;
}

function reservationMatchesPosition(row, posSet) {
  const key = String(row.symbol_key || '').toUpperCase();
  const sym = key.includes(':') ? key.split(':').pop() : key;
  if (key && posSet.has(key)) return true;
  if (sym && posSet.has(sym)) return true;
  return false;
}

/**
 * Reconcile reserved ledger rows vs live open orders / positions.
 * - BUY reserved + position → confirm fill
 * - reserved + still open → keep
 * - reserved + missing (past grace) → release + order event
 */
export async function reconcileReservationsWithBroker(
  ownerUserId,
  { openOrders = [], positions = [], graceSec = RECONCILE_GRACE_SEC } = {}
) {
  ensureIbkrOrderEventTables();
  const { releaseReservation, confirmFill, ensureIbkrLedgerTables } = await import(
    './ibkr-trading-ledger.js'
  );
  ensureIbkrLedgerTables();
  const db = getDb();
  const reserved = db
    .prepare(
      `SELECT * FROM ibkr_trade_reservations
       WHERE owner_user_id = ? AND status = 'reserved'
       ORDER BY id ASC`
    )
    .all(ownerUserId);
  const openSet = openOrderSymbolSet(openOrders);
  const posSet = positionKeySet(positions);
  const graceMs = (Number(graceSec) || RECONCILE_GRACE_SEC) * 1000;
  const now = Date.now();
  const actions = [];

  for (const row of reserved) {
    const created =
      Date.parse(String(row.created_at || '').replace(' ', 'T') + 'Z') || Date.parse(row.created_at);
    const ageMs = Number.isFinite(created) ? now - created : graceMs + 1;
    const side = String(row.side || '').toUpperCase();
    const onOpen = reservationMatchesOpen(row, openSet);
    const onPos = reservationMatchesPosition(row, posSet);

    if (side === 'BUY' && onPos && !onOpen) {
      const pos = (positions || []).find((p) => {
        const pk = String(p.key || `${p.exchange}:${p.symbol}` || p.symbol || '').toUpperCase();
        const rk = String(row.symbol_key || '').toUpperCase();
        return pk === rk || String(p.symbol || '').toUpperCase() === rk.split(':').pop();
      });
      confirmFill(row.id, {
        fillPrice: pos?.avg_cost ?? null,
        fillQty: row.qty,
        source: 'reconcile',
        avgCostForPnl: pos?.avg_cost ?? null,
      });
      recordOrderEvent({
        owner_user_id: ownerUserId,
        reservation_id: row.id,
        run_id: row.run_id,
        symbol_key: row.symbol_key,
        side: row.side,
        status: 'Filled',
        reason_code: IBKR_ORDER_REASON.FILLED,
        reason_text: 'Reconcile: position present, open order gone — marked filled',
        source: 'reconcile',
        qty: row.qty,
        detail: { avg_cost: pos?.avg_cost ?? null },
      });
      actions.push({ reservation_id: row.id, action: 'filled', symbol_key: row.symbol_key });
      continue;
    }

    if (onOpen) {
      actions.push({ reservation_id: row.id, action: 'still_open', symbol_key: row.symbol_key });
      continue;
    }

    if (ageMs < graceMs) {
      actions.push({
        reservation_id: row.id,
        action: 'grace',
        symbol_key: row.symbol_key,
        age_sec: Math.round(ageMs / 1000),
      });
      continue;
    }

    // Missing from open book — assume cancelled/expired by IB (or never stayed open)
    releaseReservation(row.id, { reason: 'cancelled' });
    const reasonCode = IBKR_ORDER_REASON.RECONCILE_MISSING;
    const reasonText =
      'Reserved trade no longer in IB open orders (and no matching position). Likely IB cancel/TIF expiry.';
    recordOrderEvent({
      owner_user_id: ownerUserId,
      reservation_id: row.id,
      run_id: row.run_id,
      symbol_key: row.symbol_key,
      side: row.side,
      status: 'Cancelled',
      reason_code: reasonCode,
      reason_text: reasonText,
      source: 'reconcile',
      qty: row.qty,
      detail: { notional_usd: row.notional_usd },
    });
    actions.push({
      reservation_id: row.id,
      action: 'released_cancelled',
      symbol_key: row.symbol_key,
      reason_code: reasonCode,
    });
  }

  return {
    ok: true,
    checked: reserved.length,
    actions,
    released: actions.filter((a) => a.action === 'released_cancelled').length,
    filled: actions.filter((a) => a.action === 'filled').length,
  };
}

function summarizeAvoidHints(events = []) {
  const hints = [];
  const seen = new Set();
  for (const e of events) {
    const text = `${e.reason_text || ''} ${e.reason_code || ''}`.toLowerCase();
    const key = String(e.symbol_key || e.symbol || '').toUpperCase();
    // Commission-free rejects are NOT hard avoids — Maker must decide (see commission_decisions)
    if (
      e.reason_code === IBKR_ORDER_REASON.IB_COMMISSION_FREE_REJECT ||
      isCommissionFreeRejectText(text)
    ) {
      continue;
    }
    if (
      text.includes('margin') ||
      text.includes('not available for trading') ||
      e.reason_code === IBKR_ORDER_REASON.IB_SYSTEM_CANCEL
    ) {
      const hint = key
        ? `Avoid ${key} on this account — IB rejected/cancelled (${e.reason_code || 'ib_system'}): ${(e.reason_text || '').slice(0, 120)}`
        : `IB system cancel: ${(e.reason_text || e.reason_code || '').slice(0, 140)}`;
      if (!seen.has(hint)) {
        seen.add(hint);
        hints.push(hint);
      }
    }
    if (e.reason_code === IBKR_ORDER_REASON.IB_TIF_DAY_EXPIRED || text.includes('tif_day')) {
      const hint = 'Unfilled equity DAY entries expire at RTH close — size/price for same-session fill or accept residual.';
      if (!seen.has(hint)) {
        seen.add(hint);
        hints.push(hint);
      }
    }
    if (
      e.reason_code === IBKR_ORDER_REASON.RECONCILE_MISSING &&
      key.startsWith('PAXOS:')
    ) {
      const hint = `Crypto ${key} disappeared from open orders without a fill — paper PAXOS may be unsupported; prefer equities until proven.`;
      if (!seen.has(hint)) {
        seen.add(hint);
        hints.push(hint);
      }
    }
  }
  return hints.slice(0, 12);
}

/**
 * Maker-facing commission decisions (IBKR Lite → Fixed).
 * Maker chooses retry_with_commission vs avoid_this_run using market context.
 */
export function summarizeCommissionDecisions(events = []) {
  const byKey = new Map();
  for (const e of events) {
    const text = `${e.reason_text || ''} ${e.reason_code || ''}`;
    const isComm =
      e.reason_code === IBKR_ORDER_REASON.IB_COMMISSION_FREE_REJECT ||
      isCommissionFreeRejectText(text);
    if (!isComm) continue;
    const key = String(e.symbol_key || e.symbol || '').toUpperCase() || 'UNKNOWN';
    let override = null;
    try {
      const detail = e.detail_json ? JSON.parse(e.detail_json) : null;
      override = detail?.advanced_error_override || detail?.advancedErrorOverride || null;
    } catch {
      /* ignore */
    }
    const prev = byKey.get(key);
    if (!prev || String(e.created_at || '') >= String(prev.created_at || '')) {
      byKey.set(key, {
        symbol_key: key,
        created_at: e.created_at,
        reason_text: String(e.reason_text || '').slice(0, 200),
        advanced_error_override: override,
        decision_required: true,
        options: ['retry_with_commission', 'avoid_this_run'],
        guidance:
          'Decide from market context: set trade.retry_with_commission=true and widen tp_pct/stop_pct for round-trip Fixed commission drag, OR put the name in residual with residual_reason=avoid_commission_this_run.',
      });
    }
  }
  return [...byKey.values()].slice(0, 12);
}

/** Last known advancedErrorOverride for a symbol (from commission rejects). */
export function getLastCommissionOverride(ownerUserId, symbolKey, { days = RETENTION_DAYS } = {}) {
  const key = String(symbolKey || '').toUpperCase();
  if (!ownerUserId || !key) return null;
  const events = listOrderEvents(ownerUserId, { days, limit: 80, symbolKey: key });
  for (const e of events) {
    if (
      e.reason_code !== IBKR_ORDER_REASON.IB_COMMISSION_FREE_REJECT &&
      !isCommissionFreeRejectText(e.reason_text)
    ) {
      continue;
    }
    try {
      const detail = e.detail_json ? JSON.parse(e.detail_json) : null;
      const ov = detail?.advanced_error_override || detail?.advancedErrorOverride;
      if (ov) return String(ov);
    } catch {
      /* ignore */
    }
  }
  // Also try without symbol filter (key may be SMART:AMD vs NASDAQ:AMD)
  const sym = key.includes(':') ? key.split(':').pop() : key;
  for (const e of listOrderEvents(ownerUserId, { days, limit: 80 })) {
    const sk = String(e.symbol_key || e.symbol || '').toUpperCase();
    if (sk !== key && !sk.endsWith(`:${sym}`) && sk !== sym) continue;
    try {
      const detail = e.detail_json ? JSON.parse(e.detail_json) : null;
      const ov = detail?.advanced_error_override || detail?.advancedErrorOverride;
      if (ov) return String(ov);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Maker-facing learnings blob (last N days, capped).
 * Heuristic digest — use getOrderHistory({ responseType: 'summarized' }) for LLM context.
 */
export function buildOrderLearnings(ownerUserId, { days = RETENTION_DAYS, limit = 40 } = {}) {
  const events = listOrderEvents(ownerUserId, { days, limit });
  const cancels = events.filter((e) =>
    /cancel|reject|fail|inactive/i.test(String(e.status || ''))
  );
  const fills = events.filter((e) => /fill/i.test(String(e.status || '')));
  const bullets = [];
  for (const e of cancels.slice(0, 15)) {
    bullets.push(
      `${e.created_at} ${e.symbol_key || e.symbol || '?'} ${e.status}` +
        (e.reason_code ? ` [${e.reason_code}]` : '') +
        (e.reason_text ? `: ${String(e.reason_text).slice(0, 160)}` : '')
    );
  }
  const windowDays = Math.min(Math.max(Number(days) || RETENTION_DAYS, 1), RETENTION_DAYS);
  const commission_decisions = summarizeCommissionDecisions(events);
  return {
    retention_days: RETENTION_DAYS,
    window_days: windowDays,
    event_count: events.length,
    cancel_or_reject_count: cancels.length,
    fill_count: fills.length,
    avoid_hints: summarizeAvoidHints(events),
    commission_decisions,
    summary_bullets: bullets,
    recent_events: events.slice(0, 25).map((e) => ({
      id: e.id,
      created_at: e.created_at,
      symbol_key: e.symbol_key,
      side: e.side,
      status: e.status,
      reason_code: e.reason_code,
      reason_text: e.reason_text,
      source: e.source,
      error_code: e.error_code,
      ib_order_id: e.ib_order_id,
    })),
  };
}

function buildActualOrderContextText(learnings) {
  const hints = learnings.avoid_hints || [];
  const bullets = learnings.summary_bullets || [];
  const commissions = learnings.commission_decisions || [];
  const parts = [];
  if (commissions.length) {
    parts.push(
      'COMMISSION DECISIONS (IBKR Lite — Maker must choose per symbol for THIS run):\n' +
        commissions
          .map(
            (c) =>
              `- ${c.symbol_key}: prior reject "${c.reason_text}". Choose retry_with_commission (widen tp_pct/stop_pct for Fixed commission drag) OR avoid_this_run (residual).` +
              (c.advanced_error_override ? ' Override tags available from prior reject.' : '')
          )
          .join('\n')
    );
  }
  if (hints.length) {
    parts.push('Avoid hints (hard):\n' + hints.map((h) => `- ${h}`).join('\n'));
  }
  if (bullets.length) {
    parts.push('Recent cancels/rejects:\n' + bullets.map((b) => `- ${b}`).join('\n'));
  }
  if (!parts.length) {
    return `No IBKR order events in the last ${learnings.window_days} day(s).`;
  }
  return `IBKR order history (last ${learnings.window_days} day(s), ${learnings.event_count} events):\n\n${parts.join('\n\n')}`;
}

async function llmSummarizeOrderHistory(learnings, { purpose, ownerUserId = null } = {}) {
  const { chatCompletions } = await import('../config/llm.js');
  const raw = buildActualOrderContextText(learnings);
  const eventsBlob = (learnings.recent_events || [])
    .slice(0, 30)
    .map(
      (e) =>
        `${e.created_at} ${e.symbol_key || '?'} ${e.status} [${e.reason_code || ''}] ${String(e.reason_text || '').slice(0, 120)}`
    )
    .join('\n');

  const { content, modelUsed } = await chatCompletions({
    messages: [
      {
        role: 'system',
        content: `Compress IBKR order/cancel history into durable trading lessons for a Maker agent.
Plain text only (no JSON, no fences). Short bullets.
Focus on: products to hard-avoid, IBKR Lite commission-free rejects that need Maker decision (retry_with_commission vs avoid_this_run), TIF/session lessons, repeated reject codes, what worked (fills).
For commission rejects: do NOT say "never trade" — tell Maker to decide using market context and adjust tp/stop if retrying with Fixed commission.
Max ~400 words.`,
      },
      {
        role: 'user',
        content: `Purpose: ${purpose || 'IBKR Maker order learnings'}
Window: ${learnings.window_days} days, ${learnings.event_count} events

${raw}

Event log:
${eventsBlob || '(none)'}

Write the learning context now.`,
      },
    ],
    maxTokens: 900,
    ownerUserId,
  });
  return {
    summary: String(content || '').trim() || raw,
    model_used: modelUsed,
  };
}

/**
 * Order history API helper — mirrors brain-history response_type.
 * @param {{
 *   ownerUserId: string,
 *   days?: number,
 *   limit?: number,
 *   symbolKey?: string|null,
 *   responseType?: 'actual'|'summarized',
 *   purpose?: string,
 * }} opts
 */
export async function getOrderHistory(opts = {}) {
  ensureIbkrOrderEventTables();
  const ownerUserId = opts.ownerUserId || opts.owner_user_id;
  if (!ownerUserId) throw new Error('owner_user_id required');
  const days = Math.min(Math.max(Number(opts.days) || 7, 1), RETENTION_DAYS);
  const limit = opts.limit != null ? Number(opts.limit) : 40;
  const symbolKey = opts.symbolKey || opts.symbol_key || opts.key || null;
  const responseType = String(opts.responseType || opts.response_type || 'actual').toLowerCase();
  const force = opts.force === true || opts.refresh === true;

  const events = listOrderEvents(ownerUserId, { days, limit, symbolKey });
  const learnings = buildOrderLearnings(ownerUserId, { days, limit });

  const base = {
    ok: true,
    response_type: responseType === 'summarized' ? 'summarized' : 'actual',
    days,
    retention_days: RETENTION_DAYS,
    symbol_key: symbolKey,
    event_count: events.length,
  };

  if (responseType === 'summarized') {
    if (!events.length) {
      const empty = `No IBKR order events in the last ${days} day(s).`;
      return {
        ...base,
        events: [],
        order_learnings: learnings,
        summary: empty,
        context_text: empty,
        bodyText: empty,
        model_used: null,
        cached: false,
        cache_mode: 'no_data',
      };
    }

    const slimEvents = events.map((e) => ({
      id: e.id,
      created_at: e.created_at,
      symbol_key: e.symbol_key,
      status: e.status,
      reason_code: e.reason_code,
      source: e.source,
    }));
    const slimLearnings = {
      window_days: learnings.window_days,
      event_count: learnings.event_count,
      cancel_or_reject_count: learnings.cancel_or_reject_count,
      fill_count: learnings.fill_count,
      avoid_hints: learnings.avoid_hints,
      commission_decisions: learnings.commission_decisions,
    };

    const db = getDb();
    ensureToolSummaryCacheTable(db);
    const scopeKey = scopeKeyFor([days, symbolKey || '*']);
    const watermark = watermarkFor(events);
    const today = todayUtc();
    const cache = readToolSummaryCache(db, {
      ownerUserId,
      kind: ORDER_SUMMARY_CACHE_KIND,
      scopeKey,
    });
    const plan = planSummaryCache({
      cache,
      watermark,
      today,
      maxBaseAgeDays: fullRebuildDays('ORDER_LEARNINGS_FULL_REBUILD_DAYS', 7),
      force,
    });

    if (plan.mode !== 'rebuild') {
      if (plan.mode === 'no_new') {
        writeToolSummaryCache(db, {
          owner_user_id: ownerUserId,
          kind: ORDER_SUMMARY_CACHE_KIND,
          scope_key: scopeKey,
          summary: cache.summary,
          model: cache.model || '',
          watermark,
          item_count: events.length,
          base_generated_at: cache.base_generated_at,
          valid_date: today,
          updated_at: new Date().toISOString(),
        });
      }
      return {
        ...base,
        events: slimEvents,
        order_learnings: slimLearnings,
        summary: cache.summary,
        context_text: cache.summary,
        bodyText: cache.summary,
        model_used: cache.model || null,
        cached: true,
        cache_mode: plan.mode,
        generated_at: cache.base_generated_at || null,
      };
    }

    const { summary, model_used } = await llmSummarizeOrderHistory(learnings, {
      purpose: opts.purpose,
      ownerUserId,
    });
    const generatedAt = new Date().toISOString();
    writeToolSummaryCache(db, {
      owner_user_id: ownerUserId,
      kind: ORDER_SUMMARY_CACHE_KIND,
      scope_key: scopeKey,
      summary,
      model: model_used || '',
      watermark,
      item_count: events.length,
      base_generated_at: generatedAt,
      valid_date: today,
      updated_at: generatedAt,
    });
    return {
      ...base,
      events: slimEvents,
      order_learnings: slimLearnings,
      summary,
      context_text: summary,
      bodyText: summary,
      model_used,
      cached: false,
      cache_mode: 'rebuild',
      cache_reason: plan.reason,
      generated_at: generatedAt,
    };
  }

  const context_text = buildActualOrderContextText(learnings);
  return {
    ...base,
    events,
    order_learnings: learnings,
    summary: null,
    context_text,
    bodyText: context_text,
    model_used: null,
  };
}

/** Infer standard reason for workflow cancel source. */
export function standardCancelReason(source = 'workflow') {
  const s = String(source || '').toLowerCase();
  if (s === 'dayplan' || s === 'day-plan' || s === 'maker-checker') {
    return {
      reason_code: IBKR_ORDER_REASON.WORKFLOW_DAYPLAN_CANCEL,
      reason_text: 'Cancelled by day-plan workflow',
      source: 'dayplan',
    };
  }
  if (s === 'poller' || s === 'position-poller') {
    return {
      reason_code: IBKR_ORDER_REASON.WORKFLOW_POLLER_CANCEL,
      reason_text: 'Cancelled by position poller workflow',
      source: 'poller',
    };
  }
  if (s === 'e2e' || s === 'test') {
    return {
      reason_code: IBKR_ORDER_REASON.WORKFLOW_E2E_CANCEL_ALL,
      reason_text: 'Cancelled by E2E/test cleanup',
      source: 'e2e',
    };
  }
  if (s === 'before_sell' || s === 'sell_to_close') {
    return {
      reason_code: IBKR_ORDER_REASON.WORKFLOW_CANCEL_BEFORE_SELL,
      reason_text: 'Cancelled open orders for symbol before SELL_TO_CLOSE (day-plan or poller)',
      source: 'workflow',
    };
  }
  return {
    reason_code: IBKR_ORDER_REASON.WORKFLOW_CANCEL,
    reason_text: 'Cancelled by Agent OS workflow',
    source: 'workflow',
  };
}

export function reasonFromIbMessage(message, { status = 'Cancelled' } = {}) {
  const code = classifyReasonText(message);
  return {
    status,
    reason_code: code || IBKR_ORDER_REASON.IB_SYSTEM_CANCEL,
    reason_text: String(message || '').slice(0, 500),
    source: 'ib',
  };
}
