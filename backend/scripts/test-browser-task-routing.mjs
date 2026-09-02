import assert from 'node:assert/strict';
import {
  assertPreferredBrowserExecutor,
  goalLooksInteractive,
  snapshotSummaryPrompt,
  structuredDocumentError,
  structuredReadOnlyDocumentEvidence,
} from '../src/services/browser-tasks.js';

assert.equal(goalLooksInteractive('Open LinkedIn and capture a full-page PNG screenshot'), true);
assert.equal(goalLooksInteractive('Save a screenshot image of the current page'), true);
assert.equal(goalLooksInteractive('Read this public article and summarize it'), false);

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

console.log('browser task routing tests passed');
