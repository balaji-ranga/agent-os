/** Company session helpers: CEO (root) vs employees (sub-users). */

export function isCompanyUser(user) {
  return user?.role === 'ceo' || user?.role === 'org_user';
}

export function isTenantFullAccess(user) {
  return user?.role === 'ceo' || !!user?.is_ceo_delegate;
}

const ALWAYS_ON = new Set(['home', 'kanban', 'profile']);

export function hasPermission(user, key) {
  if (!key) return true;
  if (isTenantFullAccess(user)) return true;
  if (ALWAYS_ON.has(key)) return true;
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  return perms.includes(key);
}

export function filterCatalogByPermissions(items, user) {
  if (isTenantFullAccess(user)) return items;
  return (items || []).filter((it) => {
    if (it.always || ALWAYS_ON.has(it.id)) return true;
    if (it.id === 'home' || it.id === 'kanban') return true;
    return hasPermission(user, it.permission || it.id);
  });
}
