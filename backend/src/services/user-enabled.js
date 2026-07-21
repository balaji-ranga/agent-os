/**
 * Lightweight owner-enabled check for cron/schedule gates (no heavy imports).
 */
import { getDb } from '../db/schema.js';

export function isUserEnabled(userId) {
  if (!userId) return false;
  const row = getDb().prepare(`SELECT enabled FROM platform_users WHERE id = ?`).get(userId);
  return !!(row && row.enabled);
}
