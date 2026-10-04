import crypto from 'node:crypto';
import { getDb } from '../db/schema.js';

function ensureTables() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS ibkr_strategy_bundles (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      bundle_json TEXT NOT NULL,
      created_by_agent_id TEXT,
      approved_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ibkr_strategy_bundles_owner
      ON ibkr_strategy_bundles(owner_user_id, updated_at DESC);
  `);
}

function id() { return `ibkr-sb-${crypto.randomUUID()}`; }

export function validateIbkrStrategyBundle(bundle) {
  const b = bundle && typeof bundle === 'object' ? bundle : {};
  const missing = ['goal', 'strategy', 'strategy_skill', 'policy', 'universe', 'market_data'].filter((k) => !b[k] || typeof b[k] !== 'object');
  const errors = [...missing.map((k) => `${k} configuration is required`)];
  if (b.policy?.environment && b.policy.environment !== 'paper') errors.push('only paper environment is allowed');
  if (b.policy?.feature_switches?.live_execution_enabled === true) errors.push('live execution must remain disabled');
  if (b.strategy?.execution_mode && !['automatic', 'manual', 'advisory'].includes(String(b.strategy.execution_mode))) errors.push('unsupported execution_mode');
  if (b.market_data?.allow_delayed_for_execution === true) errors.push('delayed data cannot be used for execution');
  return { valid: errors.length === 0, errors, required_keys: ['goal', 'strategy', 'strategy_skill', 'policy', 'universe', 'market_data'] };
}

export function draftIbkrStrategyBundle(ownerUserId, input = {}) {
  ensureTables();
  const bundle = input.bundle && typeof input.bundle === 'object' ? input.bundle : {};
  const name = String(input.name || bundle.name || 'Untitled IBKR paper strategy').trim().slice(0, 160);
  const recordId = id();
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO ibkr_strategy_bundles
    (id, owner_user_id, name, version, status, bundle_json, created_by_agent_id, created_at, updated_at)
    VALUES (?, ?, ?, 1, 'draft', ?, ?, ?, ?)`)
    .run(recordId, ownerUserId, name, JSON.stringify(bundle), input.caller_agent_id || null, now, now);
  return { ok: true, id: recordId, owner_user_id: ownerUserId, name, version: 1, status: 'draft', bundle, validation: validateIbkrStrategyBundle(bundle) };
}

export function listIbkrStrategyBundles(ownerUserId, { limit = 50 } = {}) {
  ensureTables();
  const rows = getDb().prepare(`SELECT id, name, version, status, created_by_agent_id, approved_by, bundle_json, created_at, updated_at
    FROM ibkr_strategy_bundles WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT ?`).all(ownerUserId, Math.min(100, Math.max(1, Number(limit) || 50)));
  // The list is owner-scoped and is also the agent's read path for the active
  // paper strategy. Return the validated bundle payload so a planner/checker
  // can reconcile strategy, policy, universe, and market-data evidence without
  // inventing a second unscoped retrieval tool. Keep the persisted JSON field
  // private and tolerate legacy malformed rows as an explicit data gap.
  return rows.map(({ bundle_json, ...row }) => {
    let bundle = null;
    try { bundle = bundle_json ? JSON.parse(bundle_json) : null; } catch { bundle = null; }
    return { ...row, bundle };
  });
}

export function validateStoredIbkrStrategyBundle(ownerUserId, bundleId) {
  ensureTables();
  const row = getDb().prepare('SELECT * FROM ibkr_strategy_bundles WHERE id = ? AND owner_user_id = ?').get(bundleId, ownerUserId);
  if (!row) throw Object.assign(new Error('strategy bundle not found'), { status: 404 });
  const bundle = JSON.parse(row.bundle_json || '{}');
  return { ok: true, id: row.id, version: row.version, status: row.status, validation: validateIbkrStrategyBundle(bundle), bundle };
}

export function replayIbkrStrategyBundle(input = {}) {
  const series = Array.isArray(input.series) ? input.series.map(Number).filter(Number.isFinite) : [];
  if (series.length < 2) return { ok: false, status: 'insufficient_data', error: 'Provide at least two point-in-time prices for replay' };
  const start = series[0];
  const end = series[series.length - 1];
  const ret = start ? ((end - start) / start) * 100 : 0;
  const peak = Math.max(...series);
  const trough = Math.min(...series);
  const drawdown = peak ? ((peak - trough) / peak) * 100 : 0;
  return { ok: true, status: 'replay_only', observations: series.length, return_pct: Number(ret.toFixed(4)), max_range_drawdown_pct: Number(drawdown.toFixed(4)), note: 'This is an evidence replay, not an order simulation. Commissions and slippage must be supplied for production comparisons.' };
}
