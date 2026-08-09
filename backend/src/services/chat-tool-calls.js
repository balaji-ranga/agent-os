/**
 * Attach tool invocations to chat turns by time + agent source.
 * Sources: content_tool_logs (Agent OS tools) + OpenClaw session .jsonl (native browser/image/cron).
 */
import { getDb } from '../db/schema.js';
import { chatOwnerIdsForRead } from './agent-chat-scope.js';
import {
  listNativeOpenClawToolCalls,
  persistNativeToolCallsToLogs,
} from './openclaw-session-tools.js';

function normalizeSourceKey(source) {
  const s = String(source || '').trim().toLowerCase();
  if (!s) return '';
  // t-ceo-bala--techresearcher → techresearcher
  const m = s.match(/^t-.+--([a-z0-9_-]+)$/);
  if (m) return m[1];
  return s;
}

function sourceMatchesAgent(source, agentId) {
  const base = String(agentId || '').toLowerCase();
  const key = normalizeSourceKey(source);
  if (!base || !key) return false;
  return key === base || key.includes(base) || base.includes(key);
}

function hasChartMedia(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return Boolean(
    parsed.visuals_markdown ||
      parsed.chart_urls ||
      parsed.north_chart_url ||
      parsed.south_chart_url ||
      (Array.isArray(parsed.charts) && parsed.charts.length)
  );
}

function clipText(v, n) {
  if (v == null) return undefined;
  const s = String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function safeJson(raw, max = 4000) {
  if (raw == null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const s = JSON.stringify(parsed);
    if (s.length <= max) return parsed;
    // Keep chart media fields intact so the chat UI can render SVGs even when the
    // full ephemeris payload is large.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && hasChartMedia(parsed)) {
      const slim = {
        ok: parsed.ok,
        visuals_markdown: parsed.visuals_markdown ?? null,
        chart_urls: parsed.chart_urls ?? null,
        charts: Array.isArray(parsed.charts)
          ? parsed.charts.map((c) => ({ id: c?.id, type: c?.type, title: c?.title, url: c?.url }))
          : undefined,
        north_chart_url: parsed.north_chart_url,
        south_chart_url: parsed.south_chart_url,
        navamsa_north_chart_url: parsed.navamsa_north_chart_url,
        navamsa_south_chart_url: parsed.navamsa_south_chart_url,
        error: parsed.error,
        lagna: parsed.lagna ? { sign: parsed.lagna.sign, sign_index: parsed.lagna.sign_index } : undefined,
        _truncated: true,
      };
      Object.keys(slim).forEach((k) => {
        if (slim[k] === undefined || slim[k] === null) delete slim[k];
      });
      return slim;
    }
    // General tools (e.g. learnings_summary): keep the human-readable core, not only _truncated.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const slim = {
        ok: parsed.ok,
        error: parsed.error,
        topic: parsed.topic,
        days: parsed.days,
        owner_user_id: parsed.owner_user_id,
        agent_id: parsed.agent_id,
        feedback_count: parsed.feedback_count,
        kanban_action_count: parsed.kanban_action_count,
        summary: clipText(parsed.summary, Math.min(1800, max)),
        message: clipText(parsed.message, 800),
        result: clipText(parsed.result, 800),
        action: parsed.action,
        url: parsed.url,
        regularMarketPrice: parsed.regularMarketPrice,
        symbol: parsed.symbol,
        openclaw_tool_call_id: parsed.openclaw_tool_call_id,
        _truncated: true,
        _preview: clipText(s, Math.max(400, max - 200)),
      };
      Object.keys(slim).forEach((k) => {
        if (slim[k] === undefined || slim[k] === null) delete slim[k];
      });
      const slimStr = JSON.stringify(slim);
      if (slimStr.length <= max + 500) return slim;
    }
    return `${s.slice(0, max)}…`;
  } catch {
    const s = String(raw);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
}

function parseTimeMs(iso) {
  if (!iso) return null;
  const raw = String(iso);
  const d = new Date(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

export function bumpIsoMinutes(iso, minutes) {
  const d = new Date(String(iso || '').includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

function inTimeWindow(createdAt, fromIso, toIso) {
  const t = parseTimeMs(createdAt);
  if (t == null) return true;
  const from = parseTimeMs(fromIso);
  const to = parseTimeMs(toIso);
  if (from != null && t < from) return false;
  if (to != null && t > to) return false;
  return true;
}

function listContentToolLogs(agentId, ownerUserId, fromIso, toIso) {
  if (!agentId || !ownerUserId) return [];
  const ownerIds = chatOwnerIdsForRead(ownerUserId);
  const ph = ownerIds.map(() => '?').join(',');
  const from = fromIso || '1970-01-01';
  const to = toIso || '9999-12-31';
  const rows = getDb()
    .prepare(
      `SELECT id, tool_name, source, request_payload, response_payload, status, created_at
       FROM content_tool_logs
       WHERE owner_user_id IN (${ph})
         AND datetime(created_at) >= datetime(?)
         AND datetime(created_at) <= datetime(?)
       ORDER BY created_at ASC, id ASC
       LIMIT 120`
    )
    .all(...ownerIds, from, to);

  return rows
    .filter((r) => sourceMatchesAgent(r.source, agentId))
    .map((r) => ({
      id: r.id,
      tool_name: r.tool_name,
      source: r.source,
      status: r.status,
      created_at: r.created_at,
      request: safeJson(r.request_payload, 2500),
      response: safeJson(r.response_payload, 2500),
    }));
}

function mergeToolCalls(fromLogs, fromSessions) {
  const byCallId = new Map();
  const out = [];

  for (const row of fromLogs || []) {
    const callId =
      row?.request?.openclaw_tool_call_id ||
      (typeof row?.request === 'object' && row.request?.openclaw_tool_call_id) ||
      null;
    if (callId) byCallId.set(String(callId), true);
    out.push(row);
  }

  for (const row of fromSessions || []) {
    const callId = row?.request?.openclaw_tool_call_id;
    if (callId && byCallId.has(String(callId))) continue;
    // Prefer log row when same native tool + second already present from a prior mirror.
    if (callId) byCallId.set(String(callId), true);
    out.push({
      id: row.id,
      tool_name: row.tool_name,
      source: row.source,
      status: row.status,
      created_at: row.created_at,
      request: safeJson(row.request, 2500),
      response: safeJson(row.response, 2500),
    });
  }

  out.sort((a, b) => {
    const ta = parseTimeMs(a.created_at) || 0;
    const tb = parseTimeMs(b.created_at) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
  return out.slice(0, 80);
}

/**
 * @param {string} agentId
 * @param {string} ownerUserId
 * @param {string} fromIso inclusive lower bound
 * @param {string} toIso exclusive/upper bound
 */
export function listToolCallsForAgentWindow(agentId, ownerUserId, fromIso, toIso) {
  if (!agentId || !ownerUserId) return [];
  const fromLogs = listContentToolLogs(agentId, ownerUserId, fromIso, toIso);
  let fromSessions = [];
  try {
    fromSessions = listNativeOpenClawToolCalls(agentId, ownerUserId, fromIso, toIso);
    // Best-effort: make native tools durable in content_tool_logs for Logs UI.
    if (fromSessions.length) persistNativeToolCallsToLogs(fromSessions, ownerUserId);
  } catch (e) {
    console.warn('[chat-tool-calls] openclaw session tools failed', e?.message || e);
  }
  return mergeToolCalls(fromLogs, fromSessions);
}

/**
 * Enrich chat turns with tool_calls attached to assistant messages.
 *
 * User+assistant rows are often inserted together *after* the gateway call, so tool
 * log timestamps fall *before* the user turn. We therefore attribute tools to the
 * interval (previous assistant → this assistant), looking back for the first reply.
 *
 * @param {Array<{id?:number,role:string,content:string,created_at:string}>} turns
 * @param {string} agentId
 * @param {string} ownerUserId
 */
export function attachToolCallsToChatTurns(turns, agentId, ownerUserId) {
  if (!Array.isArray(turns) || !turns.length) return turns || [];

  const times = turns.map((t) => t.created_at).filter(Boolean);
  let minAt = null;
  let maxAt = null;
  for (const iso of times) {
    if (!minAt || String(iso) < String(minAt)) minAt = iso;
    if (!maxAt || String(iso) > String(maxAt)) maxAt = iso;
  }
  // Load once for the whole page (history can be long).
  const bulkFrom = bumpIsoMinutes(minAt || new Date().toISOString(), -360);
  const bulkTo = bumpIsoMinutes(maxAt || new Date().toISOString(), 5);
  const allTools = listToolCallsForAgentWindow(agentId, ownerUserId, bulkFrom, bulkTo);

  let prevAssistantAt = null;
  return turns.map((t) => {
    if (t.role === 'user') {
      return { ...t, tool_calls: undefined };
    }
    if (t.role !== 'assistant') return t;

    // Window: after previous assistant (exclusive) through this reply (+ small pad).
    // First reply: look back far enough to cover long OpenClaw runs (browser, tools).
    const from = prevAssistantAt
      ? bumpIsoMinutes(prevAssistantAt, 0)
      : bumpIsoMinutes(t.created_at, -180);
    const to = bumpIsoMinutes(t.created_at || from, 2);
    prevAssistantAt = t.created_at || prevAssistantAt;

    const tool_calls = allTools.filter((tc) => inTimeWindow(tc.created_at, from, to));
    return { ...t, tool_calls };
  });
}

/**
 * Tools invoked during a live chat send (from just before gateway call until now).
 */
export function listToolCallsSince(agentId, ownerUserId, sinceIso) {
  return listToolCallsForAgentWindow(agentId, ownerUserId, sinceIso, bumpIsoMinutes(new Date().toISOString(), 1));
}
