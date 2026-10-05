import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';

const IBKR_ACCOUNT_PATTERN = /\b(?:DU|U)[- ]?\d{5,12}\b/gi;
const IBKR_ACCOUNT_KEYS = new Set(['accountid', 'accountnumber', 'accountno', 'accountcode', 'acctid', 'acctnumber', 'acctno', 'acctcode', 'ibkraccountid', 'ibkraccountnumber']);

export function sanitizeBridgeEgress(value, depth = 0) {
  if (depth > 30) return '[REDACTED_EXCESSIVE_DEPTH]';
  if (typeof value === 'string') return value.replace(IBKR_ACCOUNT_PATTERN, '[REDACTED_IBKR_ACCOUNT]');
  if (Array.isArray(value)) return value.map((child) => sanitizeBridgeEgress(child, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (IBKR_ACCOUNT_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    clean[key] = sanitizeBridgeEgress(child, depth + 1);
  }
  return clean;
}

function sanitizeSpoolLine(line) {
  try { return JSON.stringify(sanitizeBridgeEgress(JSON.parse(line))); }
  catch { return String(line).replace(IBKR_ACCOUNT_PATTERN, '[REDACTED_IBKR_ACCOUNT]'); }
}

export function commandMatchesBootstrap(command, bootstrap) {
  const commandRef = String(command?.authorization?.account_ref || '');
  const currentRef = String(bootstrap?.account_ref || '');
  const commandCycle = String(command?.authorization?.goal?.cycle_id || '');
  const currentCycle = String(bootstrap?.goal?.cycle?.cycle_id || '');
  const commandEnvironment = String(command?.authorization?.environment || '');
  const currentEnvironment = String(bootstrap?.environment || '');
  return Boolean(commandRef && currentRef && commandRef === currentRef && commandCycle && commandCycle === currentCycle && commandEnvironment && commandEnvironment === currentEnvironment && bootstrap?.goal?.opening_trades_allowed === true && bootstrap?.execution_mode?.requested_mode === currentEnvironment && bootstrap?.execution_mode?.execution_enabled === true);
}

export function bridgeRuntimeStalled({ cycleStartedAt = 0, now = Date.now(), stallTimeoutMs = 120000 } = {}) {
  const started = Number(cycleStartedAt || 0);
  const timeout = Math.max(1, Number(stallTimeoutMs) || 120000);
  return started > 0 && Number(now) - started >= timeout;
}

export class IBKRNewBridgeCore {
  constructor({ apiUrl, bridgeId, token, spoolDir, fetchImpl = fetch, now = () => new Date(), requestTimeoutMs = 15000 }) {
    if (!apiUrl || !bridgeId || !token) throw new Error('IBKRNew API URL, bridge ID, and token are required');
    this.apiUrl = apiUrl.replace(/\/$/, ''); this.bridgeId = bridgeId; this.token = token; this.fetch = fetchImpl; this.now = now;
    this.requestTimeoutMs = Math.max(10, Number(requestTimeoutMs) || 15000);
    this.spoolDir = spoolDir; mkdirSync(spoolDir, { recursive: true }); this.statePath = join(spoolDir, 'IBKRNew-state.json'); this.spoolPath = join(spoolDir, 'IBKRNew-events.jsonl'); this.commandStatePath = join(spoolDir, 'IBKRNew-command-state.json');
    this.batchPath = join(spoolDir, 'IBKRNew-events.inflight.jsonl');
    this.flushPromise = null;
    const state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : {};
    this.sequence = state.bridge_id && state.bridge_id !== bridgeId ? 0 : Number(state.sequence || 0);
  }
  commandState() { return existsSync(this.commandStatePath) ? JSON.parse(readFileSync(this.commandStatePath, 'utf8')) : {}; }
  pendingLines() { return [this.batchPath, this.spoolPath].flatMap((path) => existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean) : []); }
  spoolDepth() { return this.pendingLines().length; }
  commandSeen(commandId) { return this.commandState()[commandId] || null; }
  markCommand(commandId, status, detail = {}) { const state = this.commandState(); state[commandId] = { status, detail, updated_at: this.now().toISOString() }; this.atomicWrite(this.commandStatePath, JSON.stringify(state)); return state[commandId]; }
  headers() { return { 'content-type': 'application/json', 'x-ibkrnew-bridge-id': this.bridgeId, 'x-ibkrnew-bridge-token': this.token }; }
  atomicWrite(path, content) { const temp = `${path}.next`; writeFileSync(temp, content, { mode: 0o600 }); renameSync(temp, path); }
  persistSequence() { this.atomicWrite(this.statePath, JSON.stringify({ bridge_id: this.bridgeId, sequence: this.sequence })); }
  synchronizeSequence(serverSequence) {
    const sequence = Number(serverSequence);
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('IBKRNew bootstrap returned an invalid bridge sequence');
    // Include a crashed upload batch, discard only events already committed by
    // the server, and retain callback events appended while HTTP was pending.
    const lines = this.pendingLines();
    const state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : {};
    const matchingBridge = !state.bridge_id || state.bridge_id === this.bridgeId;
    const pending = matchingBridge ? [...new Map(lines.map((line) => JSON.parse(line)).filter((event) => Number(event.sequence) > sequence).map((event) => [event.event_id || `legacy:${event.sequence}`, event])).values()] : [];
    const contiguous = pending.every((event, index) => Number(event.sequence) === sequence + index + 1);
    let archivedSpool = null;
    if (!matchingBridge || !contiguous || (!pending.length && this.sequence !== sequence)) {
      if (lines.length) {
        archivedSpool = join(this.spoolDir, `IBKRNew-events.orphaned-${Date.now()}-${crypto.randomUUID()}.jsonl`);
        writeFileSync(archivedSpool, `${lines.join('\n')}\n`, { mode: 0o600 });
      }
    }
    const replay = pending.map((event, index) => ({ ...event, sequence: sequence + index + 1 }));
    // Persist the replacement before removing the upload batch. Event ids make
    // replay after a crash idempotent, including a lost HTTP acknowledgement.
    this.atomicWrite(this.spoolPath, replay.length ? `${replay.map((event) => JSON.stringify(event)).join('\n')}\n` : '');
    if (existsSync(this.batchPath)) unlinkSync(this.batchPath);
    const changed = this.sequence !== sequence + replay.length || !contiguous || !matchingBridge;
    this.sequence = sequence + replay.length;
    this.persistSequence();
    return { changed, sequence: this.sequence, archived_spool: archivedSpool };
  }
  async request(path, init = {}, operation = 'request') {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const error = new Error(`IBKRNew ${operation} timed out after ${this.requestTimeoutMs}ms`);
        error.code = 'IBKRNEW_HTTP_TIMEOUT';
        reject(error);
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.fetch(`${this.apiUrl}${path}`, { ...init, signal: controller.signal }),
        timeout,
      ]);
    } catch (error) {
      if (error?.code === 'IBKRNEW_HTTP_TIMEOUT') throw error;
      throw new Error(`IBKRNew ${operation} failed: ${error?.message || String(error)}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
  emit(eventType, payload, occurredAt = this.now().toISOString()) {
    this.sequence += 1; const event = sanitizeBridgeEgress({ event_id: `IBKRNewDesktopEvent_${crypto.randomUUID()}`, sequence: this.sequence, event_type: eventType, occurred_at: occurredAt, payload });
    appendFileSync(this.spoolPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 }); this.persistSequence(); return event;
  }
  emitInstrumentProfile(profile, occurredAt = this.now().toISOString()) {
    const symbol = String(profile?.symbol || '').trim().toUpperCase(); const securityType = String(profile?.security_type || '').trim().toUpperCase();
    if (!symbol || !['STK', 'ETF'].includes(securityType)) throw new Error('IBKRNew instrument profile requires symbol and STK or ETF security_type');
    return this.emit('instrument.profile_refreshed', { ...profile, symbol, security_type: securityType }, occurredAt);
  }
  flush() {
    if (!this.flushPromise) this.flushPromise = this.flushBatch().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }
  async flushBatch() {
    let sent = 0;
    while (sent < 200) {
      if (!existsSync(this.batchPath)) {
        if (!existsSync(this.spoolPath) || !readFileSync(this.spoolPath, 'utf8').trim()) break;
        renameSync(this.spoolPath, this.batchPath);
      }
      const lines = readFileSync(this.batchPath, 'utf8').split(/\r?\n/).filter(Boolean);
      if (!lines.length) { unlinkSync(this.batchPath); continue; }
      const response = await this.request('/bridge/events', { method: 'POST', headers: this.headers(), body: sanitizeSpoolLine(lines[0]) }, 'event flush');
      if (!response.ok) throw new Error(`IBKRNew event delivery failed: ${response.status}`);
      const receipt = await response.json();
      if (receipt?.accepted !== true || receipt?.status !== 'accepted') {
        const error = new Error(`IBKRNew event not accepted: ${receipt?.reason || receipt?.status || 'invalid receipt'}`);
        error.code = receipt?.status === 'quarantined' ? 'IBKRNEW_SEQUENCE_GAP' : 'IBKRNEW_EVENT_REJECTED';
        throw error;
      }
      const remaining = lines.slice(1);
      this.atomicWrite(this.batchPath, remaining.length ? `${remaining.join('\n')}\n` : '');
      if (!remaining.length) unlinkSync(this.batchPath);
      sent += 1;
    }
    return { sent, remaining: this.spoolDepth() };
  }
  async claim(limit = 10) {
    const response = await this.request('/bridge/commands/claim', { method: 'POST', headers: this.headers(), body: JSON.stringify({ limit, protocol_version: 2 }) }, 'command claim');
    if (!response.ok) throw new Error(`IBKRNew command claim failed: ${response.status}`);
    const commands = (await response.json()).commands || [];
    return commands.filter((command) => this.verifyCommand(command));
  }
  async bootstrap() {
    const response = await this.request('/bridge/bootstrap', { headers: this.headers() }, 'bootstrap');
    if (!response.ok) throw new Error(`IBKRNew bootstrap failed: ${response.status}`); return response.json();
  }
  async executeCommand(command, gateway) {
    const seen = this.commandSeen(command.command_id);
    if (seen) {
      const status = ['submitted', 'rejected', 'uncertain'].includes(seen.status) ? seen.status : 'uncertain';
      return this.acknowledge(command.command_id, status, seen.detail);
    }
    let status; let detail;
    try {
      const executionBoot = await this.bootstrap();
      if (!commandMatchesBootstrap(command, executionBoot)) throw new Error('account reference epoch changed before execution');
      this.markCommand(command.command_id, 'executing');
      detail = await gateway.placeProtected(command);
      status = 'submitted';
    } catch (error) {
      status = error.submission_uncertain ? 'uncertain' : 'rejected';
      detail = { error: error.message };
      this.emit('desktop.component_error', { component_id: 'IBKRNewExecutionAdapter', component_type: 'execution_adapter', code: status === 'uncertain' ? 'COMMAND_UNCERTAIN' : 'COMMAND_REJECTED', message: error.message, command_id: command.command_id });
    }
    this.markCommand(command.command_id, status, detail);
    // A receipt transport failure must never rewrite broker submission state.
    return this.acknowledge(command.command_id, status, detail);
  }
  verifyCommand(received) {
    const { signature, expires_at: transportExpiry, ...command } = received || {};
    const key = crypto.createHash('sha256').update(String(this.token)).digest('hex');
    const expected = crypto.createHmac('sha256', key).update(JSON.stringify(command)).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    return !transportExpiry || Date.parse(transportExpiry) > this.now().getTime();
  }
  async acknowledge(commandId, status, detail = {}) {
    const response = await this.request(`/bridge/commands/${encodeURIComponent(commandId)}/ack`, { method: 'POST', headers: this.headers(), body: JSON.stringify(sanitizeBridgeEgress({ status, detail })) }, 'command acknowledgement');
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

export function acquireBridgeRuntimeLock(spoolDir) {
  mkdirSync(spoolDir, { recursive: true });
  const path = join(spoolDir, 'IBKRNew-runtime.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    try { fd = openSync(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(path, 'utf8')); }
      catch {
        if (Date.now() - statSync(path).mtimeMs < 60000) throw new Error('IBKRNew bridge runtime lock is still initializing');
        renameSync(path, `${path}.incomplete-${Date.now()}`); continue;
      }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('IBKRNew bridge runtime lock owner is invalid');
      try { process.kill(owner.pid, 0); }
      catch (probe) {
        if (probe.code === 'ESRCH') { unlinkSync(path); continue; }
        throw new Error('IBKRNew bridge runtime lock owner cannot be verified');
      }
      throw new Error('Another IBKRNew bridge runtime already owns this spool');
    }
    const identity = { pid: process.pid, nonce: crypto.randomUUID() };
    try { writeFileSync(fd, JSON.stringify(identity)); } finally { closeSync(fd); }
    return () => {
      if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).nonce === identity.nonce) unlinkSync(path);
    };
  }
  throw new Error('IBKRNew bridge runtime lock acquisition failed');
}

export function buildMarketSubscriptionComponent(symbols) {
  const activeSymbols = [...new Set((symbols || []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
  return {
    component_id: 'IBKRNewMarketSubscriptions',
    component_type: 'market_subscriptions',
    status: activeSymbols.length ? 'online' : 'degraded',
    subscription_count: activeSymbols.length,
    symbols: activeSymbols,
    message: activeSymbols.length
      ? `${activeSymbols.length} configured market subscription(s) are active.`
      : 'No market subscriptions are configured. Account monitoring remains active, but no price-driven entry signals can be produced.',
  };
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
