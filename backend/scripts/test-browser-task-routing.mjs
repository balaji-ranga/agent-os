import assert from 'node:assert/strict';
import {
  assertPreferredBrowserExecutor,
  goalLooksInteractive,
  snapshotSummaryPrompt,
} from '../src/services/browser-tasks.js';

assert.equal(goalLooksInteractive('Open LinkedIn and capture a full-page PNG screenshot'), true);
assert.equal(goalLooksInteractive('Save a screenshot image of the current page'), true);
assert.equal(goalLooksInteractive('Read this public article and summarize it'), false);

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
