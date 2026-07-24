/**
 * Redact secrets from desktop workflow logs.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'passphrase',
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
  'desktop_token',
  'authorization',
  'bearer',
  'private_key',
  'privateKey',
  'webhook_secret',
  'llm_api_key',
]);

export function redactValue(key, value) {
  const k = String(key || '').toLowerCase().replace(/-/g, '_');
  if ([...SENSITIVE_KEYS].some((s) => k.includes(s.toLowerCase()))) {
    return '[REDACTED]';
  }
  if (typeof value === 'string' && /^dsk_[A-Za-z0-9_-]+$/.test(value.trim())) {
    return `${value.slice(0, 8)}…[REDACTED]`;
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
    s = s.replace(/dsk_[A-Za-z0-9_-]{20,}/g, (m) => `${m.slice(0, 8)}…[REDACTED]`);
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

export function safeJson(value) {
  try {
    return JSON.stringify(redactDeep(value), null, 2);
  } catch {
    return String(value);
  }
}
