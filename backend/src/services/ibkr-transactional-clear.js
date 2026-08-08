/**
 * Clear owner-scoped IBKR *transactional* data.
 * Keeps strategy/master config in workflow Variables (budget, allowlist, etc.).
 */
import { getDb } from '../db/schema.js';
import { ensureIbkrMonthlyTables } from './ibkr-monthly-guardrail.js';
import { ensureIbkrAnalyticsTables } from './ibkr-analytics.js';
import { ensureIbkrOrderEventTables } from './ibkr-order-events.js';
import { ensureIbkrLedgerTables } from './ibkr-trading-ledger.js';

/** Confirmation phrase required in POST body (prevents accidental UI/API clicks). */
export const IBKR_CLEAR_TX_CONFIRM = 'CLEAR_IBKR_TRANSACTIONAL';

/**
 * Tables deleted on clear. All filtered by owner_user_id.
 * Never touches agent_workflow_definitions.variables_json (daily_budget_usd, allowlist, …).
 */
const TRANSACTIONAL_TABLES = [
  { table: 'trading_day_plans', label: 'day_plans' },
  { table: 'ibkr_order_events', label: 'order_events' },
  { table: 'ibkr_fills', label: 'fills' },
  { table: 'ibkr_position_snapshots', label: 'position_snapshots' },
  { table: 'ibkr_realized_pnl', label: 'realized_pnl' },
  { table: 'ibkr_cash_events', label: 'cash_events' },
  { table: 'ibkr_account_snapshot_cache', label: 'account_snapshot_cache' },
  { table: 'ibkr_equity_marks', label: 'equity_marks' },
  { table: 'ibkr_trade_reservations', label: 'trade_reservations' },
  { table: 'ibkr_budget_days', label: 'budget_day_spend' },
  { table: 'ibkr_position_meta', label: 'position_meta' },
  { table: 'ibkr_positions_cache', label: 'positions_cache' },
];

function tableExists(db, name) {
  try {
    const row = db
      .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

function countRows(db, table, owner) {
  if (!tableExists(db, table)) return 0;
  try {
    return Number(
      db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE owner_user_id = ?`).get(owner)?.n || 0
    );
  } catch {
    return 0;
  }
}

function deleteRows(db, table, owner) {
  if (!tableExists(db, table)) return { deleted: 0, skipped: true };
  try {
    const info = db.prepare(`DELETE FROM ${table} WHERE owner_user_id = ?`).run(owner);
    return { deleted: Number(info.changes || 0), skipped: false };
  } catch (e) {
    return { deleted: 0, skipped: false, error: e.message || String(e) };
  }
}

/**
 * Preview counts of transactional rows for this owner.
 */
export function previewTransactionalIbkrData(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  ensureIbkrMonthlyTables();
  ensureIbkrAnalyticsTables();
  ensureIbkrOrderEventTables();
  ensureIbkrLedgerTables();
  const db = getDb();
  const counts = {};
  let total = 0;
  for (const { table, label } of TRANSACTIONAL_TABLES) {
    const n = countRows(db, table, owner);
    counts[label] = n;
    total += n;
  }
  return {
    ok: true,
    owner_user_id: owner,
    total_rows: total,
    counts,
    preserved: [
      'workflow Variables (daily_budget_usd, allowlist, risk %, crons, …)',
      'workflow graph definitions',
      'content tools meta / agent tool grants',
      'CEO vault / BYOK keys',
    ],
    tables: TRANSACTIONAL_TABLES.map((t) => t.label),
  };
}

/**
 * Permanently delete transactional IBKR rows for the entitled owner.
 * @param {string} ownerUserId
 * @param {{ confirm?: string }} [opts]
 */
export function clearTransactionalIbkrData(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id is required');
  const confirm = String(opts.confirm || '').trim();
  if (confirm !== IBKR_CLEAR_TX_CONFIRM) {
    throw new Error(
      `confirm must be exactly "${IBKR_CLEAR_TX_CONFIRM}" (keeps workflow budget Variables intact)`
    );
  }

  ensureIbkrMonthlyTables();
  ensureIbkrAnalyticsTables();
  ensureIbkrOrderEventTables();
  ensureIbkrLedgerTables();
  const db = getDb();

  const deleted = {};
  let total = 0;
  const errors = [];

  const runAll = db.transaction(() => {
    for (const { table, label } of TRANSACTIONAL_TABLES) {
      const r = deleteRows(db, table, owner);
      deleted[label] = r.deleted;
      total += r.deleted || 0;
      if (r.error) errors.push({ table: label, error: r.error });
    }

    // Optional LLM summary caches for IBKR owner-scoped tools (if table present)
    if (tableExists(db, 'tool_summary_cache')) {
      try {
        const info = db
          .prepare(
            `DELETE FROM tool_summary_cache
             WHERE owner_user_id = ?
               AND (
                 kind LIKE 'ibkr%'
                 OR kind LIKE 'trading%'
                 OR kind LIKE '%order%learn%'
                 OR scope_key LIKE '%ibkr%'
               )`
          )
          .run(owner);
        deleted.tool_summary_cache_ibkr = Number(info.changes || 0);
        total += Number(info.changes || 0);
      } catch (e) {
        errors.push({ table: 'tool_summary_cache', error: e.message || String(e) });
      }
    }
  });
  runAll();

  console.info(
    '[ibkr] clear transactional owner=%s total_deleted=%s keys=%s',
    owner,
    total,
    Object.keys(deleted).filter((k) => deleted[k] > 0).join(',') || 'none'
  );

  return {
    ok: errors.length === 0,
    owner_user_id: owner,
    total_deleted: total,
    deleted,
    errors: errors.length ? errors : undefined,
    preserved: [
      'workflow Variables (budget, allowlist, risk, cron, …)',
      'workflow definitions / graphs',
      'tools meta and tool grants',
    ],
    message:
      total === 0
        ? 'No transactional IBKR rows found for this account.'
        : `Cleared ${total} transactional row(s). Strategy Variables (budget etc.) were not modified.`,
  };
}
