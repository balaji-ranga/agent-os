/**
 * Unit tests for agent_workflow_runs content tool.
 *
 * Usage: node backend/scripts/test-agent-workflow-runs-tool.js
 */
import assert from 'assert';
import { initDb, getDb } from '../src/db/schema.js';
import { seedWorkflowToolsIfMissing } from '../src/db/seed-content-tools-meta.js';
import { executeAgentWorkflowRuns } from '../src/services/agent-workflow-agent-runs.js';
import {
  COO_CONTENT_TOOLS_ALLOW,
  WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW,
  REQUIRED_GLOBAL_CONTENT_TOOLS,
} from '../src/lib/content-tools-allow.js';

initDb();
seedWorkflowToolsIfMissing();

assert.ok(REQUIRED_GLOBAL_CONTENT_TOOLS.includes('agent_workflow_runs'));
assert.ok(COO_CONTENT_TOOLS_ALLOW.includes('agent_workflow_runs'));
assert.ok(WORKFLOW_BUILDER_CONTENT_TOOLS_ALLOW.includes('agent_workflow_runs'));

const meta = getDb()
  .prepare('SELECT name, endpoint FROM content_tools_meta WHERE name = ?')
  .get('agent_workflow_runs');
assert.ok(meta, 'agent_workflow_runs seeded in content_tools_meta');
assert.ok(/agent-workflow-runs/.test(meta.endpoint));

const missingOwner = executeAgentWorkflowRuns({}, {});
assert.strictEqual(missingOwner.ok, false);

const ceo =
  getDb().prepare("SELECT id FROM platform_users WHERE role = 'ceo' AND enabled = 1 LIMIT 1").get() ||
  getDb().prepare("SELECT id FROM platform_users WHERE id = 'ceo-bala'").get();
assert.ok(ceo?.id, 'need a CEO row for test');

const listAll = executeAgentWorkflowRuns({ limit: 5 }, { ownerUserId: ceo.id });
assert.strictEqual(listAll.ok, true);
assert.ok(listAll.mode === 'list_all');
assert.ok(Array.isArray(listAll.runs));
console.log('PASS: agent_workflow_runs list_all', { owner: ceo.id, count: listAll.count });

const notFound = executeAgentWorkflowRuns(
  { workflow_query: 'definitely-no-such-workflow-xyz-999' },
  { ownerUserId: ceo.id }
);
assert.strictEqual(notFound.ok, false);

console.log('PASS: agent_workflow_runs tool');
