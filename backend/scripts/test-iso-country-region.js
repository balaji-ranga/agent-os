/**
 * Unit tests for ISO 3166 country/region parse + write validation.
 * Usage: node scripts/test-iso-country-region.js
 */
import assert from 'assert';
import {
  parseIsoLocation,
  normalizeCountryRegion,
  parseCountryCode,
  listIsoCountries,
  listIsoRegions,
  formatIsoLocationLabel,
  erpnextCountryName,
} from '../src/lib/iso-country-region.js';

function expectThrow(fn, re) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    assert.match(String(e.message), re);
    assert.equal(e.status, 400);
  }
  assert.ok(threw, 'expected throw');
}

assert.ok(listIsoCountries().some((c) => c.alpha2 === 'SG'));
assert.equal(parseCountryCode('Singapore'), 'SG');
assert.equal(parseCountryCode('USA'), 'US');
assert.equal(parseCountryCode('UK'), 'GB');
assert.equal(parseCountryCode('SGP'), 'SG');
assert.deepEqual(parseIsoLocation('', 'Singapore'), { country: 'SG', region: '' });
assert.deepEqual(parseIsoLocation('', 'global'), { country: '', region: '' });
assert.deepEqual(parseIsoLocation('US', 'CA'), { country: 'US', region: 'US-CA' });
assert.deepEqual(parseIsoLocation('', 'US-CA'), { country: 'US', region: 'US-CA' });
assert.deepEqual(parseIsoLocation('US', 'California'), { country: 'US', region: 'US-CA' });
assert.deepEqual(normalizeCountryRegion({ country: 'Singapore', region: '' }), { country: 'SG', region: '' });
assert.deepEqual(normalizeCountryRegion({ country: '', region: '' }), { country: '', region: '' });
assert.deepEqual(normalizeCountryRegion({ region: 'global' }), { country: '', region: '' });
expectThrow(() => normalizeCountryRegion({ country: 'Narnia' }), /ISO 3166-1/);
expectThrow(() => normalizeCountryRegion({ country: 'US', region: 'Narnia' }), /ISO 3166-2/);
assert.ok(listIsoRegions('SG').some((r) => r.code === 'SG-01'));
assert.equal(formatIsoLocationLabel('SG', ''), 'Singapore (SG)');
assert.equal(erpnextCountryName('US'), 'United States');
assert.equal(erpnextCountryName('GB'), 'United Kingdom');
assert.equal(erpnextCountryName('SG'), 'Singapore');
console.log('PASS iso-country-region');
