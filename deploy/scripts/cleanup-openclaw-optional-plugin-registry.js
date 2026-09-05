/**
 * Remove stale install records for optional runtimes that Flolah deliberately
 * does not load. OpenClaw can retain these records after their package folders
 * are removed, then refuse gateway startup during plugin verification.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from '../../backend/node_modules/better-sqlite3/lib/index.js';
import { resolveOpenClawDir } from '../../scripts/lib/openclaw-paths.js';

const openclawDir = resolveOpenClawDir();
const dbPath = process.env.OPENCLAW_STATE_DB_PATH || join(openclawDir, 'state', 'openclaw.sqlite');
const removable = new Set(['codex']);
if (String(process.env.OPENCLAW_ENABLE_DEEPSEEK_PLUGIN || '0') !== '1') removable.add('deepseek');

if (!existsSync(dbPath)) process.exit(0);

const db = new Database(dbPath);
try {
  const row = db.prepare(
    `SELECT value_json FROM config_machine_state WHERE state_key = 'plugins.installedIndex'`
  ).get();
  if (!row?.value_json) process.exit(0);
  const state = JSON.parse(row.value_json);
  const records = state?.index?.installRecords;
  if (!records || typeof records !== 'object') process.exit(0);
  const removed = [...removable].filter((id) => Object.hasOwn(records, id));
  if (removed.length === 0) process.exit(0);

  const backupDir = join(openclawDir, 'migration-backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, 'openclaw.sqlite.pre-optional-plugin-registry-cleanup');
  if (!existsSync(backupPath)) copyFileSync(dbPath, backupPath);

  for (const id of removed) delete records[id];
  const now = Date.now();
  state.revision = now;
  if (state.index) state.index.generatedAtMs = now;
  db.prepare(
    `UPDATE config_machine_state SET value_json = ?, updated_at_ms = ? WHERE state_key = 'plugins.installedIndex'`
  ).run(JSON.stringify(state), now);
  console.log('[openclaw] Removed stale optional plugin install records:', removed.join(', '));
} finally {
  db.close();
}
