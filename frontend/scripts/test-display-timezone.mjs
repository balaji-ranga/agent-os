import assert from 'node:assert/strict';
import {
  getBrowserTimeZone,
  resolveDisplayTimeZone,
  setPlatformDefaultTimeZone,
  setPreferredDisplayTimeZone,
} from '../src/utils/displayTimezone.js';
import { formatLocalDateTime, parseApiDate } from '../src/utils/formatDateTime.js';

const browserTimeZone = getBrowserTimeZone();

setPlatformDefaultTimeZone('America/New_York');
setPreferredDisplayTimeZone(null);
assert.equal(
  resolveDisplayTimeZone(),
  browserTimeZone,
  'A missing profile timezone must fall back to the browser, not the platform timezone.',
);

setPreferredDisplayTimeZone('Asia/Singapore');
assert.equal(resolveDisplayTimeZone(), 'Asia/Singapore');
assert.equal(resolveDisplayTimeZone('Europe/London'), 'Europe/London');

const parsed = parseApiDate('2026-09-06 00:00:00');
assert.equal(parsed?.toISOString(), '2026-09-06T00:00:00.000Z');

const singapore = formatLocalDateTime('2026-09-06 00:00:00');
const london = formatLocalDateTime('2026-09-06 00:00:00', { timeZone: 'Europe/London' });
assert.notEqual(singapore, london, 'Formatting must honor the selected display timezone.');

setPreferredDisplayTimeZone(null);
setPlatformDefaultTimeZone(null);
console.log('Display timezone checks passed.');
