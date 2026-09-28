import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '').trim() : '';
};
const ownerUserId = valueAfter('--owner');
const apply = args.includes('--apply');
const backupDir = valueAfter('--backup-dir');

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
}

if (!ownerUserId) throw new Error('Usage: node scripts/repair-marketing-outcome-attribution.mjs --owner <owner-id> [--apply --backup-dir <directory>]');
if (apply && !backupDir) throw new Error('--backup-dir is required with --apply');

const { initDb } = await import('../src/db/schema.js');
const { getMarketingWorkspace } = await import('../src/services/marketing-workspace.js');
const { deleteRow, findTableByName } = await import('../src/services/master-data.js');

const db = initDb();
try {
  const workspace = getMarketingWorkspace(ownerUserId);
  const campaigns = new Map(workspace.records.campaigns.map((row) => [row.campaign_id, row]));
  const assets = new Map(workspace.records.assets.map((row) => [row.asset_id, row]));
  const invalid = workspace.records.outcomes.filter((row) => {
    if (row.source !== 'email_send_reconciliation') return false;
    const observedAt = parseTimestamp(row.observed_at || row.created_at);
    const campaignCreatedAt = parseTimestamp(campaigns.get(row.campaign_id)?.created_at);
    const assetCreatedAt = parseTimestamp(assets.get(row.asset_id)?.created_at);
    const boundary = Math.max(Number.isFinite(campaignCreatedAt) ? campaignCreatedAt : 0, Number.isFinite(assetCreatedAt) ? assetCreatedAt : 0);
    return Number.isFinite(observedAt) && boundary > 0 && observedAt < boundary;
  });

  const summary = {
    owner_user_id: ownerUserId,
    mode: apply ? 'apply' : 'dry-run',
    invalid_count: invalid.length,
    outcome_ids: invalid.map((row) => row.outcome_id),
    earliest_observed_at: invalid.map((row) => row.observed_at).filter(Boolean).sort()[0] || '',
    latest_observed_at: invalid.map((row) => row.observed_at).filter(Boolean).sort().at(-1) || '',
  };

  if (apply && invalid.length) {
    const table = findTableByName(ownerUserId, 'marketing_campaign_outcomes');
    if (!table?.id) throw new Error('marketing_campaign_outcomes table not found');
    const targetDir = resolve(backupDir);
    mkdirSync(targetDir, { recursive: true });
    const backupPath = resolve(targetDir, `marketing-outcome-attribution-${ownerUserId}-${Date.now()}.json`);
    writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), summary, rows: invalid }, null, 2), { encoding: 'utf8', mode: 0o600 });
    for (const row of invalid) deleteRow(ownerUserId, table.id, row.row_id);
    const remainingIds = new Set(getMarketingWorkspace(ownerUserId).records.outcomes.map((row) => row.outcome_id));
    const undeleted = invalid.filter((row) => remainingIds.has(row.outcome_id));
    if (undeleted.length) throw new Error(`Failed to remove ${undeleted.length} invalid outcome rows`);
    summary.deleted_count = invalid.length;
    summary.backup_path = backupPath;
  } else {
    summary.deleted_count = 0;
  }

  console.log(JSON.stringify(summary, null, 2));
} finally {
  db.close();
}
