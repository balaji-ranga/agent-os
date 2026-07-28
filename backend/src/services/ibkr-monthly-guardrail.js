/**
 * Monthly equity marks + drawdown guardrail for IBKR monthly trading system.
 * Owner-scoped; drawdown stop % from env/arg (default 4).
 */
import { getDb } from '../db/schema.js';

let ensured = false;

export function ensureIbkrMonthlyTables(db = getDb()) {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ibkr_equity_marks (
      owner_user_id TEXT NOT NULL,
      mark_date TEXT NOT NULL,
      equity_usd REAL NOT NULL,
      cash_usd REAL,
      month_key TEXT NOT NULL,
      month_hwm_usd REAL NOT NULL,
      detail_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, mark_date)
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_equity_marks_owner_month
      ON ibkr_equity_marks(owner_user_id, month_key, mark_date);

    CREATE TABLE IF NOT EXISTS trading_day_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      plan_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      plan_json TEXT,
      checker_verdict_json TEXT,
      approvals_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE (owner_user_id, plan_date)
    );
    CREATE INDEX IF NOT EXISTS idx_trading_day_plans_owner_date
      ON trading_day_plans(owner_user_id, plan_date DESC);
  `);
  ensured = true;
}

function todayUtcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function monthKeyFromDate(isoDate) {
  return String(isoDate || '').slice(0, 7);
}

function num(v, d = null) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function defaultDrawdownStopPct(arg) {
  if (arg != null && Number.isFinite(Number(arg))) return Number(arg);
  const env = num(process.env.MONTHLY_DRAWDOWN_STOP_PCT);
  if (env != null) return env;
  return 4;
}

export function recordEquityMark(ownerUserId, { equity, cash = null, date = null, detail = null } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const equityUsd = num(equity);
  if (equityUsd == null || !(equityUsd >= 0)) throw new Error('equity must be a non-negative number');

  const markDate = String(date || todayUtcDate()).slice(0, 10);
  const monthKey = monthKeyFromDate(markDate);
  const cashUsd = num(cash);
  const db = getDb();

  // HWM as of this mark date only (ignore later backfilled/future marks).
  const priorPeak = db
    .prepare(
      `SELECT MAX(equity_usd) AS peak FROM ibkr_equity_marks
       WHERE owner_user_id = ? AND month_key = ? AND mark_date <= ?`
    )
    .get(owner, monthKey, markDate);
  const monthHwm = Math.max(num(priorPeak?.peak, equityUsd) ?? equityUsd, equityUsd);

  db.prepare(
    `INSERT INTO ibkr_equity_marks
       (owner_user_id, mark_date, equity_usd, cash_usd, month_key, month_hwm_usd, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, mark_date) DO UPDATE SET
       equity_usd = excluded.equity_usd,
       cash_usd = excluded.cash_usd,
       month_key = excluded.month_key,
       month_hwm_usd = excluded.month_hwm_usd,
       detail_json = excluded.detail_json`
  ).run(
    owner,
    markDate,
    equityUsd,
    cashUsd,
    monthKey,
    monthHwm,
    detail != null ? JSON.stringify(detail) : null
  );

  // Recompute running HWM for the whole month so later rows stay consistent.
  const monthRows = db
    .prepare(
      `SELECT mark_date, equity_usd FROM ibkr_equity_marks
       WHERE owner_user_id = ? AND month_key = ?
       ORDER BY mark_date ASC`
    )
    .all(owner, monthKey);
  let running = 0;
  const upd = db.prepare(
    `UPDATE ibkr_equity_marks SET month_hwm_usd = ?
     WHERE owner_user_id = ? AND mark_date = ?`
  );
  for (const row of monthRows) {
    running = Math.max(running, num(row.equity_usd, 0) || 0);
    upd.run(running, owner, row.mark_date);
  }

  console.log(
    '[ibkr-guardrail] equity mark owner=%s date=%s equity=%s hwm=%s',
    owner,
    markDate,
    equityUsd,
    monthHwm
  );

  return {
    ok: true,
    mark_date: markDate,
    equity_usd: equityUsd,
    cash_usd: cashUsd,
    month_key: monthKey,
    month_hwm_usd: monthHwm,
  };
}

export function getMonthlyGuardrail(ownerUserId, { drawdownStopPct = null, asOfDate = null } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');

  const stopPct = defaultDrawdownStopPct(drawdownStopPct);
  const asOf = String(asOfDate || todayUtcDate()).slice(0, 10);
  const monthKey = monthKeyFromDate(asOf);
  const db = getDb();

  const marks = db
    .prepare(
      `SELECT mark_date, equity_usd, cash_usd, month_hwm_usd
       FROM ibkr_equity_marks
       WHERE owner_user_id = ? AND month_key = ? AND mark_date <= ?
       ORDER BY mark_date ASC`
    )
    .all(owner, monthKey, asOf);

  if (!marks.length) {
    return {
      ok: true,
      month_key: monthKey,
      as_of: asOf,
      marks_count: 0,
      equity_usd: null,
      cash_usd: null,
      month_start_equity_usd: null,
      month_hwm_usd: null,
      mtd_return_pct: null,
      drawdown_from_hwm_pct: null,
      drawdown_stop_pct: stopPct,
      guardrail_breached: false,
      risk_mode: 'normal',
      message: 'no equity marks for this month yet',
    };
  }

  const first = marks[0];
  const last = marks[marks.length - 1];
  const startEq = num(first.equity_usd);
  const equity = num(last.equity_usd);
  const hwm = Math.max(...marks.map((m) => num(m.month_hwm_usd, num(m.equity_usd) || 0)));
  const mtd_return_pct =
    startEq > 0 && equity != null
      ? Number((((equity - startEq) / startEq) * 100).toFixed(4))
      : null;
  const drawdown_from_hwm_pct =
    hwm > 0 && equity != null
      ? Number((((hwm - equity) / hwm) * 100).toFixed(4))
      : null;

  const dd = drawdown_from_hwm_pct ?? 0;
  const guardrail_breached = dd >= stopPct;
  let risk_mode = 'normal';
  if (guardrail_breached) risk_mode = 'halt_new';
  else if (dd >= stopPct * 0.75) risk_mode = 'reduce';

  return {
    ok: true,
    month_key: monthKey,
    as_of: asOf,
    marks_count: marks.length,
    equity_usd: equity,
    cash_usd: num(last.cash_usd),
    month_start_equity_usd: startEq,
    month_hwm_usd: hwm,
    mtd_return_pct,
    drawdown_from_hwm_pct,
    drawdown_stop_pct: stopPct,
    guardrail_breached,
    risk_mode,
  };
}

export function listEquityMarks(ownerUserId, { monthKey = null, limit = 60 } = {}) {
  ensureIbkrMonthlyTables();
  const owner = String(ownerUserId || '').trim();
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 365);
  const db = getDb();
  if (monthKey) {
    return db
      .prepare(
        `SELECT * FROM ibkr_equity_marks
         WHERE owner_user_id = ? AND month_key = ?
         ORDER BY mark_date DESC LIMIT ?`
      )
      .all(owner, String(monthKey).slice(0, 7), lim);
  }
  return db
    .prepare(
      `SELECT * FROM ibkr_equity_marks
       WHERE owner_user_id = ?
       ORDER BY mark_date DESC LIMIT ?`
    )
    .all(owner, lim);
}
