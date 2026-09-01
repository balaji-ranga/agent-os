import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

export class IBKRNewBridgeCore {
  constructor({ apiUrl, bridgeId, token, spoolDir, fetchImpl = fetch, now = () => new Date() }) {
    if (!apiUrl || !bridgeId || !token) throw new Error('IBKRNew API URL, bridge ID, and token are required');
    this.apiUrl = apiUrl.replace(/\/$/, ''); this.bridgeId = bridgeId; this.token = token; this.fetch = fetchImpl; this.now = now;
    this.spoolDir = spoolDir; mkdirSync(spoolDir, { recursive: true }); this.statePath = join(spoolDir, 'IBKRNew-state.json'); this.spoolPath = join(spoolDir, 'IBKRNew-events.jsonl'); this.commandStatePath = join(spoolDir, 'IBKRNew-command-state.json');
    this.sequence = existsSync(this.statePath) ? Number(JSON.parse(readFileSync(this.statePath, 'utf8')).sequence || 0) : 0;
  }
  commandState() { return existsSync(this.commandStatePath) ? JSON.parse(readFileSync(this.commandStatePath, 'utf8')) : {}; }
  spoolDepth() { return existsSync(this.spoolPath) ? readFileSync(this.spoolPath, 'utf8').split(/\r?\n/).filter(Boolean).length : 0; }
  commandSeen(commandId) { return this.commandState()[commandId] || null; }
  markCommand(commandId, status, detail = {}) { const state = this.commandState(); state[commandId] = { status, detail, updated_at: this.now().toISOString() }; writeFileSync(this.commandStatePath, JSON.stringify(state), { mode: 0o600 }); return state[commandId]; }
  headers() { return { 'content-type': 'application/json', 'x-ibkrnew-bridge-id': this.bridgeId, 'x-ibkrnew-bridge-token': this.token }; }
  emit(eventType, payload, occurredAt = this.now().toISOString()) {
    this.sequence += 1; const event = { event_id: `IBKRNewDesktopEvent_${crypto.randomUUID()}`, sequence: this.sequence, event_type: eventType, occurred_at: occurredAt, payload };
    appendFileSync(this.spoolPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 }); writeFileSync(this.statePath, JSON.stringify({ sequence: this.sequence }), { mode: 0o600 }); return event;
  }
  emitInstrumentProfile(profile, occurredAt = this.now().toISOString()) {
    const symbol = String(profile?.symbol || '').trim().toUpperCase(); const securityType = String(profile?.security_type || '').trim().toUpperCase();
    if (!symbol || !['STK', 'ETF'].includes(securityType)) throw new Error('IBKRNew instrument profile requires symbol and STK or ETF security_type');
    return this.emit('instrument.profile_refreshed', { ...profile, symbol, security_type: securityType }, occurredAt);
  }
  async flush() {
    if (!existsSync(this.spoolPath)) return { sent: 0, remaining: 0 };
    const lines = readFileSync(this.spoolPath, 'utf8').split(/\r?\n/).filter(Boolean); let sent = 0;
    for (const line of lines) {
      const response = await this.fetch(`${this.apiUrl}/bridge/events`, { method: 'POST', headers: this.headers(), body: line });
      if (!response.ok) break; sent += 1;
    }
    const remaining = lines.slice(sent); const temp = `${this.spoolPath}.next`; writeFileSync(temp, remaining.length ? `${remaining.join('\n')}\n` : '', { mode: 0o600 }); renameSync(temp, this.spoolPath);
    return { sent, remaining: remaining.length };
  }
  async claim(limit = 10) {
    const response = await this.fetch(`${this.apiUrl}/bridge/commands/claim`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ limit }) });
    if (!response.ok) throw new Error(`IBKRNew command claim failed: ${response.status}`);
    const commands = (await response.json()).commands || [];
    return commands.filter((command) => this.verifyCommand(command));
  }
  async bootstrap() {
    const response = await this.fetch(`${this.apiUrl}/bridge/bootstrap`, { headers: this.headers() });
    if (!response.ok) throw new Error(`IBKRNew bootstrap failed: ${response.status}`); return response.json();
  }
  verifyCommand(received) {
    const { signature, expires_at: transportExpiry, ...command } = received || {};
    const key = crypto.createHash('sha256').update(String(this.token)).digest('hex');
    const expected = crypto.createHmac('sha256', key).update(JSON.stringify(command)).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    return !transportExpiry || Date.parse(transportExpiry) > this.now().getTime();
  }
  async acknowledge(commandId, status, detail = {}) {
    const response = await this.fetch(`${this.apiUrl}/bridge/commands/${encodeURIComponent(commandId)}/ack`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ status, detail }) });
    if (!response.ok) throw new Error(`IBKRNew acknowledgement failed: ${response.status}`); return response.json();
  }
}

export function buildBarFeatures({ bars, relativeVolume, confirmed15m, shortable = false }) {
  if (!Array.isArray(bars) || bars.length < 21) return null;
  const closes = bars.map((b) => Number(b.close)); const volumes = bars.map((b) => Number(b.volume || 0));
  const ema = (period) => closes.reduce((v, x, i) => i ? x * (2 / (period + 1)) + v * (1 - 2 / (period + 1)) : x, closes[0]);
  const totalVolume = volumes.reduce((a, b) => a + b, 0); const vwap = bars.reduce((sum, b, i) => sum + closes[i] * volumes[i], 0) / Math.max(1, totalVolume);
  return { last: closes.at(-1), close: closes.at(-1), vwap, ema_fast: ema(9), ema_slow: ema(21), relative_volume: Number(relativeVolume), confirmed_15m: confirmed15m === true, shortable, quote_at: bars.at(-1).at || new Date().toISOString() };
}

export function selectUniverseProfiles(profiles, universe) {
  const normalize = (values) => (values || []).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean);
  const globalAllow = normalize(universe?.allowlist); const globalDeny = new Set(normalize(universe?.denylist)); const stockRules = universe?.filters?.stock || {}; const etfRules = universe?.filters?.etf || {};
  const indexes = normalize(stockRules.indexes); const etfAllow = normalize(etfRules.allowlist); const etfDeny = new Set(normalize(etfRules.denylist)); const categories = normalize(etfRules.categories);
  return (Array.isArray(profiles) ? profiles : []).filter((profile) => {
    const symbol = String(profile?.symbol || '').trim().toUpperCase(); const securityType = String(profile?.security_type || '').trim().toUpperCase();
    if (!symbol || globalDeny.has(symbol) || globalAllow.length && !globalAllow.includes(symbol)) return false;
    if (securityType === 'STK') {
      if (stockRules.enabled !== true) return false;
      const memberships = normalize(profile.index_memberships); const matched = indexes.filter((index) => memberships.includes(index));
      return !indexes.length || (stockRules.index_match === 'ALL' ? matched.length === indexes.length : matched.length > 0);
    }
    if (securityType === 'ETF') {
      if (etfRules.enabled !== true || etfDeny.has(symbol) || etfAllow.length && !etfAllow.includes(symbol)) return false;
      const profileCategories = normalize(profile.etf_categories || profile.categories);
      return !categories.length || categories.some((category) => profileCategories.includes(category));
    }
    return false;
  });
}

export class IBKRNewFeatureEngine {
  constructor() { this.current = new Map(); this.history = new Map(); this.shortable = new Map(); }
  setShortable(symbol, value) { this.shortable.set(symbol, value === true); }
  ingest(bar, policy) {
    const symbol = String(bar.symbol || '').toUpperCase(); const minute = String(bar.at).slice(0, 16); const current = this.current.get(symbol);
    if (!current || current.minute !== minute) {
      this.current.set(symbol, { ...bar, minute, open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume || 0) });
      if (!current) return null;
      const history = [...(this.history.get(symbol) || []), current].slice(-120); this.history.set(symbol, history);
      if (history.length < 21) return null;
      const avgVolume = history.slice(0, -1).reduce((sum, b) => sum + Number(b.volume || 0), 0) / Math.max(1, history.length - 1);
      const rising15m = current.close > history.at(-16).close;
      const features = buildBarFeatures({ bars: history, relativeVolume: Number(current.volume || 0) / Math.max(1, avgVolume), confirmed15m: rising15m === (current.close > current.open), shortable: this.shortable.get(symbol) === true });
      const tr = history.slice(-14).map((b, i, arr) => Math.max(b.high - b.low, i ? Math.abs(b.high - arr[i - 1].close) : 0, i ? Math.abs(b.low - arr[i - 1].close) : 0));
      const atr = tr.reduce((a, b) => a + b, 0) / tr.length; const direction = features.last > features.vwap && features.ema_fast > features.ema_slow ? 1 : -1;
      const stop = features.last - direction * Math.max(atr, features.last * 0.005); const riskPerShare = Math.abs(features.last - stop);
      const maxPosition = direction > 0 ? policy.budgets.max_stock_position_usd : policy.budgets.max_short_position_usd;
      const quantity = Math.max(0, Math.floor(Math.min(maxPosition / features.last, policy.loss_limits.max_planned_loss_per_trade_usd / riskPerShare)));
      if (!quantity) return null;
      return { symbol, ...features, quantity, limit_price: features.last, planned_loss_usd: quantity * riskPerShare, protection: { stop_price: stop, targets: [{ limit_price: features.last + direction * riskPerShare * 1.5, quantity }] } };
    }
    current.high = Math.max(current.high, Number(bar.high)); current.low = Math.min(current.low, Number(bar.low)); current.close = Number(bar.close); current.volume += Number(bar.volume || 0); current.at = bar.at;
    return null;
  }
}
