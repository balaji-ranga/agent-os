import { getDb } from '../db/schema.js';
import { ensureIbkrNewEventTraderSchema, getIbkrNewProfileRefreshContext, applyIbkrNewFmpProfile, getIbkrNewProfileRefreshStatus } from './ibkrnew-event-trader.js';
import { fmpSymbol, mapFmpFundamentals, mapFmpEarnings } from './ibkrnew-profile-data.js';
import { createHash } from 'node:crypto';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ADAPTER_VERSION = 'fmp-profile-v2-earnings-limit5';
let active = null, timer = null, requestTail = Promise.resolve();

function quotaDb() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS ibkrnew_fmp_request_budget (key_hash TEXT PRIMARY KEY, utc_day TEXT NOT NULL, requests INTEGER NOT NULL, last_request_at INTEGER NOT NULL, paused_until INTEGER NOT NULL DEFAULT 0)`);
  return db;
}
const retryError = (reason, at) => Object.assign(new Error(reason), { retryAt: at });
export function fmpRetryAt(value, now = Date.now()) {
  const seconds = Number(value);
  const parsed = value == null ? NaN : Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(value);
  return Math.max(now + 60000, Number.isFinite(parsed) ? parsed : now + 3600000);
}

export function planProfileJobs(context, entries, now = Date.now()) {
  return entries.filter(e => {
    const rules = context.rules[e.family === 'fundamentals' ? 'fundamentals' : 'corporate_events'];
    if (context.providers[e.family === 'fundamentals' ? 'fundamentals_provider' : 'earnings_provider'] !== 'FMP' || rules?.enabled !== true) return false;
    const refreshMs = Math.min(86400000, Number(rules.maximum_age_hours) * 2400000);
    if (e.matches && e.valid && now - Date.parse(e.fieldAt) >= 0 && now - Date.parse(e.fieldAt) < refreshMs) return false;
    return !(e.prior?.bridge_id === context.bridge_id && Date.parse(e.prior.next_attempt_at) > now && e.prior.status !== 'ready');
  }).sort((a, b) => Number(a.valid && a.matches) - Number(b.valid && b.matches) || (Date.parse(a.prior?.updated_at) || 0) - (Date.parse(b.prior?.updated_at) || 0) || a.symbol.localeCompare(b.symbol) || a.family.localeCompare(b.family));
}

// Fixed, trusted upstream. No request-supplied URL/key and no executable quotes.
export function createFmpProfileClient({ fetchImpl = fetch, key = process.env.MARKET_DATA_API_KEY, pace = true, dailyLimit = Number(process.env.IBKRNEW_FMP_DAILY_CALL_LIMIT || 250) } = {}) {
  const keyHash = createHash('sha256').update(String(key || '')).digest('hex');
  const client = (endpoint, params) => {
    const run = async () => {
    if (!key || String(process.env.MARKET_DATA_PROVIDER || 'fmp').toLowerCase() !== 'fmp') throw new Error('FMP_KEY_NOT_CONFIGURED');
    if (!['profile', 'ratios-ttm', 'income-statement', 'cash-flow-statement', 'earnings'].includes(endpoint)) throw new Error('FMP_ENDPOINT_INVALID');
    const db = quotaDb();
    let prior = db.prepare('SELECT * FROM ibkrnew_fmp_request_budget WHERE key_hash=?').get(keyHash);
    if (Date.now() < Number(prior?.paused_until || 0)) throw retryError('FMP_RATE_LIMIT_COOLDOWN', prior.paused_until);
    if (pace) await wait(Math.max(0, Number(prior?.last_request_at || 0) + 2100 - Date.now()));
    db.transaction(() => {
      const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
      prior = db.prepare('SELECT * FROM ibkrnew_fmp_request_budget WHERE key_hash=?').get(keyHash);
      const requests = prior?.utc_day === day ? prior.requests : 0;
      if (now < Number(prior?.paused_until || 0)) throw retryError('FMP_RATE_LIMIT_COOLDOWN', prior.paused_until);
      if (!(dailyLimit > 0) || requests >= dailyLimit) throw retryError('FMP_LOCAL_DAILY_BUDGET_EXHAUSTED', Date.parse(day) + 86400000);
      db.prepare('INSERT INTO ibkrnew_fmp_request_budget VALUES(?,?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET utc_day=excluded.utc_day,requests=excluded.requests,last_request_at=excluded.last_request_at').run(keyHash, day, requests + 1, now, 0);
    })();
    const url = new URL(`https://financialmodelingprep.com/stable/${endpoint}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    url.searchParams.set('apikey', key);
    let response;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new Error('FMP_REQUEST_FAILED'); }
    if (!response.ok) {
      const retryAt = response.status === 429 ? fmpRetryAt(response.headers.get('retry-after')) : Date.now() + ([401, 402, 403].includes(response.status) ? 86400000 : 3600000);
      if ([401, 403, 429].includes(response.status)) db.prepare('UPDATE ibkrnew_fmp_request_budget SET paused_until=? WHERE key_hash=?').run(retryAt, keyHash);
      throw retryError(`FMP_HTTP_${response.status}_${endpoint.replaceAll('-', '_').toUpperCase()}`, retryAt); // Never persist upstream body/URL/key.
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('FMP_RESPONSE_TOO_LARGE');
    let rows; try { rows = JSON.parse(body); } catch { throw new Error('FMP_RESPONSE_INVALID'); }
    if (!Array.isArray(rows)) throw new Error('FMP_RESPONSE_INVALID');
    return rows;
    };
    const result = requestTail.then(run, run);
    requestTail = result.catch(() => {});
    return result;
  };
  client.checkBudget = (calls = 1) => {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    const prior = quotaDb().prepare('SELECT * FROM ibkrnew_fmp_request_budget WHERE key_hash=?').get(keyHash);
    if (now < Number(prior?.paused_until || 0)) throw retryError('FMP_RATE_LIMIT_COOLDOWN', prior.paused_until);
    if (!(dailyLimit > 0) || (prior?.utc_day === day ? prior.requests : 0) + calls > dailyLimit) throw retryError('FMP_LOCAL_DAILY_BUDGET_EXHAUSTED', Date.parse(day) + 86400000);
  };
  return client;
}

function state(context, symbol, family, status, reason, nextAt, refreshedAt = null) {
  const ts = new Date().toISOString();
  getDb().prepare(`INSERT INTO ibkrnew_profile_refresh_state(owner_user_id,bridge_id,environment,symbol,family,provider,status,reason_code,refreshed_at,next_attempt_at,updated_at,adapter_version)
    VALUES(?,?,?,?,?,'FMP',?,?,?,?,?,?) ON CONFLICT(owner_user_id,environment,symbol,family,provider) DO UPDATE SET bridge_id=excluded.bridge_id,status=excluded.status,reason_code=excluded.reason_code,refreshed_at=COALESCE(excluded.refreshed_at,ibkrnew_profile_refresh_state.refreshed_at),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at,adapter_version=excluded.adapter_version`).run(context.owner_user_id, context.bridge_id, context.environment, symbol, family, status, reason, refreshedAt, new Date(nextAt).toISOString(), ts, ADAPTER_VERSION);
}

export async function refreshIbkrNewProfiles(ownerUserId, { client = createFmpProfileClient(), maxSymbols = 1000 } = {}) {
  const context = getIbkrNewProfileRefreshContext(ownerUserId);
  if (!context) return { skipped: 'ACTIVE_ATTESTED_CONTEXT_REQUIRED', updated: 0 };
  let updated = 0, failed = 0;
  const entries = [];
  for (const symbol of context.symbols.slice(0, maxSymbols)) {
    for (const family of ['fundamentals', 'earnings']) {
      const provider = context.providers[family === 'fundamentals' ? 'fundamentals_provider' : 'earnings_provider'];
      const rules = context.rules[family === 'fundamentals' ? 'fundamentals' : 'corporate_events'];
      if (provider !== 'FMP' || rules?.enabled !== true) continue;
      const prior = getDb().prepare("SELECT * FROM ibkrnew_profile_refresh_state WHERE owner_user_id=? AND environment=? AND symbol=? AND family=? AND provider='FMP'").get(ownerUserId, context.environment, symbol, family);
      const profileRow = getDb().prepare("SELECT profile_json,fundamentals_at,corporate_events_at FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND bridge_id=? AND environment=? AND symbol=? AND security_type='STK'").get(ownerUserId, context.bridge_id, context.environment, symbol);
      const cached = JSON.parse(profileRow?.profile_json || '{}');
      const fieldAt = family === 'fundamentals' ? profileRow?.fundamentals_at : profileRow?.corporate_events_at;
      const matches = cached[family === 'fundamentals' ? 'fundamentals_source' : 'corporate_events_source'] === 'FMP';
      const value = cached[family === 'fundamentals' ? 'fundamentals' : 'corporate_events'];
      const valid = Boolean(value) && (family !== 'earnings' || Array.isArray(value) && value.length > 0 && cached.earnings_coverage?.verified === true) && Date.now() - Date.parse(fieldAt) < Number(rules.maximum_age_hours) * 3600000;
      entries.push({ symbol, family, prior, fieldAt, matches, valid });
    }
  }
  for (const { symbol, family } of planProfileJobs(context, entries).slice(0, 20)) {
      const rules = context.rules[family === 'fundamentals' ? 'fundamentals' : 'corporate_events'];
      try { client.checkBudget?.(family === 'fundamentals' ? rules.require_positive_operating_cash_flow ? 4 : 3 : 1); }
      catch (error) { return { updated, failed, paused: error.message, retry_at: new Date(error.retryAt).toISOString() }; }
      const current = getIbkrNewProfileRefreshContext(ownerUserId);
      if (!current || current.environment !== context.environment || current.universe_version !== context.universe_version || current.bridge_id !== context.bridge_id) return { skipped: 'CONTEXT_CHANGED', updated, failed };
      state(context, symbol, family, 'refreshing', null, Date.now() + 120000);
      try {
        const ticker = fmpSymbol(symbol);
        let payload;
        if (family === 'fundamentals') {
          const profiles = await client('profile', { symbol: ticker });
          const ratios = await client('ratios-ttm', { symbol: ticker });
          const income = await client('income-statement', { symbol: ticker, period: 'quarter', limit: 4 });
          const cashFlow = rules.require_positive_operating_cash_flow ? await client('cash-flow-statement', { symbol: ticker, period: 'quarter', limit: 4 }) : undefined;
          payload = mapFmpFundamentals({ symbol, profiles, ratios, income, cashFlow });
        } else payload = mapFmpEarnings({ symbol, earnings: await client('earnings', { symbol: ticker, limit: 5 }) });
        if (!applyIbkrNewFmpProfile(context, family, payload)) return { skipped: 'CONTEXT_CHANGED', updated, failed };
        const refreshMs = Math.min(86400000, Number(rules.maximum_age_hours) * 2400000);
        state(context, symbol, family, 'ready', null, Date.now() + refreshMs, new Date().toISOString()); updated++;
      } catch (error) {
        const reason = /^FMP_[A-Z0-9_]+$|^PROFILE_SYMBOL_INVALID$/.test(error.message) ? error.message : 'FMP_REFRESH_FAILED';
        state(context, symbol, family, 'failed', reason, error.retryAt || Date.now() + 3600000); failed++;
        if (reason === 'FMP_KEY_NOT_CONFIGURED' || /^FMP_HTTP_(401|403|429)_/.test(reason) || ['FMP_RATE_LIMIT_COOLDOWN', 'FMP_LOCAL_DAILY_BUDGET_EXHAUSTED'].includes(reason)) return { updated, failed, paused: reason };
      }
  }
  return { updated, failed };
}

export function queueIbkrNewProfileRefresh(ownerUserId) {
  const context = getIbkrNewProfileRefreshContext(ownerUserId);
  if (!context) return { queued: false, reason: 'ACTIVE_ATTESTED_CONTEXT_REQUIRED' };
  if (!Object.values(context.providers).includes('FMP')) return { queued: false, reason: 'IBKR_DESKTOP_PROFILE_FEED_REQUIRED' };
  if (active) return { queued: true, already_running: true };
  active = refreshIbkrNewProfiles(ownerUserId).catch(() => ({ failed: 'PROFILE_REFRESH_INTERNAL_ERROR' })).finally(() => { active = null; });
  return { queued: true };
}

export function startIbkrNewProfileRefresh() {
  if (timer) return;
  const tick = async () => {
    if (active) return;
    ensureIbkrNewEventTraderSchema();
    const owners = getDb().prepare("SELECT DISTINCT owner_user_id FROM ibkrnew_execution_modes WHERE requested_mode IN ('paper','live') AND activation_state='ACTIVE'").all();
    active = (async () => { for (const row of owners) await refreshIbkrNewProfiles(row.owner_user_id); })().catch(() => {}).finally(() => { active = null; });
  };
  timer = setInterval(() => { tick().catch(() => {}); }, 60000); timer.unref();
  setImmediate(() => { tick().catch(() => {}); });
}

export { getIbkrNewProfileRefreshStatus };
