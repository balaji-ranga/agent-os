import assert from 'node:assert/strict';
import {
  loginClientIp,
  loginOriginFromRequest,
  resolveIpCountry,
} from '../src/services/auth/login-origin.js';

function request(peer, headers = {}) {
  return { socket: { remoteAddress: peer }, headers };
}

assert.equal(
  loginClientIp(request('172.18.0.3', { 'x-real-ip': '8.8.8.8' })),
  '8.8.8.8',
  'trusted local reverse proxy supplies the client IP'
);
assert.equal(
  loginClientIp(request('203.0.113.20', { 'x-real-ip': '8.8.8.8' })),
  '203.0.113.20',
  'public peers cannot spoof forwarding headers'
);
assert.equal(
  loginClientIp(request('127.0.0.1', { 'x-forwarded-for': '1.1.1.1, 10.0.0.4' })),
  '1.1.1.1',
  'first address in an nginx-provided chain is the original client'
);
assert.deepEqual(resolveIpCountry('not-an-ip'), { country_code: '', country_name: '' });

const origin = loginOriginFromRequest(
  request('127.0.0.1', { 'x-real-ip': '8.8.8.8' })
);
assert.equal(origin.clientIp, '8.8.8.8');
assert.equal(origin.ipCountryCode, 'US');
assert.match(origin.ipCountryName, /United States/);

console.log('PASS login origin extraction and local country resolution');
