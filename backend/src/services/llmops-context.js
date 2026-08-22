/**
 * AsyncLocalStorage for LLMOps / agent monitoring.
 * Correlates token_usage, content_tool_logs, goal plans, and workflow runs
 * without a vendor tracing product. Never stores secrets.
 */
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';

const als = new AsyncLocalStorage();

function compact(patch = {}) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null) continue;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s === '') continue;
    out[k] = s;
  }
  return out;
}

export function getLlmopsContext() {
  return als.getStore() || null;
}

export function mergeLlmopsContext(patch = {}) {
  const cur = als.getStore();
  if (!cur) return null;
  Object.assign(cur, compact(patch));
  return cur;
}

/**
 * Run `fn` inside an LLMOps context. If a store already exists, merge for the
 * duration of `fn` (including async) then restore. Express middleware should
 * use this around `next()` so downstream awaits stay in the same store.
 */
export function withLlmopsContext(patch, fn) {
  const cleaned = compact(patch);
  const cur = als.getStore();
  if (cur) {
    const snapshot = { ...cur };
    Object.assign(cur, cleaned);
    const restore = () => {
      Object.keys(cur).forEach((k) => {
        delete cur[k];
      });
      Object.assign(cur, snapshot);
    };
    try {
      const out = fn();
      if (out && typeof out.then === 'function') {
        return Promise.resolve(out).finally(restore);
      }
      restore();
      return out;
    } catch (e) {
      restore();
      throw e;
    }
  }
  return als.run(cleaned, fn);
}

export function runWithLlmopsContext(patch, fn) {
  return als.run(compact(patch), fn);
}

export function newTraceId(prefix = 'llm') {
  const p = String(prefix || 'llm').replace(/[^a-z0-9_-]/gi, '') || 'llm';
  return `${p}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function inferTraceId(ctx = {}) {
  if (ctx.traceId) return String(ctx.traceId);
  if (ctx.goalRunId) return String(ctx.goalRunId);
  if (ctx.runId != null && ctx.runId !== '') {
    const r = String(ctx.runId);
    if (r.startsWith('agr-') || r.startsWith('wf:') || r.startsWith('llm-')) return r;
    if (/^\d+$/.test(r)) return `wf:${r}`;
  }
  if (ctx.sessionId) return `sess:${ctx.sessionId}`;
  return null;
}

/**
 * Resolve which org member a ledger row should bill.
 * Prefer explicit / ALS member, then COO, else a generic unattributed bucket
 * (shown on Efficiency → LLMOps, not Agent View).
 */
export function resolveMeterMemberKey(ownerUserId, explicit = null) {
  const fromOpt = explicit != null ? String(explicit).trim() : '';
  if (fromOpt) return fromOpt;
  const ctx = getLlmopsContext();
  const fromCtx = String(ctx?.memberKey || ctx?.agentId || '').trim();
  if (fromCtx) return fromCtx;
  const owner = String(ownerUserId || '').trim();
  if (!owner) return 'llm:unattributed';
  try {
    const row = getDb()
      .prepare(
        `SELECT a.id FROM user_agents ua
         JOIN agents a ON a.id = ua.agent_id
         WHERE ua.user_id = ? AND ua.enabled = 1 AND a.is_coo = 1
         ORDER BY a.id LIMIT 1`
      )
      .get(owner);
    if (row?.id) return String(row.id);
  } catch (e) {
    console.warn('[llmops] COO member resolve failed:', e?.message || e);
  }
  return 'llm:unattributed';
}

export function resolveMeterSource(explicit = null, toolName = null) {
  const fromOpt = explicit != null ? String(explicit).trim() : '';
  if (fromOpt) return fromOpt;
  const ctx = getLlmopsContext();
  if (ctx?.source) return String(ctx.source);
  if (toolName || ctx?.toolName) return 'content_tool';
  return 'chat_completions';
}
