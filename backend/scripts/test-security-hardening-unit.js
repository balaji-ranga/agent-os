/**
 * Unit checks for secret redaction + internal query-token allowlist.
 * Run: node backend/scripts/test-security-hardening-unit.js
 */
import assert from 'assert';
import {
  redactSecretsInUrl,
  redactSecretsInString,
  redactSensitiveHeaders,
  isSensitiveLogPath,
  sanitizeAccessLogPath,
} from '../src/utils/redact-secrets.js';
import {
  allowsInternalQueryToken,
  extractInternalToken,
} from '../src/middleware/internal-auth.js';

process.env.AGENT_OS_INTERNAL_TOKEN = process.env.AGENT_OS_INTERNAL_TOKEN || 'unit-test-internal-token-xyz';

assert.equal(
  redactSecretsInUrl('/api/standups/cron-callback?standup_id=1&internal_token=sekrit&agent_id=coo'),
  '/api/standups/cron-callback?standup_id=1&internal_token=REDACTED&agent_id=coo'
);
assert.equal(
  redactSecretsInUrl('/api/hooks?secret=abc&x=1'),
  '/api/hooks?secret=REDACTED&x=1'
);
assert.match(redactSecretsInString('Authorization: Bearer super-secret-token'), /REDACTED/);
assert.match(redactSecretsInString('Bearer sk-proj-ABCDEFGHIJKLMNOP'), /REDACTED/);
assert.match(
  redactSecretsInString(JSON.stringify({ api_key: 'sk-live-secret-value', name: 'openai' })),
  /"api_key"\s*:\s*"REDACTED"/i
);
assert.match(
  redactSecretsInString('{"encryption_phrase":"hunter2","key_name":"openai"}'),
  /"encryption_phrase"\s*:\s*"REDACTED"/i
);
assert.doesNotMatch(
  redactSecretsInString('{"encryption_phrase":"hunter2","key_name":"openai"}'),
  /hunter2/
);
assert.match(redactSecretsInString('OPENAI_API_KEY=sk-abc123456789'), /REDACTED/);
assert.match(redactSecretsInString('TOOLS_API_KEY=plain-secret-here'), /REDACTED/);

const hdrs = redactSensitiveHeaders({
  authorization: 'Bearer sekrit',
  'x-session-token': 'sess',
  'content-type': 'application/json',
});
assert.equal(hdrs.authorization, 'REDACTED');
assert.equal(hdrs['x-session-token'], 'REDACTED');
assert.equal(hdrs['content-type'], 'application/json');

assert.equal(isSensitiveLogPath('/api/user-api-keys'), true);
assert.equal(isSensitiveLogPath('/api/user-api-keys/abc/dependencies'), true);
assert.equal(isSensitiveLogPath('/api/auth/login'), true);
assert.equal(isSensitiveLogPath('/api/agents'), false);
assert.equal(
  sanitizeAccessLogPath('POST', '/api/user-api-keys/uuid-1?force=1'),
  '/api/user-api-keys/*'
);
assert.equal(
  redactSecretsInUrl('/api/user-api-keys?api_key=should-never-appear'),
  '/api/user-api-keys'
);
assert.doesNotMatch(
  redactSecretsInUrl('/api/user-api-keys?api_key=should-never-appear'),
  /should-never-appear/
);

const cronReq = {
  originalUrl: '/api/standups/cron-callback?internal_token=unit-test-internal-token-xyz',
  query: { internal_token: 'unit-test-internal-token-xyz' },
  headers: {},
};
assert.equal(allowsInternalQueryToken(cronReq), true);
assert.equal(extractInternalToken(cronReq), 'unit-test-internal-token-xyz');

const ibkrReq = {
  originalUrl: '/api/ibkr-trading/config?internal_token=unit-test-internal-token-xyz',
  query: { internal_token: 'unit-test-internal-token-xyz' },
  headers: {},
};
assert.equal(allowsInternalQueryToken(ibkrReq), false);
assert.equal(extractInternalToken(ibkrReq), null);

const headerReq = {
  originalUrl: '/api/ibkr-trading/config',
  query: {},
  headers: { 'x-agent-os-internal': 'unit-test-internal-token-xyz' },
};
assert.equal(extractInternalToken(headerReq), 'unit-test-internal-token-xyz');

console.log('OK security hardening unit checks');
