/**
 * External market-data service (default provider: Financial Modeling Prep stable API).
 * Paper vs live TTLs from IBKR_IS_PAPER via getIbkrTradingConfig().
 * Never logs full API keys.
 *
 * Note: FMP free keys must use https://financialmodelingprep.com/stable/*
 * (legacy /api/v3 returns 403 for new accounts). company-screener is paid (402);
 * free tier falls back to a configurable liquid large-cap universe + profile.
 */
import { createHash } from 'crypto';
import { getIbkrTradingConfig } from './ibkr-trading-rules.js';
import {
  getCached,
  setCached,
  invalidateCache,
  ensureMarketDataCacheTable,
} from './market-data-cache.js';

const MISSING_KEY = { ok: false, error: 'MARKET_DATA_API_KEY not configured' };

/** Paper/free-tier seed universe (liquid US mega-caps). Override via MARKET_DATA_SCREENER_UNIVERSE. */
const DEFAULT_UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'BRK-B', 'LLY', 'AVGO',
  'TSLA', 'JPM', 'V', 'XOM', 'UNH', 'MA', 'JNJ', 'WMT', 'PG', 'HD',
  'ORCL', 'COST', 'ABBV', 'CVX', 'MRK', 'CRM', 'BAC', 'KO', 'PEP', 'AMD',
  'TMO', 'CSCO', 'ACN', 'LIN', 'MCD', 'ABT', 'ADBE', 'WFC', 'DHR', 'TXN',
  'DIS', 'INTU', 'QCOM', 'IBM', 'GE', 'CAT', 'AMAT', 'VZ', 'CMCSA', 'NEE',
  'PM', 'ISRG', 'PFE', 'SPGI', 'AXP', 'MS', 'BKNG', 'GS', 'RTX', 'LOW',
  'T', 'BLK', 'SYK', 'UNP', 'HON', 'PGR', 'TJX', 'VRTX', 'C', 'PLD',
];

function providerName() {
  return String(process.env.MARKET_DATA_PROVIDER || 'fmp').trim().toLowerCase() || 'fmp';
}

function baseUrl() {
  return String(
    process.env.MARKET_DATA_BASE_URL || 'https://financialmodelingprep.com/stable'
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
  if (kind === 'profile') {
    return paper
      ? envInt('MARKET_DATA_CACHE_PROFILE_TTL_SEC_PAPER', 6 * 3600)
      : envInt('MARKET_DATA_CACHE_PROFILE_TTL_SEC_LIVE', 3 * 3600);
  }
  return 3600;
}

function expiresInSeconds(sec) {
  return new Date(Date.now() + sec * 1000).toISOString();
}

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
  if (!Array.isArray(values) || values.length < period || period <= 0) return null;
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

function screenerUniverse() {
  const raw = String(process.env.MARKET_DATA_SCREENER_UNIVERSE || '').trim();
  if (!raw) return [...DEFAULT_UNIVERSE];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
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
      body: String(text).slice(0, 400),
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

function extractBars(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.historical)) return data.historical;
  return [];
}

function barClose(b) {
  return num(b?.close ?? b?.price);
}

/**
 * Index vs 200-DMA regime.
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

  const raw = await fmpGet('/historical-price-eod/full', { symbol });
  if (!raw.ok) {
    // Paper trading / free-tier: never hard-kill W1 on FMP 402/403/5xx — synthetic risk-on allowlist path.
    if (isPaperMode() && (raw.status === 402 || raw.status === 403 || raw.status >= 500 || !apiKey())) {
      const synthetic = {
        ok: true,
        index: symbol,
        last_close: null,
        sma_200: null,
        risk_on: true,
        regime: 'risk_on',
        as_of: todayUtc(),
        paper: true,
        cached: false,
        synthetic: true,
        note: `market data provider unavailable (${raw.error || raw.status}); paper fallback risk_on`,
      };
      console.warn('[market-data] getRegime paper fallback', { symbol, error: raw.error, status: raw.status });
      setCached({
        cacheKey,
        provider: providerName(),
        kind,
        payload: synthetic,
        expiresAt: expiresInSeconds(900),
      });
      return synthetic;
    }
    return raw;
  }

  const hist = extractBars(raw.data);
  // Stable API returns newest-first
  const chronological = [...hist].reverse();
  const closes = chronological.map((b) => barClose(b)).filter((c) => c != null);
  if (closes.length < 200) {
    return {
      ok: false,
      error: `insufficient history for ${symbol} (need ≥200 closes)`,
      status: 422,
    };
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

function buildHistoryMetrics(barsChronological) {
  const closes = barsChronological.map((b) => barClose(b)).filter((c) => c != null);
  const volumes = barsChronological.map((b) => num(b.volume, 0));
  const last = closes.length ? closes[closes.length - 1] : null;
  const window52 = closes.slice(-252);
  const high_52w = window52.length ? Math.max(...window52) : null;
  const pct_from_high_52w =
    high_52w > 0 && last != null
      ? Number((((last - high_52w) / high_52w) * 100).toFixed(4))
      : null;
  const vol20 = volumes.slice(-20);
  const avg_volume_20 =
    vol20.length > 0
      ? Number((vol20.reduce((s, v) => s + (v || 0), 0) / vol20.length).toFixed(2))
      : null;

  return {
    bars: barsChronological.map((b) => ({
      date: b.date,
      open: num(b.open),
      high: num(b.high),
      low: num(b.low),
      close: barClose(b),
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

async function getProfile(symbol, { force = false } = {}) {
  const sym = String(symbol || '').trim().toUpperCase();
  const kind = 'profile';
  const cacheKey = `${providerName()}:profile:${sym}`;
  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, sym, true);
      return { ...hit.payload, cached: true };
    }
  }
  logCache(kind, sym, false);
  const raw = await fmpGet('/profile', { symbol: sym });
  if (!raw.ok) return raw;
  const row = Array.isArray(raw.data) ? raw.data[0] : raw.data;
  if (!row) return { ok: false, error: `no profile for ${sym}`, status: 404 };
  const result = {
    ok: true,
    symbol: String(row.symbol || sym).toUpperCase(),
    name: row.companyName || row.name || null,
    marketCap: num(row.marketCap),
    volume: num(row.volume),
    price: num(row.price),
    exchange: row.exchangeShortName || row.exchange || null,
    sector: row.sector || null,
    industry: row.industry || null,
    cached: false,
  };
  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt: expiresInSeconds(ttlSeconds('profile')),
  });
  return result;
}

async function screenerViaUniverse(filters) {
  const universe = screenerUniverse().slice(0, Math.max(filters.limit * 3, filters.limit));
  const candidates = [];
  for (const sym of universe) {
    if (candidates.length >= filters.limit) break;
    const prof = await getProfile(sym, { force: false });
    if (!prof.ok) continue;
    if (prof.marketCap != null && prof.marketCap < filters.minMarketCap) continue;
    if (filters.volumeMoreThan != null && (prof.volume || 0) < filters.volumeMoreThan) continue;
    if (filters.priceMoreThan != null && (prof.price || 0) < filters.priceMoreThan) continue;
    candidates.push({
      symbol: prof.symbol,
      name: prof.name,
      marketCap: prof.marketCap,
      volume: prof.volume,
      price: prof.price,
      exchange: prof.exchange,
      sector: prof.sector,
      industry: prof.industry,
    });
  }
  candidates.sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  return {
    ok: true,
    count: candidates.length,
    filters,
    candidates: candidates.slice(0, filters.limit),
    paper: isPaperMode(),
    cached: false,
    mode: 'universe_fallback',
    note: 'FMP company-screener unavailable on this plan; used MARKET_DATA_SCREENER_UNIVERSE / default mega-caps + profile',
  };
}

/**
 * Liquidity + mcap screener (FMP company-screener, with free-tier universe fallback).
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
    limit: Math.min(Math.max(num(limit, 100) || 100, 1), 200),
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

  const raw = await fmpGet('/company-screener', query);
  let result;
  if (!raw.ok && (raw.status === 402 || raw.status === 403)) {
    console.log('[market-data] screener paid-endpoint unavailable; using universe fallback');
    result = await screenerViaUniverse(filters);
  } else if (!raw.ok) {
    return raw;
  } else {
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

    result = {
      ok: true,
      count: candidates.length,
      filters,
      candidates,
      paper: isPaperMode(),
      cached: false,
      mode: 'company_screener',
    };
  }

  setCached({
    cacheKey,
    provider: providerName(),
    kind,
    payload: result,
    expiresAt: expiresInSeconds(ttlSeconds('screener')),
  });
  return result;
}

/**
 * Daily bars + technicals for a symbol.
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

  const raw = await fmpGet('/historical-price-eod/full', { symbol: sym });
  if (!raw.ok) return raw;

  const hist = extractBars(raw.data);
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

  const raw = await fmpGet('/income-statement', { symbol: sym, limit: 5, period: 'annual' });
  if (!raw.ok) return raw;

  const rows = Array.isArray(raw.data) ? raw.data : [];
  const latest = rows[0] || null;
  const prior = rows[1] || null;

  function yoy(cur, prev) {
    const a = num(cur);
    const b = num(prev);
    if (a == null || b == null || !(b > 0 || b < 0)) return null;
    if (b === 0) return null;
    return Number(((a - b) / Math.abs(b)).toFixed(6));
  }

  const epsLatest = latest?.epsdiluted ?? latest?.eps;
  const epsPrior = prior?.epsdiluted ?? prior?.eps;

  const result = {
    ok: true,
    symbol: sym,
    currency: latest?.reportedCurrency || null,
    fiscal_year_latest: latest?.calendarYear || latest?.date || null,
    revenue_latest: num(latest?.revenue),
    revenue_prior: num(prior?.revenue),
    revenue_yoy: latest && prior ? yoy(latest.revenue, prior.revenue) : null,
    eps_latest: num(epsLatest),
    eps_prior: num(epsPrior),
    eps_yoy: latest && prior ? yoy(epsLatest, epsPrior) : null,
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