import assert from 'node:assert/strict';
import {
  appendOperatingModelHistory,
  evaluateDay1Acceptance,
} from '../src/services/company-operate.js';

const model = {
  loops: [
    { id: 'daily-ops', critical_day1: true },
    { id: 'optional-report', critical_day1: false },
  ],
};

const accepted = evaluateDay1Acceptance({
  model,
  agents: [{ id: 'coo' }],
  md: [{ agent_id: 'coo', ok: true }],
  workflows: [{ id: 'operate-daily', loop_id: 'daily-ops', ok: true, published: true }],
  policy: { ok: true },
});
assert.equal(accepted.ok, true);
assert.equal(accepted.installed.critical_workflows, 1);

const rejected = evaluateDay1Acceptance({
  model,
  agents: [{ id: 'coo' }],
  md: [{ agent_id: 'coo', ok: false }],
  workflows: [{ loop_id: 'daily-ops', ok: true, published: false, publish_error: 'invalid graph' }],
  policy: { ok: false },
});
assert.equal(rejected.ok, false);
assert.deepEqual(
  new Set(rejected.errors.map((e) => e.code)),
  new Set(['CRITICAL_WORKFLOW_NOT_PUBLISHED', 'RUNBOOK_INSTALL_FAILED', 'POLICY_INSTALL_FAILED'])
);

let strategic = {};
for (let version = 1; version <= 22; version += 1) {
  strategic = {
    ...strategic,
    operating_model_history: appendOperatingModelHistory(strategic, { id: `model-${version}` }, {
      version,
      confirmedAt: `2026-08-${String(version).padStart(2, '0')}T00:00:00.000Z`,
    }),
  };
}
assert.equal(strategic.operating_model_history.length, 20);
assert.equal(strategic.operating_model_history[0].version, 3);
assert.equal(strategic.operating_model_history.at(-1).model.id, 'model-22');

console.log('company operate contract tests passed');
