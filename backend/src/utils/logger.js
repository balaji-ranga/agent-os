/**
 * Platform logger — gated by PLATFORM_LOG_LEVEL=off|error|info (default: info).
 *
 * Levels (ascending verbosity):
 *   off   — no platform logs
 *   error — errors only (5xx access lines + log.error)
 *   info  — all API access lines + info + errors
 *
 * Never logs Authorization headers, request/response bodies, or secret query/body fields.
 * Sensitive routes (API Keys vault, auth login/register) log path-only with ids collapsed.
 */
import {
  redactSecretsInString,
  sanitizeAccessLogPath,
  isSensitiveLogPath,
} from './redact-secrets.js';

const LEVELS = { off: 0, error: 1, info: 2 };

function parseLevel(raw) {
  const s = String(raw ?? 'info').trim().toLowerCase();
  if (s === 'off' || s === '0' || s === 'none' || s === 'silent') return 'off';
  if (s === 'error' || s === 'err') return 'error';
  if (s === 'info' || s === 'all' || s === 'debug' || s === 'verbose') return 'info';
  return 'info';
}

let currentLevel = parseLevel(process.env.PLATFORM_LOG_LEVEL);

export function getPlatformLogLevel() {
  return currentLevel;
}

/** Re-read env (tests / runtime toggle). */
export function refreshPlatformLogLevel() {
  currentLevel = parseLevel(process.env.PLATFORM_LOG_LEVEL);
  return currentLevel;
}

function levelEnabled(min) {
  return (LEVELS[currentLevel] ?? 0) >= (LEVELS[min] ?? 0);
}

function ts() {
  return new Date().toISOString();
}

function safeMsg(parts) {
  return parts
    .map((p) => {
      if (p == null) return '';
      if (typeof p === 'string') return redactSecretsInString(p);
      if (p instanceof Error) return redactSecretsInString(p.stack || p.message || String(p));
      try {
        return redactSecretsInString(JSON.stringify(p));
      } catch {
        return redactSecretsInString(String(p));
      }
    })
    .filter(Boolean)
    .join(' ');
}

export const log = {
  info(...args) {
    if (!levelEnabled('info')) return;
    console.log(`[${ts()}] [info] ${safeMsg(args)}`);
  },
  error(...args) {
    if (!levelEnabled('error')) return;
    console.error(`[${ts()}] [error] ${safeMsg(args)}`);
  },
  warn(...args) {
    if (!levelEnabled('error')) return;
    console.warn(`[${ts()}] [warn] ${safeMsg(args)}`);
  },
};

const SKIP_PATH_PREFIXES = ['/health'];

function shouldSkipAccessLog(req) {
  const path = String(req.path || req.url || '').split('?')[0];
  return SKIP_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Express middleware: log every API request/response when PLATFORM_LOG_LEVEL allows.
 * Mount after attachRedactedRequestUrl (and optionally after auth for user id).
 *
 * Intentionally does NOT log:
 * - Authorization / cookie / API-key headers
 * - Request or response bodies (API Keys vault, passwords, etc.)
 */
export function platformApiAccessLogger(req, res, next) {
  if (currentLevel === 'off') return next();
  if (shouldSkipAccessLog(req)) return next();

  const started = Date.now();
  res.on('finish', () => {
    const status = res.statusCode || 0;
    const isError = status >= 500;
    if (currentLevel === 'error' && !isError) return;
    if (currentLevel === 'off') return;

    const ms = Date.now() - started;
    const method = req.method || '?';
    const rawUrl = req.originalUrl || req.url || req.path || '?';
    const url =
      req.logUrl ||
      (isSensitiveLogPath(rawUrl)
        ? sanitizeAccessLogPath(method, rawUrl)
        : sanitizeAccessLogPath(method, rawUrl));
    const user = req.authUser?.id || '-';
    const sensitiveTag = req.logSensitive || isSensitiveLogPath(rawUrl) ? ' sensitive=1' : '';
    const line = `${method} ${url} ${status} ${ms}ms user=${user}${sensitiveTag}`;

    if (isError) log.error('[api]', line);
    else log.info('[api]', line);
  });

  next();
}
