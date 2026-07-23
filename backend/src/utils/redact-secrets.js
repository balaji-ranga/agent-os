/**
 * Redact secrets from URLs / log lines so tokens never land in access or console logs.
 */
const SENSITIVE_QUERY_KEYS = [
  'internal_token',
  'token',
  'secret',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'authorization',
  'password',
  'client_secret',
];

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'x-session-token',
  'x-agent-os-internal',
  'cookie',
  'x-workflow-hook-secret',
  'x-webhook-secret',
]);

function isSensitiveQueryKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return SENSITIVE_QUERY_KEYS.includes(k);
}

/** Redact sensitive query params in a URL or path+query string. */
export function redactSecretsInUrl(urlOrPath) {
  const raw = String(urlOrPath || '');
  if (!raw) return raw;
  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return raw;
  const path = raw.slice(0, qIdx);
  const qs = raw.slice(qIdx + 1);
  if (!qs) return path;
  const parts = qs.split('&').map((pair) => {
    if (!pair) return pair;
    const eq = pair.indexOf('=');
    const key = eq >= 0 ? pair.slice(0, eq) : pair;
    const decodedKey = (() => {
      try {
        return decodeURIComponent(key.replace(/\+/g, ' '));
      } catch {
        return key;
      }
    })();
    if (isSensitiveQueryKey(decodedKey) || isSensitiveQueryKey(key)) {
      return `${key}=REDACTED`;
    }
    return pair;
  });
  return `${path}?${parts.join('&')}`;
}

/** Redact common secret patterns in free-form log strings. */
export function redactSecretsInString(text) {
  let s = String(text || '');
  if (!s) return s;
  s = redactSecretsInUrl(s);
  s = s.replace(
    /(Authorization:\s*Bearer\s+)(\S+)/gi,
    '$1REDACTED'
  );
  s = s.replace(
    /(x-agent-os-internal[=:\s]+)(\S+)/gi,
    '$1REDACTED'
  );
  s = s.replace(
    /(TOOLS_API_KEY[=:\s]+)(\S+)/gi,
    '$1REDACTED'
  );
  s = s.replace(
    /(AGENT_OS_INTERNAL_TOKEN[=:\s]+)(\S+)/gi,
    '$1REDACTED'
  );
  return s;
}

/** Shallow-copy headers with sensitive values redacted (for debug dumps). */
export function redactSensitiveHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (SENSITIVE_HEADER_KEYS.has(String(k).toLowerCase())) {
      out[k] = 'REDACTED';
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Express middleware: attach req.logUrl (redacted) and avoid leaking secrets in
 * default error messages that echo the URL.
 */
export function attachRedactedRequestUrl(req, _res, next) {
  try {
    req.logUrl = redactSecretsInUrl(req.originalUrl || req.url || '');
  } catch {
    req.logUrl = req.path || '/';
  }
  next();
}
