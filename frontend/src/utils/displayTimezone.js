/**
 * Display timezone preference used by formatDateTime helpers.
 * Auth loads user.display_timezone into this. When the profile has no timezone,
 * display-only formatting follows the current browser rather than the platform
 * scheduler timezone.
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

/** Set from Auth when /me loads (user choice). Empty/null = fall through to browser. */
export function setPreferredDisplayTimeZone(tz) {
  const t = String(tz || '').trim();
  preferredDisplayTimeZone = t && isValidIanaTimeZone(t) ? t : null;
}

export function getPreferredDisplayTimeZone() {
  return preferredDisplayTimeZone || null;
}

/** Platform default retained for schedule/business-calendar semantics, not timestamp display. */
export function setPlatformDefaultTimeZone(tz) {
  const t = String(tz || '').trim();
  platformDefaultTimeZone = t && isValidIanaTimeZone(t) ? t : null;
}

export function getPlatformDefaultTimeZone() {
  return platformDefaultTimeZone || null;
}

export function getBrowserTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidIanaTimeZone(timeZone) ? timeZone : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Effective IANA zone for UI: explicit arg > user profile > browser.
 * platformDefaultTimeZone remains available for schedule/business-calendar UI,
 * but is intentionally not a display fallback.
 */
export function resolveDisplayTimeZone(explicit) {
  if (explicit && isValidIanaTimeZone(explicit)) return explicit;
  if (preferredDisplayTimeZone) return preferredDisplayTimeZone;
  return getBrowserTimeZone();
}
