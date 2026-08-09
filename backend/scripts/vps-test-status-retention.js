/**
 * VPS/local check: status checker digest + retention column + storage MB + scheduled-jobs help doc.
 * Usage: node scripts/vps-test-status-retention.js
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { initDb, getDb } from '../src/db/schema.js';
import {
  resolvePlatformHelpDir,
  PLATFORM_HELP_DOCUMENTS,
} from '../src/services/ceo-default-master-data.js';
import { runCooStatusChecker } from '../src/services/coo-status-checker.js';
import { purgeOwnerRetention, normalizeRetentionDays } from '../src/services/data-retention.js';
import { estimateOwnerStorage } from '../src/services/owner-storage.js';
import { getEfficiencySummary } from '../src/services/efficiency.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { seedStatusCheckerToolIfMissing } from '../src/db/seed-content-tools-meta.js';
import { grantCooDelegationToolsIfMissing } from '../src/services/openclaw-agent-tools.js';

initDb();
seedStatusCheckerToolIfMissing();
grantCooDelegationToolsIfMissing();

const owner = getBalaCeoAuthId();
const row = getDb().prepare('SELECT data_retention_days FROM platform_users WHERE id = ?').get(owner);
console.log('retention_days', normalizeRetentionDays(row?.data_retention_days));

const storage = await estimateOwnerStorage(owner);
console.log('storage_mb', storage.total_mb, 'rag_mb', storage.breakdown?.opensearch_rag_bytes);
if (!Array.isArray(storage.components)) throw new Error('storage missing components breakdown');

const summary = await getEfficiencySummary(owner, { days: 14 });
if (summary.totals.storage_mb == null) throw new Error('efficiency summary missing storage_mb');
console.log('efficiency.storage_mb', summary.totals.storage_mb);
if (!summary.totals.storage_breakdown?.components) {
  throw new Error('efficiency summary missing storage_breakdown.components');
}

const meta = getDb().prepare(`SELECT name FROM content_tools_meta WHERE name = 'status_checker'`).get();
if (!meta) throw new Error('status_checker meta missing');
const grants = getDb()
  .prepare(
    `SELECT COUNT(*) AS n FROM agent_tool_grants g JOIN agents a ON a.id = g.agent_id WHERE g.tool_name = 'status_checker' AND a.is_coo = 1`
  )
  .get().n;
if (!grants) throw new Error('status_checker not granted to COO');

const out = await runCooStatusChecker(owner, { email: false, postStandup: true });
console.log('status_checker', {
  standup_id: out.standup_id,
  counts: out.digest.counts,
  sync: (out.digest.sync_changes || []).length,
});

const dry = purgeOwnerRetention(owner, { days: 365 });
console.log('retention_purge_365d', dry.deleted);

// Scheduled-jobs / retention help doc must ship in the image and be seeded into Master Data RAG.
const CRON_HELP_FILE = '19-scheduled-jobs-and-crons.md';
if (!PLATFORM_HELP_DOCUMENTS.some((d) => d.filename === CRON_HELP_FILE)) {
  throw new Error(`${CRON_HELP_FILE} missing from PLATFORM_HELP_DOCUMENTS catalog`);
}
const helpDir = resolvePlatformHelpDir();
if (!helpDir || !existsSync(join(helpDir, CRON_HELP_FILE))) {
  throw new Error(`${CRON_HELP_FILE} not found on disk (help dir: ${helpDir || 'unresolved'})`);
}
const cronDocRows = getDb()
  .prepare(`SELECT COUNT(*) AS n FROM master_data_documents WHERE title LIKE '%Scheduled Jobs Crons%'`)
  .get().n;
console.log('cron_help_doc_seeded_for_ceos', cronDocRows);

console.log('VPS_STATUS_RETENTION_OK');
