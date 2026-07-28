/**
 * Redact secrets from bridge logs (aligned with desktop-workflow-runner).
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'api_key',
  'apikey',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'secret',
  'token',
  'authorization',
  'bearer',
  'webhook_secret',
  'local_bridge_token',
]);

export function redactValue(key, value) {
  const k = String(key || '').toLowerCase().replace(/-/g, '_');
  if ([...SENSITIVE_KEYS].some((s) => k.includes(s.toLowerCase()))) {
    return '[REDACTED]';
  }
  if (typeof value === 'string' && /Bearer\s+\S+/i.test(value)) {
    return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
  }
  return value;
}

export function redactDeep(input, depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (input == null) return input;
  if (typeof input === 'string') {
    let s = input;
    s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]');
    s = s.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, '$1=[REDACTED]');
    return s;
  }
  if (Array.isArray(input)) return input.map((v) => redactDeep(v, depth + 1));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = redactValue(k, redactDeep(v, depth + 1));
    }
    return out;
  }
  return input;
}

export function logInfo(msg, meta) {
  if (meta !== undefined) {
    console.log(`[bridge] ${msg}`, redactDeep(meta));
  } else {
    console.log(`[bridge] ${msg}`);
  }
}

export function logWarn(msg, meta) {
  if (meta !== undefined) {
    console.warn(`[bridge] ${msg}`, redactDeep(meta));
  } else {
    console.warn(`[bridge] ${msg}`);
  }
}

export function logError(msg, meta) {
  if (meta !== undefined) {
    console.error(`[bridge] ${msg}`, redactDeep(meta));
  } else {
    console.error(`[bridge] ${msg}`);
  }
}
