import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  browserExecutorSupportsEvaluate,
  browserTaskResumeState,
  inferLinkedInStartUrl,
  socialPublishRecipeDescriptor,
  structuredSocialPublishInput,
  verifyRecipeReplayOutcome,
} from '../src/services/browser-tasks.js';
import {
  browserWorkerPayload,
  extensionSocialSnapshotState,
  extractPublishBody,
  inferSocialPlatform,
  structuredSnapshotContainsExactBody,
  structuredSnapshotEditableValueEquals,
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

assert.deepEqual(
  structuredSocialPublishInput({
    operation: 'social_publish',
    platform: 'linkedin',
    body: '  Exact content survives any coordinator rewording.  ',
    constraints: { max_submissions: 1 },
  }),
  {
    operation: 'social_publish',
    platform: 'linkedin',
    body: '  Exact content survives any coordinator rewording.  ',
    constraints: {
      max_submissions: 1,
      preserve_audience: true,
      require_exact_editor_value: true,
      require_durable_confirmation: true,
    },
    valid: true,
  }
);
assert.equal(structuredSocialPublishInput({
  operation: 'social_publish',
  platform: 'linkedin',
  body: 'Unsafe contracts are rejected instead of silently weakened.',
  constraints: { max_submissions: 2 },
})?.valid, false);
assert.equal(structuredSocialPublishInput({
  operation: 'social_publish',
  platform: 'linkedin',
  body: 'Audience mutation must never be enabled through this contract.',
  constraints: { preserve_audience: false },
})?.valid, false);
assert.equal(structuredSocialPublishInput({ operation: 'research', body: 'not a publish' }), null);

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

const socialSnapshot = {
  structured_snapshot: {
    page: { url: 'https://www.linkedin.com/feed/', title: 'Feed | LinkedIn' },
    landmarks: [{ role: 'dialog', name: 'Create a post' }],
    visible_text_excerpt: 'Create a post Testing exact body Post',
    elements: [
      { ref: 'g1-e1', role: 'textbox', name: 'Text editor for creating content', editable: true, sensitive: false, value: 'Testing exact body', visible: true, in_dialog: true },
      { ref: 'g1-e2', role: 'button', name: 'Post', enabled: true, visible: true, in_dialog: true },
    ],
  },
};
assert.equal(structuredSnapshotEditableValueEquals(socialSnapshot, 'Testing exact body'), true);
assert.equal(structuredSnapshotEditableValueEquals(socialSnapshot, 'Testing'), false);
assert.equal(extensionSocialSnapshotState(socialSnapshot, 'linkedin', 'Testing exact body').submit.ref, 'g1-e2');
assert.equal(extensionSocialSnapshotState(socialSnapshot, 'linkedin', 'Testing exact body').dialog_open, true);
const ambiguousSocialSnapshot = structuredClone(socialSnapshot);
ambiguousSocialSnapshot.structured_snapshot.elements.push({ ref: 'g1-e3', role: 'button', name: 'Post', enabled: true, visible: true, in_dialog: true });
assert.equal(extensionSocialSnapshotState(ambiguousSocialSnapshot, 'linkedin', 'Testing exact body').submit, null);
const linkedInWithUnrelatedDialog = {
  structured_snapshot: {
    page: { url: 'https://www.linkedin.com/feed/', title: 'Feed | LinkedIn' },
    landmarks: [{ role: 'dialog', name: 'Messaging' }],
    visible_text_excerpt: 'Messaging Start a post',
    elements: [
      { ref: 'g2-e1', role: 'button', name: 'Start a post, opens a dialog', enabled: true, visible: true, in_dialog: false },
      { ref: 'g2-e2', role: 'textbox', name: 'Write a message', editable: true, sensitive: false, value: '', visible: true, in_dialog: true },
    ],
  },
};
const unrelatedDialogState = extensionSocialSnapshotState(linkedInWithUnrelatedDialog, 'linkedin', 'New post');
assert.equal(unrelatedDialogState.dialog_open, false);
assert.equal(unrelatedDialogState.trigger.ref, 'g2-e1');
assert.equal(unrelatedDialogState.editor_count, 0);

const linkedInRecipe = {
  name: 'LinkedIn dynamic post',
  start_url: 'https://www.linkedin.com/feed/',
  steps: [
    { action: 'open', args: { url: 'https://www.linkedin.com/feed/' } },
    { action: 'act', args: { request: { kind: 'type', text: '{{post_content}}' } } },
    { action: 'act', args: { request: { kind: 'click', text: 'Post' } } },
  ],
};
assert.deepEqual(
  socialPublishRecipeDescriptor(linkedInRecipe, { post_content: 'Verified body' }),
  { platform: 'linkedin', start_url: 'https://www.linkedin.com/feed/', body: 'Verified body', input_name: 'post_content' }
);
assert.deepEqual(
  socialPublishRecipeDescriptor({ ...linkedInRecipe, start_url: 'https://www.facebook.com/' }, { post_content: 'Verified Facebook body' }),
  { platform: 'facebook', start_url: 'https://www.facebook.com/', body: 'Verified Facebook body', input_name: 'post_content' }
);
assert.equal(socialPublishRecipeDescriptor({ ...linkedInRecipe, start_url: 'https://example.com/' }, { post_content: 'x' }), null);

const unverifiedMutation = verifyRecipeReplayOutcome(
  { steps: [{ action: 'act', args: { request: { kind: 'click', text: 'Submit' } } }] },
  [{ action: 'act', ok: true, evidence: { kind: 'click' } }],
  'URL: https://example.com/\nTitle: Example'
);
assert.equal(unverifiedMutation.satisfied, false);
assert(unverifiedMutation.missing_evidence.includes('action_state:act'));

const extensionPath = fileURLToPath(new URL('../flolah-chrome-extension/background.js', import.meta.url));
const extension = readFileSync(extensionPath, 'utf8');
for (const marker of ["'screenshot'", "'task_cleanup'", "'tabs'", "'focus'", 'resumable_tasks: true', 'tab_discovery: true', 'tab_selection: true', 'allowedTabSummaries', 'selectedTabId', 'visible_text_excerpt', 'in_dialog', 'result_state', 'AMBIGUOUS_TARGET', 'Page.captureScreenshot', 'DOM.getFlattenedDocument', 'pierce: true', 'Input.insertText', 'Input.dispatchMouseEvent', 'windowsVirtualKeyCode', 'preserveAllow: true']) {
  assert(extension.includes(marker), `extension missing ${marker}`);
}
assert(extension.includes('args.tab_id || args.tabId || args.targetId'), 'extension focus must honor targetId aliases');
assert(extension.indexOf('const requested = Number(args.tab_id || args.tabId || args.targetId || 0)') < extension.indexOf('const pinned = taskId'), 'explicit focus target must take precedence over a stale task pin');
assert(extension.includes('if(el.shadowRoot)queue.push'), 'extension snapshots must traverse open shadow roots');
assert(extension.includes("if(el.tagName==='IFRAME')"), 'extension snapshots must traverse same-origin child frames');
assert(extension.includes("roots.push(el.shadowRoot)"), 'extension ref actions must resolve controls in shadow roots');
console.log('browser maturity contract tests passed');
