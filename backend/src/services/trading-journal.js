/**
 * Trading journal summary from IBKR fills / realized PnL / order events.
 * Graceful when tables are empty or missing.
 */
import { getDb } from '../db/schema.js';

function tableExists(db, name) {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/**
 * @param {string} ownerUserId
 * @param {{ days?: number }} opts
 */
export function summarizeJournal(ownerUserId, { days = 30 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const windowDays = Math.min(Math.max(Number(days) || 30, 1), 365);
  const db = getDb();
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();

  const out = {
    ok: true,
    owner_user_id: owner,
    days: windowDays,
    since,
    fills_count: 0,
    buys: 0,
    sells: 0,
    realized_pnl_usd: 0,
    win_count: 0,
    loss_count: 0,
    win_rate: null,
    avg_win_usd: null,
    avg_loss_usd: null,
    profit_factor: null,
    order_events_count: 0,
    cancels: 0,
    rejects: 0,
    notes: [],
  };

  if (tableExists(db, 'ibkr_fills')) {
    try {
      const fills = db
        .prepare(
          `SELECT side, qty, fill_price, notional_usd, filled_at, symbol_key
           FROM ibkr_fills
           WHERE owner_user_id = ? AND filled_at >= ?
           ORDER BY filled_at DESC`
        )
        .all(owner, since);
      out.fills_count = fills.length;
      for (const f of fills) {
        const side = String(f.side || '').toUpperCase();
        if (side === 'BUY') out.buys += 1;
        else if (side === 'SELL' || side === 'SELL_SHORT') out.sells += 1;
      }
    } catch (e) {
      out.notes.push(`fills: ${e.message}`);
    }
  } else {
    out.notes.push('ibkr_fills table not present');
  }

  if (tableExists(db, 'ibkr_realized_pnl')) {
    try {
      const rows = db
        .prepare(
          `SELECT realized_pnl_usd, realized_at, symbol_key
           FROM ibkr_realized_pnl
           WHERE owner_user_id = ? AND realized_at >= ?`
        )
        .all(owner, since);
      const wins = [];
      const losses = [];
      let total = 0;
      for (const r of rows) {
        const p = num(r.realized_pnl_usd);
        total += p;
        if (p > 0) {
          wins.push(p);
          out.win_count += 1;
        } else if (p < 0) {
          losses.push(p);
          out.loss_count += 1;
        }
      }
      out.realized_pnl_usd = Number(total.toFixed(4));
      const decided = out.win_count + out.loss_count;
      out.win_rate = decided > 0 ? Number((out.win_count / decided).toFixed(4)) : null;
      out.avg_win_usd =
        wins.length > 0
          ? Number((wins.reduce((s, v) => s + v, 0) / wins.length).toFixed(4))
          : null;
      out.avg_loss_usd =
        losses.length > 0
          ? Number((losses.reduce((s, v) => s + v, 0) / losses.length).toFixed(4))
          : null;
      const sumWins = wins.reduce((s, v) => s + v, 0);
      const sumLossAbs = Math.abs(losses.reduce((s, v) => s + v, 0));
      out.profit_factor =
        sumLossAbs > 0 ? Number((sumWins / sumLossAbs).toFixed(4)) : wins.length ? null : null;
      if (sumLossAbs > 0) out.profit_factor = Number((sumWins / sumLossAbs).toFixed(4));
      else if (sumWins > 0) out.profit_factor = null; // undefined when no losses
    } catch (e) {
      out.notes.push(`realized_pnl: ${e.message}`);
    }
  } else {
    out.notes.push('ibkr_realized_pnl table not present');
  }

  if (tableExists(db, 'ibkr_order_events')) {
    try {
      const events = db
        .prepare(
          `SELECT status, reason_code
           FROM ibkr_order_events
           WHERE owner_user_id = ? AND created_at >= ?`
        )
        .all(owner, since);
      out.order_events_count = events.length;
      for (const ev of events) {
        const st = String(ev.status || '').toLowerCase();
        if (st.includes('cancel')) out.cancels += 1;
        if (st.includes('reject')) out.rejects += 1;
      }
    } catch (e) {
      out.notes.push(`order_events: ${e.message}`);
    }
  } else {
    out.notes.push('ibkr_order_events table not present');
  }

  console.log(
    '[trading-journal] owner=%s days=%s fills=%s realized=%s',
    owner,
    windowDays,
    out.fills_count,
    out.realized_pnl_usd
  );
  return out;
}
