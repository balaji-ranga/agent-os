/**
 * Display timezone preference used by formatDateTime helpers.
 * Auth loads user.display_timezone into this; UI stays consistent with Kanban / chat.
 */
let preferredDisplayTimeZone = null;
let platformDefaultTimeZone = null;

export function isValidIanaTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Set from Auth when /me loads (user choice). Empty/null = fall through to platform. */
export function setPreferredDisplayTimeZone(tz) {
  const t = String(tz || '').trim();
  preferredDisplayTimeZone = t && isValidIanaTimeZone(t) ? t : null;
}

export function getPreferredDisplayTimeZone() {
  return preferredDisplayTimeZone || null;
}

/** Platform default (PLATFORM_TIMEZONE) from API — used when user leaves profile empty. */
export function setPlatformDefaultTimeZone(tz) {
  const t = String(tz || '').trim();
  platformDefaultTimeZone = t && isValidIanaTimeZone(t) ? t : null;
}

export function getPlatformDefaultTimeZone() {
  return platformDefaultTimeZone || null;
}

/**
 * Effective IANA zone for UI: explicit arg > user profile > platform default > undefined (browser).
 */
export function resolveDisplayTimeZone(explicit) {
  if (explicit && isValidIanaTimeZone(explicit)) return explicit;
  if (preferredDisplayTimeZone) return preferredDisplayTimeZone;
  if (platformDefaultTimeZone) return platformDefaultTimeZone;
  return undefined;
}
