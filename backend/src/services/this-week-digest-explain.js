/**
 * Explainability for This Week Digest Time Saved / Est. Value Delivered.
 * Value uses each AI employee's hourly_rate_usd (hire default 10); env default for unassigned/workflows.
 */
export function buildDigestEstimatesExplain(opts) {
  const minutesPerTask = opts && opts.minutesPerTask;
  const defaultUsdPerHour = opts && opts.usdPerHour;
  const weightedAvgRate = opts && opts.weightedAvgRate;
  const ratesUsed = (opts && opts.ratesSummary) || null;
  const min = Math.max(15, Number(minutesPerTask) || 45);
  const defRate = Math.max(0, Number(defaultUsdPerHour) || 10);
  const avg =
    weightedAvgRate != null && Number.isFinite(Number(weightedAvgRate))
      ? Math.round(Number(weightedAvgRate) * 100) / 100
      : defRate;
  return {
    minutes_per_task: min,
    usd_per_hour_default: defRate,
    usd_per_hour: defRate,
    weighted_avg_usd_per_hour: avg,
    rates_summary: ratesUsed,
    time_saved: {
      title: 'How Time Saved is calculated',
      summary:
        'Platform estimate only - not wall-clock timesheets. Uses a fixed minutes-per-task proxy for every completed task and workflow run.',
      bullets: [
        'Count completed work this week: Kanban cards with status completed/done PLUS workflow runs with status completed.',
        'Time Saved (hours) = completed_count x ' + min + ' minutes per task / 60.',
        'Default minutes/task is ' + min + ' (env THIS_WEEK_MINUTES_PER_TASK, minimum 15).',
        'Proxy for labour displacement - not measured human work hours.',
        'Week-over-week delta applies the same formula to the previous Mon-Sun window.',
      ],
      formula: 'hours = round((tasks_completed * minutes_per_task) / 60, 1)',
    },
    value_delivered: {
      title: 'How Est. Value Delivered is calculated',
      summary:
        'Platform estimate: sum of (hours per completed unit x that AI employee hourly USD rate). Not CRM revenue, invoices, or task value tags.',
      bullets: [
        'Each AI employee has hourly_rate_usd set when you hire them (default $10/hr). Change later via agent PATCH (AI Employees list / org).',
        'For each completed Kanban task: value += (minutes_per_task / 60) x assignee hourly_rate_usd.',
        'Completed workflow runs and unassigned tasks use the platform default rate (env THIS_WEEK_VALUE_USD_PER_HOUR, default $' +
          defRate +
          '/hr).',
        'Total is rounded to whole USD. Effective average rate across counted work this week is about $' +
          avg +
          '/hr.',
        'Time Saved still uses one minutes_per_task; only dollar valuation is per-agent.',
      ],
      formula:
        'value_usd = round(sum((min_per_task/60)*agent_hourly_rate_usd) over completed Kanban + workflows@default_rate)',
    },
    agent_howto:
      'When the CEO asks about Digest Time Saved, Est. Value Delivered, or dollar amounts on This Week Digest, call tool this_week_digest (optional offset_weeks). Answer using methodology.time_saved / methodology.value_delivered and rates_summary. Never invent formulas. Value is per-agent hourly_rate_usd (hire default 10), not CRM. status_checker has counts only.',
  };
}
