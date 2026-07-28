/**
 * Parse IBKR local-bridge webhook event for W3 routing.
 * Must export: run(inputs, context)
 * Outputs flags: is_equity_mark, is_fill, is_stop_out, is_eod_snapshot, event_type
 */
export function run(inputs = {}, context = {}) {
  let raw =
    inputs.payload ||
    inputs.text ||
    inputs.event ||
    context?.initial_input ||
    '';
  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = { event: raw, payload: raw };
    }
  }
  if (!obj || typeof obj !== 'object') obj = {};

  const eventType = String(
    obj.event || obj.event_type || obj.type || obj.payload?.event || ''
  )
    .trim()
    .toLowerCase();
  const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : obj;

  const isEquityMark =
    eventType === 'equity_mark' || eventType === 'equity-mark' || eventType.includes('equity_mark');
  const isFill =
    eventType === 'fill' || eventType === 'order_fill' || eventType.includes('fill');
  const isStopOut =
    eventType === 'stop_out' || eventType === 'stop-out' || eventType.includes('stop_out');
  const isEod =
    eventType === 'eod_snapshot' ||
    eventType === 'eod-snapshot' ||
    eventType.includes('eod_snapshot') ||
    eventType.includes('eod');

  const route = isEod
    ? 'eod_snapshot'
    : isEquityMark
      ? 'equity_mark'
      : isFill || isStopOut
        ? 'fill_or_stop'
        : 'other';

  return {
    ok: true,
    event_type: eventType || 'unknown',
    route,
    is_equity_mark: isEquityMark ? 'true' : 'false',
    is_fill: isFill ? 'true' : 'false',
    is_stop_out: isStopOut ? 'true' : 'false',
    is_eod_snapshot: isEod ? 'true' : 'false',
    is_fill_or_stop: isFill || isStopOut ? 'true' : 'false',
    equity: payload.equity ?? payload.equity_usd ?? null,
    cash: payload.cash ?? payload.cash_usd ?? null,
    symbol: payload.symbol || payload.key || null,
    payload_json: JSON.stringify(payload),
    text: JSON.stringify({ event_type: eventType || 'unknown', route }),
  };
}