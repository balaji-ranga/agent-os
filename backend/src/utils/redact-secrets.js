/**
 * Redact secrets from URLs / log lines so tokens, keys, and auth material
 * never land in access or console logs.
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
  'passwd',
  'passphrase',
  'encryption_phrase',
  'encryptionphrase',
  'client_secret',
  'client_secret_basic',
  'session',
  'session_token',
  'webhook_secret',
  'hook_secret',
  'bearer',
  'private_key',
  'privatekey',
  'kek',
  'otp',
  'mfa_code',
  'mfa_secret',
];

/** Header names that must never appear with real values in logs. */
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'x-session-token',
  'x-agent-os-internal',
  'cookie',
  'set-cookie',
  'x-workflow-hook-secret',
  'x-webhook-secret',
  'x-api-key',
  'x-api-token',
  'x-auth-token',
  'x-access-token',
  'x-openai-api-key',
  'x-tools-api-key',
]);

/** JSON / form field names whose values are secrets. */
const SENSITIVE_JSON_KEYS = [
  'password',
  'passwd',
  'passphrase',
  'encryption_phrase',
  'encryptionPhrase',
  'api_key',
  'apiKey',
  'api_token',
  'apiToken',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'client_secret',
  'clientSecret',
  'secret',
  'token',
  'authorization',
  'auth_header',
  'authHeader',
  'bearer',
  'private_key',
  'privateKey',
  'llm_api_key',
  'llmApiKey',
  'webhook_secret',
  'webhookSecret',
  'mfa_secret',
  'mfaSecret',
  'otp',
  'kek',
];

/** Path prefixes that must never log query strings or imply body contents. */
const SENSITIVE_PATH_PREFIXES = [
  '/api/user-api-keys',
  '/user-api-keys',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/mfa',
  '/auth/login',
  '/auth/register',
  '/auth/mfa',
  '/api/admin/users', // may include passwords on create
];

function isSensitiveQueryKey(key) {
  const k = String(key || '').trim().toLowerCase();
  if (!k) return false;
  if (SENSITIVE_QUERY_KEYS.includes(k)) return true;
  // Fuzzy: anything ending with _token, _secret, _key, _password, passphrase
  return /(?:^|_)(token|secret|password|passwd|passphrase|apikey|api_key|authorization)$/i.test(k);
}

function isSensitiveJsonKey(key) {
  const k = String(key || '').trim();
  if (!k) return false;
  if (SENSITIVE_JSON_KEYS.includes(k)) return true;
  const lower = k.toLowerCase();
  return /(?:password|passwd|passphrase|secret|token|apikey|api_key|authorization|bearer|private.?key)$/i.test(
    lower
  );
}

/** True when this request path carries secrets (API Keys vault, login, etc.). */
export function isSensitiveLogPath(urlOrPath) {
  const raw = String(urlOrPath || '').split('?')[0].toLowerCase();
  return SENSITIVE_PATH_PREFIXES.some((p) => raw === p || raw.startsWith(`${p}/`) || raw.startsWith(p));
}

/**
 * Path-only form for access logs on sensitive routes (no query, no body hint).
 * Example: POST /api/user-api-keys/:id → POST /api/user-api-keys/*
 */
export function sanitizeAccessLogPath(method, urlOrPath) {
  const raw = String(urlOrPath || '');
  const pathOnly = raw.split('?')[0] || '/';
  if (!isSensitiveLogPath(pathOnly)) {
    return redactSecretsInUrl(raw);
  }
  // Collapse resource ids; never keep query on sensitive routes
  let safe = pathOnly
    .replace(/\/user-api-keys\/[^/]+/gi, '/user-api-keys/*')
    .replace(/\/admin\/users\/[^/]+/gi, '/admin/users/*');
  return safe;
}

/** Redact sensitive query params in a URL or path+query string. */
export function redactSecretsInUrl(urlOrPath) {
  const raw = String(urlOrPath || '');
  if (!raw) return raw;
  if (isSensitiveLogPath(raw)) {
    return sanitizeAccessLogPath('GET', raw);
  }
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

/** Redact sensitive JSON field values in a stringified object. */
function redactJsonSecrets(s) {
  let out = s;
  for (const key of SENSITIVE_JSON_KEYS) {
    // "api_key": "value" | "apiKey":"value" | 'api_key': 'value'
    const re = new RegExp(
      `([\\"'\\\`]${key}[\\"'\\\`]\\s*:\\s*)([\\"'\\\`][^\\"'\\\`]*[\\"'\\\`]|[^,}\\]\\s]+)`,
      'gi'
    );
    out = out.replace(re, `$1"REDACTED"`);
  }
  // Generic: any key matching sensitive pattern
  out = out.replace(
    /(["'`][\w.-]*(?:password|passwd|passphrase|secret|token|apikey|api_key|authorization|bearer|private_?key)[\w.-]*["'`]\s*:\s*)(["'`][^"'`]*["'`]|[^,}\]\s]+)/gi,
    '$1"REDACTED"'
  );
  return out;
}

/** Redact common secret patterns in free-form log strings. */
export function redactSecretsInString(text) {
  let s = String(text || '');
  if (!s) return s;

  s = redactSecretsInUrl(s);
  s = redactJsonSecrets(s);

  // Authorization / Bearer (header-style and inline)
  s = s.replace(/(Authorization\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(Bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi, '$1REDACTED');
  s = s.replace(/(Proxy-Authorization\s*[:=]\s*)(\S+)/gi, '$1REDACTED');

  // Common auth / internal headers
  s = s.replace(/(x-session-token\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(x-agent-os-internal\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(x-api-key\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(x-workflow-hook-secret\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(x-webhook-secret\s*[:=]\s*)(\S+)/gi, '$1REDACTED');
  s = s.replace(/(Cookie\s*[:=]\s*)([^\n\r]+)/gi, '$1REDACTED');

  // Env-style assignments
  s = s.replace(
    /\b(TOOLS_API_KEY|AGENT_OS_INTERNAL_TOKEN|OPENCLAW_GATEWAY_TOKEN|OPENAI_API_KEY|OPENAI_PRIMARY_API_KEY|OPENAI_SECONDARY_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|REPLICATE_API_TOKEN|USER_API_KEYS_KEK|EMAIL_INBOUND_WEBHOOK_SECRET|AGENT_OS_ADMIN_PASSWORD|WORKFLOW_SMTP_PASS)\b(\s*[:=]\s*)(\S+)/gi,
    '$1$2REDACTED'
  );

  // Provider-looking key material (sk-..., sk-proj-..., sk-ant-..., ghp_/gho_, etc.)
  s = s.replace(/\b(sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_\-]{8,})\b/g, 'REDACTED_API_KEY');
  s = s.replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, 'REDACTED_TOKEN');
  s = s.replace(/\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, 'REDACTED_TOKEN');
  s = s.replace(/\b(AIza[0-9A-Za-z\-_]{20,})\b/g, 'REDACTED_API_KEY');

  return s;
}

/** Shallow-copy headers with sensitive values redacted (for debug dumps). */
export function redactSensitiveHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const lk = String(k).toLowerCase();
    if (
      SENSITIVE_HEADER_KEYS.has(lk) ||
      /(?:authorization|token|secret|api-?key|password|cookie)/i.test(lk)
    ) {
      out[k] = 'REDACTED';
    } else if (typeof v === 'string') {
      out[k] = redactSecretsInString(v);
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
    const raw = req.originalUrl || req.url || '';
    req.logUrl = isSensitiveLogPath(raw)
      ? sanitizeAccessLogPath(req.method, raw)
      : redactSecretsInUrl(raw);
    req.logSensitive = isSensitiveLogPath(raw);
  } catch {
    req.logUrl = req.path || '/';
    req.logSensitive = false;
  }
  next();
}
