/**
 * Compose weekly trading digest email body.
 * Includes monthly metrics section when day-of-month <= 7 (first weekly run of month).
 * Must export: run(inputs, context)
 */
export function run(inputs = {}, context = {}) {
  const day = new Date().getUTCDate();
  const includeMonthly = day <= 7;
  const journal = String(inputs.journal || inputs.journal_text || '').trim();
  const guardrail = String(inputs.guardrail || '').trim();
  const analytics = String(inputs.analytics || '').trim();

  const lines = [
    'Monthly Positive Return — Weekly Review',
    `Generated (UTC day-of-month): ${day}`,
    '',
    '=== Journal (7d) ===',
    journal || '(no journal data)',
    '',
    '=== Guardrail ===',
    guardrail || '(no guardrail data)',
    '',
    '=== Analytics ===',
    analytics || '(no analytics data)',
  ];

  if (includeMonthly) {
    lines.push(
      '',
      '=== Monthly metrics (first weekly run of month) ===',
      'Review MTD return vs target, HWM drawdown, win rate, cash allocation, and largest losing streak.',
      'If monthly target already reached, prefer risk reduction over chasing additional return.',
      'Guardrail JSON above is the source of truth for mtd_return_pct / drawdown_from_hwm_pct.'
    );
  }

  const text = lines.join('\n');
  return {
    ok: true,
    include_monthly: includeMonthly,
    day_of_month: day,
    text,
  };
}