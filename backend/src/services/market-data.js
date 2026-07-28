/**
 * External market-data service (default provider: Financial Modeling Prep).
 * Paper vs live TTLs from IBKR_IS_PAPER via getIbkrTradingConfig().
 * Never logs full API keys.
 */
import { createHash } from 'crypto';
import { getIbkrTradingConfig } from './ibkr-trading-rules.js';
import { getCached, setCached, invalidateCache, ensureMarketDataCacheTable } from './market-data-cache.js';

const MISSING_KEY = { ok: false, error: 'MARKET_DATA_API_KEY not configured' };

function providerName() {
  return String(process.env.MARKET_DATA_PROVIDER || 'fmp').trim().toLowerCase() || 'fmp';
}

function baseUrl() {
  return String(
    process.env.MARKET_DATA_BASE_URL || 'https://financialmodelingprep.com/api/v3'
  )
    .trim()
    .replace(/\/+$/, '');
}

function apiKey() {
  return String(process.env.MARKET_DATA_API_KEY || '').trim();
}

function isPaperMode() {
  return getIbkrTradingConfig().isPaper !== false;
}

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ttlSeconds(kind) {
  const paper = isPaperMode();
  if (kind === 'screener') {
    return paper
      ? envInt('MARKET_DATA_CACHE_SCREENER_TTL_SEC_PAPER', 6 * 3600)
      : envInt('MARKET_DATA_CACHE_SCREENER_TTL_SEC_LIVE', 12 * 3600);
  }
  if (kind === 'fundamentals') {
    return paper
      ? envInt('MARKET_DATA_CACHE_FUNDAMENTALS_TTL_SEC_PAPER', 7 * 86400)
      : envInt('MARKET_DATA_CACHE_FUNDAMENTALS_TTL_SEC_LIVE', 3 * 86400);
  }
  if (kind === 'today_bar') {
    return paper
      ? envInt('MARKET_DATA_CACHE_TODAY_BAR_TTL_SEC_PAPER', 3600)
      : envInt('MARKET_DATA_CACHE_TODAY_BAR_TTL_SEC_LIVE', 900);
  }
  return 3600;
}

function expiresInSeconds(sec) {
  return new Date(Date.now() + sec * 1000).toISOString();
}

/** Regime cache valid until next UTC midnight. */
function nextUtcDayExpires() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function redactKeyInUrl(url) {
  return String(url || '').replace(/([?&]apikey=)[^&]*/gi, '$1***');
}

function logCache(kind, symbol, hit) {
  const sym = symbol ? ` symbol=${symbol}` : '';
  console.log(`[market-data] cache ${hit ? 'hit' : 'miss'} kind=${kind}${sym}`);
}

function hashFilters(obj) {
  return createHash('sha1').update(JSON.stringify(obj || {})).digest('hex').slice(0, 16);
}

function num(v, d = null) {
  if (v == null || v === '') return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period || period < 1) return null;
  const slice = values.slice(-period);
  let sum = 0;
  for (const v of slice) sum += v;
  return sum / period;
}

function momentum(closes, lookback) {
  if (!Array.isArray(closes) || closes.length <= lookback) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 1 - lookback];
  if (!(prev > 0) || last == null) return null;
  return (last - prev) / prev;
}

async function fmpGet(path, query = {}) {
  const key = apiKey();
  if (!key) return { ok: false, error: MISSING_KEY.error, status: 503 };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '') continue;
    qs.set(k, String(v));
  }
  qs.set('apikey', key);
  const url = `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}?${qs.toString()}`;
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    console.warn('[market-data] fetch failed', redactKeyInUrl(url), e?.message || e);
    return { ok: false, error: e?.message || 'fetch failed', status: 502 };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(
      '[market-data] provider HTTP',
      res.status,
      redactKeyInUrl(url),
      String(text).slice(0, 200)
    );
    return {
      ok: false,
      error: `market data provider HTTP ${res.status}`,
      status: res.status >= 500 ? 502 : res.status,
    };
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, error: 'invalid JSON from market data provider', status: 502 };
  }
  if (data && typeof data === 'object' && data['Error Message']) {
    return { ok: false, error: String(data['Error Message']), status: 502 };
  }
  return { ok: true, data };
}

function requireKeyOrError() {
  if (!apiKey()) return { ...MISSING_KEY, status: 503 };
  return null;
}

/**
 * Index vs 200-DMA regime.
 * @param {{ indexSymbol?: string, force?: boolean }} opts
 */
export async function getRegime({ indexSymbol = 'SPY', force = false } = {}) {
  ensureMarketDataCacheTable();
  const missing = requireKeyOrError();
  if (missing) return missing;

  const symbol = String(indexSymbol || 'SPY').trim().toUpperCase() || 'SPY';
  const kind = 'regime';
  const cacheKey = `${providerName()}:regime:${symbol}`;

  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, symbol, true);
      return { ...hit.payload, cached: true };
    }
  } else {
    invalidateCache({ cacheKey });
  }
  logCache(kind, symbol, false);

  const raw = await fmpGet(`/historical-price-full/${encodeURIComponent(symbol)}`, {
    serietype: 'line',
  });
  if (!raw.ok) return raw;

  const hist = Array.isArray(raw.data?.historical)
    ? raw.data.historical
    : Array.isArray(raw.data)
      ? raw.data
      : [];
  // FMP returns newest-first
  const chronological = [...hist].reverse();
  const closes = chronological.map((b) => num(b.close)).filter((c) => c != null);
  if (closes.length < 200) {
    return { ok: false, error: `insufficient history for ${symbol} (need ≥200 closes)`, status: 422 };
  }
  const last_close = closes[closes.length - 1];
  const sma_200 = sma(closes, 200);
  const risk_on = sma_200 != null && last_close >= sma_200;
  const as_of = chronological[chronological.length - 1]?.date || todayUtc();

  const result = {
    ok: true,
    index: symbol,
    last_close,
    sma_200: sma_200 != null ? Number(sma_200.toFixed(4)) : null,
    risk_on,
    as_of,
    paper: isPaperMode(),
    cached: false,
  };
  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt: nextUtcDayExpires(),
  });
  return result;
}

/**
 * Liquidity / mcap screener (FMP stock-screener).
 * @param {object} opts
 */
export async function runScreener({
  minMarketCap = 5e10,
  limit = 100,
  force = false,
  exchange = null,
  country = 'US',
  volumeMoreThan = null,
  priceMoreThan = null,
  isActivelyTrading = true,
  ...extra
} = {}) {
  ensureMarketDataCacheTable();
  const missing = requireKeyOrError();
  if (missing) return missing;

  const kind = 'screener';
  const filters = {
    minMarketCap: num(minMarketCap, 5e10),
    limit: Math.min(Math.max(num(limit, 100) || 100, 1), 500),
    exchange,
    country,
    volumeMoreThan: num(volumeMoreThan),
    priceMoreThan: num(priceMoreThan),
    isActivelyTrading,
    ...extra,
  };
  const cacheKey = `${providerName()}:screener:${hashFilters(filters)}`;

  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, null, true);
      return { ...hit.payload, cached: true };
    }
  } else {
    invalidateCache({ cacheKey });
  }
  logCache(kind, null, false);

  const query = {
    marketCapMoreThan: Math.floor(filters.minMarketCap),
    limit: filters.limit,
    isActivelyTrading: filters.isActivelyTrading ? 'true' : 'false',
  };
  if (filters.country) query.country = filters.country;
  if (filters.exchange) query.exchange = filters.exchange;
  if (filters.volumeMoreThan != null) query.volumeMoreThan = Math.floor(filters.volumeMoreThan);
  if (filters.priceMoreThan != null) query.priceMoreThan = filters.priceMoreThan;

  const raw = await fmpGet('/stock-screener', query);
  if (!raw.ok) return raw;

  const rows = Array.isArray(raw.data) ? raw.data : [];
  const candidates = rows
    .map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      name: r.companyName || r.name || null,
      marketCap: num(r.marketCap),
      volume: num(r.volume),
      price: num(r.price),
      exchange: r.exchangeShortName || r.exchange || null,
      sector: r.sector || null,
      industry: r.industry || null,
    }))
    .filter((c) => c.symbol)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));

  const result = {
    ok: true,
    count: candidates.length,
    filters,
    candidates,
    paper: isPaperMode(),
    cached: false,
  };
  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt: expiresInSeconds(ttlSeconds('screener')),
  });
  return result;
}

function buildHistoryMetrics(barsChronological) {
  const closes = barsChronological.map((b) => num(b.close)).filter((c) => c != null);
  const volumes = barsChronological.map((b) => num(b.volume, 0));
  const last = closes.length ? closes[closes.length - 1] : null;
  const window52 = closes.slice(-252);
  const high_52w = window52.length ? Math.max(...window52) : null;
  const pct_from_high_52w =
    high_52w > 0 && last != null ? Number((((last - high_52w) / high_52w) * 100).toFixed(4)) : null;
  const vol20 = volumes.slice(-20);
  const avg_volume_20 =
    vol20.length > 0 ? Number((vol20.reduce((s, v) => s + (v || 0), 0) / vol20.length).toFixed(2)) : null;

  return {
    bars: barsChronological.map((b) => ({
      date: b.date,
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: num(b.close),
      volume: num(b.volume),
    })),
    last_close: last,
    sma_50: (() => {
      const v = sma(closes, 50);
      return v != null ? Number(v.toFixed(4)) : null;
    })(),
    sma_200: (() => {
      const v = sma(closes, 200);
      return v != null ? Number(v.toFixed(4)) : null;
    })(),
    momentum_3m: (() => {
      const v = momentum(closes, 63);
      return v != null ? Number(v.toFixed(6)) : null;
    })(),
    momentum_6m: (() => {
      const v = momentum(closes, 126);
      return v != null ? Number(v.toFixed(6)) : null;
    })(),
    high_52w: high_52w != null ? Number(high_52w.toFixed(4)) : null,
    pct_from_high_52w,
    avg_volume_20,
  };
}

/**
 * Daily bars + technicals for a symbol.
 * @param {{ symbol: string, days?: number, force?: boolean }} opts
 */
export async function getHistory({ symbol, days = 260, force = false } = {}) {
  ensureMarketDataCacheTable();
  const missing = requireKeyOrError();
  if (missing) return missing;

  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'symbol is required', status: 400 };

  const dayCount = Math.min(Math.max(num(days, 260) || 260, 30), 1000);
  const kind = 'history';
  const cacheKey = `${providerName()}:history:${sym}:${dayCount}`;

  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, sym, true);
      return { ...hit.payload, cached: true };
    }
  } else {
    invalidateCache({ cacheKey });
  }
  logCache(kind, sym, false);

  const raw = await fmpGet(`/historical-price-full/${encodeURIComponent(sym)}`, {});
  if (!raw.ok) return raw;

  const hist = Array.isArray(raw.data?.historical)
    ? raw.data.historical
    : Array.isArray(raw.data)
      ? raw.data
      : [];
  const chronological = [...hist].reverse().slice(-dayCount);
  if (!chronological.length) {
    return { ok: false, error: `no history for ${sym}`, status: 404 };
  }

  const metrics = buildHistoryMetrics(chronological);
  const lastDate = chronological[chronological.length - 1]?.date || '';
  const includesToday = lastDate === todayUtc();
  const expiresAt = includesToday
    ? expiresInSeconds(ttlSeconds('today_bar'))
    : null; // completed days — never expire

  const result = {
    ok: true,
    symbol: sym,
    days: dayCount,
    as_of: lastDate,
    includes_today: includesToday,
    paper: isPaperMode(),
    cached: false,
    ...metrics,
  };
  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt,
  });
  return result;
}

/**
 * Income-statement growth approximations (revenue / EPS YoY).
 * @param {{ symbol: string, force?: boolean }} opts
 */
export async function getFundamentals({ symbol, force = false } = {}) {
  ensureMarketDataCacheTable();
  const missing = requireKeyOrError();
  if (missing) return missing;

  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'symbol is required', status: 400 };

  const kind = 'fundamentals';
  const cacheKey = `${providerName()}:fundamentals:${sym}`;

  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, sym, true);
      return { ...hit.payload, cached: true };
    }
  } else {
    invalidateCache({ cacheKey });
  }
  logCache(kind, sym, false);

  const raw = await fmpGet(`/income-statement/${encodeURIComponent(sym)}`, { limit: 5, period: 'annual' });
  if (!raw.ok) return raw;

  const rows = Array.isArray(raw.data) ? raw.data : [];
  // Newest first from FMP
  const latest = rows[0] || null;
  const prior = rows[1] || null;

  function yoy(cur, prev) {
    const a = num(cur);
    const b = num(prev);
    if (a == null || b == null || !(b > 0 || b < 0)) return null;
    if (b === 0) return null;
    return Number(((a - b) / Math.abs(b)).toFixed(6));
  }

  const revenue_yoy = latest && prior ? yoy(latest.revenue, prior.revenue) : null;
  const eps_yoy =
    latest && prior
      ? yoy(latest.epsdiluted ?? latest.eps, prior.epsdiluted ?? prior.eps)
      : null;

  const result = {
    ok: true,
    symbol: sym,
    currency: latest?.reportedCurrency || null,
    fiscal_year_latest: latest?.calendarYear || latest?.date || null,
    revenue_latest: num(latest?.revenue),
    revenue_prior: num(prior?.revenue),
    revenue_yoy,
    eps_latest: num(latest?.epsdiluted ?? latest?.eps),
    eps_prior: num(prior?.epsdiluted ?? prior?.eps),
    eps_yoy,
    paper: isPaperMode(),
    cached: false,
  };
  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt: expiresInSeconds(ttlSeconds('fundamentals')),
  });
  return result;
}

export {
  ensureMarketDataCacheTable,
  invalidateCache as invalidateMarketDataCache,
  MISSING_KEY,
};
