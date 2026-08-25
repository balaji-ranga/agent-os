import * as openclaw from '../gateway/openclaw.js';

export const DASHBOARD_CONTEXT_INSTRUCTION =
  'Dashboard chat context is exactly the messages supplied in this request. Treat the final user message as the current ask and highest priority. Do not call sessions_history and do not resume a prior tool task unless the final user message explicitly asks you to continue or check it.';

const GREETING_RE = /^\s*(?:(?:hi|hello|hey)(?:\s+(?:there|again|coo|team|good\s+(?:morning|afternoon|evening)))?|good\s+(?:morning|afternoon|evening)|greetings)[\s!.?,]*$/i;
const CONTEXT_CORRECTION_RE = /\b(?:wrong|irrelevant|stale|old)\s+context\b|\b(?:you(?:'re| are)?\s+)?(?:picked?|using|used|responding (?:with|to))\s+(?:the\s+)?wrong\b|\bdo not (?:continue|resume|use)\b/i;
const REFERENTIAL_RE = /\b(?:this|that|these|those|it|above|previous|earlier|same|latter|former|continue|retry|rerun|proceed|revise|shorten|expand|update|change|also|additionally)\b/i;
const SHORT_CONTINUATION_RE = /^\s*(?:yes|no|ok(?:ay)?|done|proceed|continue|retry|rerun|do it|go ahead|please do)[\s!.?,]*$/i;
const REFERENTIAL_QUESTION_RE = /^\s*(?:what|how|why|where|when|who)\s+(?:is|are|was|were|about|did|does|do)\s+(?:the|this|that|it)\b/i;

export function isDashboardGreeting(message) {
  return GREETING_RE.test(String(message || ''));
}

export function dashboardAskNeedsPriorContext(message) {
  const text = String(message || '').trim();
  if (!text || isDashboardGreeting(text) || CONTEXT_CORRECTION_RE.test(text)) return false;
  return (
    SHORT_CONTINUATION_RE.test(text) ||
    REFERENTIAL_RE.test(text) ||
    REFERENTIAL_QUESTION_RE.test(text)
  );
}

/**
 * A self-contained Dashboard ask is a new context boundary. Only an explicitly
 * referential follow-up receives recent turns. This prevents an unfinished tool
 * result from becoming the answer to a greeting or an unrelated new request.
 */
export function selectDashboardHistoryForAsk(history = [], message = '', { limit = 6 } = {}) {
  if (!dashboardAskNeedsPriorContext(message)) return [];
  const clean = (Array.isArray(history) ? history : []).filter((turn) => {
    const content = String(turn?.content || '').trim();
    return content && !/^no response from (?:openclaw|agentsystem)\.?$/i.test(content);
  });
  return clean.slice(-Math.max(2, Number(limit) || 6));
}

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
