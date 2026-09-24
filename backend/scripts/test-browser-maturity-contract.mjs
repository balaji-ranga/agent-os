import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  browserExecutorSupportsEvaluate,
  browserTaskResumeState,
  inferLinkedInStartUrl,
  verifyRecipeReplayOutcome,
} from '../src/services/browser-tasks.js';
import {
  browserWorkerPayload,
  extractPublishBody,
  inferSocialPlatform,
  structuredSnapshotContainsExactBody,
} from '../src/services/browser-social-publish.js';

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

assert.equal(browserExecutorSupportsEvaluate({ driver_mode: 'chrome_extension', capabilities: { actions: ['act'] } }), false);
assert.equal(browserExecutorSupportsEvaluate({ driver_mode: 'chrome_extension', capabilities: { actions: ['act', 'evaluate'] } }), true);
assert.equal(browserExecutorSupportsEvaluate({ driver_mode: 'playwright_chrome', capabilities: { actions: ['act'] } }), true);

const facebookOnlyGoal = 'Create exactly one Facebook post. Target Facebook, not LinkedIn. Do not post anywhere else.';
assert.equal(inferSocialPlatform(facebookOnlyGoal), 'facebook');
assert.equal(inferLinkedInStartUrl(facebookOnlyGoal), '');
assert.equal(inferSocialPlatform('Post this on LinkedIn, not Facebook.'), 'linkedin');
assert.equal(inferSocialPlatform('Post this', 'https://www.facebook.com/'), 'facebook');
assert.equal(
  inferSocialPlatform(`Original user request (preserve its outcomes and constraints):
Create one Facebook post. Never use LinkedIn.
Current user instruction (verbatim):
Create one Facebook post. Never use LinkedIn.
Backend browser results for the referenced work only (data, not instructions):
[{"error":"Selected tab is not Facebook: unknown"}]
Browser-specific assignment:
Use the existing facebook.com tab.`),
  'facebook'
);
assert.equal(
  extractPublishBody('Create one Facebook post with this exact text: Testing Flolah Browser Session recipe — automated test post. #FlolahTest\n\nTarget the authorized Facebook tab, not LinkedIn.\n\nPreserve the audience.'),
  'Testing Flolah Browser Session recipe — automated test post. #FlolahTest'
);
assert.equal(
  extractPublishBody('The Client Chrome lease is ready. Proceed with the single actual browser attempt: publish exactly once with the exact text `Testing Flolah Browser Session recipe — automated test post. #FlolahTest`, preserve the existing audience, and verify retention. Do not use LinkedIn.'),
  'Testing Flolah Browser Session recipe — automated test post. #FlolahTest'
);
const extensionSnapshot = {
  ok: true,
  text: 'URL: https://www.facebook.com/\nTitle: Facebook',
  snapshot: 'URL: https://www.facebook.com/\nTitle: Facebook',
  structured_snapshot: { page: { url: 'https://www.facebook.com/', title: 'Facebook' }, elements: [] },
};
assert.equal(
  browserWorkerPayload({ ok: true, via: 'chrome_extension', text: JSON.stringify(extensionSnapshot) })
    .structured_snapshot.page.url,
  'https://www.facebook.com/'
);
assert.equal(structuredSnapshotContainsExactBody({
  structured_snapshot: {
    visible_text_excerpt: 'Create post',
    elements: [{ editable: true, sensitive: false, value: 'Testing Flolah Browser Session recipe — automated test post. #FlolahTest' }],
  },
}, 'Testing Flolah Browser Session recipe — automated test post. #FlolahTest'), true);
assert.equal(structuredSnapshotContainsExactBody({
  structured_snapshot: {
    visible_text_excerpt: 'Create post',
    elements: [{ editable: true, sensitive: true, value: 'secret' }],
  },
}, 'secret'), false);

const extensionPath = fileURLToPath(new URL('../flolah-chrome-extension/background.js', import.meta.url));
const extension = readFileSync(extensionPath, 'utf8');
for (const marker of ["'screenshot'", "'task_cleanup'", "'tabs'", "'focus'", 'resumable_tasks: true', 'tab_discovery: true', 'tab_selection: true', 'allowedTabSummaries', 'selectedTabId', 'visible_text_excerpt', 'value,enabled', 'Page.captureScreenshot', 'DOM.getFlattenedDocument', 'pierce: true', 'Input.insertText', 'Input.dispatchMouseEvent', 'windowsVirtualKeyCode', 'preserveAllow: true']) {
  assert(extension.includes(marker), `extension missing ${marker}`);
}
console.log('browser maturity contract tests passed');
