/** Aggregate the existing ledger once per history page; never count native
 * reservations as spent tokens or add native telemetry to the same ledger twice. */
export function goalRunUsage(db, ownerId, runIds) {
  const ids = [...new Set(runIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const marks = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT run_id,
    SUM(input_tokens) input_tokens, SUM(output_tokens) output_tokens,
    SUM(total_tokens) total_tokens, COUNT(*) usage_records,
    SUM(CASE WHEN tokens_estimated=1 THEN 1 ELSE 0 END) estimated_records
    FROM token_usage WHERE owner_user_id=? AND run_id IN (${marks}) GROUP BY run_id`).all(ownerId, ...ids);
  return new Map(rows.map(row => [row.run_id, {
    input_tokens: row.input_tokens || 0, output_tokens: row.output_tokens || 0,
    total_tokens: row.total_tokens || 0, usage_records: row.usage_records,
    estimated_records: row.estimated_records || 0,
  }]));
}
