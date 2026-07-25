/**
 * Daily summary cache shared by LLM-backed history tools (order learnings, brain history).
 *
 * Same intent as the learnings_summary cache: one LLM call per owner+scope per UTC day.
 * Difference: these tools feed live decisions (trading, maker/checker), so a stale
 * summary is a correctness risk — the cache is therefore also keyed on a data
 * watermark and rebuilds the moment new rows land, even on the same day.
 *
 * Rows are stored per (owner, kind, scope) in whichever DB holds the source rows.
 */
import { createHash } from 'crypto';

const TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tool_summary_cache (
    owner_user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    summary TEXT NOT NULL,
    model TEXT DEFAULT '',
    watermark TEXT DEFAULT '',
    item_count INTEGER DEFAULT 0,
    base_generated_at TEXT DEFAULT '',
    valid_date TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (owner_user_id, kind, scope_key)
  );
`;

export function ensureToolSummaryCacheTable(db) {
  if (!db) return;
  try {
    db.exec(TABLE_SQL);
  } catch {
    /* ignore — cache is best-effort */
  }
}

/** Stable short key for a parameter set (days / symbol / workflow+node ids). */
export function scopeKeyFor(parts) {
  const raw = (Array.isArray(parts) ? parts : [parts])
    .map((p) => (Array.isArray(p) ? [...p].map(String).sort().join(',') : String(p ?? '')))
    .join('|');
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

/**
 * Watermark for a row set: newest id + count. The count makes retention pruning
 * (rows ageing out of the window) invalidate the cache too, not just new inserts.
 */
export function watermarkFor(rows, idField = 'id') {
  const list = Array.isArray(rows) ? rows : [];
  let maxId = 0;
  for (const r of list) {
    const v = Number(r?.[idField]) || 0;
    if (v > maxId) maxId = v;
  }
  return `${maxId}:${list.length}`;
}

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Accepts force/refresh as boolean or "true" (query strings arrive as text). */
export function parseForceFlag(src = {}) {
  const raw = src.force ?? src.refresh;
  if (raw === true) return true;
  return String(raw ?? '').toLowerCase() === 'true';
}

export function ageInDays(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 86400000;
}

export function fullRebuildDays(envName, fallback = 7) {
  return Math.max(1, parseInt(process.env[envName] || String(fallback), 10) || fallback);
}

export function readToolSummaryCache(db, { ownerUserId, kind, scopeKey }) {
  try {
    return (
      db
        .prepare(
          `SELECT * FROM tool_summary_cache
           WHERE owner_user_id = ? AND kind = ? AND scope_key = ?`
        )
        .get(ownerUserId, kind, scopeKey) || null
    );
  } catch {
    return null;
  }
}

export function writeToolSummaryCache(db, row) {
  try {
    db.prepare(
      `INSERT INTO tool_summary_cache
         (owner_user_id, kind, scope_key, summary, model, watermark, item_count,
          base_generated_at, valid_date, updated_at)
       VALUES (@owner_user_id, @kind, @scope_key, @summary, @model, @watermark, @item_count,
          @base_generated_at, @valid_date, @updated_at)
       ON CONFLICT(owner_user_id, kind, scope_key) DO UPDATE SET
          summary = excluded.summary,
          model = excluded.model,
          watermark = excluded.watermark,
          item_count = excluded.item_count,
          base_generated_at = excluded.base_generated_at,
          valid_date = excluded.valid_date,
          updated_at = excluded.updated_at`
    ).run(row);
  } catch {
    /* ignore — cache is best-effort */
  }
}

/**
 * Decide whether the caller must call the LLM.
 *
 *  - `cache_hit`  same UTC day and watermark unchanged → serve cached, no LLM.
 *  - `no_new`     new day but watermark unchanged → extend validity, no LLM.
 *  - `rebuild`    no cache, watermark moved, stale base, or force → caller runs the LLM.
 *
 * @returns {{ mode: 'cache_hit'|'no_new'|'rebuild', reason: string }}
 */
export function planSummaryCache({ cache, watermark, today, maxBaseAgeDays, force = false }) {
  if (force) return { mode: 'rebuild', reason: 'force' };
  if (!cache || !cache.summary) return { mode: 'rebuild', reason: 'no_cache' };
  if (String(cache.watermark || '') !== String(watermark)) {
    return { mode: 'rebuild', reason: 'new_data' };
  }
  if (!cache.base_generated_at || ageInDays(cache.base_generated_at) >= maxBaseAgeDays) {
    return { mode: 'rebuild', reason: 'stale_base' };
  }
  if (cache.valid_date === today) return { mode: 'cache_hit', reason: 'same_day' };
  return { mode: 'no_new', reason: 'no_new_data' };
}
