/**
 * Parse IBKR local-bridge webhook event for W3 routing.
 * Must export: run(inputs, context)
 * Outputs flags: is_equity_mark, is_fill, is_stop_out, is_eod_snapshot,
 * is_cancel_or_reject, is_order_event, event_type
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
    eventType === 'fill' || eventType === 'order_fill' || (eventType.includes('fill') && !eventType.includes('unfill'));
  const isStopOut =
    eventType === 'stop_out' || eventType === 'stop-out' || eventType.includes('stop_out');
  const isEod =
    eventType === 'eod_snapshot' ||
    eventType === 'eod-snapshot' ||
    eventType.includes('eod_snapshot') ||
    eventType.includes('eod');
  const isReject = eventType === 'reject' || eventType.includes('reject');
  const isCancel =
    eventType === 'cancel' ||
    eventType === 'cancelled' ||
    eventType.includes('cancel');
  const isOrderStatus =
    eventType === 'order_status' || eventType === 'order-status' || eventType.includes('order_status');

  const isCancelOrReject = isReject || isCancel;
  const isOrderEvent = isFill || isStopOut || isCancelOrReject || isOrderStatus;

  const route = isEod
    ? 'eod_snapshot'
    : isEquityMark
      ? 'equity_mark'
      : isFill || isStopOut
        ? 'fill_or_stop'
        : isCancelOrReject
          ? 'cancel_or_reject'
          : isOrderStatus
            ? 'order_status'
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
    is_cancel_or_reject: isCancelOrReject ? 'true' : 'false',
    is_order_status: isOrderStatus ? 'true' : 'false',
    is_order_event: isOrderEvent ? 'true' : 'false',
    equity: payload.equity ?? payload.equity_usd ?? null,
    cash: payload.cash ?? payload.cash_usd ?? null,
    symbol: payload.symbol || payload.key || null,
    /** Full envelope for ingest (event + payload) */
    envelope_json: JSON.stringify({
      event: eventType || 'unknown',
      payload,
    }),
    payload_json: JSON.stringify(payload),
    text: JSON.stringify({ event_type: eventType || 'unknown', route }),
  };
}

export default { run };
