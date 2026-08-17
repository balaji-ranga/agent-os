/** Preset display titles for the signed-in user's org role (UI only; auth role stays ceo/admin). */
export const ROLE_TITLE_PRESETS = [
  'CEO',
  'Founder',
  'Owner',
  'Managing Director',
  'President',
  'Partner',
  'Director',
];

/**
 * User-facing role label. Does not change authz (`user.role`).
 * Empty/missing title falls back to CEO for ceo accounts, else the raw role.
 */
export function userRoleTitle(user) {
  const custom = String(user?.role_title || '').trim();
  if (custom) return custom;
  if (user?.role === 'ceo') return 'CEO';
  if (user?.is_ceo_delegate) return 'CEO Delegate';
  if (user?.role === 'org_user') return 'Employee';
  if (user?.role === 'admin') return 'Admin';
  return user?.role ? String(user.role) : 'User';
}