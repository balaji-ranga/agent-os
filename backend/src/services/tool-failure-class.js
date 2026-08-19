/**
 * Shared failure taxonomy for tool/workflow invoke.
 * Generic — not vendor-specific beyond HTTP/status heuristics.
 */

export const FAILURE_CLASSES = Object.freeze([
  'transient',
  'auth',
  'rate_limit',
  'schema',
  'policy_denial',
  'model_uncertainty',
  'downstream_rejection',
]);

const FALLBACK_BY_CLASS = Object.freeze({
  rate_limit: 'browse_task_start',
  transient: null,
  auth: null,
  schema: null,
  policy_denial: null,
  model_uncertainty: null,
  downstream_rejection: null,
});

export function classifyToolFailure(err, extra = {}) {
  const status = Number(extra.status || err?.status || err?.statusCode || 0);
  const msg = String(err?.message || extra.message || err || '').toLowerCase();
  const code = String(extra.code || err?.code || '').toLowerCase();

  if (status === 401 || status === 403 || /unauthorized|forbidden|invalid api key|auth/.test(msg)) {
    return pack('auth', status, extra);
  }
  if (
    status === 429 ||
    /rate.?limit|too many requests|quota|resource exhausted/.test(msg) ||
    code === 'rate_limited'
  ) {
    return pack('rate_limit', status || 429, extra);
  }
  if (status === 400 || /schema|required|invalid json|validation/.test(msg)) {
    return pack('schema', status || 400, extra);
  }
  if (/policy|prohibited|approval required|not allowed/.test(msg) || extra.policyDenied) {
    return pack('policy_denial', status || 403, extra);
  }
  if (/uncertain|low confidence|unverifiable|unknown contact/.test(msg)) {
    return pack('model_uncertainty', status || 422, extra);
  }
  if (status >= 500 || /econnreset|etimedout|enotfound|fetch failed|socket/.test(msg)) {
    return pack('transient', status || 503, extra);
  }
  if (status >= 400) {
    return pack('downstream_rejection', status, extra);
  }
  return pack('transient', status || 0, extra);
}

function pack(failure_class, status, extra) {
  return {
    failure_class,
    http_status: status || null,
    retryable: failure_class === 'transient' || failure_class === 'rate_limit',
    fallback_tool: FALLBACK_BY_CLASS[failure_class] || null,
    bounded_retries: failure_class === 'rate_limit' ? 2 : failure_class === 'transient' ? 3 : 0,
    message: extra.message || null,
  };
}
