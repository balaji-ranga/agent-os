/**
 * Paths for versioned legal pages (served from static /legal on app + marketing hosts).
 * Prefer relative /legal so same-origin nginx/Vite public works.
 */
export const LEGAL_PATHS = {
  terms: '/legal/terms.html',
  privacy: '/legal/privacy.html',
  cookies: '/legal/cookies.html',
  openSource: '/legal/open-source.html',
};

/** Public Docusaurus user guide (apex + login nginx; no auth). */
export const PUBLIC_DOCS_PATH = '/docs/';

/** Fallback versions if /auth/legal-versions is unreachable. */
export const FALLBACK_LEGAL_VERSIONS = {
  terms_version: '2026-08-09',
  privacy_version: '2026-08-09',
};
