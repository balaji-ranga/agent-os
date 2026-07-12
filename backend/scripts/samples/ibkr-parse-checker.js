/**
 * Parse checker Brain JSON → decision / adjustments for while + if nodes.
 * Must export: run(inputs, context)
 */
export function run(inputs = {}, context = {}) {
  const text =
    inputs.text ||
    inputs.payload ||
    inputs.checker_text ||
    context?.node_outputs?.['checker-1']?.text ||
    '';
  const raw = String(text || '').trim();
  let parsed = null;
  try {
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : raw;
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    parsed = JSON.parse(start >= 0 ? body.slice(start, end + 1) : body);
  } catch {
    parsed = null;
  }

  let decision = String(parsed?.decision || parsed?.verdict || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') {
    const lower = raw.toLowerCase();
    if (lower.includes('"decision":"approved"') || (/\bapproved\b/.test(lower) && !/\brejected\b/.test(lower))) {
      decision = 'approved';
    } else {
      decision = 'rejected';
    }
  }

  const adjustments = String(parsed?.adjustments || parsed?.recommendations || raw).slice(0, 4000);
  const plan = parsed?.plan || parsed?.trade_plan || null;
  const makerText = context?.node_outputs?.['maker-1']?.text || '';

  return {
    ok: true,
    decision,
    adjustments,
    plan_json: plan ? JSON.stringify(plan) : '',
    maker_text: String(makerText),
    text: JSON.stringify({ decision, adjustments: adjustments.slice(0, 500) }),
  };
}
