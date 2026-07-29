/**
 * Unit checks for browser-url-policy matching (no DB).
 */
import {
  evaluateUrlPolicy,
  urlMatchesPattern,
} from '../src/services/browser-url-policy.js';

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log('ok:', msg);
}

assert(
  urlMatchesPattern('*.cheapflights.com', 'https://www.cheapflights.com/x'),
  '*.cheapflights.com matches https://www.cheapflights.com/x'
);

assert(
  evaluateUrlPolicy(
    { allowlist: ['*.cheapflights.com'], denylist: ['*.cheapflights.com'] },
    'https://www.cheapflights.com/flights'
  ).ok === false,
  'deny wins over allow'
);

assert(
  evaluateUrlPolicy(
    { allowlist: ['example.com'], denylist: [] },
    'https://other.com/'
  ).ok === false,
  'allowlist blocks off-list'
);

assert(
  urlMatchesPattern('https://example.com/foo/*', 'https://example.com/foo/bar'),
  'https://example.com/foo/* matches /foo/bar'
);

if (process.exitCode) {
  console.error('browser-url-policy tests FAILED');
  process.exit(1);
}
console.log('browser-url-policy tests PASSED');
