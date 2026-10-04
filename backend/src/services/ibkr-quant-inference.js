import crypto from 'node:crypto';
import { getDb } from '../db/schema.js';

const DEFAULT_MODEL = 'ibkr-quant-baseline-v1';
const DEFAULT_REVISION = 'baseline-heuristic-1';
const DEFAULT_BACKEND = 'baseline';

function ensureTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS ibkr_quant_inference_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      task TEXT NOT NULL,
      model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL,
      feature_schema_version INTEGER NOT NULL DEFAULT 1,
      input_hash TEXT NOT NULL,
      as_of TEXT,
      horizon TEXT,
      output_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ok',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_quant_owner_created
      ON ibkr_quant_inference_runs(owner_user_id, created_at DESC);
  `);
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function baselineInference(task, features = {}, text = '') {
  const momentum = finite(features.momentum_pct ?? features.momentum, 0);
  const volatility = Math.max(0, finite(features.volatility_pct ?? features.volatility, 0));
  const volumeRatio = Math.max(0, finite(features.volume_ratio, 1));
  const drawdown = Math.max(0, finite(features.drawdown_pct ?? features.drawdown, 0));
  const sentiment = finite(features.sentiment_score, null);
  const lower = String(text || '').toLowerCase();
  const textScore = sentiment ?? (lower.includes('positive') || lower.includes('upgrade') ? 0.55 : lower.includes('negative') || lower.includes('downgrade') ? -0.55 : 0);
  const risk = Math.min(1, (volatility / 10) * 0.45 + (drawdown / 20) * 0.35 + (textScore < -0.4 ? 0.2 : 0));
  const direction = momentum > 0.75 && textScore > -0.25 ? 'bullish' : momentum < -0.75 || textScore < -0.55 ? 'bearish' : 'neutral';
  const confidence = Math.max(0.05, Math.min(0.95, 0.5 + Math.min(0.35, Math.abs(momentum) / 10) + Math.min(0.1, Math.max(0, volumeRatio - 1) / 10) - risk * 0.25));
  if (task === 'news_sentiment') {
    return { label: textScore > 0.2 ? 'positive' : textScore < -0.2 ? 'negative' : 'neutral', probability: confidence, risk_score: risk };
  }
  if (task === 'risk_classification') {
    return { label: risk > 0.65 ? 'high' : risk > 0.35 ? 'moderate' : 'low', probability: confidence, risk_score: risk };
  }
  if (task === 'candidate_ranking') {
    return { score: Number((confidence * (1 - risk)).toFixed(6)), direction, risk_score: risk };
  }
  if (task === 'return_forecast') {
    const expected = momentum * 0.18 + textScore * 0.5 - volatility * 0.04;
    return {
      expected_return_pct: Number(expected.toFixed(4)),
      quantiles_pct: { p10: Number((expected - volatility * 0.7).toFixed(4)), p50: Number(expected.toFixed(4)), p90: Number((expected + volatility * 0.7).toFixed(4)) },
      direction,
      probability: confidence,
      risk_score: risk,
    };
  }
  return { regime: volatility > 6 ? 'high_volatility' : momentum > 1 ? 'risk_on' : momentum < -1 ? 'risk_off' : 'mixed', direction, probability: confidence, risk_score: risk };
}

const OUTPUT_SCHEMA_VERSION = 1;

function numeric(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bounded(value, min = 0, max = 1, fallback = null) {
  const n = numeric(value, fallback);
  return n == null ? fallback : Math.max(min, Math.min(max, n));
}

function unwrapModelOutput(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.output && typeof raw.output === 'object' && !Array.isArray(raw.output)) return raw.output;
  if (raw.prediction && typeof raw.prediction === 'object' && !Array.isArray(raw.prediction)) return raw.prediction;
  if (raw.forecast && typeof raw.forecast === 'object' && !Array.isArray(raw.forecast)) return raw.forecast;
  return raw;
}

/**
 * Convert every model/ensemble response to the stable contract consumed by
 * the strategy planner. Model-specific fields are deliberately not allowed
 * to leak into the planner contract.
 */
function normalizeModelOutput(task, raw, fallback) {
  const value = unwrapModelOutput(raw);
  if (!value) return { output: fallback, valid: false, reason: 'model output was not an object' };
  const direction = ['bullish', 'bearish', 'neutral'].includes(String(value.direction).toLowerCase())
    ? String(value.direction).toLowerCase()
    : null;
  const probability = bounded(value.probability ?? value.confidence ?? value.prob, 0, 1);
  const riskScore = bounded(value.risk_score ?? value.riskScore ?? value.risk, 0, 1);
  if (task === 'news_sentiment') {
    const label = ['positive', 'negative', 'neutral'].includes(String(value.label).toLowerCase()) ? String(value.label).toLowerCase() : null;
    if (!label || probability == null || riskScore == null) return { output: fallback, valid: false, reason: 'news_sentiment contract incomplete' };
    return { output: { label, probability, risk_score: riskScore }, valid: true };
  }
  if (task === 'risk_classification') {
    const label = ['low', 'moderate', 'high'].includes(String(value.label).toLowerCase()) ? String(value.label).toLowerCase() : null;
    if (!label || probability == null || riskScore == null) return { output: fallback, valid: false, reason: 'risk_classification contract incomplete' };
    return { output: { label, probability, risk_score: riskScore }, valid: true };
  }
  if (task === 'candidate_ranking') {
    const score = numeric(value.score ?? value.rank_score);
    if (score == null || !direction || riskScore == null) return { output: fallback, valid: false, reason: 'candidate_ranking contract incomplete' };
    return { output: { score, direction, risk_score: riskScore }, valid: true };
  }
  if (task === 'return_forecast') {
    const expected = numeric(value.expected_return_pct ?? value.expectedReturnPct ?? value.predicted_return_pct);
    const q = value.quantiles_pct ?? value.quantiles ?? {};
    const forecast = Array.isArray(value.forecast) ? value.forecast.map((item) => numeric(item)).filter((item) => item != null) : [];
    const forecastExpected = forecast.length ? forecast[forecast.length - 1] : null;
    const forecastSpread = forecast.length > 1 ? Math.max(...forecast) - Math.min(...forecast) : 0;
    const resolvedExpected = expected ?? forecastExpected;
    const quantiles = {
      p10: numeric(q.p10 ?? (resolvedExpected == null ? null : resolvedExpected - forecastSpread)),
      p50: numeric(q.p50 ?? resolvedExpected),
      p90: numeric(q.p90 ?? (resolvedExpected == null ? null : resolvedExpected + forecastSpread)),
    };
    const resolvedDirection = direction || (forecast.length > 1 ? (forecast[forecast.length - 1] > forecast[0] ? 'bullish' : forecast[forecast.length - 1] < forecast[0] ? 'bearish' : 'neutral') : null);
    if (resolvedExpected == null || quantiles.p10 == null || quantiles.p50 == null || quantiles.p90 == null || !resolvedDirection || probability == null || riskScore == null) {
      return { output: fallback, valid: false, reason: 'return_forecast contract incomplete' };
    }
    return { output: { expected_return_pct: resolvedExpected, quantiles_pct: quantiles, direction: resolvedDirection, probability, risk_score: riskScore }, valid: true };
  }
  const regime = ['high_volatility', 'risk_on', 'risk_off', 'mixed'].includes(String(value.regime).toLowerCase()) ? String(value.regime).toLowerCase() : null;
  if (!regime || !direction || probability == null || riskScore == null) return { output: fallback, valid: false, reason: 'regime_classification contract incomplete' };
  return { output: { regime, direction, probability, risk_score: riskScore }, valid: true };
}

async function remoteInference({ task, features, text, endpoint, modelId, backend, horizon, series }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.IBKR_QUANT_ENDPOINT_AUTH ? { authorization: process.env.IBKR_QUANT_ENDPOINT_AUTH } : {}) },
    body: JSON.stringify({ task, features, text, series: Array.isArray(series) ? series : [], horizon: horizon || null, model_id: modelId, backend }),
    signal: AbortSignal.timeout(Number(process.env.IBKR_QUANT_TIMEOUT_MS || 12000)),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`quant endpoint ${response.status}: ${data?.error || response.statusText}`);
  return data;
}

export async function inferIbkrQuantSignal(ownerUserId, input = {}) {
  ensureTables();
  const task = String(input.task || 'regime_classification').trim().toLowerCase();
  const allowed = new Set(['regime_classification', 'return_forecast', 'risk_classification', 'candidate_ranking', 'news_sentiment']);
  if (!allowed.has(task)) throw Object.assign(new Error(`unsupported quant task: ${task}`), { status: 400 });
  const features = input.features && typeof input.features === 'object' ? input.features : {};
  const text = String(input.text || '').slice(0, 12000);
  const endpoint = String(process.env.IBKR_QUANT_ENDPOINT_URL || '').trim();
  const backend = String(input.backend || process.env.IBKR_QUANT_BACKEND || DEFAULT_BACKEND).trim().toLowerCase();
  const modelId = String(process.env.IBKR_QUANT_MODEL_ID || (endpoint ? `ibkr-${backend}` : DEFAULT_MODEL));
  const revision = String(process.env.IBKR_QUANT_MODEL_REVISION || (endpoint ? 'remote-configured' : DEFAULT_REVISION));
  const series = Array.isArray(input.series) ? input.series.slice(-512).map((value) => finite(value, null)) : [];
  const inputHash = stableHash({ task, features, text, series, horizon: input.horizon || null });
  let status = 'ok';
  let output;
  let errorMessage = null;
  let outputStatus = 'validated';
  if (endpoint) {
    try {
      const rawOutput = await remoteInference({ task, features, text, endpoint, modelId, backend, horizon: input.horizon, series });
      const normalized = normalizeModelOutput(task, rawOutput, baselineInference(task, features, text));
      output = normalized.output;
      if (!normalized.valid) {
        status = 'ml_invalid_output';
        outputStatus = 'baseline_fallback';
        errorMessage = normalized.reason;
      }
    } catch (e) {
      status = 'ml_unavailable';
      outputStatus = 'baseline_fallback';
      errorMessage = e.message;
      output = baselineInference(task, features, text);
    }
  } else {
    output = baselineInference(task, features, text);
  }
  const result = {
    ok: true,
    advisory_only: true,
    status,
    task,
    backend,
    model_id: modelId,
    model_revision: revision,
    feature_schema_version: Number(input.feature_schema_version || 1),
    input_hash: inputHash,
    as_of: input.as_of || new Date().toISOString(),
    horizon: input.horizon || null,
    output,
    output_schema_version: OUTPUT_SCHEMA_VERSION,
    output_status: outputStatus,
    evidence_id: `iq-${inputHash.slice(0, 16)}`,
    ...(errorMessage ? { warning: errorMessage } : {}),
  };
  getDb().prepare(`INSERT INTO ibkr_quant_inference_runs
    (owner_user_id, task, model_id, model_revision, feature_schema_version, input_hash, as_of, horizon, output_json, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(ownerUserId, task, modelId, revision, result.feature_schema_version, inputHash, result.as_of, result.horizon, JSON.stringify(result), status, errorMessage);
  return result;
}

export function listIbkrQuantRuns(ownerUserId, { limit = 50 } = {}) {
  ensureTables();
  return getDb().prepare(`SELECT id, task, model_id, model_revision, feature_schema_version, input_hash, as_of, horizon, status, error_message, created_at
    FROM ibkr_quant_inference_runs WHERE owner_user_id = ? ORDER BY id DESC LIMIT ?`).all(ownerUserId, Math.min(200, Math.max(1, Number(limit) || 50)));
}

export { normalizeModelOutput };
