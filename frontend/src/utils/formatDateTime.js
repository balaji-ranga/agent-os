/**
 * Parse SQLite / ISO timestamps (stored as UTC without suffix).
 */
import { resolveDisplayTimeZone } from './displayTimezone.js';

export function parseApiDate(value) {
  if (!value) return null;
  let s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) && !s.includes('T')) {
    s = `${s.replace(' ', 'T')}Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ+]/.test(s.slice(-6))) {
    s = `${s}Z`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format timestamp with timezone abbreviation.
 * Uses profile/browser display timezone when timeZone is not passed.
 */
export function formatServerDateTime(value, timeZone, opts = {}) {
  const d = parseApiDate(value);
  if (!d) return '—';
  const tz = resolveDisplayTimeZone(timeZone);
  const options = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...opts,
  };
  if (tz) options.timeZone = tz;
  return new Intl.DateTimeFormat(undefined, options).format(d);
}

/** @param {object} [opts] - may include timeZone (IANA); defaults to user profile / browser */
export function formatLocalDateTime(value, opts = {}) {
  const { timeZone, ...rest } = opts;
  return formatServerDateTime(value, timeZone, rest);
}

export function formatLocalDate(value, opts = {}) {
  const d = parseApiDate(value);
  if (!d) return '—';
  const { timeZone, ...rest } = opts;
  const tz = resolveDisplayTimeZone(timeZone);
  return new Intl.DateTimeFormat(undefined, {
    ...(tz ? { timeZone: tz } : {}),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...rest,
  }).format(d);
}

export function formatLocalTime(value, opts = {}) {
  const d = parseApiDate(value);
  if (!d) return '—';
  const { timeZone, ...rest } = opts;
  const tz = resolveDisplayTimeZone(timeZone);
  return new Intl.DateTimeFormat(undefined, {
    ...(tz ? { timeZone: tz } : {}),
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
    ...rest,
  }).format(d);
}

/**
 * Compact timestamp for chat messages and activity feeds.
 * Uses profile/browser display timezone when timeZone is not passed.
 */
export function formatChatTimestamp(value, timeZone) {
  const d = parseApiDate(value);
  if (!d) return '';
  const tz = resolveDisplayTimeZone(timeZone);
  return new Intl.DateTimeFormat(undefined, {
    ...(tz ? { timeZone: tz } : {}),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

/** Datetime-local input value in effective display timezone (YYYY-MM-DDTHH:mm). */
export function toLocalDateTimeInputValue(date = new Date(), timeZone) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const tz = resolveDisplayTimeZone(timeZone);
  if (!tz) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // Format parts in target zone then reassemble
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/**
 * Prefer client-side format when we have a display timezone so Profile TZ
 * stays consistent across Kanban (API *_display was platform-only) and Workspace.
 */
export function taskCreatedAtDisplay(task, timeZone) {
  const tz = resolveDisplayTimeZone(timeZone);
  if (tz) return formatServerDateTime(task?.created_at, tz);
  if (task?.created_at_display) return task.created_at_display;
  return formatServerDateTime(task?.created_at, null);
}

export function taskUpdatedAtDisplay(task, timeZone) {
  const tz = resolveDisplayTimeZone(timeZone);
  if (tz) return formatServerDateTime(task?.updated_at, tz);
  if (task?.updated_at_display) return task.updated_at_display;
  return formatServerDateTime(task?.updated_at, null);
}

/**
 * Timestamp of a row that may carry a server-rendered *_display field.
 * With a user/browser display timezone, always reformat from the raw UTC field.
 */
export function rowTimestampDisplay(row, timeZone, field = 'created_at') {
  const tz = resolveDisplayTimeZone(timeZone);
  if (tz) return formatChatTimestamp(row?.[field], tz);
  const display = row?.[`${field}_display`];
  if (display) return display;
  return formatChatTimestamp(row?.[field], null);
}
