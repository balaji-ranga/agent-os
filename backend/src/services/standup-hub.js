/**
 * Internal standup helpers: hidden delegation hub + user-visible standup filtering.
 */
import { getDb } from '../db/schema.js';

/** Standup sources that must not appear in the CEO standup list. */
export const HIDDEN_STANDUP_SOURCES = [
  'delegation_hub',
  'coo_chat_delegate',
  'kanban',
  'agent_workflow',
  'job_pipeline',
  'cron',
];

export function isVisibleStandupSource(source) {
  const s = String(source || 'manual').trim();
  return !HIDDEN_STANDUP_SOURCES.includes(s);
}

export function hiddenStandupSourcesSqlIn() {
  return HIDDEN_STANDUP_SOURCES.map((s) => `'${s}'`).join(', ');
}

/**
 * Reusable internal standup for COO chat / tool delegations (not listed in UI).
 * @param {string} ownerUserId
 * @returns {number}
 */
export function getOrCreateDelegationHubStandup(ownerUserId) {
  if (!ownerUserId) throw new Error('ownerUserId required for delegation hub');
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM standups WHERE owner_user_id = ? AND source = 'delegation_hub' LIMIT 1`)
    .get(ownerUserId);
  if (existing?.id) return existing.id;

  db.prepare(
    `INSERT INTO standups (scheduled_at, status, source, title, owner_user_id)
     VALUES (datetime('now'), 'active', 'delegation_hub', 'Delegation hub', ?)`
  ).run(ownerUserId);
  const row = db.prepare('SELECT id FROM standups WHERE id = last_insert_rowid()').get();
  if (!row?.id) throw new Error('could not create delegation hub standup');
  return row.id;
}
