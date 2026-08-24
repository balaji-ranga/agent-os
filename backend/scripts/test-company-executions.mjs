import assert from 'node:assert/strict';
import { normalizeExecutionStatus, verificationFromResult } from '../src/services/company-executions.js';

assert.equal(normalizeExecutionStatus('in_progress'), 'running');
assert.equal(normalizeExecutionStatus('blocked_on_input'), 'blocked');
assert.equal(normalizeExecutionStatus('done'), 'completed');
assert.equal(verificationFromResult('completed', {}).state, 'unverified');
assert.equal(verificationFromResult('completed', { post_id: 'urn:post:1' }).state, 'verified');
assert.equal(verificationFromResult('completed', { verification: { satisfied: true } }).state, 'verified');
assert.equal(verificationFromResult('running', {}).state, 'not_due');
assert.equal(verificationFromResult('failed', {}, 'boom').error, 'boom');
console.log('company execution contract tests passed');
