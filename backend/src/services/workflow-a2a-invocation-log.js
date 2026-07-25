/**
 * Durable audit log for A2A public endpoints (card, OAuth token, invoke)
 * including denials that never start a workflow run.
 */
import { getDb } from '../db/schema.js';

const SENSITIVE_KEYS = new Set([
  'client_secret',
  'clientSecret',
  'access_token',
  'accessToken',
  'authorization',
  'password',
  'token',
]);

function redactValue(key, value) {
  if (SENSITIVE_KEYS.has(String(key || ''))) return '[redacted]';
  if (Array.isArray(value)) return value.map((v, i) => redactValue(String(i), v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactValue(k, v);
    return out;
  }
  return value;
}

export function redactForA2ALog(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    try {
      return JSON.stringify(redactValue('', JSON.parse(value)));
    } catch {
      return value.slice(0, 4000);
    }
  }
  try {
    return JSON.stringify(redactValue('', value));
  } catch {
    return String(value).slice(0, 4000);
  }
}

/**
 * @param {object} entry
 * @returns {number|null} inserted id
 */
export function logA2AInvocation(entry = {}) {
  try {
    const db = getDb();
    const publishId = entry.publish_id ? String(entry.publish_id) : null;
    const endpoint = String(entry.endpoint || 'invoke').slice(0, 40);
    const outcome = String(entry.outcome || 'error').slice(0, 32);
    const info = db
      .prepare(
        `INSERT INTO workflow_a2a_invocation_logs (
          publish_id, owner_user_id, workflow_definition_id, agent_name,
          client_ip, endpoint, rpc_method, skill_id,
          outcome, reason_code, reason_message,
          auth_mode, access_policy, http_status, jsonrpc_code, jsonrpc_id,
          task_id, run_id, request_json, response_json, latency_ms,
          source, bypass_access
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )`
      )
      .run(
        publishId,
        entry.owner_user_id != null ? String(entry.owner_user_id) : null,
        entry.workflow_definition_id != null ? String(entry.workflow_definition_id) : null,
        entry.agent_name != null ? String(entry.agent_name).slice(0, 200) : null,
        entry.client_ip != null ? String(entry.client_ip).slice(0, 128) : null,
        endpoint,
        entry.rpc_method != null ? String(entry.rpc_method).slice(0, 80) : null,
        entry.skill_id != null ? String(entry.skill_id).slice(0, 120) : null,
        outcome,
        entry.reason_code != null ? String(entry.reason_code).slice(0, 80) : null,
        entry.reason_message != null ? String(entry.reason_message).slice(0, 1000) : null,
        entry.auth_mode != null ? String(entry.auth_mode).slice(0, 32) : null,
        entry.access_policy != null ? String(entry.access_policy).slice(0, 32) : null,
        entry.http_status != null ? Number(entry.http_status) : null,
        entry.jsonrpc_code != null ? Number(entry.jsonrpc_code) : null,
        entry.jsonrpc_id != null ? String(entry.jsonrpc_id).slice(0, 120) : null,
        entry.task_id != null ? String(entry.task_id) : null,
        entry.run_id != null ? Number(entry.run_id) : null,
        entry.request_json != null
          ? redactForA2ALog(entry.request_json)
          : entry.request != null
            ? redactForA2ALog(entry.request)
            : null,
        entry.response_json != null
          ? redactForA2ALog(entry.response_json)
          : entry.response != null
            ? redactForA2ALog(entry.response)
            : null,
        entry.latency_ms != null ? Math.max(0, Number(entry.latency_ms) || 0) : null,
        entry.source != null ? String(entry.source).slice(0, 40) : 'public',
        entry.bypass_access ? 1 : 0
      );
    return Number(info.lastInsertRowid) || null;
  } catch (e) {
    console.warn('[a2a-invocation-log] insert failed', e?.message || e);
    return null;
  }
}

/**
 * Snapshot publication fields for logging (works with raw row or sanitized).
 */
export function publicationLogContext(pub) {
  if (!pub) return {};
  return {
    publish_id: pub.id || null,
    owner_user_id: pub.owner_user_id || null,
    workflow_definition_id: pub.workflow_definition_id || null,
    agent_name: pub.name || null,
    auth_mode: pub.auth_mode || (pub.has_auth ? 'secured' : 'public') || null,
    access_policy: pub.access_policy || 'deny_all',
  };
}

export function outcomeFromHttp(httpStatus, { jsonrpcCode = null, runFailed = false } = {}) {
  if (runFailed) return 'failed';
  if (httpStatus === 403 || jsonrpcCode === -32005) return 'denied';
  if (httpStatus === 401 || jsonrpcCode === -32003) return 'denied';
  if (httpStatus >= 200 && httpStatus < 300) return 'success';
  return 'error';
}

export function listA2AInvocations({
  publishId = '',
  ownerUserId = '',
  outcome = '',
  endpoint = '',
  clientIp = '',
  source = '',
  q = '',
  limit = 50,
  offset = 0,
} = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (publishId) {
    where.push('publish_id = ?');
    params.push(String(publishId));
  }
  if (ownerUserId) {
    where.push('owner_user_id = ?');
    params.push(String(ownerUserId));
  }
  if (outcome) {
    where.push('outcome = ?');
    params.push(String(outcome));
  }
  if (endpoint) {
    where.push('endpoint = ?');
    params.push(String(endpoint));
  }
  if (clientIp) {
    where.push('client_ip LIKE ?');
    params.push(`%${String(clientIp)}%`);
  }
  if (source) {
    where.push('source = ?');
    params.push(String(source));
  }
  if (q) {
    where.push(
      `(COALESCE(agent_name,'') LIKE ? OR COALESCE(reason_message,'') LIKE ? OR COALESCE(skill_id,'') LIKE ? OR COALESCE(publish_id,'') LIKE ?)`
    );
    const like = `%${String(q)}%`;
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM workflow_a2a_invocation_logs ${whereSql}`).get(...params)?.c || 0;
  const logs = db
    .prepare(
      `SELECT * FROM workflow_a2a_invocation_logs ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, lim, off);

  const summary = db
    .prepare(
      `SELECT outcome, COUNT(*) AS c FROM workflow_a2a_invocation_logs ${whereSql}
       GROUP BY outcome`
    )
    .all(...params)
    .reduce((acc, row) => {
      acc[row.outcome] = row.c;
      return acc;
    }, {});

  return { logs, total, limit: lim, offset: off, summary };
}
