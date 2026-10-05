import assert from 'node:assert/strict';
import { profileFieldStatus } from '../src/utils/ibkrNewProfileStatus.js';
for (const symbol of ['TLT', 'EEM']) {
  for (const field of ['fundamentals_at', 'membership_at', 'corporate_events_at']) assert.equal(profileFieldStatus({ symbol, security_type: 'ETF' }, field), 'Not required (ETF)');
}
assert.equal(profileFieldStatus({ security_type: 'STK' }, 'fundamentals_at'), 'Missing');
assert.equal(profileFieldStatus({ security_type: 'STK' }, 'corporate_events_at'), 'Missing');
assert.equal(profileFieldStatus({ security_type: 'STK' }, 'membership_at', { indexes: ['SPX'] }), 'Missing');
assert.equal(profileFieldStatus({ security_type: 'STK' }, 'membership_at', { indexes: [] }), 'Not required');
assert.equal(profileFieldStatus({ security_type: 'STK', fundamentals_at: '2026-10-06T00:00:00Z' }, 'fundamentals_at'), null);
console.log('IBKRNew profile labels passed: ETF exemption does not hide missing stock fundamentals/calendar.');
