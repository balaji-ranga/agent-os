/**
 * Shared failure taxonomy for tool/workflow invoke.
 * Generic — not vendor-specific beyond HTTP/status heuristics.
 */

export const FAILURE_CLASSES = Object.freeze([
  'transient',
  'auth',
  'quota_exhausted',
  'rate_limit',
  'schema',
  'policy_denial',
  'model_uncertainty',
  'downstream_rejection',
]);

const FALLBACK_BY_CLASS = Object.freeze({
  quota_exhausted: null,
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

  // Typed execution failures take precedence over human-readable prose.
  if (['evidence_incomplete', 'executor_offline', 'executor_unavailable', 'action_timeout', 'fetch_failed'].includes(code)) {
    return pack('transient', status || 503, extra);
  }
  if (['invalid_input', 'schema_validation', 'invalid_schema'].includes(code)) {
    return pack('schema', status || 400, extra);
  }

  // A paid-plan/usage ceiling cannot recover by retrying. Keep this before the
  // broad quota/rate-limit matcher so HTTP 402 never burns an exception retry.
  if (
    status === 402 ||
    /payment required|usage limit exceeded|monthly (spend|usage) limit|billing limit|current_spend|insufficient (credit|funds)/.test(msg) ||
    code === 'insufficient_quota'
  ) {
    return pack('quota_exhausted', status || 402, extra);
  }
  if (/policy|prohibited|approval required|approval grant|not allowed/.test(msg) || extra.policyDenied) {
    return pack('policy_denial', status || 403, extra);
  }
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
  if (status === 400 || /schema validation|invalid schema|invalid json|validation failed/.test(msg)) {
    return pack('schema', status || 400, extra);
  }
  if (/uncertain|low confidence|unverifiable|unknown contact|needs? (?:ceo )?clarification|missing required input/.test(msg)) {
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

const _circuits = new Map();

function circuitKey(ownerUserId, toolName) {
  return `${String(ownerUserId || 'anon')}:${String(toolName || '*')}`;
}

export function resetToolCircuits() {
  _circuits.clear();
}

function circuitState(ownerUserId, toolName) {
  const key = circuitKey(ownerUserId, toolName);
  const row = _circuits.get(key) || { fails: 0, openUntil: 0 };
  if (row.openUntil && Date.now() > row.openUntil) {
    row.fails = 0;
    row.openUntil = 0;
    _circuits.set(key, row);
  }
  return { key, row };
}

/**
 * Bounded retry with exponential backoff. Writes should still go through idempotency.
 * Circuit opens after 5 consecutive failures for 30s (per owner+tool).
 */
export async function withBoundedRetry(execute, opts = {}) {
  const ownerUserId = opts.ownerUserId || null;
  const toolName = opts.toolName || null;
  const sleep = typeof opts.sleep === 'function' ? opts.sleep : (ms) => new Promise((r) => setTimeout(r, ms));
  const { key, row } = circuitState(ownerUserId, toolName);
  if (row.openUntil && Date.now() < row.openUntil) {
    const err = new Error('circuit_open');
    err.failure_class = 'transient';
    err.retryable = false;
    throw err;
  }

  let lastClass = null;
  let attempt = 0;
  for (;;) {
    try {
      const out = await execute(attempt);
      row.fails = 0;
      row.openUntil = 0;
      _circuits.set(key, row);
      return { result: out, attempts: attempt + 1, recovered: attempt > 0, failure_class: lastClass };
    } catch (e) {
      lastClass = classifyToolFailure(e, { status: e?.status, message: e?.message, policyDenied: e?.policyDenied });
      const max = Number(opts.maxRetries != null ? opts.maxRetries : lastClass.bounded_retries);
      if (!lastClass.retryable || attempt >= max) {
        row.fails += 1;
        if (row.fails >= 5) row.openUntil = Date.now() + 30000;
        _circuits.set(key, row);
        e.classified = lastClass;
        e.attempts = attempt + 1;
        throw e;
      }
      const backoff = Math.min(4000, 200 * 2 ** attempt);
      await sleep(opts.backoffMs != null ? opts.backoffMs : backoff);
      attempt += 1;
    }
  }
}
