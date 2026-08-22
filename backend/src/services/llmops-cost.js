/**
 * Owner-scoped LLM price book + cost_lines (estimated $ from token_usage).
 * Estimates are not provider invoices. CEOs override rates; BYOK vs platform is labeled.
 */
import { getDb } from '../db/schema.js';
import { monthPeriod } from './token-usage.js';
import { getLlmConfig } from '../config/llm.js';

/** Platform catalog owner key — empty string, not a CEO id. */
export const PLATFORM_PRICE_OWNER = '';

/**
 * Pedagogical default rates (USD per 1M tokens). CEOs override on Efficiency → LLMOps.
 * Wildcard `*` applies when no model row matches.
 */
const DEFAULT_CATALOG = [
  { model_id: '*', input_usd_per_1m: 1, output_usd_per_1m: 3 },
  { model_id: 'gpt-4o-mini', input_usd_per_1m: 0.15, output_usd_per_1m: 0.6 },
  { model_id: 'gpt-4o', input_usd_per_1m: 2.5, output_usd_per_1m: 10 },
  { model_id: 'gpt-4.1', input_usd_per_1m: 2, output_usd_per_1m: 8 },
  { model_id: 'o4-mini', input_usd_per_1m: 1.1, output_usd_per_1m: 4.4 },
  { model_id: 'claude-sonnet-4', input_usd_per_1m: 3, output_usd_per_1m: 15 },
  { model_id: 'claude-3.5-sonnet', input_usd_per_1m: 3, output_usd_per_1m: 15 },
  { model_id: 'deepseek-chat', input_usd_per_1m: 0.27, output_usd_per_1m: 1.1 },
];

function numRate(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function ensureDefaultPriceBook() {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO llm_price_book
       (owner_user_id, model_id, input_usd_per_1m, output_usd_per_1m, currency)
     VALUES (?, ?, ?, ?, 'USD')`
  );
  const tx = db.transaction(() => {
    for (const row of DEFAULT_CATALOG) {
      ins.run(PLATFORM_PRICE_OWNER, row.model_id, row.input_usd_per_1m, row.output_usd_per_1m);
    }
  });
  tx();
}

function listBookRows(ownerUserId) {
  ensureDefaultPriceBook();
  const owner = String(ownerUserId || '');
  return getDb()
    .prepare(
      `SELECT id, owner_user_id, model_id, input_usd_per_1m, output_usd_per_1m, currency, updated_at
       FROM llm_price_book
       WHERE owner_user_id = ? OR owner_user_id = ?
       ORDER BY CASE WHEN owner_user_id = ? THEN 0 ELSE 1 END, model_id`
    )
    .all(owner, PLATFORM_PRICE_OWNER, owner);
}

/**
 * Effective rates: CEO row for exact model, then CEO wildcard, then platform exact
 * (longest matching prefix), then platform `*`.
 */
export function resolveModelRates(ownerUserId, modelId) {
  const model = String(modelId || '').trim() || '(unknown)';
  const rows = listBookRows(ownerUserId);
  const ceo = rows.filter((r) => r.owner_user_id === String(ownerUserId || ''));
  const plat = rows.filter((r) => r.owner_user_id === PLATFORM_PRICE_OWNER);

  const pickExact = (list, id) => list.find((r) => String(r.model_id) === id);
  const pickPrefix = (list, id) => {
    let best = null;
    for (const r of list) {
      const mid = String(r.model_id || '');
      if (!mid || mid === '*') continue;
      if (id === mid || id.startsWith(mid) || mid.startsWith(id.split('/').pop() || id)) {
        if (!best || mid.length > String(best.model_id).length) best = r;
      }
    }
    return best;
  };
  const pickStar = (list) => list.find((r) => String(r.model_id) === '*');

  const hit =
    pickExact(ceo, model) ||
    pickPrefix(ceo, model) ||
    pickStar(ceo) ||
    pickExact(plat, model) ||
    pickPrefix(plat, model) ||
    pickStar(plat);

  return {
    model_id: model,
    input_usd_per_1m: numRate(hit?.input_usd_per_1m, 1),
    output_usd_per_1m: numRate(hit?.output_usd_per_1m, 3),
    matched: hit?.model_id || '*',
    scope: hit?.owner_user_id === String(ownerUserId || '') ? 'ceo' : 'platform',
    currency: hit?.currency || 'USD',
  };
}

export function getPriceBook(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  const rows = listBookRows(owner);
  return {
    owner_user_id: owner,
    rows: rows.map((r) => ({
      id: r.id,
      scope: r.owner_user_id === owner ? 'ceo' : 'platform',
      model_id: r.model_id,
      input_usd_per_1m: Number(r.input_usd_per_1m),
      output_usd_per_1m: Number(r.output_usd_per_1m),
      currency: r.currency || 'USD',
      updated_at: r.updated_at,
    })),
    note: 'Estimates only — not your provider invoice. Override CEO rows; platform catalog is shared.',
  };
}

/**
 * Replace CEO-owned price rows. Platform catalog is never mutated.
 * Body: { rows: [{ model_id, input_usd_per_1m, output_usd_per_1m }] }
 */
export function saveCeoPriceBook(ownerUserId, rows) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  const list = Array.isArray(rows) ? rows : [];
  const db = getDb();
  const del = db.prepare('DELETE FROM llm_price_book WHERE owner_user_id = ?');
  const ins = db.prepare(
    `INSERT INTO llm_price_book
       (owner_user_id, model_id, input_usd_per_1m, output_usd_per_1m, currency, updated_at)
     VALUES (?, ?, ?, ?, 'USD', datetime('now'))`
  );
  const tx = db.transaction(() => {
    del.run(owner);
    const seen = new Set();
    for (const raw of list) {
      const model = String(raw?.model_id || '').trim();
      if (!model || seen.has(model)) continue;
      seen.add(model);
      ins.run(
        owner,
        model.slice(0, 120),
        numRate(raw.input_usd_per_1m, 1),
        numRate(raw.output_usd_per_1m, 3)
      );
    }
  });
  tx();
  console.info('[llmops] price book saved owner=%s rows=%s', owner, list.length);
  return getPriceBook(owner);
}

export function tokensToUsd(inputTokens, outputTokens, rates) {
  const inTok = Math.max(0, Number(inputTokens) || 0);
  const outTok = Math.max(0, Number(outputTokens) || 0);
  const inRate = numRate(rates?.input_usd_per_1m, 1);
  const outRate = numRate(rates?.output_usd_per_1m, 3);
  const usd = (inTok / 1e6) * inRate + (outTok / 1e6) * outRate;
  return Math.round(usd * 10000) / 10000;
}

function dateFilter(since, until, params) {
  if (!since || !until) return '';
  params.push(since, until);
  return ` AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;
}

function resolvePayer(ownerUserId) {
  try {
    const cfg = getLlmConfig(ownerUserId);
    return cfg?.using_byok ? 'byok' : 'platform';
  } catch {
    return 'unknown';
  }
}

/** Live valuation of token_usage → estimated USD (not persisted invoices). */
export function valueTokenUsage(ownerUserId, { since = null, until = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { amount_usd: 0, lines: [], payer: 'unknown' };
  const params = [owner];
  const filter = dateFilter(since, until, params);
  const rows = getDb()
    .prepare(
      `SELECT COALESCE(NULLIF(model_id, ''), '(unknown)') AS model_id,
              COALESCE(source, 'unknown') AS source,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens,
              COUNT(*) AS calls
       FROM token_usage
       WHERE owner_user_id = ?${filter}
       GROUP BY COALESCE(NULLIF(model_id, ''), '(unknown)'), COALESCE(source, 'unknown')`
    )
    .all(...params);
  const payer = resolvePayer(owner);
  const lines = rows.map((r) => {
    const rates = resolveModelRates(owner, r.model_id);
    const amount_usd = tokensToUsd(r.input_tokens, r.output_tokens, rates);
    return {
      category: 'llm_tokens',
      model_id: r.model_id,
      source: r.source,
      input_tokens: Number(r.input_tokens) || 0,
      output_tokens: Number(r.output_tokens) || 0,
      total_tokens: Number(r.total_tokens) || 0,
      calls: Number(r.calls) || 0,
      amount_usd,
      rate: {
        input_usd_per_1m: rates.input_usd_per_1m,
        output_usd_per_1m: rates.output_usd_per_1m,
        matched: rates.matched,
      },
      confidence: 'estimated',
      payer,
      currency: 'USD',
    };
  });
  const amount_usd = Math.round(lines.reduce((a, l) => a + l.amount_usd, 0) * 10000) / 10000;
  return { amount_usd, lines, payer, currency: 'USD' };
}

export function listManualCostLines(ownerUserId, { period = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  const p = period || monthPeriod();
  return getDb()
    .prepare(
      `SELECT id, period, category, amount_usd, currency, note, confidence, created_at
       FROM cost_lines
       WHERE owner_user_id = ? AND period = ? AND category = 'manual_external'
       ORDER BY id DESC`
    )
    .all(owner, p)
    .map((r) => ({
      id: r.id,
      period: r.period,
      category: r.category,
      amount_usd: Number(r.amount_usd) || 0,
      currency: r.currency || 'USD',
      note: r.note || '',
      confidence: r.confidence || 'manual',
      created_at: r.created_at,
    }));
}

export function addManualCostLine(ownerUserId, { amount_usd, note = '', period = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  const amount = Number(amount_usd);
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  if (!Number.isFinite(amount) || amount === 0) {
    const err = new Error('amount_usd required');
    err.status = 400;
    throw err;
  }
  const p = period || monthPeriod();
  const result = getDb()
    .prepare(
      `INSERT INTO cost_lines
         (owner_user_id, period, category, amount_usd, currency, confidence, payer, note)
       VALUES (?, ?, 'manual_external', ?, 'USD', 'manual', 'ceo', ?)`
    )
    .run(owner, p, amount, String(note || '').slice(0, 500));
  console.info('[llmops] manual cost line owner=%s period=%s amount=%s', owner, p, amount);
  return { id: Number(result.lastInsertRowid), period: p, amount_usd: amount };
}

export function deleteManualCostLine(ownerUserId, id) {
  const owner = String(ownerUserId || '').trim();
  const rowId = Number(id);
  if (!owner || !Number.isFinite(rowId)) {
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }
  const result = getDb()
    .prepare(
      `DELETE FROM cost_lines WHERE id = ? AND owner_user_id = ? AND category = 'manual_external'`
    )
    .run(rowId, owner);
  if (!result.changes) {
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }
  return { ok: true, id: rowId };
}
