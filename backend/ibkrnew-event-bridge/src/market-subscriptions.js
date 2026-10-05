import { EventName, WhatToShow } from '@stoqey/ib';
const sharedStarts = [];

// Data requests only. This object never reconnects the broker or touches orders.
export class MarketSubscriptions {
  constructor(ib, contract, emit, { now = Date.now, regular = () => true, starts = sharedStarts } = {}) {
    this.ib = ib; this.contract = contract; this.emit = emit; this.now = now; this.regular = regular;
    this.entries = new Map(); this.requests = new Map(); this.starts = starts; this.nextId = 1000;
    this.handlers = {
      [EventName.error]: (_error, code, id) => this.onError(Number(code), Number(id)),
      [EventName.marketDataType]: (id, type) => { const e = this.requests.get(id); if (e) e.quote.market_data_type = Number(type); },
      [EventName.tickPrice]: (id, field, value) => {
        const e = this.requests.get(id); if (!e || id !== e.quoteId || !(Number(value) > 0)) return;
        const key = ({ 1: 'bid', 2: 'ask', 4: 'last' })[field];
        if (key) { e.quote[key] = Number(value); e.quote[`${key}_at`] = new Date(this.now()).toISOString(); }
      },
      [EventName.tickGeneric]: (id, field, value) => {
        const e = this.requests.get(id); if (!e || id !== e.quoteId || Number(field) !== 46) return;
        e.quote.shortability_level = Number(value); e.quote.shortability_at = new Date(this.now()).toISOString();
        this.emit('instrument.shortability_changed', { symbol: e.symbol, shortable: Number(value) > 2.5, shortability_level: Number(value), shortability_at: e.quote.shortability_at });
      },
      [EventName.realtimeBar]: (id, date, open, high, low, close, volume, wap, count) => {
        const e = this.requests.get(id); if (!e || id !== e.barId) return;
        const at = Number(date) * 1000;
        if (!Number.isFinite(at) || at < e.startedAt - 10000 || this.now() - at > 30000 || at > this.now() + 5000) return;
        e.lastBarAt = this.now();
        if (e.quote.market_data_type === 1 && e.quote.bid > 0 && e.quote.ask >= e.quote.bid && Date.parse(e.quote.bid_at) >= (e.errorAt || 0) && Date.parse(e.quote.ask_at) >= (e.errorAt || 0)) { e.failures = 0; e.error = null; }
        this.emit('market.realtime_bar', { symbol: e.symbol, security_type: e.profile.security_type || 'STK', interval_seconds: 5, at: new Date(at).toISOString(), open, high, low, close, volume, vwap: wap, count });
      },
    };
    for (const [event, handler] of Object.entries(this.handlers)) ib.on(event, handler);
  }
  setProfiles(profiles) {
    const desired = new Map(profiles.map(p => [String(p.symbol).toUpperCase(), p]));
    for (const [symbol, entry] of this.entries) if (!desired.has(symbol)) { this.cancel(entry); this.entries.delete(symbol); }
    for (const [symbol, profile] of desired) {
      let entry = this.entries.get(symbol);
      if (!entry) { entry = { symbol, profile, quote: {}, retryAt: 0, failures: 0, startedAt: null, lastBarAt: null }; this.entries.set(symbol, entry); }
      // Slow profile refresh must not restart healthy price streams. Contract
      // changes do require retiring the previous request IDs.
      if (JSON.stringify(this.contract(entry.profile)) !== JSON.stringify(this.contract(profile))) { this.cancel(entry); entry.retryAt = 0; entry.lastBarAt = null; }
      entry.profile = profile;
    }
    this.refresh();
  }
  cancel(entry) {
    if (entry.barId != null) { this.requests.delete(entry.barId); try { this.ib.cancelRealTimeBars(entry.barId); } catch {} }
    if (entry.quoteId != null) { this.requests.delete(entry.quoteId); try { this.ib.cancelMktData(entry.quoteId); } catch {} }
    entry.barId = null; entry.quoteId = null;
  }
  onError(code, id) {
    const affected = code === 1101 && id === -1 ? [...this.entries.values()] : [this.requests.get(id)].filter(Boolean);
    if (![354, 420, 10089, 10186, 10197, 10225, 1101].includes(code)) return;
    for (const e of affected) {
      // No raw provider message/account identifiers enter the cloud ledger.
      if (e.error === code) continue;
      e.error = code; e.errorAt = this.now(); e.failures += 1;
      const permission = [354, 10089, 10186].includes(code);
      e.retryAt = this.now() + (permission ? 300000 : Math.min(300000, 30000 * 2 ** Math.min(e.failures - 1, 4)));
      this.emit('desktop.component_error', { component_id: 'IBKRNewMarketSubscriptions', code: String(code), symbol: e.symbol, message: `IBKR data subscription rejected for ${e.symbol}; bounded automatic refresh scheduled.`, retry_at: new Date(e.retryAt).toISOString() });
    }
  }
  refresh() {
    if (!this.regular()) return;
    const now = this.now(); while (this.starts.length && now - this.starts[0] >= 600000) this.starts.shift();
    for (const e of this.entries.values()) {
      const stale = e.startedAt != null && now - (e.lastBarAt ?? e.startedAt) >= 60000;
      if (e.barId != null && !e.error && !stale) continue;
      if (now < e.retryAt || this.starts.length >= 50) continue;
      // Stay below IBKR's 60 new five-second bar requests / ten minutes.
      // IDs never overlap temporary quote/order-reconciliation requests.
      if (this.nextId >= 400000) throw new Error('Market request ID space exhausted; supervised runtime restart required');
      this.cancel(e); e.quote = {}; e.lastBarAt = null; e.startedAt = now; e.retryAt = now + 60000; e.error = null;
      e.barId = this.nextId++; e.quoteId = this.nextId++;
      this.requests.set(e.barId, e); this.requests.set(e.quoteId, e); this.starts.push(now);
      const contract = this.contract(e.profile);
      this.ib.reqRealTimeBars(e.barId, contract, 5, WhatToShow.TRADES, true, []);
      this.ib.reqMktData(e.quoteId, contract, '236', false, false, []);
    }
  }
  health() {
    const now = this.now();
    const entries = [...this.entries.values()];
    const reason = e => {
      if (e.error != null) return [354, 10089, 10186].includes(e.error) ? 'market_data_permission_denied' : e.error === 10197 ? 'competing_session' : 'subscription_error';
      if (!this.regular()) return 'outside_regular_session';
      if (e.barId == null) return 'subscription_pacing_wait';
      if (e.quote.market_data_type !== 1) return 'realtime_quote_not_verified';
      if (!(e.quote.bid > 0 && e.quote.ask >= e.quote.bid)) return 'bid_ask_missing';
      if (now - Date.parse(e.quote.bid_at) > 30000 || now - Date.parse(e.quote.ask_at) > 30000) return 'bid_ask_stale';
      if (e.lastBarAt == null || now - e.lastBarAt >= 30000) return 'realtime_bar_stale';
      return null;
    };
    const healthy = e => reason(e) == null;
    return { healthy_symbols: entries.filter(healthy).map(e => e.symbol), pending_symbols: entries.filter(e => !healthy(e)).map(e => e.symbol), details: entries.map(e => ({ symbol: e.symbol, market_data_ready: healthy(e), reason: reason(e), error_code: e.error, market_data_type: e.quote.market_data_type ?? null, bid_at: e.quote.bid_at || null, ask_at: e.quote.ask_at || null, last_bar_at: e.lastBarAt == null ? null : new Date(e.lastBarAt).toISOString(), retry_at: new Date(e.retryAt).toISOString() })) };
  }
  dispose() {
    for (const e of this.entries.values()) this.cancel(e);
    for (const [event, handler] of Object.entries(this.handlers)) this.ib.off(event, handler);
    this.entries.clear();
  }
}
