/**
 * Deduplicate Platform Help Master Data docs for one CEO (keep newest per filename).
 * Then force-refresh from disk so lookback wording is current.
 * Usage: node scripts/heal-platform-help-docs.js [ownerUserId]
 */
import { initDb } from '../src/db/schema.js';
import { getDbForCeo } from '../src/db/request-db.js';
import { deleteDocument } from '../src/services/master-data.js';
import { ensurePlatformHelpDocuments } from '../src/services/ceo-default-master-data.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();
const owner = process.argv[2] || getBalaCeoAuthId();
const db = getDbForCeo(owner);

const rows = db
  .prepare(
    `SELECT id, title, filename, updated_at, chunk_count
     FROM master_data_documents
     WHERE owner_user_id = ?
       AND (title LIKE 'Flolah Help%' OR title LIKE 'Flowlah Help%' OR filename LIKE 'platform-help-%')
     ORDER BY filename, updated_at DESC, id DESC`
  )
  .all(owner);

const seen = new Set();
const toDelete = [];
for (const r of rows) {
  const key = String(r.filename || r.title || r.id);
  if (seen.has(key)) toDelete.push(r);
  else seen.add(key);
}

console.log({
  owner,
  help_docs: rows.length,
  unique_filenames: seen.size,
  duplicates_to_delete: toDelete.length,
});

for (const r of toDelete) {
  try {
    deleteDocument(owner, r.id, { force: true });
    console.log('deleted_dup', r.id, r.filename, r.updated_at);
  } catch (e) {
    console.warn('delete_failed', r.id, e.message);
  }
}

// Force content refresh: bump by re-reading from disk (hash will differ if file changed;
 // if hash matches after dup cleanup, still OK).
const out = await ensurePlatformHelpDocuments(owner, { refresh: true });
console.log('refresh', { created: out.created, updated: out.updated });

const needle = 'Feedback lookback window = 30 days';
const hit = db
  .prepare(
    `SELECT COUNT(*) AS n FROM master_data_doc_chunks c
     JOIN master_data_documents d ON d.id = c.document_id
     WHERE c.owner_user_id = ?
       AND d.filename = 'platform-help-11-content-tools-scripts-profile.md'
       AND instr(c.content, ?) > 0`
  )
  .get(owner, needle);
const left = db
  .prepare(
    `SELECT COUNT(*) AS n FROM master_data_documents
     WHERE owner_user_id = ? AND filename = 'platform-help-11-content-tools-scripts-profile.md'`
  )
  .get(owner);
console.log({ copies_of_11: left.n, lookback_chunk_hits: hit.n });
console.log(hit.n > 0 && left.n === 1 ? 'PASS: single help doc with 30-day lookback' : 'WARN: check manually');
