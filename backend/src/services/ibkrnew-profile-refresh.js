import { getDb } from '../db/schema.js';
import { ensureIbkrNewEventTraderSchema, getIbkrNewProfileRefreshContext, applyIbkrNewFmpProfile, getIbkrNewProfileRefreshStatus } from './ibkrnew-event-trader.js';
import { fmpSymbol, mapFmpFundamentals, mapFmpEarnings } from './ibkrnew-profile-data.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let active = null, timer = null, lastRequestAt = 0, pausedUntil = 0;

// Fixed, trusted upstream. No request-supplied URL/key and no executable quotes.
export function createFmpProfileClient({ fetchImpl = fetch, key = process.env.MARKET_DATA_API_KEY, pace = true } = {}) {
  return async (endpoint, params) => {
    if (!key || String(process.env.MARKET_DATA_PROVIDER || 'fmp').toLowerCase() !== 'fmp') throw new Error('FMP_KEY_NOT_CONFIGURED');
    if (!['profile', 'ratios-ttm', 'income-statement', 'cash-flow-statement', 'earnings'].includes(endpoint)) throw new Error('FMP_ENDPOINT_INVALID');
    if (Date.now() < pausedUntil) throw new Error('FMP_RATE_LIMIT_COOLDOWN');
    if (pace) await wait(Math.max(0, lastRequestAt + 2100 - Date.now()));
    lastRequestAt = Date.now();
    const url = new URL(`https://financialmodelingprep.com/stable/${endpoint}`);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    url.searchParams.set('apikey', key);
    let response;
    try { response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new Error('FMP_REQUEST_FAILED'); }
    if (!response.ok) {
      if ([401, 403, 429].includes(response.status)) pausedUntil = Date.now() + 3600000;
      throw new Error(`FMP_HTTP_${response.status}`); // Never persist upstream body/URL/key.
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > 2 * 1024 * 1024) throw new Error('FMP_RESPONSE_TOO_LARGE');
    let rows; try { rows = JSON.parse(body); } catch { throw new Error('FMP_RESPONSE_INVALID'); }
    if (!Array.isArray(rows)) throw new Error('FMP_RESPONSE_INVALID');
    return rows;
  };
}

function state(context, symbol, family, status, reason, nextAt, refreshedAt = null) {
  const ts = new Date().toISOString();
  getDb().prepare(`INSERT INTO ibkrnew_profile_refresh_state(owner_user_id,bridge_id,environment,symbol,family,provider,status,reason_code,refreshed_at,next_attempt_at,updated_at)
    VALUES(?,?,'paper',?,?,'FMP',?,?,?,?,?) ON CONFLICT(owner_user_id,environment,symbol,family,provider) DO UPDATE SET bridge_id=excluded.bridge_id,status=excluded.status,reason_code=excluded.reason_code,refreshed_at=COALESCE(excluded.refreshed_at,ibkrnew_profile_refresh_state.refreshed_at),next_attempt_at=excluded.next_attempt_at,updated_at=excluded.updated_at`).run(context.owner_user_id, context.bridge_id, symbol, family, status, reason, refreshedAt, new Date(nextAt).toISOString(), ts);
}

export async function refreshIbkrNewProfiles(ownerUserId, { client = createFmpProfileClient(), maxSymbols = 1000 } = {}) {
  const context = getIbkrNewProfileRefreshContext(ownerUserId);
  if (!context) return { skipped: 'PAPER_ACTIVE_CONTEXT_REQUIRED', updated: 0 };
  let updated = 0, failed = 0;
  for (const symbol of context.symbols.slice(0, maxSymbols)) {
    for (const family of ['fundamentals', 'earnings']) {
      const provider = context.providers[family === 'fundamentals' ? 'fundamentals_provider' : 'earnings_provider'];
      const rules = context.rules[family === 'fundamentals' ? 'fundamentals' : 'corporate_events'];
      if (provider !== 'FMP' || rules?.enabled !== true) continue;
      const prior = getDb().prepare("SELECT * FROM ibkrnew_profile_refresh_state WHERE owner_user_id=? AND environment='paper' AND symbol=? AND family=? AND provider='FMP'").get(ownerUserId, symbol, family);
      const profileRow = getDb().prepare("SELECT profile_json,fundamentals_at,corporate_events_at FROM ibkrnew_instrument_profiles WHERE owner_user_id=? AND bridge_id=? AND environment='paper' AND symbol=? AND security_type='STK'").get(ownerUserId, context.bridge_id, symbol);
      const cached = JSON.parse(profileRow?.profile_json || '{}');
      const fieldAt = family === 'fundamentals' ? profileRow?.fundamentals_at : profileRow?.corporate_events_at;
      const matches = cached[family === 'fundamentals' ? 'fundamentals_source' : 'corporate_events_source'] === 'FMP';
      if (prior && prior.bridge_id === context.bridge_id && Date.parse(prior.next_attempt_at) > Date.now() && (prior.status !== 'ready' || matches && Date.now() - Date.parse(fieldAt) < Number(rules.maximum_age_hours) * 3600000)) continue;
      const current = getIbkrNewProfileRefreshContext(ownerUserId);
      if (!current || current.universe_version !== context.universe_version || current.bridge_id !== context.bridge_id) return { skipped: 'CONTEXT_CHANGED', updated, failed };
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
        } else payload = mapFmpEarnings({ symbol, earnings: await client('earnings', { symbol: ticker, limit: 100 }) });
        if (!applyIbkrNewFmpProfile(context, family, payload)) return { skipped: 'CONTEXT_CHANGED', updated, failed };
        const refreshMs = Math.min(6 * 3600000, Number(rules.maximum_age_hours) * 1800000);
        state(context, symbol, family, 'ready', null, Date.now() + refreshMs, new Date().toISOString()); updated++;
      } catch (error) {
        const reason = /^FMP_[A-Z0-9_]+$|^PROFILE_SYMBOL_INVALID$/.test(error.message) ? error.message : 'FMP_REFRESH_FAILED';
        state(context, symbol, family, 'failed', reason, Date.now() + 3600000); failed++;
        if (reason === 'FMP_KEY_NOT_CONFIGURED' || /^FMP_HTTP_(401|403|429)$/.test(reason) || reason === 'FMP_RATE_LIMIT_COOLDOWN') return { updated, failed, paused: reason };
      }
    }
  }
  return { updated, failed };
}

export function queueIbkrNewProfileRefresh(ownerUserId) {
  const context = getIbkrNewProfileRefreshContext(ownerUserId);
  if (!context) return { queued: false, reason: 'PAPER_ACTIVE_CONTEXT_REQUIRED' };
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
    const owners = getDb().prepare("SELECT DISTINCT owner_user_id FROM ibkrnew_execution_modes WHERE requested_mode='paper' AND activation_state='ACTIVE'").all();
    active = (async () => { for (const row of owners) await refreshIbkrNewProfiles(row.owner_user_id); })().catch(() => {}).finally(() => { active = null; });
  };
  timer = setInterval(() => { tick().catch(() => {}); }, 60000); timer.unref();
  setImmediate(() => { tick().catch(() => {}); });
}

export { getIbkrNewProfileRefreshStatus };
