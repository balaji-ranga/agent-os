/**
 * Platform execution governor for OpenClaw content-tool calls.
 *
 * OpenClaw owns the inner model/tool loop.  This service owns tenant-safe argument
 * canonicalisation, duplicate/no-progress prevention, observation classification,
 * capability fallbacks, bounded behaviour and an auditable action ledger.
 */
import { createHash, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPlatformTimeoutMs } from './platform-timeout-settings.js';

const OWNER_KEYS = new Set([
  'owner_user_id', 'ownerUserId', 'ceo_user_id', 'ceoUserId', 'user_id', 'userId',
  'caller_agent_id', 'x_openclaw_agent_id', 'approval_token',
]);

const POLL_OR_STATUS = /(?:_status|_list|_enquire|_get|_history|_watch_tick)$/;
const MUTATING = /(?:create|insert|update|delete|send|publish|post|place|submit|cancel|move_status|assign|trigger|run_now|save|apply|index_document)/;

const CAPABILITY_RULES = [
  [/^master_data_list_(?:tables|rows)$/, 'structured_data_search'],
  [/^master_data_(?:list_documents|rag|index_document)$/, 'document_knowledge'],
  [/^browse_/, 'browser_automation'],
  [/^crm_/, 'crm'],
  [/^erp_/, 'erp'],
  [/^email_/, 'external_messaging'],
  [/^(?:brave_web_search|summarize_url|social_research_|business_discover)/, 'web_research'],
  [/^agent_goal_/, 'goal_orchestration'],
  [/^agent_workflow_/, 'workflow_orchestration'],
  [/^kanban_/, 'work_management'],
  [/^(?:generate_image|generate_video|speech_)/, 'media_generation'],
];

const FALLBACKS = {
  structured_data_search: ['document_discovery', 'document_rag'],
  document_knowledge: ['document_discovery', 'clarification'],
  web_research: ['browser_automation', 'clarification'],
  browser_automation: ['saved_recipe', 'alternate_browser_driver', 'clarification'],
  crm: ['broader_crm_search', 'clarification'],
  erp: ['erp_read_back', 'clarification'],
  external_messaging: ['profile_lookup', 'approval_or_clarification'],
};

function json(value, fallback = null) {
  try { return JSON.stringify(value); } catch { return fallback; }
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stable(value[key])])
  );
}

function redactForStorage(value, depth = 0) {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactForStorage(v, depth + 1));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && value.length > 4000 ? `${value.slice(0, 4000)}…` : value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:token|secret|password|passwd|api[_-]?key|authorization|cookie|sessionid)/i.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactForStorage(item, depth + 1);
    }
  }
  return out;
}

export function canonicalToolParams(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (OWNER_KEYS.has(key)) continue;
    if (value === undefined || value === '') continue;
    out[key] = stable(value);
  }
  return stable(out);
}

export function capabilityForTool(toolName) {
  const name = String(toolName || '').trim();
  return CAPABILITY_RULES.find(([pattern]) => pattern.test(name))?.[1] || 'general_tool';
}

export function defaultExecutionBehaviour(toolName) {
  const name = String(toolName || '').trim();
  const capability = capabilityForTool(name);
  const mutating = MUTATING.test(name);
  return {
    tool_name: name,
    capability,
    access: mutating ? 'mutating' : 'read_only',
    retry_limit: 1,
    timeout_ms: ['connector_execute_action', 'gmail_mailbox_review', 'gmail_mailbox_cleanup'].includes(name)
      ? getPlatformTimeoutMs('connector_operation') : /browse_|generate_video/.test(name) ? 90000 : 60000,
    duplicate_window_sec: POLL_OR_STATUS.test(name) ? 0 : 900,
    verification_mode: mutating ? 'read_back_or_receipt' : 'evidence_coverage',
    fallback_capabilities: FALLBACKS[capability] || ['clarification'],
    repeat_allowed: POLL_OR_STATUS.test(name),
  };
}

function ownerOverrides(ownerUserId) {
  if (!ownerUserId) return new Map();
  const rows = getDb().prepare(
    `SELECT * FROM tool_execution_behaviour WHERE owner_user_id = ?`
  ).all(ownerUserId);
  return new Map(rows.map((r) => [r.tool_name, r]));
}

export function getExecutionBehaviour(ownerUserId, toolName) {
  const base = defaultExecutionBehaviour(toolName);
  const row = ownerOverrides(ownerUserId).get(base.tool_name);
  if (!row) return base;
  return {
    ...base,
    retry_limit: row.retry_limit ?? base.retry_limit,
    timeout_ms: row.timeout_ms ?? base.timeout_ms,
    duplicate_window_sec: row.duplicate_window_sec ?? base.duplicate_window_sec,
    verification_mode: row.verification_mode || base.verification_mode,
    fallback_capabilities: parseJson(row.fallback_capabilities, base.fallback_capabilities),
    overridden: true,
  };
}

export function listExecutionBehaviours(ownerUserId) {
  const tools = getDb().prepare(
    `SELECT name, display_name, purpose, enabled FROM content_tools_meta ORDER BY is_builtin DESC, name`
  ).all();
  const stats = getDb().prepare(
    `SELECT tool_name, COUNT(*) calls,
            SUM(CASE WHEN observation_status = 'success' THEN 1 ELSE 0 END) successes,
            SUM(CASE WHEN observation_status = 'duplicate_blocked' THEN 1 ELSE 0 END) duplicates_prevented,
            SUM(CASE WHEN observation_status NOT IN ('success','running') THEN 1 ELSE 0 END) exceptions
       FROM tool_execution_actions WHERE owner_user_id = ? GROUP BY tool_name`
  ).all(ownerUserId);
  const byName = new Map(stats.map((s) => [s.tool_name, s]));
  return tools.map((t) => ({ ...t, ...getExecutionBehaviour(ownerUserId, t.name), stats: byName.get(t.name) || { calls: 0, successes: 0, duplicates_prevented: 0, exceptions: 0 } }));
}

export function putExecutionBehaviours(ownerUserId, mappings = []) {
  const db = getDb();
  const save = db.prepare(
    `INSERT INTO tool_execution_behaviour
       (owner_user_id, tool_name, retry_limit, timeout_ms, duplicate_window_sec, verification_mode, fallback_capabilities, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, tool_name) DO UPDATE SET
       retry_limit=excluded.retry_limit, timeout_ms=excluded.timeout_ms,
       duplicate_window_sec=excluded.duplicate_window_sec,
       verification_mode=excluded.verification_mode,
       fallback_capabilities=excluded.fallback_capabilities, updated_at=datetime('now')`
  );
  const tx = db.transaction((items) => {
    for (const item of items) {
      const name = String(item.tool_name || '').trim();
      if (!name) throw Object.assign(new Error('tool_name required'), { status: 400 });
      const exists = db.prepare(`SELECT 1 FROM content_tools_meta WHERE name = ?`).get(name);
      if (!exists) throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 400 });
      const retry = Math.max(0, Math.min(3, Number(item.retry_limit ?? 1)));
      const timeout = Math.max(1000, Math.min(600000, Number(item.timeout_ms ?? 60000)));
      const duplicate = Math.max(0, Math.min(86400, Number(item.duplicate_window_sec ?? 900)));
      const verification = String(item.verification_mode || defaultExecutionBehaviour(name).verification_mode);
      if (!['none', 'evidence_coverage', 'read_back_or_receipt'].includes(verification)) {
        throw Object.assign(new Error(`Invalid verification_mode for ${name}`), { status: 400 });
      }
      const fallbacks = Array.isArray(item.fallback_capabilities)
        ? item.fallback_capabilities.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
        : defaultExecutionBehaviour(name).fallback_capabilities;
      save.run(ownerUserId, name, retry, timeout, duplicate, verification, json(fallbacks, '[]'));
    }
  });
  tx(Array.isArray(mappings) ? mappings : []);
  return listExecutionBehaviours(ownerUserId);
}

function executionKey({ sessionKey, traceId, ownerUserId, agentId }) {
  const raw = String(sessionKey || traceId || `${ownerUserId || 'unknown'}:${agentId || 'unknown'}:unscoped`);
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

function fingerprint(toolName, params) {
  return createHash('sha256').update(`${toolName}:${json(canonicalToolParams(params), '{}')}`).digest('hex');
}

export function beginToolExecution({ ownerUserId, agentId, sessionKey, traceId, toolName, params }) {
  const behaviour = getExecutionBehaviour(ownerUserId, toolName);
  const canonicalParams = canonicalToolParams(params);
  const key = executionKey({ sessionKey, traceId, ownerUserId, agentId });
  const fp = fingerprint(toolName, canonicalParams);
  if (!behaviour.repeat_allowed && behaviour.duplicate_window_sec > 0) {
    const prior = getDb().prepare(
      `SELECT id, observation_status, reason_code, created_at FROM tool_execution_actions
        WHERE owner_user_id = ? AND execution_key = ? AND action_fingerprint = ?
          AND created_at >= datetime('now', ?)
        ORDER BY created_at DESC`
    ).all(ownerUserId, key, fp, `-${behaviour.duplicate_window_sec} seconds`);
    const duplicate = prior[0];
    const allowedTransientRetry =
      duplicate?.observation_status === 'transient_error' && prior.length <= behaviour.retry_limit;
    if (duplicate && !allowedTransientRetry) {
      const observation = {
        status: 'duplicate_blocked', reason_code: 'duplicate_no_progress', progress: false,
        retryable: false, evidence: [],
        suggested_capabilities: behaviour.fallback_capabilities,
        message: 'Equivalent action already ran in this execution. Do not change tenant/owner parameter names or repeat it; choose a different capability or use the existing observation.',
        previous_action_id: duplicate.id,
      };
      const id = `tea-${randomUUID()}`;
      getDb().prepare(
        `INSERT INTO tool_execution_actions
          (id, owner_user_id, execution_key, agent_id, tool_name, capability, action_fingerprint,
           request_payload, observation_status, reason_code, progress, response_summary, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'duplicate_blocked', 'duplicate_no_progress', 0, ?, datetime('now'))`
      ).run(id, ownerUserId, key, agentId, toolName, behaviour.capability, fp, json(redactForStorage(canonicalParams), '{}'), json(observation, '{}'));
      return { ok: false, duplicate: true, id, execution_key: key, behaviour, canonicalParams, observation };
    }
  }
  const id = `tea-${randomUUID()}`;
  getDb().prepare(
    `INSERT INTO tool_execution_actions
      (id, owner_user_id, execution_key, agent_id, tool_name, capability, action_fingerprint, request_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, ownerUserId, key, agentId, toolName, behaviour.capability, fp, json(redactForStorage(canonicalParams), '{}'));
  return { ok: true, id, execution_key: key, behaviour, canonicalParams };
}

function hasEmptyPayload(data) {
  if (!data || typeof data !== 'object') return false;
  if (Number(data.hit_count) === 0) return true;
  for (const key of ['rows', 'chunks', 'documents', 'results', 'items', 'tasks', 'recipes']) {
    if (Array.isArray(data[key]) && data[key].length === 0) return true;
  }
  return false;
}

export function classifyToolObservation({ toolName, httpStatus, data, behaviour }) {
  const text = String(data?.error || data?.message || data?.reason || '').toLowerCase();
  let status = 'success';
  let reason_code = 'completed';
  let retryable = false;
  let progress = true;
  if (httpStatus === 202 || /approval required|awaiting approval/.test(text)) {
    status = 'awaiting_approval'; reason_code = 'approval_required'; progress = false;
  } else if (httpStatus === 402 || /quota|billing|payment required/.test(text)) {
    status = 'blocked_external'; reason_code = 'quota_exhausted'; progress = false;
  } else if (httpStatus === 404 && /table not found|unknown table/.test(text)) {
    status = 'wrong_source'; reason_code = 'table_not_found'; progress = false;
  } else if (httpStatus === 429 || httpStatus === 408 || httpStatus >= 500 || /timeout|temporar|fetch failed/.test(text)) {
    status = 'transient_error'; reason_code = httpStatus === 429 ? 'rate_limited' : 'provider_unavailable'; retryable = true; progress = false;
  } else if (httpStatus >= 400) {
    status = 'permanent_error'; reason_code = data?.code || 'request_rejected'; progress = false;
  } else if (hasEmptyPayload(data)) {
    status = 'empty'; reason_code = 'no_evidence'; progress = false;
  }
  const suggested = status === 'success' ? [] : behaviour.fallback_capabilities;
  if (status === 'wrong_source' && toolName === 'master_data_list_rows') {
    suggested.splice(0, suggested.length, 'master_data_list_documents', 'master_data_rag');
  }
  return { status, reason_code, progress, retryable, evidence: [], missing_outcomes: [], suggested_capabilities: suggested };
}

export function completeToolExecution(action, { httpStatus, data }) {
  const observation = classifyToolObservation({ toolName: action.behaviour.tool_name, httpStatus, data, behaviour: action.behaviour });
  getDb().prepare(
    `UPDATE tool_execution_actions SET observation_status = ?, reason_code = ?, progress = ?,
       response_summary = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(observation.status, observation.reason_code, observation.progress ? 1 : 0, json(redactForStorage(data), '{}')?.slice(0, 8000), action.id);
  return { ...observation, action_id: action.id, execution_key: action.execution_key, verification_mode: action.behaviour.verification_mode };
}
