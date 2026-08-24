import assert from 'node:assert/strict';
import {
  collectTypedEvidence,
  correlateCompanyExecutions,
  normalizeExecutionStatus,
  verificationFromResult,
} from '../src/services/company-executions.js';

assert.equal(normalizeExecutionStatus('in_progress'), 'running');
assert.equal(normalizeExecutionStatus('blocked_on_input'), 'blocked');
assert.equal(normalizeExecutionStatus('done'), 'completed');
assert.equal(verificationFromResult('completed', {}).state, 'unverified');
assert.equal(verificationFromResult('completed', { post_id: 'urn:post:1' }).state, 'verified');
assert.equal(verificationFromResult('completed', { verification: { satisfied: true } }).state, 'verified');
assert.equal(verificationFromResult('running', {}).state, 'not_due');
assert.equal(verificationFromResult('failed', {}, 'boom').error, 'boom');
assert.deepEqual(
  collectTypedEvidence({ result: { message_id: 'msg-1', artifacts: [{ id: 'mda-1' }] } }).map((e) => e.type),
  ['provider_receipt', 'artifact']
);
const correlated = correlateCompanyExecutions([
  { id: 'goal:agr-1', source_type: 'goal_plan', source_id: 'agr-1', status: 'running' },
  { id: 'browser:bt-1', source_type: 'browser', source_id: 'bt-1', status: 'completed', parent_goal_run_id: 'agr-1' },
]);
assert.equal(correlated[1].parent_execution_id, 'goal:agr-1');
assert.equal(correlated[0].children[0].id, 'browser:bt-1');
console.log('company execution contract tests passed');
