/**
 * Read native OpenClaw tool calls (browser, image, cron) from per-agent session .jsonl.
 * Content tools already appear in content_tool_logs; native tools do not - Agent Chat chips
 * merge both via chat-tool-calls.js.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { tenantOpenClawAgentId } from './openclaw-tenant.js';
import { getDb } from '../db/schema.js';

/** Native OpenClaw tools that never go through Agent OS POST /api/tools (no content_tool_logs). */
export const NATIVE_OPENCLAW_TOOLS = new Set(['browser', 'image', 'cron', 'cron_add']);

const MAX_SESSION_FILES = Math.min(
  Math.max(parseInt(process.env.CHAT_OPENCLAW_SESSION_FILES || '10', 10) || 10, 1),
  24
);
const MAX_BYTES_PER_FILE = Math.min(
  Math.max(
    parseInt(process.env.CHAT_OPENCLAW_SESSION_MAX_BYTES || String(12 * 1024 * 1024), 10) || 12 * 1024 * 1024,
    256 * 1024
  ),
  40 * 1024 * 1024
);
const MAX_NATIVE_CALLS = 80;

function clipText(v, n) {
  if (v == null) return undefined;
  const s = String(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function parseTimeMs(iso) {
  if (!iso) return null;
  const raw = String(iso);
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  const t = d.getTime();
  return Number.isNaN(t) ? null : t;
}

function toSqlUtc(isoOrMs) {
  if (typeof isoOrMs === 'number' && Number.isFinite(isoOrMs)) {
    return new Date(isoOrMs).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }
  const ms = parseTimeMs(isoOrMs);
  if (ms == null) return String(isoOrMs || '');
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function sessionsDirFor(runtimeId) {
  return join(getOpenClawDir(), 'agents', String(runtimeId || ''), 'sessions');
}

function candidateRuntimeIds(agentId, ownerUserId) {
  const base = String(agentId || '').trim().toLowerCase();
  const out = [];
  if (ownerUserId && base) out.push(tenantOpenClawAgentId(ownerUserId, base));
  if (base) out.push(base);
  return [...new Set(out.filter(Boolean))];
}

function listSessionJsonlFiles(dir, fromMs, toMs) {
  if (!existsSync(dir)) return [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const padMs = 30 * 60 * 1000;
  const lo = fromMs != null ? fromMs - padMs : 0;
  const hi = toMs != null ? toMs + padMs : Number.MAX_SAFE_INTEGER;
  return names
    .filter((n) => n.endsWith('.jsonl') && !n.includes('.trajectory'))
    .map((n) => {
      const p = join(dir, n);
      try {
        const st = statSync(p);
        return { path: p, name: n, mtimeMs: st.mtimeMs || 0, size: st.size || 0 };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((f) => f.mtimeMs >= lo && f.mtimeMs <= hi + 24 * 60 * 60 * 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SESSION_FILES);
}

function extractToolResultText(msg) {
  const parts = msg && msg.content;
  if (typeof parts === 'string') return parts;
  if (!Array.isArray(parts)) return '';
  const texts = [];
  for (const p of parts) {
    if (p && p.type === 'text' && p.text != null) texts.push(String(p.text));
    else if (p && typeof p.text === 'string') texts.push(p.text);
  }
  return texts.join('\n');
}

function slimBrowserArgs(args) {
  if (!args || typeof args !== 'object') return args || {};
  const out = {
    action: args.action,
    url: clipText(args.url, 500),
    profile: args.profile,
    targetId: args.targetId,
  };
  if (args.expression != null) out.expression = clipText(args.expression, 400);
  if (args.script != null) out.script = clipText(args.script, 400);
  if (args.selector != null) out.selector = clipText(args.selector, 200);
  Object.keys(out).forEach((k) => {
    if (out[k] === undefined || out[k] === null) delete out[k];
  });
  return out;
}

function slimNativeArgs(toolName, args) {
  if (toolName === 'browser') return slimBrowserArgs(args);
  if (!args || typeof args !== 'object') return args || {};
  try {
    const s = JSON.stringify(args);
    if (s.length <= 2000) return args;
    return { _truncated: true, _preview: clipText(s, 1800) };
  } catch {
    return { _unserializable: true };
  }
}

function slimNativeResult(toolName, text, isError, details) {
  const body = text || (details != null ? JSON.stringify(details) : '');
  if (!body) {
    return isError ? { ok: false, error: 'empty tool result' } : { ok: true };
  }
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out = {
        ok: !isError && parsed.status !== 'error' && !parsed.error,
        status: parsed.status,
        error: clipText(parsed.error, 500),
        url: clipText(parsed.url || parsed.finalUrl || parsed.href, 500),
        title: clipText(parsed.title, 200),
      };
      if (parsed.chart && parsed.chart.result && parsed.chart.result[0] && parsed.chart.result[0].meta && parsed.chart.result[0].meta.regularMarketPrice != null) {
        out.regularMarketPrice = parsed.chart.result[0].meta.regularMarketPrice;
        out.symbol = parsed.chart.result[0].meta.symbol;
      }
      if (parsed.regularMarketPrice != null) out.regularMarketPrice = parsed.regularMarketPrice;
      if (parsed.symbol) out.symbol = parsed.symbol;
      const hasCore = out.error || out.url || out.regularMarketPrice != null;
      if (!hasCore) out._preview = clipText(body, toolName === 'browser' ? 1200 : 800);
      Object.keys(out).forEach((k) => {
        if (out[k] === undefined || out[k] === null || out[k] === '') delete out[k];
      });
      return out;
    }
  } catch {
    /* plain text */
  }
  return {
    ok: !isError,
    _preview: clipText(body, toolName === 'browser' ? 1200 : 800),
  };
}

function parseSessionFile(filePath, runtimeId, fromMs, toMs) {
  let raw;
  try {
    const st = statSync(filePath);
    if ((st.size || 0) > MAX_BYTES_PER_FILE) {
      const fd = readFileSync(filePath, { encoding: 'utf8' });
      raw = fd.slice(-MAX_BYTES_PER_FILE);
    } else {
      raw = readFileSync(filePath, 'utf8');
    }
  } catch (e) {
    console.warn('[openclaw-session-tools] read failed', {
      file: filePath,
      error: (e && e.message) || String(e),
    });
    return [];
  }

  const pending = new Map();
  const done = [];

  for (const line of raw.split('\n')) {
    if (!line || line.length < 20) continue;
    if (!line.includes('toolCall') && !line.includes('toolResult')) continue;
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (!evt || evt.type !== 'message' || !evt.message) continue;
    const ts = evt.timestamp || (evt.message && evt.message.timestamp);
    let createdMs = null;
    if (typeof ts === 'number') createdMs = ts > 1e12 ? ts : ts * 1000;
    else if (typeof ts === 'string') createdMs = parseTimeMs(ts);
    if (createdMs == null) continue;
    if (fromMs != null && createdMs < fromMs - 60000) continue;
    if (toMs != null && createdMs > toMs + 120000) continue;

    const msg = evt.message;
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || part.type !== 'toolCall' || !part.name) continue;
        const name = String(part.name).toLowerCase();
        if (!NATIVE_OPENCLAW_TOOLS.has(name)) continue;
        const callId = String(part.id || name + '-' + createdMs);
        pending.set(callId, {
          id: 'oc-' + callId,
          tool_name: name,
          request: Object.assign({}, slimNativeArgs(name, part.arguments || {}), {
            openclaw_tool_call_id: callId,
            openclaw_runtime_id: runtimeId,
          }),
          created_at: new Date(createdMs).toISOString(),
          createdMs: createdMs,
        });
      }
    } else if (msg.role === 'toolResult' || msg.role === 'tool') {
      const name = String(msg.toolName || msg.name || '').toLowerCase();
      if (!NATIVE_OPENCLAW_TOOLS.has(name)) continue;
      const callId = String(msg.toolCallId || msg.tool_call_id || msg.id || '');
      const isError = Boolean(msg.isError || msg.is_error);
      const text = extractToolResultText(msg);
      const status =
        isError || /"status"\s*:\s*"error"/i.test(text) || /Navigation blocked|timed out/i.test(text)
          ? 'error'
          : 'ok';
      const base = pending.get(callId) || {
        id: 'oc-' + (callId || name + '-' + createdMs),
        tool_name: name,
        request: {
          openclaw_tool_call_id: callId || undefined,
          openclaw_runtime_id: runtimeId,
        },
        created_at: new Date(createdMs).toISOString(),
        createdMs: createdMs,
      };
      pending.delete(callId);
      done.push(
        Object.assign({}, base, {
          source: runtimeId,
          status: status,
          response: slimNativeResult(name, text, isError, msg.details),
          created_at: base.created_at,
          createdMs: base.createdMs,
          _origin: 'openclaw_session',
        })
      );
    }
  }

  for (const base of pending.values()) {
    done.push(
      Object.assign({}, base, {
        source: runtimeId,
        status: 'pending',
        response: { ok: false, error: 'no toolResult in session transcript' },
        _origin: 'openclaw_session',
      })
    );
  }

  return done;
}

/**
 * List native OpenClaw tool calls for an Agent OS agent in a time window.
 */
export function listNativeOpenClawToolCalls(agentId, ownerUserId, fromIso, toIso) {
  if (!agentId || !ownerUserId) return [];
  const fromMs = parseTimeMs(fromIso);
  const toMs = parseTimeMs(toIso);
  const runtimes = candidateRuntimeIds(agentId, ownerUserId);
  const all = [];
  const seen = new Set();

  for (const runtimeId of runtimes) {
    const dir = sessionsDirFor(runtimeId);
    const files = listSessionJsonlFiles(dir, fromMs, toMs);
    for (const f of files) {
      const calls = parseSessionFile(f.path, runtimeId, fromMs, toMs);
      for (const c of calls) {
        const key = (c.request && c.request.openclaw_tool_call_id) || c.id;
        if (seen.has(key)) continue;
        seen.add(key);
        if (fromMs != null && c.createdMs < fromMs) continue;
        if (toMs != null && c.createdMs > toMs) continue;
        all.push(c);
      }
    }
  }

  all.sort(function (a, b) {
    return (a.createdMs || 0) - (b.createdMs || 0);
  });
  return all.slice(0, MAX_NATIVE_CALLS).map(function (row) {
    const copy = Object.assign({}, row);
    delete copy.createdMs;
    delete copy._origin;
    return copy;
  });
}

/**
 * Persist newly seen native session tools into content_tool_logs (deduped by call id).
 */
export function persistNativeToolCallsToLogs(calls, ownerUserId) {
  if (!ownerUserId || !Array.isArray(calls) || !calls.length) return 0;
  const db = getDb();
  let inserted = 0;
  const insert = db.prepare(
    'INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status, owner_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const existsStmt = db.prepare(
    'SELECT id FROM content_tool_logs WHERE owner_user_id = ? AND tool_name = ? AND request_payload LIKE ? LIMIT 1'
  );

  for (const c of calls) {
    const callId = c && c.request && c.request.openclaw_tool_call_id;
    if (!callId) continue;
    try {
      const hit = existsStmt.get(ownerUserId, c.tool_name, '%"openclaw_tool_call_id":"' + callId + '"%');
      if (hit && hit.id) continue;
      insert.run(
        c.tool_name,
        c.source || null,
        JSON.stringify(c.request || {}),
        JSON.stringify(c.response || {}),
        c.status === 'ok' ? 'ok' : c.status || 'error',
        ownerUserId,
        toSqlUtc(c.created_at)
      );
      inserted += 1;
    } catch (e) {
      console.warn('[openclaw-session-tools] persist failed', {
        tool: c.tool_name,
        error: (e && e.message) || String(e),
      });
    }
  }
  if (inserted > 0) {
    console.info('[openclaw-session-tools] mirrored native tools to content_tool_logs', {
      ownerUserId: ownerUserId,
      inserted: inserted,
    });
  }
  return inserted;
}