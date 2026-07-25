/**
 * Unit tests for status-only auto-requeue (no CEO nudge).
 * Usage: node scripts/test-delegation-status-only-retry.js
 */
import assert from 'assert';
import {
  getStatusOnlyRetryCount,
  withStatusOnlyRetryCount,
  isEligibleForStatusOnlyRetry,
  isJobPipelinePrompt,
  isTransientOpenClawError,
  getTransientAttempt,
} from '../src/services/delegation-status-only-retry.js';

{
  assert.strictEqual(getStatusOnlyRetryCount(''), 0);
  assert.strictEqual(getStatusOnlyRetryCount('owner_user_id: ceo-bala'), 0);
  assert.strictEqual(getStatusOnlyRetryCount('foo\n[status_only_retry:1]'), 1);
  assert.strictEqual(getStatusOnlyRetryCount(withStatusOnlyRetryCount('desc', 2)), 2);
  const once = withStatusOnlyRetryCount('owner_user_id: x\n[status_only_retry:1]', 2);
  assert.ok(!once.includes('[status_only_retry:1]'));
  assert.ok(once.includes('[status_only_retry:2]'));
  console.log('PASS retry count helpers');
}

{
  assert.ok(isEligibleForStatusOnlyRetry('The CEO asked: is RAG keyword based?'));
  assert.ok(!isJobPipelinePrompt('normal ask'));
  assert.ok(isJobPipelinePrompt('[job_pipeline:discovery]\nceo_user_id: x'));
  assert.ok(!isEligibleForStatusOnlyRetry('[job_pipeline:discovery]\nfind jobs'));
  console.log('PASS eligibility');
}

{
  assert.ok(isTransientOpenClawError(new Error('OpenClaw gateway unreachable (http://openclaw:18789): fetch failed')));
  assert.ok(isTransientOpenClawError(new Error('OpenClaw gateway timeout after 240000ms')));
  assert.ok(!isTransientOpenClawError(new Error('Budget exceeded')));
  assert.strictEqual(getTransientAttempt('[transient:3] OpenClaw gateway unreachable'), 3);
  assert.strictEqual(getTransientAttempt('Budget exceeded'), 0);
  console.log('PASS transient gateway helpers');
}

console.log('DELEGATION_STATUS_ONLY_RETRY_OK');
