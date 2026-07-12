/**
 * Hard trading rules for IBKR maker/checker workflow (no LLM trust).
 */

export const IBKR_ALLOWLIST = Object.freeze([
  { key: 'NASDAQ:NVDA', symbol: 'NVDA', exchange: 'NASDAQ', market: 'US', currency: 'USD', boardLot: 1 },
  { key: 'BATS:MAGS', symbol: 'MAGS', exchange: 'BATS', market: 'US', currency: 'USD', boardLot: 1 },
  { key: 'NASDAQ:AMD', symbol: 'AMD', exchange: 'NASDAQ', market: 'US', currency: 'USD', boardLot: 1 },
  { key: 'SGX:S68', symbol: 'S68', exchange: 'SGX', market: 'SG', currency: 'SGD', boardLot: 100 },
  { key: 'SGX:S63', symbol: 'S63', exchange: 'SGX', market: 'SG', currency: 'SGD', boardLot: 100 },
]);

export function getIbkrTradingConfig() {
  const allowlist = String(process.env.IBKR_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const keys = allowlist.length ? allowlist : IBKR_ALLOWLIST.map((a) => a.key);
  return {
    tradingEnabled: process.env.IBKR_TRADING_ENABLED === '1' || process.env.IBKR_TRADING_ENABLED === 'true',
    isPaper: process.env.IBKR_IS_PAPER !== '0' && process.env.IBKR_IS_PAPER !== 'false',
    dailyBudgetUsd: Number(process.env.IBKR_DAILY_BUDGET_USD || 1000),
    maxTradesPerDay: Number(process.env.IBKR_MAX_TRADES_PER_DAY || 10),
    checkerMaxLoops: Number(process.env.IBKR_CHECKER_MAX_LOOPS || 3),
    stopPctMin: Number(process.env.IBKR_STOP_PCT_MIN || 1.5),
    stopPctMax: Number(process.env.IBKR_STOP_PCT_MAX || 2.0),
    tpPctMin: Number(process.env.IBKR_TP_PCT_MIN || 0.5),
    tpPctMax: Number(process.env.IBKR_TP_PCT_MAX || 2.0),
    entrySlipPctMax: Number(process.env.IBKR_ENTRY_SLIP_PCT_MAX || 0.25),
    maxHoldDays: Number(process.env.IBKR_MAX_HOLD_DAYS || 5),
    noMargin: process.env.IBKR_NO_MARGIN !== '0',
    sgdUsdRate: Number(process.env.IBKR_SGD_USD_RATE || 0.74),
    allowlistKeys: keys,
    makerModel: process.env.IBKR_MAKER_MODEL || 'gpt-5.5',
    checkerModel: process.env.IBKR_CHECKER_MODEL || process.env.OLLAMA_MODEL || 'llama3.2',
    checkerModelSource: process.env.IBKR_CHECKER_MODEL_SOURCE || 'ollama',
  };
}

export function findAllowlistEntry(symbolOrKey) {
  const raw = String(symbolOrKey || '').trim().toUpperCase();
  if (!raw) return null;
  return (
    IBKR_ALLOWLIST.find((a) => a.key === raw) ||
    IBKR_ALLOWLIST.find((a) => a.symbol === raw) ||
    IBKR_ALLOWLIST.find((a) => raw.endsWith(`:${a.symbol}`)) ||
    null
  );
}

export function toUsd(amount, currency, sgdUsdRate) {
  const n = Number(amount) || 0;
  const ccy = String(currency || 'USD').toUpperCase();
  if (ccy === 'USD') return n;
  if (ccy === 'SGD') return n * Number(sgdUsdRate || 0.74);
  return n;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * Normalize maker JSON (object or string). Returns { ok, error, plan }.
 */
export function parseTradePlan(raw) {
  let plan = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : text;
    try {
      plan = JSON.parse(body);
    } catch {
      const start = body.indexOf('{');
      const end = body.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          plan = JSON.parse(body.slice(start, end + 1));
        } catch (e) {
          return { ok: false, error: `Invalid plan JSON: ${e.message}`, plan: null };
        }
      } else {
        return { ok: false, error: 'Invalid plan JSON', plan: null };
      }
    }
  }
  if (!plan || typeof plan !== 'object') return { ok: false, error: 'Plan must be an object', plan: null };
  return { ok: true, error: null, plan };
}

export function parseCheckerDecision(raw) {
  const parsed = parseTradePlan(raw);
  if (!parsed.ok) {
    const text = String(raw || '').toLowerCase();
    if (text.includes('approved') && !text.includes('rejected')) {
      return { ok: true, decision: 'approved', adjustments: '', notes: String(raw || ''), error: null };
    }
    if (text.includes('rejected')) {
      return { ok: true, decision: 'rejected', adjustments: String(raw || ''), notes: '', error: null };
    }
    return { ok: false, decision: 'rejected', adjustments: '', notes: '', error: parsed.error };
  }
  const d = parsed.plan;
  const decision = String(d.decision || d.verdict || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    return { ok: false, decision: 'rejected', adjustments: '', notes: '', error: 'Checker must set decision approved|rejected' };
  }
  return {
    ok: true,
    decision,
    adjustments: String(d.adjustments || d.recommendations || ''),
    notes: String(d.notes || ''),
    error: null,
    plan: d.plan || d.trade_plan || null,
  };
}

/**
 * Validate a day plan against hard gates. Does not touch the ledger.
 * opts.allowlistKeys — workflow variable override (subset of known meta).
 * opts.pendingSellSymbols — symbols with working SELL orders.
 * opts.blockDuplicateBuys — reject BUY if already long.
 * opts.minRationaleChars — default 80.
 */
export function validateTradePlan(planInput, opts = {}) {
  const cfg = getIbkrTradingConfig();
  const allowlistKeys =
    Array.isArray(opts.allowlistKeys) && opts.allowlistKeys.length
      ? opts.allowlistKeys.map((k) => String(k).toUpperCase())
      : cfg.allowlistKeys;
  const cashUsd = Number(opts.cashUsd ?? opts.cash_usd ?? Infinity);
  const budgetRemainingUsd = Number(
    opts.budgetRemainingUsd ?? opts.budget_remaining_usd ?? cfg.dailyBudgetUsd
  );
  const tradesUsed = Number(opts.tradesUsed ?? opts.trades_used ?? 0);
  const positions = opts.positions || [];
  const pendingSellSymbols = new Set(
    (opts.pendingSellSymbols || opts.pending_sell_symbols || []).map((s) => String(s).toUpperCase())
  );
  const blockDuplicateBuys = opts.blockDuplicateBuys !== false && opts.block_duplicate_buys !== false;
  const minRationale = Number(opts.minRationaleChars ?? opts.min_rationale_chars ?? 80);

  const { ok: parsedOk, error: parseError, plan } = parseTradePlan(planInput);
  if (!parsedOk) return { ok: false, error: parseError, trades_to_place: [], residual: [], spendable_usd: 0 };

  const trades = Array.isArray(plan.trades) ? plan.trades : Array.isArray(plan) ? plan : [];
  if (!trades.length) {
    const residualOnly = Array.isArray(plan.residual) ? plan.residual : [];
    const notes = String(plan.notes || '').trim();
    if (notes || residualOnly.length) {
      return {
        ok: true,
        error: null,
        errors: [],
        trades_to_place: [],
        residual: residualOnly,
        spendable_usd: Number(Math.max(0, Math.min(budgetRemainingUsd, cashUsd)).toFixed(2)),
        reserved_usd: 0,
        slots_left: Math.max(0, Number(opts.maxTradesPerDay ?? opts.max_trades_per_day ?? cfg.maxTradesPerDay) - tradesUsed),
        us_only_fallback_hint: false,
        allowlist_keys: allowlistKeys,
        no_trade_day: true,
        config: {
          daily_budget_usd: cfg.dailyBudgetUsd,
          max_trades_per_day: cfg.maxTradesPerDay,
          stop_pct: [cfg.stopPctMin, cfg.stopPctMax],
          tp_pct: [cfg.tpPctMin, cfg.tpPctMax],
          min_rationale_chars: minRationale,
        },
      };
    }
    return { ok: false, error: 'Plan has no trades[]', trades_to_place: [], residual: [], spendable_usd: 0 };
  }

  const spendable = Math.max(0, Math.min(budgetRemainingUsd, cashUsd));
  const maxTrades = Number(opts.maxTradesPerDay ?? opts.max_trades_per_day ?? cfg.maxTradesPerDay);
  const slotsLeft = Math.max(0, maxTrades - tradesUsed);
  const held = new Set(
    (positions || []).map((p) => String(p.symbol || p.key || '').toUpperCase()).filter(Boolean)
  );
  for (const p of positions || []) {
    const meta = findAllowlistEntry(p.key || p.symbol);
    if (meta) {
      held.add(meta.key);
      held.add(meta.symbol);
    }
  }

  const errors = [];
  const normalized = [];
  let runningSpend = 0;

  for (let i = 0; i < trades.length; i++) {
    const t = trades[i] || {};
    const entryMeta = findAllowlistEntry(t.key || t.symbol || t.ticker);
    if (!entryMeta || !allowlistKeys.includes(entryMeta.key)) {
      errors.push(`Trade ${i + 1}: symbol not on allowlist (${t.key || t.symbol})`);
      continue;
    }

    const side = String(t.side || '').toUpperCase().replace(/-/g, '_');
    if (side !== 'BUY' && side !== 'SELL_TO_CLOSE') {
      errors.push(`Trade ${i + 1}: side must be BUY or SELL_TO_CLOSE`);
      continue;
    }
    if (side === 'SELL_TO_CLOSE') {
      const hasPos =
        held.has(entryMeta.symbol) ||
        held.has(entryMeta.key) ||
        (Number(t.qty || 0) > 0 && opts.allowSellWithoutPositionCheck);
      if (!hasPos && !opts.allowSellWithoutPositionCheck) {
        errors.push(`Trade ${i + 1}: SELL_TO_CLOSE requires open long in ${entryMeta.key}`);
        continue;
      }
      if (pendingSellSymbols.has(entryMeta.symbol) || pendingSellSymbols.has(entryMeta.key)) {
        errors.push(`Trade ${i + 1}: pending SELL already exists for ${entryMeta.key}`);
        continue;
      }
    }
    if (side === 'BUY' && blockDuplicateBuys) {
      if (held.has(entryMeta.symbol) || held.has(entryMeta.key)) {
        errors.push(`Trade ${i + 1}: already long ${entryMeta.key} — skip duplicate BUY`);
        continue;
      }
    }

    const ref = Number(t.reference_price ?? t.ref_price ?? t.last ?? 0);
    const entry = Number(t.entry_price ?? t.price ?? 0);
    const qty = Number(t.qty ?? t.quantity ?? 0);
    const stopPct = Number(t.stop_pct ?? t.stopLossPct ?? 0);
    const tpPct = Number(t.tp_pct ?? t.take_profit_pct ?? t.takeProfitPct ?? 0);
    const rationale = String(t.rationale || t.justification || '').trim();
    const thesis = String(t.thesis || '').trim();
    const catalysts = String(t.catalysts || '').trim();
    const risks = String(t.risks || '').trim();
    const whyNow = String(t.why_now || t.whyNow || '').trim();
    const combinedJustification = [rationale, thesis, catalysts, risks, whyNow].filter(Boolean).join(' | ');

    if (!(ref > 0) || !(entry > 0) || !(qty > 0)) {
      errors.push(`Trade ${i + 1}: reference_price, entry_price, qty required`);
      continue;
    }
    if (qty % entryMeta.boardLot !== 0) {
      if (entryMeta.market === 'SG') {
        errors.push(`Trade ${i + 1}: SGX board lot is ${entryMeta.boardLot}; qty ${qty} invalid`);
        continue;
      }
      errors.push(`Trade ${i + 1}: qty must be multiple of board lot ${entryMeta.boardLot}`);
      continue;
    }
    if (side === 'BUY') {
      const maxEntry = ref * (1 + cfg.entrySlipPctMax / 100);
      if (entry > maxEntry + 1e-9) {
        errors.push(`Trade ${i + 1}: entry ${entry} exceeds +${cfg.entrySlipPctMax}% of ref ${ref}`);
        continue;
      }
      if (stopPct < cfg.stopPctMin || stopPct > cfg.stopPctMax) {
        errors.push(`Trade ${i + 1}: stop_pct must be ${cfg.stopPctMin}-${cfg.stopPctMax}`);
        continue;
      }
      if (tpPct < cfg.tpPctMin || tpPct > cfg.tpPctMax) {
        errors.push(`Trade ${i + 1}: tp_pct must be ${cfg.tpPctMin}-${cfg.tpPctMax}`);
        continue;
      }
      if (!thesis || !risks || !whyNow) {
        errors.push(`Trade ${i + 1}: BUY requires thesis, risks, and why_now for checker`);
        continue;
      }
    }
    if (!combinedJustification || combinedJustification.length < minRationale) {
      errors.push(
        `Trade ${i + 1}: justification too short (need ≥${minRationale} chars across rationale/thesis/catalysts/risks/why_now)`
      );
      continue;
    }

    const notionalNative = entry * qty;
    const notionalUsd = side === 'BUY' ? toUsd(notionalNative, entryMeta.currency, cfg.sgdUsdRate) : 0;
    const stopPrice =
      side === 'BUY' ? entry * (1 - stopPct / 100) : entry * (1 + (stopPct || 0) / 100);
    const tpPrice = side === 'BUY' ? entry * (1 + tpPct / 100) : entry * (1 - (tpPct || 0) / 100);

    normalized.push({
      key: entryMeta.key,
      symbol: entryMeta.symbol,
      exchange: entryMeta.exchange,
      market: entryMeta.market,
      currency: entryMeta.currency,
      side,
      qty,
      reference_price: ref,
      entry_price: entry,
      stop_pct: side === 'BUY' ? clamp(stopPct, cfg.stopPctMin, cfg.stopPctMax) : stopPct,
      tp_pct: side === 'BUY' ? clamp(tpPct, cfg.tpPctMin, cfg.tpPctMax) : tpPct,
      stop_price: Number(stopPrice.toFixed(4)),
      tp_price: Number(tpPrice.toFixed(4)),
      notional_native: Number(notionalNative.toFixed(2)),
      notional_usd: Number(notionalUsd.toFixed(2)),
      rationale: combinedJustification,
      thesis,
      catalysts,
      risks,
      why_now: whyNow,
      board_lot: entryMeta.boardLot,
    });
  }

  const sgLotFails = errors.some((e) => e.includes('SGX board lot'));
  const usOnlyFallbackHint = sgLotFails;

  const placeable = [];
  const residual = [];
  for (const t of normalized) {
    if (placeable.length >= slotsLeft) {
      residual.push({ ...t, residual_reason: 'max_trades_per_day' });
      continue;
    }
    if (t.side === 'BUY') {
      if (runningSpend + t.notional_usd > spendable + 1e-6) {
        residual.push({ ...t, residual_reason: 'budget_or_cash' });
        continue;
      }
      runningSpend += t.notional_usd;
    }
    placeable.push(t);
  }

  const blockingErrors = errors.filter((e) => !String(e).includes('SGX board lot'));
  return {
    ok: blockingErrors.length === 0,
    error: errors.length ? errors.join('; ') : null,
    errors,
    trades_to_place: placeable,
    residual: [...residual, ...(Array.isArray(plan.residual) ? plan.residual : [])],
    spendable_usd: Number(spendable.toFixed(2)),
    reserved_usd: Number(runningSpend.toFixed(2)),
    slots_left: slotsLeft,
    us_only_fallback_hint: usOnlyFallbackHint,
    allowlist_keys: allowlistKeys,
    config: {
      daily_budget_usd: cfg.dailyBudgetUsd,
      max_trades_per_day: cfg.maxTradesPerDay,
      stop_pct: [cfg.stopPctMin, cfg.stopPctMax],
      tp_pct: [cfg.tpPctMin, cfg.tpPctMax],
      min_rationale_chars: minRationale,
    },
  };
}

export function validateTradePlanStrict(planInput, opts = {}) {
  return validateTradePlan(planInput, opts);
}
