import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'flolah-governor-'));
process.env.AGENT_OS_DATA_DIR = dir;
const { initDb, getDb } = await import('../src/db/schema.js');
const governor = await import('../src/services/tool-execution-governor.js');
initDb();
const db = getDb();
db.prepare(`INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint) VALUES ('master_data_list_rows','Rows','/rows')`).run();
db.prepare(`INSERT OR IGNORE INTO content_tools_meta (name, display_name, endpoint) VALUES ('email_send','Email','/email')`).run();

assert.deepEqual(
  governor.canonicalToolParams({ query: 'x', ceo_user_id: 'spoof', owner_user_id: 'spoof2', approval_token: 'secret' }),
  { query: 'x' },
  'scope/secrets removed from canonical arguments'
);
assert.equal(governor.defaultExecutionBehaviour('email_send').access, 'mutating');
assert.equal(governor.defaultExecutionBehaviour('email_send').verification_mode, 'read_back_or_receipt');

const first = governor.beginToolExecution({ ownerUserId: 'ceo-test', agentId: 'agent-a', sessionKey: 'sess-a', toolName: 'master_data_list_rows', params: { table_name: 'missing', ceo_user_id: 'ceo-test' } });
assert.equal(first.ok, true);
const wrong = governor.completeToolExecution(first, { httpStatus: 404, data: { error: 'Table not found: missing' } });
assert.equal(wrong.status, 'wrong_source');
assert.equal(wrong.retryable, false);
assert.deepEqual(wrong.suggested_capabilities, ['master_data_list_documents', 'master_data_rag']);

const duplicate = governor.beginToolExecution({ ownerUserId: 'ceo-test', agentId: 'agent-a', sessionKey: 'sess-a', toolName: 'master_data_list_rows', params: { owner_user_id: 'another', table_name: 'missing' } });
assert.equal(duplicate.duplicate, true, 'equivalent call blocked despite owner alias variation');

const otherSession = governor.beginToolExecution({ ownerUserId: 'ceo-test', agentId: 'agent-a', sessionKey: 'sess-b', toolName: 'master_data_list_rows', params: { table_name: 'missing' } });
assert.equal(otherSession.ok, true, 'isolated session is not cross-blocked');
const transient = governor.completeToolExecution(otherSession, { httpStatus: 502, data: { error: 'fetch failed' } });
assert.equal(transient.status, 'transient_error');
assert.equal(transient.retryable, true);
const retryOnce = governor.beginToolExecution({ ownerUserId: 'ceo-test', agentId: 'agent-a', sessionKey: 'sess-b', toolName: 'master_data_list_rows', params: { table_name: 'missing' } });
assert.equal(retryOnce.ok, true, 'one configured transient retry allowed');
governor.completeToolExecution(retryOnce, { httpStatus: 502, data: { error: 'fetch failed again' } });
const retryExhausted = governor.beginToolExecution({ ownerUserId: 'ceo-test', agentId: 'agent-a', sessionKey: 'sess-b', toolName: 'master_data_list_rows', params: { table_name: 'missing' } });
assert.equal(retryExhausted.duplicate, true, 'transient retry budget enforced');

governor.putExecutionBehaviours('ceo-test', [{ tool_name: 'email_send', retry_limit: 0, timeout_ms: 12000, duplicate_window_sec: 30, verification_mode: 'read_back_or_receipt', fallback_capabilities: ['approval_or_clarification'] }]);
const email = governor.getExecutionBehaviour('ceo-test', 'email_send');
assert.equal(email.retry_limit, 0);
assert.equal(email.timeout_ms, 12000);
assert.equal(email.overridden, true);

assert.throws(() => governor.putExecutionBehaviours('ceo-test', [{ tool_name: 'unknown' }]), /Unknown tool/);
console.log('PASS tool execution governor: scope, classification, duplicate guard, isolation, overrides, negative validation');
db.close();
rmSync(dir, { recursive: true, force: true });
