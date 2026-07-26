/**
 * Migrate SQLite master_data_documents (+ disk files) into OpenSearch for one owner.
 * Skips protected platform help docs (those are seeded via ensurePlatformHelpInOpenSearch).
 */
import { existsSync, readFileSync } from 'fs';
import { getDbForCeo } from '../../db/request-db.js';
import { isProtectedPlatformDocument } from '../master-data-protected-docs.js';
import { extractTextFromBuffer } from '../master-data-extract.js';
import { ensureMasterDataSchema } from '../master-data.js';
import { getDocument as osGetDocument, indexDocument } from './documents.js';
import { createHash } from 'crypto';

function contentSha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * @param {string} ownerUserId
 * @returns {Promise<{ owner: string, migrated: number, skipped: number, failed: Array<{id:string,error:string}> }>}
 */
export async function migrateSqliteDocsForOwner(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('ownerUserId required');

  const db = getDbForCeo(owner);
  ensureMasterDataSchema(db);

  let rows = [];
  try {
    rows = db
      .prepare(
        `SELECT * FROM master_data_documents WHERE owner_user_id = ? ORDER BY created_at ASC`
      )
      .all(owner);
  } catch (e) {
    console.warn('[opensearch/migrate] sqlite read failed owner=%s: %s', owner, e?.message || e);
    return { owner, migrated: 0, skipped: 0, failed: [] };
  }

  let migrated = 0;
  let skipped = 0;
  const failed = [];

  for (const row of rows) {
    if (isProtectedPlatformDocument(row)) {
      skipped += 1;
      continue;
    }
    try {
      const existing = await osGetDocument(owner, row.id);
      if (existing?.chunk_count > 0 && existing.storage_path) {
        skipped += 1;
        continue;
      }
      if (!row.storage_path || !existsSync(row.storage_path)) {
        failed.push({ id: row.id, error: 'file_missing' });
        continue;
      }
      const buffer = readFileSync(row.storage_path);
      const text = await extractTextFromBuffer(buffer, row.mime_type, row.filename);
      await indexDocument({
        ownerUserId: owner,
        documentId: row.id,
        title: row.title,
        filename: row.filename,
        mimeType: row.mime_type || 'application/octet-stream',
        sizeBytes: row.size_bytes || buffer.length,
        storagePath: row.storage_path,
        text,
        source: 'migration',
        uploadedByType: 'system',
        uploadedById: 'sqlite-migrate',
        tags: [],
        contentSha256: contentSha256(buffer),
      });
      migrated += 1;
    } catch (e) {
      failed.push({ id: row.id, error: e?.message || String(e) });
    }
  }

  console.info(
    '[opensearch/migrate] owner=%s migrated=%d skipped=%d failed=%d',
    owner,
    migrated,
    skipped,
    failed.length
  );
  return { owner, migrated, skipped, failed };
}

/**
 * Migrate all CEO owners listed.
 * @param {string[]} ownerUserIds
 */
export async function migrateSqliteDocsForAllOwners(ownerUserIds = []) {
  const ids = Array.isArray(ownerUserIds) ? ownerUserIds : [];
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await migrateSqliteDocsForOwner(id);
      migrated += r.migrated;
      skipped += r.skipped;
      failed += r.failed.length;
    } catch (e) {
      failed += 1;
      console.warn('[opensearch/migrate] owner=%s error=%s', id, e?.message || e);
    }
  }
  console.info(
    '[opensearch/migrate] all done owners=%d migrated=%d skipped=%d failed=%d',
    ids.length,
    migrated,
    skipped,
    failed
  );
  return { owners: ids.length, migrated, skipped, failed };
}
