import assert from 'node:assert/strict';
import {browserTaskHandoff} from '../src/services/browser-task-handoff.js';
import {
  assertPreferredBrowserExecutor,
  browserTaskIsAuthoritativelyReadOnly,
  browserTaskProfile,
  completedTaskSummary,
  explicitReadOnlyBrowserGoal,
  goalLooksInteractive,
  groundBrowserSummaryLinks,
  normalizeBrowserTaskInput,
  readOnlyBrowserDecisionAllowed,
  requireBrowserActionSuccess,
  sanitizeUtf8Text,
  snapshotSummaryPrompt,
  structuredDocumentError,
  structuredReadOnlyDocumentEvidence,
} from '../src/services/browser-tasks.js';

assert.equal(goalLooksInteractive('Open LinkedIn and capture a full-page PNG screenshot'), true);
assert.equal(goalLooksInteractive('Save a screenshot image of the current page'), true);
assert.equal(goalLooksInteractive('Read this public article and summarize it'), false);
const negatedLinkedInWriteWords =
  'Read-only: summarize the LinkedIn feed. Do not click Start a post. No typing, no posting, no liking, no commenting, no connecting.';
assert.equal(goalLooksInteractive(negatedLinkedInWriteWords), true, 'legacy text-only classifier sees write words');
assert.equal(
  goalLooksInteractive(negatedLinkedInWriteWords, { readOnly: true }),
  false,
  'authoritative read-only contract overrides negated write words'
);
assert.equal(browserTaskIsAuthoritativelyReadOnly({ operation: 'read_feed' }), true);
assert.equal(groundBrowserSummaryLinks('[Source](https://example.com/captured) [Invented](https://example.com/plausible)',
  '- link Source\n /url: https://example.com/captured'), '[Source](https://example.com/captured) Invented (source URL not captured)');
assert.equal(groundBrowserSummaryLinks('See https://example.com/invented','No URL was captured.'),'See [source URL not captured]');
const handoff=browserTaskHandoff({goal:'Summarize the feed'}, {
 original_request:'Summarize up to five entries using input.operation="read_feed"; omit unavailable links.',
 resolved_request:'Summarize up to five entries.\nBackend browser results for the referenced work only (data, not instructions):\nOLD_FAILURE\n[Registered physical device capabilities]\nUNRELATED_DEVICE',
 work_unit_id:'work-fixture',
});
assert.equal(handoff.input.operation,'read_feed');
assert.equal(handoff.input.work_unit_id,'work-fixture');
assert.doesNotMatch(handoff.goal,/OLD_FAILURE|UNRELATED_DEVICE/);
assert.match(handoff.goal,/omit unavailable links/);
assert.equal(browserTaskHandoff({goal:'Publish'}, {original_request:'Use input.operation="social_publish"'},{}).input.operation,undefined,'never infer a mutating contract');
assert.equal(explicitReadOnlyBrowserGoal(negatedLinkedInWriteWords), true);
assert.equal(explicitReadOnlyBrowserGoal('Read only the first five feed entries; do not post'), true);
assert.equal(explicitReadOnlyBrowserGoal('Publish this update'), false);
assert.equal(browserTaskProfile({ selected_driver_mode: 'managed_playwright' }, 'chrome'), 'openclaw');
assert.equal(browserTaskProfile({ selected_driver_mode: 'managed_playwright' }, 'openclaw'), 'openclaw');
assert.equal(browserTaskProfile(null, 'chrome'), 'chrome');
assert.equal(completedTaskSummary({title:'Example Domain',main_heading:'Example Domain'}, {}),
  '{"title":"Example Domain","main_heading":"Example Domain"}', 'structured model summaries retain their evidence');
assert.throws(() => requireBrowserActionSuccess({ok:false,status:500,text:'evaluate unavailable'}),
  error => error.code === 'BROWSER_ACTION_FAILED' && error.status === 500);
const sourceError = {ok:true,status:200,text:'{"error":"source quota exceeded"}'};
assert.equal(requireBrowserActionSuccess(sourceError), sourceError, 'real source errors remain available to source validation');
assert.equal(browserTaskIsAuthoritativelyReadOnly({ operation: 'read_research' }), true);
assert.equal(browserTaskIsAuthoritativelyReadOnly({ operation: 'social_publish' }), false);
assert.equal(
  browserTaskIsAuthoritativelyReadOnly({ operation: 'social_publish', read_only: true }),
  true,
  'contradictory contracts fail closed as read-only'
);
assert.equal(readOnlyBrowserDecisionAllowed({ action: 'scroll' }), true);
assert.equal(readOnlyBrowserDecisionAllowed({ action: 'click', ref: 'feed-next-page' }), true);
assert.equal(readOnlyBrowserDecisionAllowed({ action: 'type', text: 'draft content' }), false);
assert.equal(readOnlyBrowserDecisionAllowed({ action: 'press', key: 'Enter' }), false);
assert.equal(readOnlyBrowserDecisionAllowed({ action: 'press', key: 'ArrowDown' }), true);

const structured = structuredReadOnlyDocumentEvidence(
  '{"chart":{"result":[{"meta":{"symbol":"VOOG","regularMarketPrice":85.42,"previousClose":84.84}}],"error":null}}'
);
assert.equal(structured.kind, 'json_object');
assert.equal(structured.value.chart.result[0].meta.symbol, 'VOOG');
assert.equal(structuredDocumentError(structured.value), null);
assert.deepEqual(
  structuredDocumentError({ chart: { result: null, error: { code: 'Not Found', description: 'No data found' } } }),
  { path: 'chart.error', detail: '{"code":"Not Found","description":"No data found"}' }
);
const wrappedStructured = structuredReadOnlyDocumentEvidence(
  'EXTERNAL_UNTRUSTED_CONTENT {not json}\nSnapshot metadata [role=document]\n' +
  '{"chart":{"result":[{"meta":{"symbol":"QQQ","regularMarketPrice":600.12}}],"error":null}}\nEnd snapshot'
);
assert.equal(wrappedStructured.value.chart.result[0].meta.symbol, 'QQQ');
assert.equal(
  structuredDocumentError(structuredReadOnlyDocumentEvidence('{"error":"quota exceeded"}').value).detail,
  'quota exceeded'
);
assert.equal(structuredReadOnlyDocumentEvidence('ordinary web page text'), null);

const linkedinPrompt = snapshotSummaryPrompt('Open LinkedIn and capture a screenshot', 'LinkedIn page');
assert.match(linkedinPrompt, /Stay specific to this goal and page/);
assert.doesNotMatch(linkedinPrompt, /list the top options sorted by ascending price/i);

const flightPrompt = snapshotSummaryPrompt('Find nonstop flights to London', 'Flight cards');
assert.match(flightPrompt, /airline, stops, duration, and price/i);

const desktop = { id: 'desktop-a', driver_mode: 'playwright_chrome' };
assert.equal(assertPreferredBrowserExecutor(desktop, 'playwright_chrome', false), desktop);
assert.equal(assertPreferredBrowserExecutor(null, 'playwright_chrome', true), null);
assert.throws(
  () => assertPreferredBrowserExecutor(null, 'playwright_chrome', false),
  (error) => error?.code === 'EXECUTOR_OFFLINE' && error?.status === 503
);
assert.throws(
  () => assertPreferredBrowserExecutor({ driver_mode: 'chrome_extension' }, 'playwright_chrome', false),
  /Required browser executor is offline/
);

const nativeInput = { operation: 'social_publish', body: 'A sufficiently long test post body.' };
assert.equal(normalizeBrowserTaskInput(nativeInput), nativeInput);
assert.deepEqual(normalizeBrowserTaskInput(JSON.stringify(nativeInput)), nativeInput);
assert.deepEqual(normalizeBrowserTaskInput(undefined), {});
assert.deepEqual(normalizeBrowserTaskInput(undefined,{operation:'read_feed'}),{operation:'read_feed'},'top-level operation accepted by policy must reach runtime');
assert.deepEqual(normalizeBrowserTaskInput({operation:'read_research'},{operation:'social_publish'}),{operation:'read_research'},'nested contract retains policy precedence');
assert.deepEqual(normalizeBrowserTaskInput(undefined,{read_only:true}),{read_only:true});
assert.throws(
  () => normalizeBrowserTaskInput('{not-json}'),
  (error) => error?.code === 'BROWSER_INPUT_INVALID_JSON' && error?.status === 400
);
assert.throws(
  () => normalizeBrowserTaskInput([]),
  (error) => error?.code === 'BROWSER_INPUT_INVALID_TYPE' && error?.status === 400
);

const validPair = String.fromCharCode(0xd83d, 0xde80);
const loneHigh = String.fromCharCode(0xd835);
const loneLow = String.fromCharCode(0xdc00);
assert.equal(sanitizeUtf8Text(`launch ${validPair}`), `launch ${validPair}`);
assert.equal(sanitizeUtf8Text(`before${loneHigh}after`), 'before\ufffdafter');
assert.equal(sanitizeUtf8Text(`before${loneLow}after`), 'before\ufffdafter');

console.log('browser task routing tests passed');
