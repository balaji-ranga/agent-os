import assert from 'node:assert/strict';
import { selectSubscriptionSymbols as select, usableSubscriptionPriority } from '../src/subscription-selection.js';
const candidates = ['A','B','C','DIS'];
assert.deepEqual(select({ candidates, eligibleSymbols:['DIS'], cap:2 }), ['DIS','A']);
assert.deepEqual(select({ candidates, protectedSymbols:['HELD'], eligibleSymbols:['DIS'], cap:2 }), ['HELD','DIS']);
assert.deepEqual(select({ candidates, previous:['B','A'], eligibleSymbols:['A','DIS'], cap:2 }), ['A','DIS']);
assert.deepEqual(select({ candidates, previous:['B','A'], eligibleSymbols:['DIS'], selectedAt:new Map([['B',1000],['A',1000]]), now:2000, cap:2 }), ['B','A']);
assert.deepEqual(select({ candidates, previous:['B','A'], eligibleSymbols:['DIS'], selectedAt:new Map([['B',1000],['A',1000]]), now:3601001, cap:2 }), ['DIS','B']);
assert.throws(()=>select({ candidates, protectedSymbols:['X','Y'],cap:1 }), /PROTECTED/);
assert.equal(select({candidates:['A','A','B','C'],cap:2}).length,2);
for(const environment of ['paper','live']) assert.deepEqual(select({candidates,eligibleSymbols:['DIS'],cap:2,environment}),['DIS','A']);
const clock=Date.parse('2026-10-06T14:00:00Z');
for(const environment of ['paper','live']) {
  const priority={environment,universe_version:5,eligible_symbols:['DIS'],as_of:new Date(clock+700).toISOString()};
  assert.equal(usableSubscriptionPriority(priority,environment,5,clock),true,'small clock skew must not discard eligibility');
  assert.equal(usableSubscriptionPriority(priority,environment,6,clock),false);
  assert.equal(usableSubscriptionPriority(priority,environment==='paper'?'live':'paper',5,clock),false);
  assert.equal(usableSubscriptionPriority({...priority,as_of:new Date(clock-60000).toISOString()},environment,5,clock),false);
  assert.equal(usableSubscriptionPriority({...priority,as_of:new Date(clock+5001).toISOString()},environment,5,clock),false);
}
console.log('Stable subscription selection passed: qualified priority, protected exposure, strict cap, residence, both modes.');
