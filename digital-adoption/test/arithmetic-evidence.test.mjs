import test from 'node:test';
import assert from 'node:assert/strict';
import {arithmeticEvidence} from '../src/arithmetic-evidence.mjs';
test('generic arithmetic facts flag an incorrect quotient and provide the correct rounded value without changing the text',()=>{
 const text='A capacity estimate: 107 / 10 = 10.2, rounded up to 11.';
 const [check]=arithmeticEvidence(text);assert.equal(check.computed,10.7);assert.equal(check.matchesRoundedValue,false);assert.equal(check.ceiling,11);
 assert.equal(arithmeticEvidence('107 / 10 = 10.7')[0].matchesRoundedValue,true);
 assert.equal(arithmeticEvidence('2,000 × 3 = 6,000')[0].matchesRoundedValue,true);
});
test('arithmetic evidence is bounded and never evaluates code, non-finite operations or unbounded numbers',()=>{
 assert.deepEqual(arithmeticEvidence('alert(1); 1 / 0 = 2; 99999999999999 * 7 = 5'),[]);
 assert.equal(arithmeticEvidence('2 + 2 = 4; '.repeat(100)).length,8);
 assert.deepEqual(arithmeticEvidence(undefined),[]);
});
