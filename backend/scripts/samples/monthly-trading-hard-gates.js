/**
 * Deterministic hard gates for Monthly Positive Return Maker JSON.
 * Must export: run(inputs, context)
 *
 * Checks: risk %, never average down, market filter for new_entry,
 * guardrail halt_new blocks new_entry, position caps, CEO approval flags,
 * entry_price present, BUY limit within slip/discount of snapshot or screener last.
 */
function parseMakerPlan(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : raw;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    return JSON.parse(start >= 0 ? body.slice(start, end + 1) : body);
  } catch {
    return null;
  }
}

function num(v, d = null) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function truthy(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function parseJsonish(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : text;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(body.slice(start, end + 1));
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function collectReferencePrices(inputs = {}) {
  const refs = {};
  const add = (key, px) => {
    const n = num(px);
    if (!(n > 0) || !key) return;
    const k = String(key).trim().toUpperCase();
    refs[k] = n;
    const sym = k.includes(':') ? k.split(':').pop() : k;
    if (sym) refs[sym] = n;
  };
  const snap = parseJsonish(
    inputs.account_snapshot ??
      inputs.snapshot ??
      inputs.api_snapshot ??
      inputs.reference_prices
  );
  const rp =
    (snap && typeof snap === 'object' && (snap.reference_prices || snap.payload?.reference_prices)) ||
    (inputs.reference_prices && typeof inputs.reference_prices === 'object' ? inputs.reference_prices : null);
  if (rp && typeof rp === 'object') {
    for (const [k, v] of Object.entries(rp)) {
      add(k, v && typeof v === 'object' ? v.reference_price ?? v.price ?? v.last : v);
    }
  }
  const scr = parseJsonish(inputs.screener ?? inputs.market_screener ?? inputs.tool_screener);
  const cands = Array.isArray(scr?.candidates)
    ? scr.candidates
    : Array.isArray(scr?.result?.candidates)
      ? scr.result.candidates
      : [];
  for (const c of cands) {
    const sym = String(c?.symbol || c?.key || '').trim();
    add(sym, c?.price ?? c?.last ?? c?.close);
  }
  return refs;
}

function lookupRef(refs, key) {
  const k = String(key || '').trim().toUpperCase();
  if (refs[k] > 0) return refs[k];
  const sym = k.includes(':') ? k.split(':').pop() : k;
  return refs[sym] > 0 ? refs[sym] : null;
}

export function run(inputs = {}, context = {}) {
  const vars = context?.workflow_variables || context?.variables || {};
  const makerText =
    inputs.plan_text ||
    inputs.text ||
    inputs.payload ||
    context?.node_outputs?.['maker-1']?.text ||
    '';
  const plan = parseMakerPlan(makerText);
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== 'object') {
    return {
      ok: false,
      pass: false,
      decision: 'rejected',
      requires_ceo_approval: false,
      errors: ['Maker output is not valid JSON'],
      warnings,
      text: JSON.stringify({ ok: false, errors: ['Maker output is not valid JSON'] }),
    };
  }

  if (!plan.prior_plan_reconcile || typeof plan.prior_plan_reconcile !== 'object') {
    errors.push('missing prior_plan_reconcile');
  }

  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const riskSummary = plan.risk_summary && typeof plan.risk_summary === 'object' ? plan.risk_summary : {};
  const riskMode = String(riskSummary.risk_mode || 'normal').toLowerCase();

  const riskCap = num(vars.risk_per_trade_pct, 0.75);
  const sizeMin = num(vars.position_size_pct_min, 3);
  const sizeMax = num(vars.position_size_pct_max, 8);
  const sizeHard = num(vars.position_size_pct_hard_max, 15);
  const discLoss = num(vars.discretionary_loss_sell_pct, 3);
  const dailyBudget = num(vars.daily_budget_usd, 1000);
  const maxTrades = num(vars.max_trades_per_day, 5);
  const entrySlipPct = num(vars.entry_slip_pct_max, 0.25);
  const entryDiscountPct = num(vars.entry_discount_pct_max, 3);
  const refs = collectReferencePrices(inputs);
  const hasQuoteSource =
    inputs.account_snapshot != null ||
    inputs.snapshot != null ||
    inputs.screener != null ||
    inputs.market_screener != null ||
    inputs.reference_prices != null;

  // Cash: IBKR snapshot fields on inputs (or nested) first; workflow cash only as fallback.
  // Spendable new_entry notional ≤ min(daily_budget, cash) when cash known.
  let cashUsd =
    num(inputs.cash_usd) ??
    num(inputs.cash) ??
    num(inputs.account_snapshot?.cash_usd) ??
    num(inputs.snapshot?.cash_usd) ??
    num(inputs.book?.cash_usd);
  if (cashUsd == null) {
    cashUsd =
      num(vars.cash_usd) ??
      num(vars.cash) ??
      num(context?.run_context?.cash_usd) ??
      num(context?.run_context?.cash);
  }
  const spendableCap =
    cashUsd != null && dailyBudget != null
      ? Math.min(dailyBudget, cashUsd)
      : cashUsd != null
        ? cashUsd
        : dailyBudget;

  // Optional upstream context (strings or objects from prior nodes)
  let regime = inputs.regime || inputs.market_regime || null;
  let guardrail = inputs.guardrail || inputs.monthly_guardrail || null;
  try {
    if (typeof regime === 'string' && regime.trim().startsWith('{')) regime = JSON.parse(regime);
  } catch { /* keep */ }
  try {
    if (typeof guardrail === 'string' && guardrail.trim().startsWith('{')) guardrail = JSON.parse(guardrail);
  } catch { /* keep */ }

  const riskOn =
    regime == null
      ? true
      : truthy(regime.risk_on) ||
        String(regime.regime || regime.status || '').toLowerCase() === 'risk_on';
  const haltNew =
    riskMode === 'halt_new' ||
    truthy(guardrail?.halt_new) ||
    truthy(guardrail?.guardrail_breached) ||
    String(guardrail?.risk_mode || '').toLowerCase() === 'halt_new';

  let requiresCeo = false;
  const keysSeen = new Map();

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i] || {};
    const type = String(a.type || '').toLowerCase();
    const key = String(a.key || '').trim();
    const label = `actions[${i}]${key ? `(${key})` : ''}`;

    if (!type) errors.push(`${label}: missing type`);
    if (!key && type !== 'hold') errors.push(`${label}: missing key`);

    if (type === 'new_entry') {
      if (haltNew) errors.push(`${label}: new_entry blocked while risk_mode/guardrail is halt_new`);
      if (!riskOn) errors.push(`${label}: new_entry blocked while market regime is risk_off`);
      if (a.stop_price == null && a.stop_pct == null) {
        errors.push(`${label}: new_entry requires stop_price (or stop_pct)`);
      }
      const entryPx = num(a.entry_price ?? a.trigger_price ?? a.limit_price);
      if (!(entryPx > 0)) {
        errors.push(`${label}: new_entry requires entry_price (W2 cannot place a bracket without it)`);
      } else if (hasQuoteSource) {
        const ref = lookupRef(refs, key);
        if (!(ref > 0)) {
          errors.push(
            `${label}: no live/screener last for ${key || 'symbol'} — refusing invented entry_price ${entryPx}`
          );
        } else {
          const maxEntry = ref * (1 + entrySlipPct / 100);
          const minEntry = ref * (1 - entryDiscountPct / 100);
          if (entryPx > maxEntry + 1e-9) {
            errors.push(
              `${label}: entry ${entryPx} exceeds +${entrySlipPct}% of last ${ref}`
            );
          } else if (entryPx < minEntry - 1e-9) {
            errors.push(
              `${label}: entry ${entryPx} is more than ${entryDiscountPct}% below last ${ref} (unfillable limit)`
            );
          }
        }
      } else {
        warnings.push(
          `${label}: no snapshot/screener quotes bound — cannot verify entry ${entryPx} vs last`
        );
      }
    }

    // Never average down: reject reduce/new_entry that adds to a loser without exit intent
    if (type === 'new_entry' && truthy(a.average_down)) {
      errors.push(`${label}: average_down is forbidden`);
    }
    if (type === 'new_entry' && String(a.rationale || a.thesis || '').toLowerCase().includes('average down')) {
      errors.push(`${label}: rationale mentions average down`);
    }

    const lossPct = num(a.loss_pct_if_exit);
    if (
      (type === 'exit' || type === 'reduce' || type === 'partial_profit') &&
      lossPct != null &&
      lossPct >= discLoss
    ) {
      if (!truthy(a.requires_ceo_approval)) {
        errors.push(
          `${label}: loss_pct_if_exit=${lossPct} >= ${discLoss} requires requires_ceo_approval:true`
        );
      }
    }
    if (truthy(a.requires_ceo_approval)) requiresCeo = true;

    const sizePct = num(a.position_size_pct ?? a.size_pct ?? a.allocation_pct);
    if (sizePct != null) {
      if (sizePct > sizeHard) errors.push(`${label}: position size ${sizePct}% exceeds hard max ${sizeHard}%`);
      else if (type === 'new_entry' && (sizePct < sizeMin || sizePct > sizeMax)) {
        warnings.push(`${label}: size ${sizePct}% outside typical band ${sizeMin}-${sizeMax}%`);
      }
    }

    const riskPct = num(a.risk_pct ?? a.risk_per_trade_pct);
    if (riskPct != null && riskPct > riskCap) {
      errors.push(`${label}: risk ${riskPct}% exceeds cap ${riskCap}%`);
    }

    if (key) {
      const prev = keysSeen.get(key) || [];
      if (type === 'new_entry' && prev.includes('new_entry') && !truthy(a.carry_forward)) {
        warnings.push(`${label}: duplicate new_entry for ${key} in same plan`);
      }
      prev.push(type);
      keysSeen.set(key, prev);
    }
  }

  const openStop = num(riskSummary.open_stop_risk_pct);
  if (openStop != null && openStop > riskCap * 10) {
    warnings.push(`open_stop_risk_pct=${openStop} looks elevated vs risk_per_trade_pct=${riskCap}`);
  }

  // Dollar budget: sum new_entry notionals (skip carry_forward finishers without fresh notional)
  let newEntryCount = 0;
  let newEntryNotional = 0;
  for (const a of actions) {
    const type = String(a.type || a.action || '').toLowerCase();
    if (type !== 'new_entry') continue;
    const isCarry = truthy(a.carry_forward);
    const notional =
      num(a.notional_usd ?? a.budget_usd ?? a.allocation_usd) ??
      (() => {
        const q = num(a.qty);
        const px = num(a.entry_price ?? a.trigger_price ?? a.limit_price);
        return q != null && px != null ? q * px : null;
      })();
    if (isCarry && (notional == null || notional <= 0)) continue;
    newEntryCount += 1;
    if (notional != null && notional > 0) newEntryNotional += notional;
    else if (!isCarry) {
      warnings.push(
        `${a.key || a.symbol || 'new_entry'}: missing notional_usd (or qty×price) — cannot fully enforce daily_budget_usd`
      );
    }
  }
  if (maxTrades != null && newEntryCount > maxTrades) {
    errors.push(`new_entry count ${newEntryCount} exceeds max_trades_per_day=${maxTrades}`);
  }
  if (spendableCap != null && newEntryNotional > spendableCap + 1e-6) {
    const label =
      cashUsd != null
        ? `min(daily_budget_usd=${dailyBudget}, cash_usd=${cashUsd})`
        : `daily_budget_usd=${dailyBudget}`;
    errors.push(
      `new_entry notional_usd sum ${newEntryNotional.toFixed(2)} exceeds spendable ${label}`
    );
  }
  if (cashUsd == null && newEntryNotional > 0) {
    warnings.push(
      'no cash_usd from IBKR snapshot (or workflow fallback) — enforced daily_budget only; cannot min(budget, cash)'
    );
  }

  const ok = errors.length === 0;
  const out = {
    ok,
    pass: ok,
    decision: ok ? 'approved' : 'rejected',
    requires_ceo_approval: requiresCeo,
    requires_ceo_approval_str: requiresCeo ? 'true' : 'false',
    errors,
    warnings,
    action_count: actions.length,
    risk_mode: riskMode,
    plan_json: JSON.stringify(plan),
    text: JSON.stringify({
      ok,
      requires_ceo_approval: requiresCeo,
      errors,
      warnings,
      action_count: actions.length,
      risk_mode: riskMode,
    }),
  };
  return out;
}

export default { run };