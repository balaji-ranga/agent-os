/**
 * Unit checks for secret redaction + internal query-token allowlist.
 * Run: node backend/scripts/test-security-hardening-unit.js
 */
import assert from 'assert';
import { redactSecretsInUrl, redactSecretsInString } from '../src/utils/redact-secrets.js';
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
