/**
 * Unit checks for outbound URL SSRF guard (summarize_url / shared lib).
 * Run: node backend/scripts/test-ssrf-outbound.js
 */
import assert from 'assert';
import {
  isPrivateIp,
  parsePublicHttpsUrl,
  toSafeHref,
  hostMatchesAllowedDomains,
  SafeOutboundUrlError,
} from '../src/lib/ssrf.js';

function expectFail(fn, re) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    assert.equal(e instanceof SafeOutboundUrlError, true);
    if (re) assert.match(String(e.message), re);
  }
  assert.equal(threw, true, 'expected SafeOutboundUrlError');
}

assert.equal(isPrivateIp('127.0.0.1'), true);
assert.equal(isPrivateIp('10.1.2.3'), true);
assert.equal(isPrivateIp('192.168.0.9'), true);
assert.equal(isPrivateIp('172.16.0.1'), true);
assert.equal(isPrivateIp('169.254.169.254'), true);
assert.equal(isPrivateIp('100.64.0.1'), true);
assert.equal(isPrivateIp('::1'), true);
assert.equal(isPrivateIp('fe80::1'), true);
assert.equal(isPrivateIp('8.8.8.8'), false);
assert.equal(isPrivateIp('1.1.1.1'), false);

expectFail(() => parsePublicHttpsUrl('http://example.com/'), /HTTPS/);
expectFail(() => parsePublicHttpsUrl('file:///etc/passwd'), /HTTPS|Invalid/);
expectFail(() => parsePublicHttpsUrl('https://127.0.0.1/'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://localhost/x'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://169.254.169.254/latest'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://10.0.0.5/'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://user:pass@example.com/'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://2130706433/'), /not allowed/);
expectFail(() => parsePublicHttpsUrl('https://metadata.google.internal/'), /not allowed/);

const ok = parsePublicHttpsUrl('https://science.nasa.gov/solar-system/planets/?q=1#frag');
assert.equal(toSafeHref(ok), 'https://science.nasa.gov/solar-system/planets/?q=1');

assert.equal(hostMatchesAllowedDomains('www.nasa.gov', ['nasa.gov']), true);
assert.equal(hostMatchesAllowedDomains('evil-nasa.gov.attacker.example', ['nasa.gov']), false);
expectFail(
  () => parsePublicHttpsUrl('https://example.com/', { allowedDomains: ['nasa.gov'] }),
  /domain not allowed/
);

const allowed = parsePublicHttpsUrl('https://science.nasa.gov/x', { allowedDomains: ['nasa.gov'] });
assert.equal(allowed.hostname, 'science.nasa.gov');

console.log('test-ssrf-outbound: ok');
