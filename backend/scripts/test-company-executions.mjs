import assert from 'node:assert/strict';
import {
  collectTypedEvidence,
  buildCompanyPulse,
  correlateCompanyExecutions,
  normalizeExecutionStatus,
  pageCompanyExecutions,
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
const paged = pageCompanyExecutions([
  { id: 'a', updated_at: '2026-08-18T10:00:00Z' },
  { id: 'b', updated_at: '2026-08-19T10:00:00Z' },
  { id: 'c', updated_at: '2026-08-25T10:00:00Z' },
], { page: 2, pageSize: 1, from: '2026-08-18', to: '2026-08-24' });
assert.deepEqual(paged.executions.map((item) => item.id), ['b']);
assert.deepEqual(paged.pagination, { page: 2, page_size: 1, total: 2, page_count: 2, has_previous: true, has_next: false });
const pulse = buildCompanyPulse([
  { id: 'run-1', title: 'Publish report', status: 'failed', detail_path: '/run/1', verification: { evidence: [] } },
  { id: 'run-2', title: 'Create brief', status: 'completed', verification: { state: 'verified', evidence: [{ type: 'artifact' }] } },
], { running: 0, blocked: 0, failed: 1, unverified: 0, completed: 1 }, { amount_usd: 0.1234, payer: 'platform' });
assert.equal(pulse.next_action.execution_id, 'run-1');
assert.equal(pulse.artifacts, 1);
assert.equal(pulse.estimated_llm_cost_usd, 0.1234);
console.log('company execution contract tests passed');
