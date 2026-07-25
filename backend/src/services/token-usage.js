/**
 * Durable token usage ledger.
 *
 * Every LLM-backed call that we can attribute to an org member (internal agent id or
 * `org_agent_members.id`) writes one row here. Provider usage is used when the API returns it;
 * otherwise we fall back to a `chars/4` estimate and flag the row as estimated so dashboards
 * can say so honestly.
 */
import { getDb } from '../db/schema.js';

/** Rough token estimate when the provider does not return usage. */
export function estimateTokens(text) {
  const chars = String(text ?? '').length;
  return chars ? Math.max(1, Math.ceil(chars / 4)) : 0;
}

/** `YYYY-MM` for the given date (local time), defaults to now. */
export function monthPeriod(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** Normalize OpenAI / Anthropic / OpenRouter usage payloads to input/output tokens. */
export function normalizeProviderUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(
    usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0
  );
  const output = Number(
    usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0
  );
  if (!Number.isFinite(input) && !Number.isFinite(output)) return null;
  const inTok = Number.isFinite(input) ? Math.max(0, Math.round(input)) : 0;
  const outTok = Number.isFinite(output) ? Math.max(0, Math.round(output)) : 0;
  if (!inTok && !outTok) return null;
  return { input_tokens: inTok, output_tokens: outTok, total_tokens: inTok + outTok };
}

/** Sum two normalized usage objects (multi-round tool loops). */
export function addUsage(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
    total_tokens: (a.total_tokens || 0) + (b.total_tokens || 0),
  };
}

/**
 * Append one usage row. Never throws — metering must not break the caller.
 * @returns {boolean} true when a row was written
 */
export function recordTokenUsage(
  ownerUserId,
  {
    memberKey,
    agentId = null,
    source = 'unknown',
    modelId = null,
    inputTokens = 0,
    outputTokens = 0,
    estimated = false,
    sessionId = null,
    runId = null,
  } = {}
) {
  const owner = String(ownerUserId || '').trim();
  const key = String(memberKey || agentId || '').trim();
  if (!owner || !key) return false;
  const inTok = Math.max(0, Math.round(Number(inputTokens) || 0));
  const outTok = Math.max(0, Math.round(Number(outputTokens) || 0));
  if (!inTok && !outTok) return false;
  try {
    getDb()
      .prepare(
        `INSERT INTO token_usage
           (owner_user_id, member_key, agent_id, source, model_id, input_tokens, output_tokens,
            total_tokens, tokens_estimated, session_id, run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        owner,
        key,
        agentId ? String(agentId) : null,
        String(source || 'unknown'),
        modelId ? String(modelId) : null,
        inTok,
        outTok,
        inTok + outTok,
        estimated ? 1 : 0,
        sessionId ? String(sessionId) : null,
        runId == null ? null : String(runId)
      );
    return true;
  } catch (e) {
    console.warn('[token-usage] record failed', key, source, e?.message || e);
    return false;
  }
}

/**
 * Meter one OpenClaw call for an agent. Uses gateway-reported usage when present,
 * else a chars/4 estimate over prompt + reply. Never throws.
 *
 * @param {string} ownerUserId
 * @param {string} agentId internal agent id (also the member key)
 * @param {{ usage?: object|null, source?: string, promptText?: string, replyText?: string, modelId?: string|null, sessionId?: string|null }} opts
 */
export function meterOpenClawUsage(ownerUserId, agentId, opts = {}) {
  const {
    usage = null,
    source = 'openclaw',
    promptText = '',
    replyText = '',
    modelId = null,
    sessionId = null,
  } = opts;
  try {
    const provided = normalizeProviderUsage(usage);
    const resolved =
      provided ||
      (() => {
        const input = estimateTokens(promptText);
        const output = estimateTokens(
          typeof replyText === 'string' ? replyText : JSON.stringify(replyText ?? '')
        );
        return input || output
          ? { input_tokens: input, output_tokens: output, total_tokens: input + output }
          : null;
      })();
    if (!resolved) return null;
    recordTokenUsage(ownerUserId, {
      memberKey: agentId,
      agentId,
      source,
      modelId: modelId || usage?.model || null,
      inputTokens: resolved.input_tokens,
      outputTokens: resolved.output_tokens,
      estimated: !provided,
      sessionId,
    });
    return { ...resolved, estimated: !provided };
  } catch (e) {
    console.warn('[token-usage] openclaw metering failed', agentId, e?.message || e);
    return null;
  }
}

/** Month-to-date tokens for one member. */
export function getMonthlyTokens(ownerUserId, memberKey, period = monthPeriod()) {
  if (!ownerUserId || !memberKey) return { total_tokens: 0, estimated_tokens: 0, calls: 0 };
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(total_tokens), 0) AS total_tokens,
         COALESCE(SUM(CASE WHEN tokens_estimated = 1 THEN total_tokens ELSE 0 END), 0) AS estimated_tokens,
         COUNT(*) AS calls
       FROM token_usage
       WHERE owner_user_id = ? AND member_key = ? AND strftime('%Y-%m', created_at, 'localtime') = ?`
    )
    .get(String(ownerUserId), String(memberKey), String(period));
  return {
    total_tokens: Number(row?.total_tokens) || 0,
    estimated_tokens: Number(row?.estimated_tokens) || 0,
    calls: Number(row?.calls) || 0,
  };
}

/** Month-to-date tokens for every member of an owner, keyed by member_key. */
export function getMonthlyTokensByMember(ownerUserId, period = monthPeriod()) {
  const out = new Map();
  if (!ownerUserId) return out;
  const rows = getDb()
    .prepare(
      `SELECT member_key, COALESCE(SUM(total_tokens), 0) AS total_tokens, COUNT(*) AS calls
       FROM token_usage
       WHERE owner_user_id = ? AND strftime('%Y-%m', created_at, 'localtime') = ?
       GROUP BY member_key`
    )
    .all(String(ownerUserId), String(period));
  for (const r of rows) {
    out.set(r.member_key, { total_tokens: Number(r.total_tokens) || 0, calls: Number(r.calls) || 0 });
  }
  return out;
}

/** Daily token totals for one member between two YYYY-MM-DD days (inclusive). */
export function getTokenTimeline(ownerUserId, memberKey, { since = null, until = null } = {}) {
  if (!ownerUserId || !memberKey) return [];
  const params = [String(ownerUserId), String(memberKey)];
  let filter = '';
  if (since && until) {
    filter = ` AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;
    params.push(since, until);
  }
  return getDb()
    .prepare(
      `SELECT date(created_at, 'localtime') AS day,
              COALESCE(SUM(total_tokens), 0) AS tokens,
              COUNT(*) AS calls
       FROM token_usage
       WHERE owner_user_id = ? AND member_key = ?${filter}
       GROUP BY date(created_at, 'localtime')
       ORDER BY day ASC`
    )
    .all(...params)
    .map((r) => ({ day: r.day, tokens: Number(r.tokens) || 0, calls: Number(r.calls) || 0 }));
}

/** Token split by source (openclaw / workflow_brain / delegation / a2a_outbound / …). */
export function getTokensBySource(ownerUserId, memberKey, { since = null, until = null } = {}) {
  if (!ownerUserId || !memberKey) return [];
  const params = [String(ownerUserId), String(memberKey)];
  let filter = '';
  if (since && until) {
    filter = ` AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;
    params.push(since, until);
  }
  return getDb()
    .prepare(
      `SELECT source, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS calls
       FROM token_usage
       WHERE owner_user_id = ? AND member_key = ?${filter}
       GROUP BY source
       ORDER BY tokens DESC`
    )
    .all(...params)
    .map((r) => ({ source: r.source, tokens: Number(r.tokens) || 0, calls: Number(r.calls) || 0 }));
}

/**
 * Zero month-to-date token usage so Agent View gauges and budget enforcement start fresh.
 * Deletes `token_usage` ledger rows for the period (default: current calendar month).
 * Does not change configured monthly budgets — only the used counter.
 *
 * @param {string} ownerUserId
 * @param {{ memberKey?: string|null, period?: string }} [opts]
 *   - memberKey: reset one agent / leaf; omit to reset every member for this owner
 * @returns {{ period: string, deleted_rows: number, member_key: string|null }}
 */
export function resetTokenUsage(ownerUserId, { memberKey = null, period = monthPeriod() } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  const periodKey = String(period || monthPeriod()).trim();
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    const err = new Error('period must be YYYY-MM');
    err.status = 400;
    throw err;
  }
  const key = memberKey != null && String(memberKey).trim() ? String(memberKey).trim() : null;
  const db = getDb();
  let result;
  if (key) {
    result = db
      .prepare(
        `DELETE FROM token_usage
         WHERE owner_user_id = ? AND member_key = ?
           AND strftime('%Y-%m', created_at, 'localtime') = ?`
      )
      .run(owner, key, periodKey);
  } else {
    result = db
      .prepare(
        `DELETE FROM token_usage
         WHERE owner_user_id = ?
           AND strftime('%Y-%m', created_at, 'localtime') = ?`
      )
      .run(owner, periodKey);
  }
  const deleted = Number(result?.changes) || 0;
  console.log(
    `[token-usage] reset owner=${owner} member=${key || '*'} period=${periodKey} deleted_rows=${deleted}`
  );
  return { period: periodKey, deleted_rows: deleted, member_key: key };
}

