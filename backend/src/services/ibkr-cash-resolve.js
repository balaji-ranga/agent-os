/**
 * Single cash resolution for IBKR budget / plan / place checks.
 *
 * Order (owner-scoped):
 *   1. IBKR account snapshot (explicit snap, else bridge cache latest)
 *   2. Workflow / request fallback cash only if snapshot has no cash
 *
 * Never treats NetLiquidation, AvailableFunds, daily budget, or cash-events ledgers as cash.
 */
import { ensureIbkrAnalyticsTables, getLatestAccountSnapshot } from './ibkr-analytics.js';

function numCash(v) {
  if (v == null || v === '') return null;
  const n = Number(typeof v === 'string' ? v.replace(/,/g, '').trim() : v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract cash from an IBKR snapshot-shaped object (summary tags → cash_usd).
 * Does not read equity / NetLiquidation as cash.
 */
export function extractCashFromIbkrSnapshot(raw = null) {
  if (!raw || typeof raw !== 'object') {
    return { cash_usd: null, equity_usd: null, captured_at: null };
  }
  const tagNum = (summary, tag) => {
    if (!summary || typeof summary !== 'object') return null;
    const rawTag = summary[tag];
    if (rawTag == null) return null;
    const v = typeof rawTag === 'object' ? rawTag.value ?? rawTag.amount : rawTag;
    return numCash(v);
  };
  const summary = raw.summary && typeof raw.summary === 'object' ? raw.summary : null;
  const cashFromTags =
    tagNum(summary, 'TotalCashValue') ??
    tagNum(summary, 'SettledCash') ??
    tagNum(summary, 'CashBalance') ??
    tagNum(summary, 'TotalCashBalance');
  const cash = cashFromTags ?? numCash(raw.cash_usd ?? raw.cash);
  const equity =
    tagNum(summary, 'NetLiquidation') ?? numCash(raw.equity_usd ?? raw.equity ?? raw.NetLiquidation);
  const captured_at = raw.captured_at || raw.updated_at || raw.as_of || null;
  return {
    cash_usd: cash,
    equity_usd: equity,
    captured_at,
  };
}

/**
 * Explicit workflow / request / node-fed cash (fallback only).
 * Accepts common bag shapes: body, event payload, variables (cash only; not budget).
 */
export function extractWorkflowFallbackCash(bag = null) {
  if (bag == null) return null;
  if (typeof bag === 'number') return numCash(bag);
  if (typeof bag === 'string') return numCash(bag);
  if (typeof bag !== 'object') return null;

  const direct =
    numCash(bag.cash_usd) ??
    numCash(bag.cash) ??
    numCash(bag.workflow_cash_usd) ??
    numCash(bag.workflowCashUsd);
  if (direct != null) return direct;

  const nested =
    bag.payload && typeof bag.payload === 'object'
      ? numCash(bag.payload.cash_usd) ?? numCash(bag.payload.cash)
      : null;
  if (nested != null) return nested;

  // Workflow variables may carry a deliberate override (rare).
  const vars = bag.workflow_variables || bag.variables;
  if (vars && typeof vars === 'object') {
    return numCash(vars.cash_usd) ?? numCash(vars.cash);
  }
  return null;
}

function snapshotAgeHours(capturedAt) {
  if (!capturedAt) return null;
  const t = Date.parse(String(capturedAt));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (Date.now() - t) / 3_600_000);
}

function defaultMaxAgeHours() {
  const n = Number(process.env.IBKR_CASH_SNAPSHOT_MAX_AGE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Resolve spendable cash for an owner.
 *
 * @param {string} ownerUserId
 * @param {object} [opts]
 * @param {object|null} [opts.snapshot] - already-loaded IBKR snap (counts as primary)
 * @param {number|string|object|null} [opts.workflowCash] - fallback bag or number
 * @param {number|null} [opts.maxAgeHours] - warn/stale when snapshot older (env IBKR_CASH_SNAPSHOT_MAX_AGE_HOURS)
 * @param {boolean} [opts.requireCash=false] - if true and no cash, ok=false
 * @param {boolean} [opts.rejectStale=false] - if true and snapshot older than maxAge, treat as missing
 */
export function resolveIbkrCashUsd(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  const maxAgeHours =
    opts.maxAgeHours != null && Number.isFinite(Number(opts.maxAgeHours))
      ? Number(opts.maxAgeHours)
      : defaultMaxAgeHours();
  const requireCash = opts.requireCash === true;
  const rejectStale = opts.rejectStale === true;

  let snapshot = opts.snapshot && typeof opts.snapshot === 'object' ? opts.snapshot : null;
  let snapshot_source = snapshot ? 'explicit_snapshot' : null;

  if (!snapshot && owner) {
    try {
      ensureIbkrAnalyticsTables();
      const cached = getLatestAccountSnapshot(owner);
      if (cached?.ok !== false && (cached.cash_usd != null || cached.summary || cached.positions)) {
        snapshot = cached;
        snapshot_source = cached.source || 'bridge_cache';
      }
    } catch (e) {
      // leave snapshot null; may still use workflow fallback
      return finalize({
        owner,
        cash_usd: extractWorkflowFallbackCash(opts.workflowCash ?? opts),
        source: 'workflow',
        snapshot_source: null,
        captured_at: null,
        maxAgeHours,
        requireCash,
        rejectStale,
        cache_error: e.message || String(e),
      });
    }
  }

  const fromSnap = extractCashFromIbkrSnapshot(snapshot);
  let cash = fromSnap.cash_usd;
  let source = cash != null ? 'snapshot' : null;
  let captured_at = fromSnap.captured_at || snapshot?.captured_at || snapshot?.updated_at || null;
  let age_hours = snapshotAgeHours(captured_at);
  let stale = maxAgeHours != null && age_hours != null && age_hours > maxAgeHours;

  if (cash != null && stale && rejectStale) {
    cash = null;
    source = null;
  }

  if (cash == null) {
    const fb = extractWorkflowFallbackCash(opts.workflowCash ?? opts.workflow_cash_usd ?? opts.cash_usd ?? opts.cash);
    if (fb != null) {
      cash = fb;
      source = 'workflow';
      captured_at = null;
      age_hours = null;
      stale = false;
    }
  }

  return finalize({
    owner,
    cash_usd: cash,
    source: source || 'none',
    snapshot_source,
    captured_at,
    maxAgeHours,
    requireCash,
    rejectStale,
    age_hours,
    stale: Boolean(stale && source === 'snapshot'),
    equity_usd: fromSnap.equity_usd,
  });
}

function finalize({
  owner,
  cash_usd,
  source,
  snapshot_source,
  captured_at,
  maxAgeHours,
  requireCash,
  rejectStale,
  age_hours = null,
  stale = false,
  equity_usd = null,
  cache_error = null,
}) {
  const hasCash = cash_usd != null && Number.isFinite(Number(cash_usd));
  const ok = !requireCash || hasCash;
  const result = {
    ok,
    owner_user_id: owner || null,
    cash_usd: hasCash ? Number(cash_usd) : null,
    source: hasCash ? source : 'none',
    snapshot_source: snapshot_source || null,
    captured_at: captured_at || null,
    age_hours: age_hours != null ? Number(age_hours.toFixed(3)) : null,
    stale: Boolean(stale),
    max_age_hours: maxAgeHours,
    equity_usd: equity_usd != null && Number.isFinite(Number(equity_usd)) ? Number(equity_usd) : null,
    error: ok
      ? null
      : stale && rejectStale
        ? `IBKR cash snapshot stale (age_hours>${maxAgeHours}) and no workflow fallback`
        : 'No cash: need IBKR account snapshot (or workflow cash_usd fallback)',
  };
  if (cache_error) result.cache_error = cache_error;

  if (hasCash) {
    console.info(
      '[ibkr-cash] resolve owner=%s cash_usd=%s source=%s snap=%s age_h=%s stale=%s',
      owner || '-',
      result.cash_usd,
      result.source,
      result.snapshot_source || '-',
      result.age_hours ?? '-',
      result.stale
    );
  } else {
    console.warn(
      '[ibkr-cash] resolve missing cash owner=%s require=%s err=%s',
      owner || '-',
      requireCash,
      result.error || cache_error || 'none'
    );
  }
  return result;
}

/** spendable = min(budget_remaining, cash) when cash known; else 0 (never invent cash). */
export function computeSpendableUsd(budgetRemainingUsd, cashUsd) {
  const budget = Math.max(0, Number(budgetRemainingUsd) || 0);
  const cash = numCash(cashUsd);
  if (cash == null) return 0;
  return Number(Math.max(0, Math.min(budget, cash)).toFixed(2));
}
