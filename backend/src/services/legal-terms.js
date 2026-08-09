/**
 * Versioned legal documents accepted at CEO registration.
 * Bump AGENT_OS_TERMS_VERSION / AGENT_OS_PRIVACY_VERSION (or constants below)
 * when published T&C / Privacy text changes; require re-accept for new signups
 * (existing users keep historical versions; re-accept gate can use these later).
 */

export const DEFAULT_TERMS_VERSION = '2026-08-09';
export const DEFAULT_PRIVACY_VERSION = '2026-08-09';

export function currentTermsVersion() {
  return String(process.env.AGENT_OS_TERMS_VERSION || DEFAULT_TERMS_VERSION).trim() || DEFAULT_TERMS_VERSION;
}

export function currentPrivacyVersion() {
  return (
    String(process.env.AGENT_OS_PRIVACY_VERSION || DEFAULT_PRIVACY_VERSION).trim() || DEFAULT_PRIVACY_VERSION
  );
}

export function getLegalVersionsPublic() {
  return {
    terms_version: currentTermsVersion(),
    privacy_version: currentPrivacyVersion(),
    cookie_policy_version: currentPrivacyVersion(),
    /** Canonical marketing paths (apex); login host also serves /legal/ via nginx. */
    paths: {
      terms: '/legal/terms.html',
      privacy: '/legal/privacy.html',
      cookies: '/legal/cookies.html',
      open_source: '/legal/open-source.html',
    },
  };
}

/**
 * Validate registration accept flags. Public self-serve register must accept.
 * @param {object} body
 * @param {{ requireAccept?: boolean }} [opts]
 */
export function assertTermsAcceptedAtRegister(body = {}, { requireAccept = true } = {}) {
  if (!requireAccept) return { ok: true, terms_version: null, privacy_version: null, terms_accepted_at: null };

  const accepted =
    body.accept_terms === true ||
    body.accept_terms === 1 ||
    String(body.accept_terms || '').toLowerCase() === 'true' ||
    String(body.accept_terms || '') === '1';

  if (!accepted) {
    const err = new Error('You must accept the Terms of Service and Privacy Policy to register');
    err.status = 400;
    throw err;
  }

  const expectedTerms = currentTermsVersion();
  const expectedPrivacy = currentPrivacyVersion();
  const clientTerms = body.terms_version != null ? String(body.terms_version).trim() : '';
  const clientPrivacy = body.privacy_version != null ? String(body.privacy_version).trim() : '';

  if (clientTerms && clientTerms !== expectedTerms) {
    const err = new Error(
      `Terms version mismatch (client sent ${clientTerms}, server expects ${expectedTerms}). Refresh and accept again.`
    );
    err.status = 400;
    throw err;
  }
  if (clientPrivacy && clientPrivacy !== expectedPrivacy) {
    const err = new Error(
      `Privacy version mismatch (client sent ${clientPrivacy}, server expects ${expectedPrivacy}). Refresh and accept again.`
    );
    err.status = 400;
    throw err;
  }

  return {
    ok: true,
    terms_version: expectedTerms,
    privacy_version: expectedPrivacy,
    terms_accepted_at: new Date().toISOString(),
  };
}
