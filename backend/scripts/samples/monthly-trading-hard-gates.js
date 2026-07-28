/**
 * Deterministic hard gates for Monthly Positive Return Maker JSON.
 * Must export: run(inputs, context)
 *
 * Checks: risk %, never average down, market filter for new_entry,
 * guardrail halt_new blocks new_entry, position caps, CEO approval flags.
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