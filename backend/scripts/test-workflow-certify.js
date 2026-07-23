/**
 * Smoke test: WorkflowGoal compile + deterministic check_goal + async certify job status.
 * Does not require a live LLM or a passing workflow run.
 * Usage: node scripts/test-workflow-certify.js
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

import { initDb, getDb } from '../src/db/schema.js';
import { seedWorkflowBuilderAgent } from './seed-workflow-builder-agent.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import * as store from '../src/services/agent-workflow-store.js';
import {
  compileGoal,
  checkGoal,
  defaultAcceptanceCriteria,
  startCertifyJob,
  getCertifyStatusForOwner,
  getCertifyJob,
  formatCertifyReply,
} from '../src/services/agent-workflow-certify.js';

initDb();
seedWorkflowBuilderAgent();

const owner = getBalaCeoAuthId();
const actor = { id: 'workflowbuilder', name: 'Workflow Builder', type: 'workflow_builder' };
let failed = 0;
function assert(c, m) {
  if (c) console.log(`  OK: ${m}`);
  else {
    failed++;
    console.error(`  FAIL: ${m}`);
  }
}

console.log('1) compileGoal');
const goal = compileGoal('Build a summarizer until it works success criteria: completed max attempts 4', {
  workflowId: null,
});
assert(goal.goal_id && goal.acceptance?.length >= 4, 'goal has id + default acceptance');
assert(goal.budget?.max_attempts === 4, 'parses max attempts');
assert(defaultAcceptanceCriteria().some((c) => c.type === 'run_completed'), 'default criteria include run_completed');

console.log('2) checkGoal on empty-ish graph');
const stamp = Date.now().toString(36);
const def = store.createDefinition({
  name: `certify-smoke-${stamp}`,
  description: 'certify unit smoke',
  ownerUserId: owner,
  actor,
  trigger_modes: ['manual'],
  graph: {
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger',
        position: { x: 0, y: 0 },
        data: { label: 'Start', nodeType: 'trigger' },
      },
    ],
    edges: [],
  },
});
assert(!!def?.id, 'created definition');

const reportFail = checkGoal({ goal: { ...goal, workflow_id: def.id }, def, lastRun: null });
assert(reportFail.verdict !== 'certified', 'without run, not certified');
assert(Array.isArray(reportFail.criteria_results), 'criteria_results present');

const reportPass = checkGoal({
  goal: {
    ...goal,
    workflow_id: def.id,
    acceptance: [
      { id: 'ac-preflight', type: 'publish_preflight_clean' },
      { id: 'ac-struct', type: 'structural_clean' },
      { id: 'ac-run', type: 'run_completed' },
      { id: 'ac-steps', type: 'no_failed_steps' },
    ],
  },
  def,
  lastRun: { status: 'completed', run_number: 1, steps: [{ status: 'completed', node_id: 'trigger-1' }] },
});
assert(reportPass.verdict === 'certified', 'completed run + clean graph certifies');

console.log('3) async certify job + status');
const started = startCertifyJob({
  ownerUserId: owner,
  workflowId: def.id,
  message: 'Certify smoke workflow end to end',
  actor,
  async: true,
  maxAttempts: 1,
});
assert(started.ok && started.job_id, 'start returns job_id');
assert(started.status === 'testing' || started.status === 'pending', 'job starts testing/pending');

const status = getCertifyStatusForOwner(owner, { jobId: started.job_id });
assert(status.ok && status.job_id === started.job_id, 'status by job_id');

const byQuery = getCertifyStatusForOwner(owner, { query: `certify-smoke-${stamp}` });
assert(byQuery.ok, 'status by workflow name query');

const reply = formatCertifyReply(getCertifyJob(started.job_id, owner));
assert(/Certify job/i.test(reply), 'formatCertifyReply mentions job');

console.log('4) tool meta + grants');
const meta = getDb()
  .prepare(`SELECT name FROM content_tools_meta WHERE name LIKE 'agent_workflow_certify_%' ORDER BY name`)
  .all()
  .map((r) => r.name);
assert(meta.includes('agent_workflow_certify_start'), 'meta certify_start');
assert(meta.includes('agent_workflow_certify_status'), 'meta certify_status');
assert(meta.includes('agent_workflow_certify_resume'), 'meta certify_resume');
const grants = getDb()
  .prepare(`SELECT tool_name FROM agent_tool_grants WHERE agent_id = ? AND tool_name LIKE 'agent_workflow_certify_%'`)
  .all('workflowbuilder')
  .map((r) => r.tool_name);
assert(grants.length >= 3, 'workflowbuilder has certify grants');

// Give async job a moment then ensure it does not crash the process
await new Promise((r) => setTimeout(r, 500));
const after = getCertifyJob(started.job_id, owner);
assert(!!after, 'job still readable after background tick');
console.log(`  (job status after tick: ${after.status})`);

if (failed) {
  console.error(`\nFAILED ${failed} assertion(s)`);
  process.exit(1);
}
console.log('\nAll certify smoke checks passed');
