/**
 * Force re-index Flolah User Guide + Platform Help into OpenSearch (PLATFORM_OWNER_ID).
 * Usage: node scripts/reupload-platform-help-docs.js
 *
 * Per-CEO Master Data no longer stores these docs — Platform Help RAG reads platform indices.
 */
import { initDb } from '../src/db/schema.js';
import { ensurePlatformHelpInOpenSearch } from '../src/services/opensearch/platform-docs.js';
import { listDocuments } from '../src/services/opensearch/documents.js';
import { PLATFORM_OWNER_ID } from '../src/services/opensearch/indices.js';
import {
  PLATFORM_HELP_TITLE_PREFIX,
  FLOLAH_GUIDE_TITLE,
} from '../src/services/ceo-default-master-data.js';

initDb();

const result = await ensurePlatformHelpInOpenSearch();
console.log('reupload result', {
  created: result.created,
  updated: result.updated,
  skipped: result.skipped,
});

const docs = await listDocuments(PLATFORM_OWNER_ID);
const help = docs.filter((d) => String(d.title || '').startsWith(PLATFORM_HELP_TITLE_PREFIX));
const guide = docs.find((d) => d.title === FLOLAH_GUIDE_TITLE);
const seedSample = help.filter((d) =>
  /API Keys|Getting Started|External Tools|Troubleshooting/i.test(String(d.title || ''))
);
console.log({
  owner: PLATFORM_OWNER_ID,
  helpDocs: help.length,
  guide: !!guide,
  sampleTitles: seedSample.map((d) => d.title),
});
console.log('PASS: platform help reupload');
