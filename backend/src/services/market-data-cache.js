/**
 * SQLite cache for external market-data responses (regime / screener / history / fundamentals).
 * Keys are opaque strings; payloads are JSON text. Missing MARKET_DATA_API_KEY is handled upstream.
 */
import { getDb } from '../db/schema.js';

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS market_data_cache (
    cache_key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    expires_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_market_data_cache_kind
    ON market_data_cache(kind, expires_at);
`;

let ensured = false;

export function ensureMarketDataCacheTable(db = getDb()) {
  if (ensured) return;
  db.exec(TABLE_SQL);
  ensured = true;
}

/** @returns {{ cache_key, provider, kind, payload, fetched_at, expires_at } | null} */
export function getCached(cacheKey) {
  ensureMarketDataCacheTable();
  const row = getDb()
    .prepare(
      `SELECT cache_key, provider, kind, payload_json, fetched_at, expires_at
       FROM market_data_cache WHERE cache_key = ?`
    )
    .get(String(cacheKey || ''));
  if (!row) return null;
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && exp <= Date.now()) return null;
  }
  let payload = null;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    return null;
  }
  return {
    cache_key: row.cache_key,
    provider: row.provider,
    kind: row.kind,
    payload,
    fetched_at: row.fetched_at,
    expires_at: row.expires_at,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.cacheKey
 * @param {string} opts.provider
 * @param {string} opts.kind
 * @param {unknown} opts.payload
 * @param {string|null} [opts.expiresAt] — null/empty = never expire
 */
export function setCached({ cacheKey, provider, kind, payload, expiresAt = null } = {}) {
  ensureMarketDataCacheTable();
  const key = String(cacheKey || '').trim();
  if (!key) return;
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO market_data_cache (cache_key, provider, kind, payload_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         provider = excluded.provider,
         kind = excluded.kind,
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at`
    )
    .run(
      key,
      String(provider || ''),
      String(kind || ''),
      JSON.stringify(payload ?? null),
      now,
      expiresAt || null
    );
}

/** Delete one key, or all rows for a kind when only kind is passed. */
export function invalidateCache({ cacheKey = null, kind = null } = {}) {
  ensureMarketDataCacheTable();
  const db = getDb();
  if (cacheKey) {
    db.prepare('DELETE FROM market_data_cache WHERE cache_key = ?').run(String(cacheKey));
    return;
  }
  if (kind) {
    db.prepare('DELETE FROM market_data_cache WHERE kind = ?').run(String(kind));
  }
}
