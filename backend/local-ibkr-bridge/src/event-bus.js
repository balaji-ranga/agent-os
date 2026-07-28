/**
 * Tiny event bus for order status / equity marks → webhook pusher.
 */
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(32);

export const BRIDGE_EVENTS = {
  ORDER_STATUS: 'order_status',
  FILL: 'fill',
  REJECT: 'reject',
  STOP_OUT: 'stop_out',
  EQUITY_MARK: 'equity_mark',
  EOD_SNAPSHOT: 'eod_snapshot',
};

/**
 * @param {string} event
 * @param {object} payload
 */
export function emitBridgeEvent(event, payload = {}) {
  const envelope = {
    event: String(event),
    ts: new Date().toISOString(),
    source: 'local-ibkr-bridge',
    payload: payload && typeof payload === 'object' ? payload : { value: payload },
  };
  bus.emit('bridge', envelope);
  bus.emit(event, envelope);
  return envelope;
}

/**
 * @param {(envelope: object) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onBridgeEvent(fn) {
  bus.on('bridge', fn);
  return () => bus.off('bridge', fn);
}

export function getEventBus() {
  return bus;
}
