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

function restrictedCacheKey(symbol) {
  return `${providerName()}:restricted:${String(symbol || '').trim().toUpperCase()}`;
}

function rememberRestrictedSymbol(symbol, error) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!isValidMarketSymbol(sym)) return;
  setCached({
    cacheKey: restrictedCacheKey(sym),
    provider: providerName(),
    kind: 'restricted',
    payload: {
      ok: false,
      skipped: true,
      reason: 'symbol_restricted',
      status: 402,
      symbol: sym,
      error: String(error || 'symbol not available on this plan').slice(0, 200),
    },
    expiresAt: nextUtcDayExpires(),
  });
}

function knownRestrictedSymbol(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!isValidMarketSymbol(sym)) return null;
  const hit = getCached(restrictedCacheKey(sym));
  return hit?.payload || null;
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

  if (query.symbol != null && String(query.symbol).trim() !== '') {
    if (!isValidMarketSymbol(query.symbol)) {
      console.info('[market-data] refuse invalid symbol (no HTTP)');
      return { ok: false, skipped: true, reason: 'invalid_symbol', status: 400, error: 'invalid symbol' };
    }
    const known = knownRestrictedSymbol(query.symbol);
    if (known) {
      logCache('restricted', query.symbol, true);
      return { ...known, cached: true };
    }
  }

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
    const failed = {
      ok: false,
      error: `market data provider HTTP ${res.status}`,
      status: res.status >= 500 ? 502 : res.status,
      body: String(text).slice(0, 400),
    };
    if (classifyFmpRestriction(failed) === 'symbol' && query.symbol) {
      rememberRestrictedSymbol(query.symbol, text);
    }
    return failed;
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

/**
 * Classify FMP 402s: some symbols/ETFs are plan-gated; some whole endpoints are paid.
 * Symbol restrictions should skip that ticker and continue; endpoint restrictions need a fallback path.
 */
export function classifyFmpRestriction(raw) {
  if (!raw || raw.ok) return null;
  const status = Number(raw.status || 0);
  const body = `${raw.body || ''} ${raw.error || ''}`;
  const gated =
    status === 402 ||
    status === 403 ||
    /not available under your current subscription|Restricted Endpoint|Premium Query Parameter/i.test(
      body
    );
  if (!gated) return null;
  if (/value set for ['"]?symbol|Premium Query Parameter/i.test(body)) return 'symbol';
  if (/Restricted Endpoint/i.test(body)) return 'endpoint';
  return 'symbol';
}

/** Reject leftover {{var.*}} templates and non-tickers so we never spend FMP credits on them. */
export function isValidMarketSymbol(value) {
  const s = String(value || '')
    .trim()
    .toUpperCase();
  if (!s || /[{}$\s,]/.test(s)) return false;
  if (s.includes('VAR.') || s.includes('{{')) return false;
  return /^[A-Z][A-Z0-9.]{0,14}(-[A-Z0-9.]{1,6})?$/.test(s);
}

export function parseSymbolList(value) {
  if (value == null || value === '') return [];
  const parts = Array.isArray(value)
    ? value
    : String(value)
        .split(/[,;|\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const s = String(p).trim().toUpperCase();
    if (!isValidMarketSymbol(s) || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function regimeFallbackSymbols() {
  return parseSymbolList(process.env.MARKET_DATA_REGIME_FALLBACK_SYMBOLS || 'SPY,QQQ,DIA,IWM');
}

/**
 * Ordered unique tickers: caller list first, then env fallbacks (never call FMP with templates).
 */
export function resolveRegimeSymbols({ indexSymbol, indexSymbols, symbol } = {}) {
  const requested = [
    ...parseSymbolList(indexSymbol),
    ...parseSymbolList(indexSymbols),
    ...parseSymbolList(symbol),
  ];
  const seen = new Set();
  const ordered = [];
  for (const s of [...requested, ...regimeFallbackSymbols()]) {
    if (seen.has(s)) continue;
    seen.add(s);
    ordered.push(s);
  }
  return { requested: [...new Set(requested)], ordered };
}

async function fetchEodHistory(symbol) {
  const known = knownRestrictedSymbol(symbol);
  if (known) return { ...known, cached: true };
  const light = await fmpGet('/historical-price-eod/light', { symbol });
  if (light.ok) return { ok: true, data: light.data, via: 'light' };
  if (light.skipped || classifyFmpRestriction(light) === 'symbol') {
    return {
      ok: false,
      skipped: true,
      reason: light.reason || 'symbol_restricted',
      status: light.status || 402,
      symbol,
      error: light.error,
    };
  }
  const full = await fmpGet('/historical-price-eod/full', { symbol });
  if (full.ok) return { ok: true, data: full.data, via: 'full' };
  if (full.skipped || classifyFmpRestriction(full) === 'symbol') {
    return {
      ok: false,
      skipped: true,
      reason: full.reason || 'symbol_restricted',
      status: full.status || 402,
      symbol,
      error: full.error,
    };
  }
  return {
    ok: false,
    error: full.error || light.error || 'eod history failed',
    status: full.status || light.status,
    body: full.body || light.body,
    symbol,
  };
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
 * Tries caller symbols (comma-separated or array) then MARKET_DATA_REGIME_FALLBACK_SYMBOLS.
 * Invalid / template leftovers never hit FMP. Plan-gated tickers (e.g. some ETFs on free tier) are skipped.
 */
export async function getRegime({
  indexSymbol,
  indexSymbols,
  symbol,
  force = false,
} = {}) {
  ensureMarketDataCacheTable();
  const missing = requireKeyOrError();
  if (missing) return missing;

  const { requested, ordered } = resolveRegimeSymbols({ indexSymbol, indexSymbols, symbol });
  const kind = 'regime';
  const cacheKey = `${providerName()}:regime:${(requested.length ? requested : ordered).join(',') || 'auto'}`;

  if (!force) {
    const hit = getCached(cacheKey);
    if (hit?.payload) {
      logCache(kind, requested[0] || ordered[0] || '', true);
      return { ...hit.payload, cached: true };
    }
  } else {
    invalidateCache({ cacheKey });
  }

  logCache(kind, requested.join(',') || ordered[0] || 'auto', false);

  const skipped = [];
  const rawRequested = [indexSymbol, indexSymbols, symbol]
    .flatMap((v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : String(v).split(/[,;|\s]+/)))
    .map((s) => String(s).trim())
    .filter(Boolean);
  for (const raw of rawRequested) {
    if (!isValidMarketSymbol(raw)) {
      skipped.push({ symbol: String(raw).slice(0, 80), reason: 'invalid_symbol' });
      console.info('[market-data] skip invalid regime symbol (no FMP call)');
    }
  }

  if (!ordered.length) {
    skipped.push({ symbol: '', reason: 'no_valid_symbols' });
  }

  for (const candidate of ordered) {
    const hist = await fetchEodHistory(candidate);
    if (hist.skipped || classifyFmpRestriction(hist) === 'symbol') {
      skipped.push({ symbol: candidate, reason: hist.reason || 'symbol_restricted' });
      console.info('[market-data] skip restricted regime symbol=%s', candidate);
      continue;
    }
    if (!hist.ok) {
      skipped.push({
        symbol: candidate,
        reason: hist.error || `http_${hist.status || 'error'}`,
      });
      console.warn('[market-data] regime fetch failed symbol=%s status=%s', candidate, hist.status || '');
      continue;
    }

    const bars = extractBars(hist.data);
    const chronological = [...bars].reverse();
    const closes = chronological.map((b) => barClose(b)).filter((c) => c != null);
    if (closes.length < 200) {
      skipped.push({ symbol: candidate, reason: 'insufficient_history' });
      continue;
    }
    const last_close = closes[closes.length - 1];
    const sma_200 = sma(closes, 200);
    const risk_on = sma_200 != null && last_close >= sma_200;
    const as_of = chronological[chronological.length - 1]?.date || todayUtc();
    const result = {
      ok: true,
      index: candidate,
      last_close,
      sma_200: sma_200 != null ? Number(sma_200.toFixed(4)) : null,
      risk_on,
      regime: risk_on ? 'risk_on' : 'risk_off',
      as_of,
      paper: isPaperMode(),
      cached: false,
      synthetic: false,
      eod_source: hist.via || null,
      requested_indexes: requested,
      skipped_symbols: skipped,
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

  const skipNote = skipped.map((s) => `${s.symbol || '?'}:${s.reason}`).join('; ');
  if (isPaperMode()) {
    const synthetic = {
      ok: true,
      index: requested[0] || ordered[0] || null,
      last_close: null,
      sma_200: null,
      risk_on: true,
      regime: 'risk_on',
      as_of: todayUtc(),
      paper: true,
      cached: false,
      synthetic: true,
      requested_indexes: requested,
      skipped_symbols: skipped,
      note: `no usable index history (${skipNote || 'no symbols'}); paper fallback risk_on`,
    };
    console.warn('[market-data] getRegime paper fallback', { skipped: skipped.length });
    setCached({
      cacheKey,
      provider: providerName(),
      kind,
      payload: synthetic,
      expiresAt: expiresInSeconds(900),
    });
    return synthetic;
  }
  return {
    ok: false,
    error: `no usable index history (${skipNote || 'no symbols'})`,
    status: 422,
    requested_indexes: requested,
    skipped_symbols: skipped,
  };
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
  if (!isValidMarketSymbol(sym)) {
    return { ok: false, skipped: true, reason: 'invalid_symbol', error: 'symbol is invalid', status: 400 };
  }
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
  if (!raw.ok) {
    if (classifyFmpRestriction(raw) === 'symbol') {
      console.info('[market-data] skip restricted profile symbol=%s', sym);
      return { ok: false, skipped: true, reason: 'symbol_restricted', status: 402, symbol: sym };
    }
    return raw;
  }
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
  for (const rawSym of universe) {
    const sym = String(rawSym || '').trim().toUpperCase();
    if (!isValidMarketSymbol(sym)) continue;
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
  if (!isValidMarketSymbol(sym)) {
    return { ok: false, skipped: true, reason: 'invalid_symbol', error: 'symbol is invalid', status: 400, symbol: sym };
  }

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

  const raw = await fetchEodHistory(sym);
  if (raw.skipped) {
    console.info('[market-data] skip restricted history symbol=%s', sym);
    return raw;
  }
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
  if (!isValidMarketSymbol(sym)) {
    return { ok: false, skipped: true, reason: 'invalid_symbol', error: 'symbol is invalid', status: 400, symbol: sym };
  }

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
  if (!raw.ok) {
    if (classifyFmpRestriction(raw) === 'symbol') {
      console.info('[market-data] skip restricted fundamentals symbol=%s', sym);
      return { ok: false, skipped: true, reason: 'symbol_restricted', status: 402, symbol: sym };
    }
    return raw;
  }

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