import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browserTaskResumeState, verifyRecipeReplayOutcome } from '../src/services/browser-tasks.js';

const recipe = { steps: [
  { action: 'open', args: { url: 'https://example.com', expect_url: '^https://example\\.com' } },
  { action: 'screenshot', args: {} },
] };
const verified = verifyRecipeReplayOutcome(recipe, [
  { action: 'open', ok: true, evidence: { result_state: 'action_applied' } },
  { action: 'screenshot', ok: true, evidence: { artifact: { url: '/api/media-artifacts/a' }, result_state: 'artifact_observed' } },
], 'URL: https://example.com/\nTitle: Example Domain');
assert.equal(verified.satisfied, true);
assert.equal(verified.outputs.final_url, 'https://example.com/');
const missing = verifyRecipeReplayOutcome(recipe, [{ action: 'open', ok: true, evidence: {} }], 'Title: Example');
assert.equal(missing.satisfied, false);
assert(missing.missing_evidence.includes('final_url'));

const resume = browserTaskResumeState({ steps: [
  { action: 'plan', plan: { steps: [{ goal: 'Open' }] } },
  { action: 'open', outcome: 'ok' },
] });
assert.equal(resume.resumed, true);
assert.equal(resume.steps.length, 2);
assert.equal(resume.execution_plan.steps[0].goal, 'Open');

const extensionPath = fileURLToPath(new URL('../flolah-chrome-extension/background.js', import.meta.url));
const extension = readFileSync(extensionPath, 'utf8');
for (const marker of ["'screenshot'", "'task_cleanup'", 'resumable_tasks: true', 'visible_text_excerpt', 'Page.captureScreenshot', 'preserveAllow: true']) {
  assert(extension.includes(marker), `extension missing ${marker}`);
}
console.log('browser maturity contract tests passed');
