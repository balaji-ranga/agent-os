import * as openclaw from '../gateway/openclaw.js';

export const DASHBOARD_CONTEXT_INSTRUCTION =
  'Dashboard chat context is exactly the messages supplied in this request. Treat the final user message as the current ask and highest priority. Do not call sessions_history and do not resume a prior tool task unless the final user message explicitly asks you to continue or check it.';

/**
 * Dashboard history is durable in SQLite and supplied on every call. Use a fresh
 * gateway session so OpenClaw cannot duplicate that history or resume stale tool state.
 */
export function dashboardGatewaySessionUser(agentId, ownerUserId, threadId, nonce = null) {
  const requestNonce = String(
    nonce || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  ).replace(/[^a-zA-Z0-9_.-]/g, '_');
  return openclaw.sessionUserFor(agentId, ownerUserId, `${threadId || 'main'}-${requestNonce}`);
}
