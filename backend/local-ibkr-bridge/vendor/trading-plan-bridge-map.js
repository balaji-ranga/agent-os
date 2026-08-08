/**
 * Map Maker/Checker day-plan actions -> local IBKR bridge request payloads.
 * Pure helpers (no DB / Gateway) — shared by VPS tools and local-ibkr-bridge.
 */

const OPEN_PRIORITY = { executing: 0, partial: 1, approved: 2, failed: 3 };

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function parseKey(keyOrSymbol = '') {
  const raw = String(keyOrSymbol || '').trim();
  if (!raw) return { key: '', symbol: '', exchange: 'SMART', currency: 'USD' };
  if (raw.includes(':')) {
    const [ex, sym] = raw.split(':');
    return {
      key: raw,
      symbol: String(sym || '').toUpperCase(),
      exchange: String(ex || 'SMART').toUpperCase(),
      currency: 'USD',
    };
  }
  return {
    key: 'SMART:' + raw.toUpperCase(),
    symbol: raw.toUpperCase(),
    exchange: 'SMART',
    currency: 'USD',
  };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function actionType(a = {}) {
  return String(a.type || a.action || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

/**
 * Select the plan row to execute from open-plans API shapes.
 * Priority: executing -> partial -> approved -> failed (most recent date wins within band).
 */
export function pickExecutablePlan(input = {}) {
  if (!input || typeof input !== 'object') return null;

  if (input.plan_date && (input.plan != null || Array.isArray(input.actions))) {
    return input;
  }
  if (Array.isArray(input.actions) && !input.plans) {
    return {
      id: input.id || null,
      plan_date: input.plan_date || null,
      status: input.status || 'approved',
      plan: input,
    };
  }
  const plans = asArray(input.plans);
  if (plans.length) {
    const scored = plans
      .map((p, idx) => ({
        p,
        score: OPEN_PRIORITY[String(p && p.status ? p.status : '').toLowerCase()] ?? 99,
        idx,
        date: String((p && p.plan_date) || ''),
      }))
      .sort((a, b) => a.score - b.score || b.date.localeCompare(a.date) || a.idx - b.idx);
    return (scored[0] && scored[0].p) || null;
  }
  if (input.plan && typeof input.plan === 'object') {
    const wrapped = input.plan;
    // Common W2 / e2e body: { plan: <day-plan API row { plan_date, status, plan:{actions} }> }
    if (wrapped.plan_date && (wrapped.plan != null || Array.isArray(wrapped.actions))) {
      return wrapped;
    }
    return {
      id: input.id || wrapped.id || null,
      plan_date: input.plan_date || wrapped.plan_date || null,
      status: input.status || wrapped.status || 'approved',
      plan: wrapped,
    };
  }
  return null;
}

function extractActions(planRow) {
  if (!planRow) return [];
  let plan = planRow.plan != null ? planRow.plan : planRow;
  if (typeof plan === 'string') {
    try {
      plan = JSON.parse(plan);
    } catch {
      plan = null;
    }
  }
  if (Array.isArray(plan?.actions)) return plan.actions;
  // Nested row: plan.plan.actions when extract was handed a double-wrapped body.
  if (plan?.plan != null) {
    let inner = plan.plan;
    if (typeof inner === 'string') {
      try {
        inner = JSON.parse(inner);
      } catch {
        inner = null;
      }
    }
    if (Array.isArray(inner?.actions)) return inner.actions;
  }
  if (Array.isArray(planRow.actions)) return planRow.actions;
  return [];
}

function entryTradeFromAction(a, parsed) {
  const qty = num(a.qty) ?? num(a.quantity);
  const entry =
    num(a.entry_price) ??
    num(a.entryPrice) ??
    num(a.trigger_price) ??
    num(a.limit_price) ??
    num(a.price);
  const stop = num(a.stop_price) ?? num(a.stopPrice);
  const tp = num(a.tp_price) ?? num(a.take_profit) ?? num(a.takeProfitPrice) ?? num(a.tpPrice);
  const notional = num(a.notional_usd) ?? num(a.notionalUsd);
  return {
    key: parsed.key,
    symbol: parsed.symbol,
    exchange: parsed.exchange || a.exchange || 'SMART',
    currency: a.currency || parsed.currency || 'USD',
    secType: a.secType || a.sec_type || 'STK',
    side: 'BUY',
    qty: qty > 0 ? qty : null,
    notional_usd: notional > 0 ? notional : undefined,
    entry_price: entry,
    stop_price: stop,
    tp_price: tp,
    thesis: a.thesis || a.rationale || '',
    action_type: 'new_entry',
  };
}

function sellTradeFromAction(a, parsed, type) {
  const qty = num(a.qty) ?? num(a.quantity);
  return {
    key: parsed.key,
    symbol: parsed.symbol,
    exchange: parsed.exchange || a.exchange || 'SMART',
    currency: a.currency || parsed.currency || 'USD',
    secType: a.secType || a.sec_type || 'STK',
    side: 'SELL_TO_CLOSE',
    qty: qty > 0 ? qty : null,
    action_type: type,
    thesis: a.thesis || a.rationale || '',
  };
}

function stopFromAction(a, parsed) {
  const qty = num(a.qty) ?? num(a.quantity);
  const stop = num(a.stop_price) ?? num(a.stopPrice) ?? num(a.trigger_price);
  return {
    key: parsed.key,
    symbol: parsed.symbol,
    exchange: parsed.exchange || a.exchange || 'SMART',
    currency: a.currency || parsed.currency || 'USD',
    secType: a.secType || a.sec_type || 'STK',
    qty: qty > 0 ? qty : undefined,
    stop_price: stop,
    order_id: a.order_id || a.orderId || null,
    action_type: 'raise_stop',
  };
}

/**
 * @param {object} input open plans API body, plan row, or maker plan JSON
 * @param {{ respectCeoApproval?: boolean }} [opts]
 */
export function mapDayPlanToBridgeOrders(input = {}, opts = {}) {
  const respectCeo = opts.respectCeoApproval !== false;
  const selected = pickExecutablePlan(input);
  if (!selected) {
    return {
      ok: false,
      selected_plan: null,
      plan_date: null,
      trades: [],
      modify_stops: [],
      sells: [],
      skipped: [],
      summary: { action_count: 0, trade_count: 0, stop_count: 0, sell_count: 0, actionable: 0 },
      error: 'no_executable_plan',
    };
  }

  const actions = extractActions(selected);
  const trades = [];
  const modify_stops = [];
  const sells = [];
  const skipped = [];

  for (const a of actions) {
    const type = actionType(a);
    const parsed = parseKey(a.key || a.symbol || a.ticker);
    if (!parsed.symbol && type !== 'hold') {
      skipped.push({ action: a, reason: 'missing_symbol' });
      continue;
    }
    if (respectCeo && (a.requires_ceo_approval === true || a.requires_ceo_approval === 1)) {
      if (!a.ceo_approved && !a.approved) {
        skipped.push({ action: a, reason: 'requires_ceo_approval' });
        continue;
      }
    }

    switch (type) {
      case 'hold':
        skipped.push({ action: a, reason: 'hold' });
        break;
      case 'new_entry':
      case 'buy':
      case 'entry': {
        const t = entryTradeFromAction(a, parsed);
        if (!(t.qty > 0) && !(t.notional_usd > 0)) {
          skipped.push({ action: a, reason: 'missing_qty' });
          break;
        }
        if (!(t.entry_price > 0) || !(t.stop_price > 0) || !(t.tp_price > 0)) {
          skipped.push({
            action: a,
            reason: 'incomplete_bracket_prices',
            note: 'entry_price, stop_price and tp_price required for stock brackets',
            trade: t,
          });
          break;
        }
        trades.push(t);
        break;
      }
      case 'raise_stop':
      case 'trail_stop':
      case 'modify_stop': {
        const s = stopFromAction(a, parsed);
        if (!(s.stop_price > 0)) {
          skipped.push({ action: a, reason: 'missing_stop_price' });
          break;
        }
        modify_stops.push(s);
        break;
      }
      case 'exit':
      case 'reduce':
      case 'partial_profit':
      case 'sell':
      case 'sell_to_close': {
        const s = sellTradeFromAction(a, parsed, type);
        if (!(s.qty > 0)) {
          skipped.push({ action: a, reason: 'missing_qty' });
          break;
        }
        sells.push(s);
        break;
      }
      default:
        skipped.push({ action: a, reason: 'unknown_type:' + (type || 'empty') });
    }
  }

  const actionable = trades.length + modify_stops.length + sells.length;
  return {
    ok: true,
    selected_plan: {
      id: selected.id ?? null,
      plan_date: selected.plan_date ?? null,
      status: selected.status ?? null,
    },
    plan_date: selected.plan_date ?? null,
    trades,
    modify_stops,
    sells,
    skipped,
    summary: {
      action_count: actions.length,
      trade_count: trades.length,
      stop_count: modify_stops.length,
      sell_count: sells.length,
      skipped_count: skipped.length,
      actionable,
    },
  };
}

export function suggestExecutionStatus(mapping, placeResult, stopResults = [], sellResults = []) {
  if (!(mapping && mapping.ok)) return 'failed';
  if (!(mapping.summary && mapping.summary.actionable > 0)) return 'executed';

  const placeOk = !placeResult || placeResult.ok !== false;
  const stopsOk = asArray(stopResults).every((r) => r && r.ok !== false);
  const sellsOk = asArray(sellResults).every((r) => r && r.ok !== false);
  if (!placeOk || !stopsOk || !sellsOk) {
    const anyOk =
      ((placeResult && placeResult.results) || []).some((r) => r && r.ok) ||
      asArray(stopResults).some((r) => r && r.ok) ||
      asArray(sellResults).some((r) => r && r.ok);
    return anyOk ? 'partial' : 'failed';
  }
  const blocked = asArray(mapping.skipped).filter((s) =>
    ['requires_ceo_approval', 'missing_qty', 'missing_stop_price'].includes(s.reason)
  );
  if (blocked.length) return 'partial';
  return 'executed';
}