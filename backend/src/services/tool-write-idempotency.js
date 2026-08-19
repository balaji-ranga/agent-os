/**
 * Generic write idempotency ledger: retries / parallel workers cannot duplicate side effects.
 * Owner-scoped. Any mutating tool can pass an explicit key or a stable identity hash.
 */
import { createHash } from 'crypto';
import { getDb } from '../db/schema.js';
import { recordMissionEvent } from './goal-outcome.js';

let _ready = false;

export function ensureWriteIdempotencyTable() {
  if (_ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tool_write_idempotency (
      owner_user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      object_id TEXT,
      result_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, tool_name, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS idx_tool_write_idem_owner
      ON tool_write_idempotency(owner_user_id, created_at DESC);
  `);
  _ready = true;
}

export function stableIdempotencyKey(parts) {
  const raw = JSON.stringify(parts || {});
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

export function lookupWriteIdempotency(ownerUserId, toolName, idempotencyKey) {
  ensureWriteIdempotencyTable();
  const owner = String(ownerUserId || '').trim();
  const tool = String(toolName || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!owner || !tool || !key) return null;
  const row = getDb()
    .prepare(
      `SELECT owner_user_id, tool_name, idempotency_key, object_id, result_json, created_at
       FROM tool_write_idempotency
       WHERE owner_user_id = ? AND tool_name = ? AND idempotency_key = ?`
    )
    .get(owner, tool, key);
  if (!row) return null;
  let result = null;
  try {
    result = row.result_json ? JSON.parse(row.result_json) : null;
  } catch {
    result = null;
  }
  return { ...row, result, idempotent_replay: true };
}

export function rememberWriteIdempotency(ownerUserId, toolName, idempotencyKey, { objectId = null, result = null } = {}) {
  ensureWriteIdempotencyTable();
  const owner = String(ownerUserId || '').trim();
  const tool = String(toolName || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!owner || !tool || !key) return;
  getDb()
    .prepare(
      `INSERT INTO tool_write_idempotency (owner_user_id, tool_name, idempotency_key, object_id, result_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, tool_name, idempotency_key) DO NOTHING`
    )
    .run(owner, tool, key, objectId != null ? String(objectId) : null, result != null ? JSON.stringify(result) : null);
}

function ensureWriteEvidenceTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS tool_write_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      input_hash TEXT,
      output_json TEXT,
      side_effect_id TEXT,
      reviewer_decision TEXT DEFAULT 'unreviewed',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tool_write_evidence_owner
      ON tool_write_evidence(owner_user_id, created_at DESC);
  `);
}

export function recordWriteEvidence({
  ownerUserId,
  toolName,
  inputHash = null,
  output = null,
  sideEffectId = null,
  reviewerDecision = 'unreviewed',
} = {}) {
  ensureWriteIdempotencyTable();
  ensureWriteEvidenceTable();
  const owner = String(ownerUserId || '').trim();
  const tool = String(toolName || '').trim();
  if (!owner || !tool) return null;
  const info = getDb()
    .prepare(
      `INSERT INTO tool_write_evidence
       (owner_user_id, tool_name, input_hash, output_json, side_effect_id, reviewer_decision)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      owner,
      tool,
      inputHash ? String(inputHash).slice(0, 80) : null,
      output != null ? JSON.stringify(output).slice(0, 4000) : null,
      sideEffectId != null ? String(sideEffectId) : null,
      String(reviewerDecision || 'unreviewed').slice(0, 40)
    );
  return info.lastInsertRowid;
}

export function listWriteEvidence(ownerUserId, { limit = 50 } = {}) {
  ensureWriteIdempotencyTable();
  ensureWriteEvidenceTable();
  const owner = String(ownerUserId || '').trim();
  if (!owner) return [];
  return getDb()
    .prepare(
      `SELECT id, owner_user_id, tool_name, input_hash, side_effect_id, reviewer_decision, created_at
       FROM tool_write_evidence WHERE owner_user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(owner, Math.min(Math.max(Number(limit) || 50, 1), 200));
}

export async function withWriteIdempotency({
  ownerUserId,
  toolName,
  idempotencyKey,
  identity = null,
  execute,
  goalRunId = null,
}) {
  const key =
    String(idempotencyKey || '').trim() ||
    (identity ? stableIdempotencyKey({ owner: ownerUserId, tool: toolName, ...identity }) : '');
  if (!key) return execute();
  const hit = lookupWriteIdempotency(ownerUserId, toolName, key);
  if (hit?.result) {
    console.info('[idempotency] replay', { tool: toolName, owner: String(ownerUserId || '').slice(0, 12) });
    return { ...hit.result, idempotent_replay: true, idempotency_key: key };
  }
  const result = await execute();
  const objectId =
    result?.company?.id ||
    result?.person?.id ||
    result?.opportunity?.id ||
    result?.lead?.id ||
    result?.id ||
    result?.name ||
    null;
  rememberWriteIdempotency(ownerUserId, toolName, key, { objectId, result });
  try {
    recordWriteEvidence({
      ownerUserId,
      toolName,
      inputHash: key,
      output: { ok: true, object_id: objectId },
      sideEffectId: objectId,
      reviewerDecision: 'executed',
    });
    recordMissionEvent({
      ownerUserId,
      goalRunId,
      event_type: 'tool_side_effect',
      payload: { tool: toolName, object_id: objectId, replay: false },
    });
  } catch (e) {
    console.warn('[idempotency] evidence skip', e?.message || e);
  }
  return { ...result, idempotent_replay: false, idempotency_key: key };
}
