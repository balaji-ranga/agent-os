/** Normalize job-applicant / media API paths for authenticated fetch. */
export function normalizeApiPath(href) {
  if (!href || typeof href !== 'string') return '';
  const trimmed = href.trim();
  if (trimmed.startsWith('/api/')) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.pathname.startsWith('/api/')) return `${u.pathname}${u.search}`;
  } catch (_) {
    /* relative or invalid */
  }
  return trimmed;
}

export function isAuthenticatedApiPath(href) {
  const raw = String(href || '');
  const p = normalizeApiPath(href);
  // All /api/media paths need Bearer (or MEDIA: rewrite) — signed public fetch is off by default.
  // If a legacy ?sig= URL is pasted, still try Bearer so chat players work when signed mode is disabled.
  void raw;
  return p.startsWith('/api/job-applicant/') || p.startsWith('/api/media/') || /\/api\/media\//i.test(raw);
}
