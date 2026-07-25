/**
 * Parse SQLite / ISO timestamps (stored as UTC without suffix) and format them in the
 * platform's preferred timezone (PLATFORM_TIMEZONE, else TZ, else the Node process zone).
 * Never format Kanban / standup / report timestamps in raw UTC — CEOs read local time.
 */

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

function processTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isValidTimezone(tz) {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Preferred display timezone for the whole platform.
 * PLATFORM_TIMEZONE wins so operators can decouple display from the container TZ.
 */
export function getPlatformTimezone() {
  const configured = String(process.env.PLATFORM_TIMEZONE || '').trim();
  if (configured && isValidTimezone(configured)) return configured;
  if (configured) {
    console.warn(`[format-datetime] ignoring invalid PLATFORM_TIMEZONE="${configured}"`);
  }
  const tzEnv = String(process.env.TZ || '').trim();
  if (tzEnv && isValidTimezone(tzEnv)) return tzEnv;
  return processTimezone();
}

/** Back-compat alias — the "server" timezone we expose to clients is the platform one. */
export function getServerTimezone() {
  return getPlatformTimezone();
}

/** Format timestamp in the platform timezone with its abbreviation (e.g. GMT+8). */
export function formatServerDateTime(value, opts = {}) {
  const d = parseApiDate(value);
  if (!d) return '—';
  const { timeZone, ...rest } = opts;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: timeZone || getPlatformTimezone(),
    ...rest,
  }).format(d);
}

/** Date-only label (no clock) in the platform timezone — for due dates. */
export function formatServerDate(value, opts = {}) {
  const d = parseApiDate(value);
  if (!d) return null;
  const { timeZone, ...rest } = opts;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: timeZone || getPlatformTimezone(),
    ...rest,
  }).format(d);
}
