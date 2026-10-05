import { EventName, WhatToShow } from '@stoqey/ib';
import { tradingSession } from './session.js';

export const VOLUME_SOURCE = 'ibkr_historical_daily_trades_20_sessions';
const DAY = 86400000;

// Daily TRADES bars use the volume delivered by the current Gateway in shares;
// do not apply the historical generic-tick/real-time-bar lot multiplier here.
export function dailyVolumeProfile(bars, now = Date.now()) {
  const session = tradingSession(new Date(now));
  if (!session.calendar_known) throw new Error('MARKET_CALENDAR_UNAVAILABLE');
  const today = session.day.replaceAll('-', '');
  const completed = new Map();
  for (const bar of bars) {
    const date = String(bar.date);
    const volume = Number(bar.volume);
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    if (!/^\d{8}$/.test(date) || !Number.isFinite(Date.parse(iso)) || new Date(iso).toISOString().slice(0, 10) !== iso || !Number.isFinite(volume) || volume < 0) throw new Error('INVALID_DAILY_VOLUME');
    if (date > today || date === today && session.minutes_to_close > 0) continue;
    completed.set(date, volume);
  }
  const dates = [...completed.keys()].sort().slice(-20);
  if (dates.length !== 20) throw new Error('INSUFFICIENT_COMPLETED_DAYS');
  const last = dates.at(-1);
  const lastAt = Date.parse(`${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}T00:00:00Z`);
  if (now - lastAt > 7 * DAY) throw new Error('DAILY_HISTORY_STALE');
  const volume = dates.reduce((sum, date) => sum + completed.get(date), 0) / dates.length;
  if (!(volume > 0)) throw new Error('INVALID_DAILY_VOLUME');
  return { average_daily_volume: volume, average_daily_volume_at: new Date(now).toISOString(), average_daily_volume_source: VOLUME_SOURCE, average_daily_volume_sessions: dates.length, average_daily_volume_last_session: last, average_daily_volume_unit: 'shares' };
}

// One outstanding data-only request, at most 50 starts/10 minutes, six-hour
// refresh. No quote subscriptions, order methods, or account fields are used.
export class VolumeProfiles {
  constructor(ib, contract, emit, { now = Date.now } = {}) {
    this.ib = ib; this.contract = contract; this.emit = emit; this.now = now;
    this.entries = new Map(); this.starts = []; this.nextId = 500000; this.active = null;
    this.handlers = {
      [EventName.historicalData]: (id, date, _o, _h, _l, _c, volume) => {
        if (id !== this.active?.id) return;
        if (String(date).startsWith('finished')) this.complete();
        else this.active.bars.push({ date, volume });
      },
      [EventName.historicalDataEnd]: id => { if (id === this.active?.id) this.complete(); },
      [EventName.error]: (_error, code, id) => {
        if (id === this.active?.id) this.fail(`IBKR_${Number(code)}`);
      },
    };
    for (const [event, handler] of Object.entries(this.handlers)) ib.on(event, handler);
  }
  setProfiles(profiles) {
    const desired = new Map(profiles.filter(p => p.security_type === 'STK').map(p => [p.symbol.toUpperCase(), p]));
    if (this.active && !desired.has(this.active.entry.profile.symbol.toUpperCase())) this.cancel();
    for (const symbol of this.entries.keys()) if (!desired.has(symbol)) this.entries.delete(symbol);
    for (const [symbol, profile] of desired) {
      const previous = this.entries.get(symbol);
      if (previous && JSON.stringify(this.contract(previous.profile)) !== JSON.stringify(this.contract(profile))) {
        if (this.active?.entry === previous) this.cancel();
        this.entries.delete(symbol);
      }
      const entry = this.entries.get(symbol) || { retryAt: 0, volume: null, error: null };
      entry.profile = profile; this.entries.set(symbol, entry);
    }
    this.refresh();
  }
  cancel() {
    if (!this.active) return;
    const { id } = this.active; this.active = null;
    try { this.ib.cancelHistoricalData(id); } catch {}
  }
  fail(reason) {
    const entry = this.active?.entry; if (!entry) return;
    this.cancel(); entry.error = reason; entry.retryAt = this.now() + 600000;
    this.emit('desktop.component_error', { component_id: 'IBKRNewVolumeProfiles', code: reason, symbol: entry.profile.symbol, message: 'IBKR daily-volume refresh failed; existing field timestamps are preserved.', retry_at: new Date(entry.retryAt).toISOString() });
  }
  complete() {
    const request = this.active; if (!request) return;
    let volume;
    try { volume = dailyVolumeProfile(request.bars, this.now()); } catch (error) { this.fail(error.message); return; }
    // The end callback already closes a finite request; cancelling it would
    // generate an unnecessary IBKR 366 (no historical query) diagnostic.
    this.active = null; request.entry.volume = volume; request.entry.error = null; request.entry.retryAt = this.now() + 6 * 3600000;
    this.emit('instrument.profile_refreshed', { symbol: request.entry.profile.symbol, security_type: 'STK', ...volume });
  }
  refresh() {
    const now = this.now();
    if (this.active && now - this.active.startedAt >= 30000) this.fail('DAILY_HISTORY_TIMEOUT');
    if (this.active) return;
    while (this.starts.length && now - this.starts[0] >= 600000) this.starts.shift();
    if (this.starts.length >= 50 || this.starts.length && now - this.starts.at(-1) < 12000) return;
    const entry = [...this.entries.values()].find(e => now >= e.retryAt);
    if (!entry) return;
    if (this.nextId >= 600000) throw new Error('Volume request ID space exhausted');
    const id = this.nextId++; this.active = { id, entry, bars: [], startedAt: now }; this.starts.push(now);
    try { this.ib.reqHistoricalData(id, this.contract(entry.profile), '', '40 D', '1 day', WhatToShow.TRADES, true, 1, false); }
    catch { this.fail('DAILY_HISTORY_REQUEST_FAILED'); }
  }
  get(symbol) {
    const volume = this.entries.get(symbol.toUpperCase())?.volume;
    return volume && this.now() - Date.parse(volume.average_daily_volume_at) <= 36 * 3600000 ? volume : null;
  }
  health() {
    return { component_id: 'IBKRNewVolumeProfiles', component_type: 'instrument_profiles', status: [...this.entries.keys()].every(s => this.get(s)) ? 'online' : 'degraded', symbols: [...this.entries.keys()], ready_symbols: [...this.entries.keys()].filter(s => this.get(s)), pending_symbols: [...this.entries.keys()].filter(s => !this.get(s)), details: [...this.entries].map(([symbol, e]) => ({ symbol, ...this.get(symbol), reason: e.error || (this.get(symbol) ? null : this.active?.entry === e ? 'refresh_in_progress' : 'refresh_queued'), retry_at: new Date(e.retryAt).toISOString() })) };
  }
  dispose() {
    this.cancel();
    for (const [event, handler] of Object.entries(this.handlers)) this.ib.off(event, handler);
    this.entries.clear();
  }
}
