import crypto from 'node:crypto';
import { getDb } from '../db/schema.js';

const DEFAULT_MODEL = 'ibkr-quant-baseline-v1';
const DEFAULT_REVISION = 'baseline-heuristic-1';

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

async function remoteInference({ task, features, text, endpoint, modelId }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(process.env.IBKR_QUANT_ENDPOINT_AUTH ? { authorization: process.env.IBKR_QUANT_ENDPOINT_AUTH } : {}) },
    body: JSON.stringify({ task, features, text, model_id: modelId }),
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
  const modelId = String(process.env.IBKR_QUANT_MODEL_ID || (endpoint ? 'huggingface-ibkr-quant' : DEFAULT_MODEL));
  const revision = String(process.env.IBKR_QUANT_MODEL_REVISION || (endpoint ? 'remote-unpinned' : DEFAULT_REVISION));
  const inputHash = stableHash({ task, features, text, horizon: input.horizon || null });
  let status = 'ok';
  let output;
  let errorMessage = null;
  if (endpoint) {
    try {
      output = await remoteInference({ task, features, text, endpoint, modelId });
    } catch (e) {
      status = 'ml_unavailable';
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
    model_id: modelId,
    model_revision: revision,
    feature_schema_version: Number(input.feature_schema_version || 1),
    input_hash: inputHash,
    as_of: input.as_of || new Date().toISOString(),
    horizon: input.horizon || null,
    output,
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
