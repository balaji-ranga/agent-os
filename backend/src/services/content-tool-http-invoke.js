/**
 * HTTP invoke for content-tools meta rows (workflow tool nodes).
 * GET/HEAD never attach a body (Node undici rejects that); payload becomes query params.
 */
import { getToolMeta } from './content-tools-meta.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { internalAuthHeaders } from '../middleware/internal-auth.js';
import { withBoundedRetry } from './tool-failure-class.js';
import { getExecutionBehaviour } from './tool-execution-governor.js';

function backendBaseUrl() {
  // Prefer internal loopback so container self-dispatch does not hairpin public HTTPS (502).
  const internal =
    process.env.TOOLS_BASE_URL ||
    process.env.AGENT_OS_INTERNAL_URL ||
    process.env.BACKEND_INTERNAL_URL ||
    '';
  if (String(internal).trim()) return String(internal).replace(/\/$/, '');
  return getPublicBaseUrl() || `http://127.0.0.1:${process.env.PORT || 3001}`;
}

function appendQueryParams(targetUrl, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return targetUrl;
  const u = new URL(targetUrl);
  for (const [key, value] of Object.entries(payload)) {
    if (value == null) continue;
    if (typeof value === 'object') {
      u.searchParams.set(key, JSON.stringify(value));
    } else {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

/**
 * @param {string} toolName
 * @param {object|null|undefined} body
 * @param {string|null} [ownerUserId]
 * @param {{ timeoutMs?: number, agentId?: string|null, openclawAgentId?: string|null, callerAgentId?: string|null, goalId?: string|null, workflowId?: string|null }} [opts]
 * Platform self-invokes (goal plans, workflow tool nodes) should pass the orchestrating agent's id so
 * COO/WB-gated tools (getCallerAgent) work the same as chat-session tool calls.
 */
export async function invokeContentToolHttp(toolName, body, ownerUserId = null, opts = {}) {
  const row = getToolMeta(toolName);
  if (!row) throw new Error(`Tool not found: ${toolName}`);
  if (!row.enabled) throw new Error(`Tool disabled: ${toolName}`);

  const method = String(row.method || 'POST').toUpperCase();
  let targetUrl = row.endpoint;
  if (targetUrl.startsWith('/')) targetUrl = backendBaseUrl() + targetUrl;

  const headers = { ...internalAuthHeaders() };
  if (ownerUserId) headers['x-ceo-user-id'] = String(ownerUserId);

  const agentId = String(opts.agentId || opts.callerAgentId || '').trim();
  const openclawAgentId = String(opts.openclawAgentId || agentId || '').trim();
  if (agentId) headers['x-agent-id'] = agentId;
  if (openclawAgentId) headers['x-openclaw-agent-id'] = openclawAgentId;
  if (opts.goalId) headers['x-flolah-goal-id'] = String(opts.goalId);
  if (opts.workflowId) headers['x-flolah-workflow-id'] = String(opts.workflowId);

  const payload = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const isGetLike = method === 'GET' || method === 'HEAD';
  if (isGetLike) {
    targetUrl = appendQueryParams(targetUrl, payload);
  } else {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : Math.max(120000, getExecutionBehaviour(ownerUserId, toolName).timeout_ms + 15000);
  const runOnce = async () => {
    const response = await fetch(targetUrl, {
      method,
      headers,
      body: isGetLike ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `Tool ${toolName} failed (${response.status})`);
      err.status = response.status;
      err.details = data;
      err.policyDenied = data.failure_class === 'policy_denial';
      err.needsApproval = data.needs_approval === true;
      throw err;
    }
    return data;
  };
  // GET/HEAD only — mutating tools stay single-shot (idempotency wraps CRM creates).
  if (isGetLike) {
    const wrapped = await withBoundedRetry(runOnce, { ownerUserId, toolName, backoffMs: 50 });
    return wrapped.result;
  }
  return runOnce();
}
