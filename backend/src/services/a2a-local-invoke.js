/**
 * Loopback A2A invocation.
 *
 * A CEO can register one of their own published A2A workflows as an External Agent (the endpoint
 * URL points back at this backend, e.g. http://127.0.0.1:3001/api/a2a/<publishId>). Calling that
 * over HTTP goes through the *public* door, so a private / deny_all / IP-whitelisted publication
 * answers 403 even when the caller is the COO delegating inside the org.
 *
 * When the endpoint resolves to a publication owned by the same CEO **and** the public door would
 * refuse the loopback call, trusted server-side callers invoke the publication in-process instead
 * (same trust model the org path already uses for `a2a_publish` org members). Publications that are
 * publicly reachable keep using the existing HTTP path untouched.
 */
import { randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { checkA2AClientIp, normalizeA2AVisibility } from './workflow-a2a-access.js';

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '0.0.0.0', '::1', 'localhost', 'backend']);
const LOOPBACK_IP = '127.0.0.1';
const A2A_PATH_RE = /\/api\/a2a\/([^/?#]+)/i;

function baseUrl() {
  return getPublicBaseUrl() || `http://127.0.0.1:${process.env.PORT || 3001}`;
}

/** True when the URL targets this backend (same host as the public base URL, or loopback). */
export function isLocalBackendUrl(url) {
  try {
    const base = baseUrl();
    const u = new URL(String(url || ''), base);
    const b = new URL(base);
    if (u.host === b.host) return true;
    return LOOPBACK_HOSTNAMES.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** publishId of a local `/api/a2a/<publishId>` endpoint, else null. */
export function parseLocalA2APublishId(url) {
  if (!isLocalBackendUrl(url)) return null;
  try {
    const u = new URL(String(url || ''), baseUrl());
    const match = A2A_PATH_RE.exec(u.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Published publication behind a local endpoint URL, restricted to the given owner. */
export function findLocalA2APublication(url, ownerUserId) {
  const publishId = parseLocalA2APublishId(url);
  if (!publishId || !ownerUserId) return null;
  try {
    const row = getDb()
      .prepare(`SELECT * FROM workflow_a2a_publications WHERE id = ? AND status = 'published'`)
      .get(publishId);
    if (!row) return null;
    // Cross-tenant endpoints stay on the public path — privacy is the other CEO's to enforce.
    if (String(row.owner_user_id) !== String(ownerUserId)) return null;
    return row;
  } catch (e) {
    console.warn('[a2a-local] publication lookup failed', publishId, e?.message || e);
    return null;
  }
}

/**
 * Decide whether a trusted caller should skip the public HTTP hop.
 *
 * @returns {{ publication: object, publish_id: string, visibility: string, policy: string, reason: string }|null}
 *          null when there is no local publication or the public endpoint would accept the call.
 */
export function resolveLocalA2ABypass(url, ownerUserId) {
  const publication = findLocalA2APublication(url, ownerUserId);
  if (!publication) return null;
  const access = checkA2AClientIp(publication, LOOPBACK_IP);
  if (access.ok) return null;
  return {
    publication,
    publish_id: publication.id,
    visibility: normalizeA2AVisibility(publication.visibility),
    policy: access.policy,
    reason: access.reason || 'public access denied',
  };
}

function partsToText(parts) {
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) => p?.text || '')
    .join('\n')
    .trim();
}

const A2A_FAILED_STATES = new Set(['failed', 'rejected', 'canceled', 'cancelled', 'unknown']);
const A2A_PENDING_STATES = new Set(['working', 'submitted', 'input-required', 'input_required', 'queued']);

/**
 * Pull the reply out of an A2A JSON-RPC result. Our own publications answer with the
 * `kind: 'message'` shape (`result.parts`); third-party agents commonly answer with the
 * `kind: 'task'` shape (`result.status.message.parts`) or artifacts.
 */
export function extractA2AReply(body) {
  const result = body?.result;
  if (body?.error) {
    return { ok: false, text: `Error: ${body.error.message || body.error.code}` };
  }
  const text =
    partsToText(result?.parts) ||
    partsToText(result?.status?.message?.parts) ||
    partsToText(result?.artifacts?.flatMap((a) => a?.parts || [])) ||
    (typeof result?.text === 'string' ? result.text.trim() : '');
  const state = String(result?.task?.status?.state || result?.status?.state || '').toLowerCase();
  const taskId = result?.task?.id || result?.id || result?.metadata?.taskId || null;
  const runId =
    result?.metadata?.runId ??
    result?.metadata?.run_id ??
    result?.task?.metadata?.runId ??
    null;
  if (state && A2A_FAILED_STATES.has(state)) {
    return {
      ok: false,
      pending: false,
      text: text || `A2A task ended in state "${state}"`,
      state,
      taskId,
      runId,
    };
  }
  if (state && A2A_PENDING_STATES.has(state)) {
    return {
      ok: true,
      pending: true,
      text: text || `A2A task accepted (state "${state}")`,
      state,
      taskId,
      runId,
    };
  }
  return { ok: true, pending: false, text, state: state || 'completed', taskId, runId };
}

/**
 * Invoke a publication of this platform in-process, skipping public IP / OAuth / visibility gates.
 * Callers MUST have authorised the request themselves (org ACL, or the publication owner).
 */
export async function invokeLocalA2APublication(publishId, message, { skillId, contextId } = {}) {
  const rpc = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        messageId: randomUUID(),
        parts: [{ kind: 'text', text: String(message ?? '') }],
        ...(contextId ? { contextId } : {}),
      },
      metadata: skillId ? { skillId } : {},
    },
  };
  // Imported lazily: the publish service pulls in the workflow runner, which reaches back here
  // through the External Agent node.
  const { handleA2AJsonRpc } = await import('./workflow-a2a-publish.js');
  const result = await handleA2AJsonRpc(publishId, rpc, {
    authHeader: null,
    clientIp: LOOPBACK_IP,
    bypassAccessChecks: true,
  });
  const body = result?.body ?? result;
  return { reply: extractA2AReply(body), body };
}
