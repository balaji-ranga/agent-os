/**
 * Platform-seeded Master Data documents (User Guide + Platform Help) must not be
 * deleted or purged by CEOs. Seed/refresh paths pass { force: true }.
 *
 * Kept as a tiny module (no master-data imports) to avoid circular deps with
 * ceo-default-master-data.js.
 */

export const FLOLAH_GUIDE_TITLE = 'Flolah User Guide';
export const FLOLAH_GUIDE_FILENAME = 'README.md';
export const PLATFORM_HELP_TITLE_PREFIX = 'Flolah Help —';
export const LEGACY_PLATFORM_HELP_TITLE_PREFIX = 'Flowlah Help —';
export const LEGACY_USER_GUIDE_TITLE = 'Flowlah User Guide';

/**
 * @param {{ title?: string, filename?: string }|null|undefined} doc
 * @returns {boolean}
 */
export function isProtectedPlatformDocument(doc) {
  if (!doc) return false;
  const title = String(doc.title || '').trim();
  const fn = String(doc.filename || '').trim().toLowerCase();

  if (title === FLOLAH_GUIDE_TITLE || title === LEGACY_USER_GUIDE_TITLE) return true;
  if (title.startsWith(PLATFORM_HELP_TITLE_PREFIX)) return true;
  if (title.startsWith(LEGACY_PLATFORM_HELP_TITLE_PREFIX)) return true;
  if (title.startsWith('Flowlah Help -')) return true;

  // Seeded filenames (ceo-default-master-data ensure* paths)
  if (fn === FLOLAH_GUIDE_FILENAME.toLowerCase()) return true;
  if (fn.startsWith('platform-help-')) return true;

  return false;
}
