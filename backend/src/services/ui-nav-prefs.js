/**
 * Owner-scoped UI nav preferences (show/hide sidebar menus).
 * Never a security boundary — APIs still enforce entitlements.
 */
import { getDb } from '../db/schema.js';

export const NAV_ALWAYS_VISIBLE = new Set([
  'home',
  'this-week',
  'profile',
  'nav-menus',
  'workspace-designer',
]);

export function ensureUiPrefsColumns(db = getDb()) {
  try {
    db.exec(`ALTER TABLE platform_users ADD COLUMN ui_nav_hidden TEXT DEFAULT '[]'`);
  } catch {
    /* column exists */
  }
}

export function parseHiddenList(raw) {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    if (!Array.isArray(v)) return [];
    return [...new Set(v.map((x) => String(x || '').trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function getUiNavHidden(userId) {
  ensureUiPrefsColumns();
  const row = getDb()
    .prepare('SELECT ui_nav_hidden FROM platform_users WHERE id = ?')
    .get(String(userId || '').trim());
  return parseHiddenList(row?.ui_nav_hidden);
}

/**
 * Persist hidden menu ids. Always-visible keys cannot be hidden.
 * @returns {string[]} effective hidden list
 */
export function setUiNavHidden(userId, hidden) {
  ensureUiPrefsColumns();
  const owner = String(userId || '').trim();
  if (!owner) throw Object.assign(new Error('user_id required'), { status: 400 });
  const list = parseHiddenList(hidden).filter((id) => !NAV_ALWAYS_VISIBLE.has(id));
  getDb()
    .prepare(
      `UPDATE platform_users SET ui_nav_hidden = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(JSON.stringify(list), owner);
  console.info('[ui-nav-prefs] saved owner=%s hidden_count=%s', owner, list.length);
  return list;
}
