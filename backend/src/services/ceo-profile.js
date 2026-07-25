/**
 * ceo_profile content tool — read the entitled CEO's platform profile (owner-scoped).
 * Agents must prefer this over chat memory for name/email/phone/etc.
 */
import { getUserById } from './users.js';

const PROFILE_FIELDS = [
  'id',
  'name',
  'email',
  'mobile',
  'region',
  'business_name',
  'industry',
  'industry_other',
  'role',
  'enabled',
];

/**
 * @param {object} body
 * @param {{ ownerUserId: string }} ctx
 */
export function executeCeoProfile(body = {}, { ownerUserId } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    return { ok: false, error: 'owner_user_id required' };
  }
  const user = getUserById(owner);
  if (!user || user.role !== 'ceo') {
    return { ok: false, error: 'CEO profile not found for this session' };
  }

  const requested = Array.isArray(body.fields)
    ? body.fields.map((f) => String(f || '').trim().toLowerCase()).filter(Boolean)
    : null;

  const profile = {};
  const missing = [];
  const keys = requested?.length ? requested : PROFILE_FIELDS;
  for (const key of keys) {
    if (!PROFILE_FIELDS.includes(key)) {
      missing.push(key);
      continue;
    }
    const val = user[key];
    profile[key] = val == null ? '' : val;
    if (key !== 'id' && key !== 'role' && key !== 'enabled' && (val == null || String(val).trim() === '')) {
      missing.push(key);
    }
  }

  return {
    ok: true,
    owner_user_id: owner,
    profile,
    missing_or_empty: missing.filter((k) => PROFILE_FIELDS.includes(k) || requested?.includes(k)),
    guidance:
      'Prefer profile.* for name/email/mobile/region/business. ' +
      'If a needed field is missing_or_empty, ask the CEO or use chat memory only as a last resort — and say you are using chat memory because the profile field is blank.',
  };
}

export { PROFILE_FIELDS };
