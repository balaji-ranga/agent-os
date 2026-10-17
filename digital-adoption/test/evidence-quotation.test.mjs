import test from 'node:test';
import assert from 'node:assert/strict';
import {copySupportingQuote} from '../src/evidence-quotation.mjs';

test('layout word-wrap resolves to the original source quotation without discarding ordinary spaces',()=>{
 const text='Separate participant Sa\nve confirmation is required.';
 assert.equal(copySupportingQuote(text,'Separate participant Save confirmation is required.'),text);
 assert.equal(copySupportingQuote('The rapist was identified.','Therapist was identified.'),null);
 assert.equal(copySupportingQuote('Returns are nine days.','Returns are ninety days.'),null);
 assert.equal(copySupportingQuote('The primary desk is Copper.','Returns are nine days.'),null);
});

test('quoted punctuation is literal and invalid or unbounded spans are rejected',()=>{
 assert.equal(copySupportingQuote('Policy (A) costs $12.00.','Policy (A) costs $12.00.'),'Policy (A) costs $12.00.');
 assert.equal(copySupportingQuote('Policy ABC costs X12X00X','Policy (A) costs $12.00.'),null);
 for(const quote of [null,'short','x'.repeat(601)])assert.equal(copySupportingQuote('A documented statement.',quote),null);
});
