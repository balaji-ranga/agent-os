/**
 * Attach Agent OS tool invocations (content_tool_logs) to chat turns by time + agent source.
 */
import { getDb } from '../db/schema.js';
import { chatOwnerIdsForRead } from './agent-chat-scope.js';

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

function safeJson(raw, max = 4000) {
  if (raw == null) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const s = JSON.stringify(parsed);
    if (s.length <= max) return parsed;
    // Keep chart media fields intact so the chat UI can render SVGs even when the
    // full ephemeris payload is large.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
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
    return `${s.slice(0, max)}…`;
  } catch {
    const s = String(raw);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
}

/**
 * @param {string} agentId
 * @param {string} ownerUserId
 * @param {string} fromIso inclusive lower bound
 * @param {string} toIso exclusive/upper bound
 */
export function listToolCallsForAgentWindow(agentId, ownerUserId, fromIso, toIso) {
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
       LIMIT 80`
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

/**
 * Enrich chat turns with tool_calls attached to assistant messages (tools between prior user msg and this reply).
 * @param {Array<{id?:number,role:string,content:string,created_at:string}>} turns
 * @param {string} agentId
 * @param {string} ownerUserId
 */
export function attachToolCallsToChatTurns(turns, agentId, ownerUserId) {
  if (!Array.isArray(turns) || !turns.length) return turns || [];
  let lastUserAt = null;
  return turns.map((t) => {
    if (t.role === 'user') {
      lastUserAt = t.created_at;
      return { ...t, tool_calls: undefined };
    }
    if (t.role !== 'assistant') return t;
    const from = lastUserAt || t.created_at;
    // Small pad so tools logged just after the assistant row still attach.
    const to = t.created_at
      ? // sqlite datetime: add via string compare; fetch with +2 min window in SQL instead
        t.created_at
      : null;
    const tool_calls = listToolCallsForAgentWindow(
      agentId,
      ownerUserId,
      from,
      // Use a soft upper bound: turn time + 2 minutes (ISO if possible)
      bumpIsoMinutes(to || from, 2)
    );
    return { ...t, tool_calls };
  });
}

function bumpIsoMinutes(iso, minutes) {
  const d = new Date(String(iso || '').includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

/**
 * Tools invoked during a live chat send (from just before gateway call until now).
 */
export function listToolCallsSince(agentId, ownerUserId, sinceIso) {
  return listToolCallsForAgentWindow(agentId, ownerUserId, sinceIso, bumpIsoMinutes(new Date().toISOString(), 1));
}
