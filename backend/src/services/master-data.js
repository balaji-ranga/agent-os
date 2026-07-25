/**
 * Per-CEO master data: tables (CSV/schema), documents on filesystem, query + RAG.
 * All data scoped via getDbForCeo(ownerUserId) — never trust body owner ids.
 */
import { createHash, randomBytes } from 'crypto';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  rmSync,
} from 'fs';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { isProtectedPlatformDocument } from './master-data-protected-docs.js';
import { getDbForCeo } from '../db/request-db.js';
import { chatCompletions } from '../config/llm.js';
import { extractTextFromBuffer } from './master-data-extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS master_data_tables (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    columns_json TEXT NOT NULL DEFAULT '[]',
    row_count INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_md_tables_owner ON master_data_tables(owner_user_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS master_data_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    row_json TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (table_id) REFERENCES master_data_tables(id)
  );
  CREATE INDEX IF NOT EXISTS idx_md_rows_table ON master_data_rows(owner_user_id, table_id);

  CREATE TABLE IF NOT EXISTS master_data_documents (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size_bytes INTEGER DEFAULT 0,
    storage_path TEXT NOT NULL,
    text_excerpt TEXT DEFAULT '',
    chunk_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_md_docs_owner ON master_data_documents(owner_user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS master_data_doc_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES master_data_documents(id)
  );
  CREATE INDEX IF NOT EXISTS idx_md_chunks_doc ON master_data_doc_chunks(owner_user_id, document_id);
  CREATE INDEX IF NOT EXISTS idx_md_chunks_owner ON master_data_doc_chunks(owner_user_id);
`;

export function ensureMasterDataSchema(db) {
  if (!db) return;
  db.exec(SCHEMA_SQL);
  // Case-insensitive unique table names per owner (skip if legacy duplicates block it)
  try {
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_md_tables_owner_name_ci
       ON master_data_tables(owner_user_id, lower(name))`
    );
  } catch {
    /* existing duplicate names — app-level check still enforces new creates */
  }
}

function dbFor(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const db = getDbForCeo(owner);
  ensureMasterDataSchema(db);
  return { db, owner };
}

function slugId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function safeName(name) {
  return String(name || 'untitled')
    .trim()
    .slice(0, 120) || 'untitled';
}

/** Compare table names case-insensitively. */
export function tableNamesEqual(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Prefer: most rows, then newest updated_at, then oldest created_at (stable canonical).
 */
export function pickCanonicalTable(tables = []) {
  const list = Array.isArray(tables) ? [...tables] : [];
  if (!list.length) return null;
  list.sort((a, b) => {
    const rc = (b.row_count || 0) - (a.row_count || 0);
    if (rc !== 0) return rc;
    const ub = String(b.updated_at || '');
    const ua = String(a.updated_at || '');
    if (ub !== ua) return ub > ua ? 1 : -1;
    const ca = String(a.created_at || '');
    const cb = String(b.created_at || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return list[0];
}

export function findTablesByName(ownerUserId, name) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) return [];
  return listTables(ownerUserId).filter((t) => String(t.name || '').trim().toLowerCase() === needle);
}

export function findTableByName(ownerUserId, name) {
  return pickCanonicalTable(findTablesByName(ownerUserId, name));
}

function assertUniqueTableName(ownerUserId, name, { excludeTableId = null } = {}) {
  const label = safeName(name);
  const matches = findTablesByName(ownerUserId, label).filter(
    (t) => !excludeTableId || t.id !== excludeTableId
  );
  if (matches.length) {
    throw new Error(`A master data table named "${matches[0].name}" already exists`);
  }
  return label;
}

function dataRoot() {
  return process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../data');
}

/** Filesystem: {DATA}/master-data/{ceo}/docs/{docId}/ */
export function masterDataDocsDir(ownerUserId, documentId = null) {
  const safeCeo = String(ownerUserId).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const base = join(dataRoot(), 'master-data', safeCeo, 'docs');
  if (documentId) return join(base, String(documentId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
  return base;
}

function parseColumnsJson(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function mapTable(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner_user_id: row.owner_user_id,
    name: row.name,
    description: row.description || '',
    columns: parseColumnsJson(row.columns_json),
    row_count: row.row_count || 0,
    source: row.source || 'manual',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapDoc(row) {
  if (!row) return null;
  const mapped = {
    id: row.id,
    owner_user_id: row.owner_user_id,
    title: row.title,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes || 0,
    text_excerpt: row.text_excerpt || '',
    chunk_count: row.chunk_count || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  mapped.is_protected = isProtectedPlatformDocument(mapped);
  return mapped;
}

/** Simple CSV parser (handles quoted fields). */
export function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
      if (ch === '\r') i++;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      if (row.some((c) => String(c).trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  if (!rows.length) return { columns: [], records: [] };
  const headers = rows[0].map((h, i) => {
    const t = String(h || '').trim() || `col_${i + 1}`;
    return t.replace(/[^\w\s.-]/g, '').slice(0, 64) || `col_${i + 1}`;
  });
  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = rows[r][i] != null ? String(rows[r][i]) : '';
    });
    records.push(obj);
  }
  return { columns: headers, records };
}

export function listTables(ownerUserId) {
  const { db, owner } = dbFor(ownerUserId);
  return db
    .prepare(
      `SELECT * FROM master_data_tables WHERE owner_user_id = ? ORDER BY updated_at DESC`
    )
    .all(owner)
    .map(mapTable);
}

export function getTable(ownerUserId, tableId) {
  const { db, owner } = dbFor(ownerUserId);
  const row = db
    .prepare(`SELECT * FROM master_data_tables WHERE id = ? AND owner_user_id = ?`)
    .get(String(tableId), owner);
  return mapTable(row);
}

export function createTable(ownerUserId, { name, description = '', columns = [] } = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const label = assertUniqueTableName(owner, name);
  const id = slugId('mdt');
  const cols = Array.isArray(columns)
    ? columns.map((c) => String(c).trim()).filter(Boolean)
    : [];
  db.prepare(
    `INSERT INTO master_data_tables (id, owner_user_id, name, description, columns_json, row_count, source)
     VALUES (?, ?, ?, ?, ?, 0, 'manual')`
  ).run(id, owner, label, String(description || ''), JSON.stringify(cols));
  return getTable(owner, id);
}

/**
 * Update table metadata only (purpose/description). Does not alter columns or drop the table.
 */
export function updateTableMeta(ownerUserId, tableId, { description } = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const existing = getTable(owner, tableId);
  if (!existing) throw new Error('Table not found');
  if (description === undefined) return existing;
  db.prepare(
    `UPDATE master_data_tables SET description = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(String(description || ''), String(tableId), owner);
  return getTable(owner, tableId);
}

/**
 * Append missing column names to an existing table (schema upgrade for seeded tables).
 * Existing rows keep their data; new columns read as empty until edited.
 */
export function ensureTableColumns(ownerUserId, tableId, columns = []) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const next = Array.isArray(table.columns) ? [...table.columns] : [];
  const seen = new Set(next.map((c) => String(c).toLowerCase()));
  const added = [];
  for (const raw of Array.isArray(columns) ? columns : []) {
    const col = String(raw || '').trim();
    if (!col || seen.has(col.toLowerCase())) continue;
    next.push(col);
    seen.add(col.toLowerCase());
    added.push(col);
  }
  if (!added.length) return { table, added };
  db.prepare(
    `UPDATE master_data_tables SET columns_json = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(JSON.stringify(next), table.id, owner);
  return { table: getTable(owner, table.id), added };
}

/** Resolve table by id or case-insensitive name (canonical pick if duplicates). */
export function resolveTable(ownerUserId, { tableId = null, tableName = null } = {}) {
  if (tableId) {
    const t = getTable(ownerUserId, tableId);
    if (!t) throw new Error('Table not found');
    return t;
  }
  const name = String(tableName || '').trim();
  if (!name) throw new Error('table_id or table_name required');
  const t = findTableByName(ownerUserId, name);
  if (!t) throw new Error(`Table not found: ${name}`);
  return t;
}

export function deleteTable(ownerUserId, tableId) {
  const { db, owner } = dbFor(ownerUserId);
  const existing = getTable(owner, tableId);
  if (!existing) throw new Error('Table not found');
  db.prepare(`DELETE FROM master_data_rows WHERE table_id = ? AND owner_user_id = ?`).run(
    String(tableId),
    owner
  );
  db.prepare(`DELETE FROM master_data_tables WHERE id = ? AND owner_user_id = ?`).run(
    String(tableId),
    owner
  );
  return { ok: true, id: tableId };
}

/** Server-side page size for table browse / query. */
export const MASTER_DATA_PAGE_SIZE = 50;

function clampPageLimit(limit) {
  return Math.min(Math.max(Number(limit) || MASTER_DATA_PAGE_SIZE, 1), MASTER_DATA_PAGE_SIZE);
}

function refreshTableRowCount(db, owner, tableId) {
  db.prepare(
    `UPDATE master_data_tables SET row_count = (SELECT COUNT(*) FROM master_data_rows WHERE table_id = ? AND owner_user_id = ?),
     updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
  ).run(tableId, owner, tableId, owner);
}

function normalizeRowData(columns, data = {}) {
  const cols = Array.isArray(columns) ? columns : [];
  const src = data && typeof data === 'object' ? data : {};
  const out = {};
  if (cols.length) {
    for (const c of cols) out[c] = src[c] != null ? String(src[c]) : '';
  } else {
    for (const [k, v] of Object.entries(src)) out[String(k)] = v != null ? String(v) : '';
  }
  return out;
}

function parseRowJson(raw) {
  try {
    return JSON.parse(raw || '{}') || {};
  } catch {
    return {};
  }
}

export function listRows(ownerUserId, tableId, { limit = MASTER_DATA_PAGE_SIZE, offset = 0 } = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const lim = clampPageLimit(limit);
  const off = Math.max(Number(offset) || 0, 0);
  const totalRow = db
    .prepare(
      `SELECT COUNT(*) AS c FROM master_data_rows WHERE table_id = ? AND owner_user_id = ?`
    )
    .get(String(tableId), owner);
  const total = totalRow?.c || 0;
  const rows = db
    .prepare(
      `SELECT id, row_json, created_at FROM master_data_rows
       WHERE table_id = ? AND owner_user_id = ?
       ORDER BY id ASC LIMIT ? OFFSET ?`
    )
    .all(String(tableId), owner, lim, off);
  return {
    table,
    rows: rows.map((r) => ({
      id: r.id,
      data: parseRowJson(r.row_json),
      created_at: r.created_at,
    })),
    total,
    limit: lim,
    offset: off,
  };
}

export function insertRow(ownerUserId, tableId, data = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const rowData = normalizeRowData(table.columns, data);
  const info = db
    .prepare(`INSERT INTO master_data_rows (table_id, owner_user_id, row_json) VALUES (?, ?, ?)`)
    .run(String(tableId), owner, JSON.stringify(rowData));
  refreshTableRowCount(db, owner, String(tableId));
  return {
    table: getTable(owner, tableId),
    row: { id: Number(info.lastInsertRowid), data: rowData },
  };
}

export function updateRow(ownerUserId, tableId, rowId, data = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const existing = db
    .prepare(
      `SELECT id, row_json FROM master_data_rows WHERE id = ? AND table_id = ? AND owner_user_id = ?`
    )
    .get(Number(rowId), String(tableId), owner);
  if (!existing) throw new Error('Row not found');
  const prev = parseRowJson(existing.row_json);
  const merged = normalizeRowData(table.columns.length ? table.columns : Object.keys({ ...prev, ...data }), {
    ...prev,
    ...data,
  });
  db.prepare(
    `UPDATE master_data_rows SET row_json = ? WHERE id = ? AND table_id = ? AND owner_user_id = ?`
  ).run(JSON.stringify(merged), Number(rowId), String(tableId), owner);
  db.prepare(
    `UPDATE master_data_tables SET updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
  ).run(String(tableId), owner);
  return {
    table: getTable(owner, tableId),
    row: { id: Number(rowId), data: merged },
  };
}

export function deleteRow(ownerUserId, tableId, rowId) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const info = db
    .prepare(
      `DELETE FROM master_data_rows WHERE id = ? AND table_id = ? AND owner_user_id = ?`
    )
    .run(Number(rowId), String(tableId), owner);
  if (!info.changes) throw new Error('Row not found');
  refreshTableRowCount(db, owner, String(tableId));
  return { ok: true, id: Number(rowId), table: getTable(owner, tableId) };
}

export function importCsv(ownerUserId, { name, description = '', csvText, tableId = null } = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const { columns, records } = parseCsv(csvText);
  if (!columns.length) throw new Error('CSV has no header row');
  let table;
  if (tableId) {
    table = getTable(owner, tableId);
    if (!table) throw new Error('Table not found');
    db.prepare(
      `UPDATE master_data_tables SET columns_json = ?, source = 'csv', updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
    ).run(JSON.stringify(columns), table.id, owner);
  } else {
    const label = assertUniqueTableName(owner, name || 'Imported CSV');
    const id = slugId('mdt');
    db.prepare(
      `INSERT INTO master_data_tables (id, owner_user_id, name, description, columns_json, row_count, source)
       VALUES (?, ?, ?, ?, ?, 0, 'csv')`
    ).run(id, owner, label, String(description || ''), JSON.stringify(columns));
    table = getTable(owner, id);
  }

  const insert = db.prepare(
    `INSERT INTO master_data_rows (table_id, owner_user_id, row_json) VALUES (?, ?, ?)`
  );
  const tx = db.transaction((recs) => {
    for (const rec of recs) insert.run(table.id, owner, JSON.stringify(rec));
  });
  tx(records);
  db.prepare(
    `UPDATE master_data_tables SET row_count = (SELECT COUNT(*) FROM master_data_rows WHERE table_id = ? AND owner_user_id = ?),
     updated_at = datetime('now') WHERE id = ? AND owner_user_id = ?`
  ).run(table.id, owner, table.id, owner);
  return { table: getTable(owner, table.id), imported: records.length };
}

/**
 * Query table rows: keyword match across JSON, optional column filter equals.
 * Server-side pagination: default/max page size = MASTER_DATA_PAGE_SIZE (50).
 */
export function queryTable(
  ownerUserId,
  {
    tableId,
    query = '',
    column = null,
    equals = null,
    limit = MASTER_DATA_PAGE_SIZE,
    offset = 0,
  } = {}
) {
  const { db, owner } = dbFor(ownerUserId);
  const table = getTable(owner, tableId);
  if (!table) throw new Error('Table not found');
  const lim = clampPageLimit(limit);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db
    .prepare(
      `SELECT id, row_json, created_at FROM master_data_rows
       WHERE table_id = ? AND owner_user_id = ? ORDER BY id ASC`
    )
    .all(String(tableId), owner);

  const q = String(query || '').trim().toLowerCase();
  const col = column != null && String(column).trim() ? String(column).trim() : null;
  const eq = equals != null ? String(equals) : null;

  const matched = [];
  for (const r of rows) {
    const data = parseRowJson(r.row_json);
    if (col && eq != null && String(data[col] ?? '') !== eq) continue;
    if (q) {
      const hay = JSON.stringify(data).toLowerCase();
      if (!hay.includes(q)) continue;
    }
    matched.push({ id: r.id, data, created_at: r.created_at });
  }

  const page = matched.slice(off, off + lim);

  return {
    table,
    query: q || null,
    filter: col ? { column: col, equals: eq } : null,
    total: matched.length,
    count: page.length,
    limit: lim,
    offset: off,
    rows: page,
    text: page
      .slice(0, 20)
      .map((m, i) => `${i + 1}. ${JSON.stringify(m.data)}`)
      .join('\n'),
  };
}

function chunkText(text, size = 900, overlap = 120) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!t) return [];
  const chunks = [];
  let i = 0;
  while (i < t.length) {
    const end = Math.min(i + size, t.length);
    chunks.push(t.slice(i, end));
    if (end >= t.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

export function listDocuments(ownerUserId) {
  const { db, owner } = dbFor(ownerUserId);
  return db
    .prepare(
      `SELECT * FROM master_data_documents WHERE owner_user_id = ? ORDER BY created_at DESC`
    )
    .all(owner)
    .map(mapDoc);
}

export function getDocument(ownerUserId, documentId) {
  const { db, owner } = dbFor(ownerUserId);
  const row = db
    .prepare(`SELECT * FROM master_data_documents WHERE id = ? AND owner_user_id = ?`)
    .get(String(documentId), owner);
  return mapDoc(row);
}

export function getDocumentFile(ownerUserId, documentId) {
  const { db, owner } = dbFor(ownerUserId);
  const row = db
    .prepare(`SELECT * FROM master_data_documents WHERE id = ? AND owner_user_id = ?`)
    .get(String(documentId), owner);
  if (!row) throw new Error('Document not found');
  if (!existsSync(row.storage_path)) throw new Error('Document file missing on disk');
  return {
    meta: mapDoc(row),
    buffer: readFileSync(row.storage_path),
    path: row.storage_path,
  };
}

function replaceDocumentChunks(db, owner, documentId, text) {
  const chunks = chunkText(text);
  const excerpt = text.slice(0, 500);
  db.prepare(`DELETE FROM master_data_doc_chunks WHERE document_id = ? AND owner_user_id = ?`).run(
    documentId,
    owner
  );
  const ins = db.prepare(
    `INSERT INTO master_data_doc_chunks (document_id, owner_user_id, chunk_index, content) VALUES (?, ?, ?, ?)`
  );
  const tx = db.transaction((list) => {
    list.forEach((c, i) => ins.run(documentId, owner, i, c));
  });
  tx(chunks);
  db.prepare(
    `UPDATE master_data_documents
     SET text_excerpt = ?, chunk_count = ?, updated_at = datetime('now')
     WHERE id = ? AND owner_user_id = ?`
  ).run(excerpt, chunks.length, documentId, owner);
  return { chunks, excerpt };
}

/**
 * Upload document: metadata in SQLite, bytes under master-data/{ceo}/docs/{id}/
 * Extracts text from PDF / DOCX / Excel for keyword RAG chunking.
 * @param {{ title?, filename, mimeType?, contentBase64?, contentText? }}
 */
export async function uploadDocument(ownerUserId, input = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const filename = basename(String(input.filename || 'document.txt'));
  let buffer;
  if (input.contentBase64) {
    buffer = Buffer.from(String(input.contentBase64), 'base64');
  } else if (input.contentText != null) {
    buffer = Buffer.from(String(input.contentText), 'utf8');
  } else {
    throw new Error('contentBase64 or contentText required');
  }
  if (buffer.length > 15 * 1024 * 1024) throw new Error('File too large (max 15MB)');

  const id = slugId('mdd');
  const dir = masterDataDocsDir(owner, id);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, filename);
  writeFileSync(storagePath, buffer);

  const mime = String(input.mimeType || 'application/octet-stream');
  const text = await extractTextFromBuffer(buffer, mime, filename);
  const chunks = chunkText(text);
  const excerpt = text.slice(0, 500);
  const title = safeName(input.title || filename.replace(extname(filename), '') || 'Document');

  db.prepare(
    `INSERT INTO master_data_documents
      (id, owner_user_id, title, filename, mime_type, size_bytes, storage_path, text_excerpt, chunk_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, owner, title, filename, mime, buffer.length, storagePath, excerpt, chunks.length);

  const ins = db.prepare(
    `INSERT INTO master_data_doc_chunks (document_id, owner_user_id, chunk_index, content) VALUES (?, ?, ?, ?)`
  );
  const tx = db.transaction((list) => {
    list.forEach((c, i) => ins.run(id, owner, i, c));
  });
  tx(chunks);

  return getDocument(owner, id);
}

/**
 * Re-extract text from the file on disk and rebuild RAG chunks (for docs uploaded before office support).
 */
export async function reindexDocument(ownerUserId, documentId) {
  const { db, owner } = dbFor(ownerUserId);
  const row = db
    .prepare(`SELECT * FROM master_data_documents WHERE id = ? AND owner_user_id = ?`)
    .get(String(documentId), owner);
  if (!row) throw new Error('Document not found');
  if (!row.storage_path || !existsSync(row.storage_path)) {
    throw new Error('Document file missing on disk');
  }
  const buffer = readFileSync(row.storage_path);
  const text = await extractTextFromBuffer(buffer, row.mime_type, row.filename);
  replaceDocumentChunks(db, owner, row.id, text);
  return getDocument(owner, row.id);
}

/** Reindex all documents for an owner. Returns { reindexed, failed[] }. */
export async function reindexAllDocuments(ownerUserId) {
  const docs = listDocuments(ownerUserId);
  const failed = [];
  let reindexed = 0;
  for (const d of docs) {
    try {
      await reindexDocument(ownerUserId, d.id);
      reindexed += 1;
    } catch (err) {
      failed.push({ id: d.id, title: d.title, error: err?.message || String(err) });
    }
  }
  return { reindexed, failed, total: docs.length };
}

/**
 * Delete one document (DB row + chunks + disk). Platform Help / User Guide are
 * blocked unless `{ force: true }` (seed/refresh only).
 */
export function deleteDocument(ownerUserId, documentId, { force = false } = {}) {
  const { db, owner } = dbFor(ownerUserId);
  const row = db
    .prepare(`SELECT * FROM master_data_documents WHERE id = ? AND owner_user_id = ?`)
    .get(String(documentId), owner);
  if (!row) throw new Error('Document not found');
  if (!force && isProtectedPlatformDocument(row)) {
    const err = new Error(
      'Platform Help and User Guide documents cannot be deleted. Use Purge all to remove your uploaded documents only.'
    );
    err.code = 'PROTECTED_DOCUMENT';
    err.status = 403;
    throw err;
  }
  db.prepare(`DELETE FROM master_data_doc_chunks WHERE document_id = ? AND owner_user_id = ?`).run(
    row.id,
    owner
  );
  db.prepare(`DELETE FROM master_data_documents WHERE id = ? AND owner_user_id = ?`).run(row.id, owner);
  try {
    if (row.storage_path && existsSync(row.storage_path)) unlinkSync(row.storage_path);
    const dir = dirname(row.storage_path);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
  return { ok: true, id: documentId };
}

/**
 * Delete every user-uploaded document for the CEO (table + chunks + disk).
 * Platform Help / Flolah User Guide are retained.
 */
export function purgeAllUserDocuments(ownerUserId) {
  const { db, owner } = dbFor(ownerUserId);
  const rows = db
    .prepare(`SELECT * FROM master_data_documents WHERE owner_user_id = ? ORDER BY created_at DESC`)
    .all(owner);
  const deleted = [];
  const retained = [];
  const failed = [];
  for (const row of rows) {
    if (isProtectedPlatformDocument(row)) {
      retained.push({ id: row.id, title: row.title, filename: row.filename });
      continue;
    }
    try {
      deleteDocument(owner, row.id, { force: false });
      deleted.push({ id: row.id, title: row.title, filename: row.filename });
    } catch (e) {
      failed.push({ id: row.id, title: row.title, error: e?.message || String(e) });
    }
  }
  console.info(
    '[master-data] purgeAllUserDocuments owner=%s deleted=%d retained=%d failed=%d',
    owner,
    deleted.length,
    retained.length,
    failed.length
  );
  return {
    ok: true,
    deleted_count: deleted.length,
    retained_count: retained.length,
    failed_count: failed.length,
    deleted,
    retained,
    failed,
  };
}

function scoreChunk(content, queryTerms) {
  const hay = String(content || '').toLowerCase();
  let score = 0;
  for (const t of queryTerms) {
    if (!t) continue;
    if (hay.includes(t)) score += 1 + (hay.split(t).length - 1) * 0.1;
  }
  return score;
}

/**
 * RAG over owner documents: keyword retrieval + optional LLM summary (user BYOK aware).
 *
 * `summarize` is opt-in: retrieval is free, the summary costs an LLM call per request.
 * Callers that want a synthesized answer (CEO UI, workflow nodes) pass it explicitly.
 */
export async function ragDocuments(
  ownerUserId,
  { query, topK = 5, documentId = null, summarize = false } = {}
) {
  const { db, owner } = dbFor(ownerUserId);
  const q = String(query || '').trim();
  if (!q) throw new Error('query required');
  const terms = q
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2)
    .slice(0, 20);
  const k = Math.min(Math.max(Number(topK) || 5, 1), 20);

  let chunks;
  if (documentId) {
    const doc = getDocument(owner, documentId);
    if (!doc) throw new Error('Document not found');
    chunks = db
      .prepare(
        `SELECT c.*, d.title, d.filename FROM master_data_doc_chunks c
         JOIN master_data_documents d ON d.id = c.document_id
         WHERE c.owner_user_id = ? AND c.document_id = ?`
      )
      .all(owner, String(documentId));
  } else {
    chunks = db
      .prepare(
        `SELECT c.*, d.title, d.filename FROM master_data_doc_chunks c
         JOIN master_data_documents d ON d.id = c.document_id
         WHERE c.owner_user_id = ?`
      )
      .all(owner);
  }

  const scored = chunks
    .map((c) => ({
      document_id: c.document_id,
      title: c.title,
      filename: c.filename,
      chunk_index: c.chunk_index,
      content: c.content,
      score: scoreChunk(c.content, terms.length ? terms : [q.toLowerCase()]),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  // Fallback: if no term hits, return first chunks
  const hits =
    scored.length > 0
      ? scored
      : chunks.slice(0, k).map((c) => ({
          document_id: c.document_id,
          title: c.title,
          filename: c.filename,
          chunk_index: c.chunk_index,
          content: c.content,
          score: 0,
        }));

  const contextText = hits
    .map((h, i) => `[${i + 1}] (${h.title || h.filename})\n${h.content}`)
    .join('\n\n');

  let summary = '';
  if (summarize && hits.length) {
    try {
      const { content } = await chatCompletions({
        messages: [
          {
            role: 'system',
            content:
              'Answer using only the provided document excerpts for this user. If unsure, say so. Cite excerpt numbers.',
          },
          {
            role: 'user',
            content: `Question: ${q}\n\nExcerpts:\n${contextText.slice(0, 12000)}`,
          },
        ],
        maxTokens: 800,
        ownerUserId: owner,
      });
      summary = String(content || '').trim();
    } catch (e) {
      summary = `(LLM summary unavailable: ${e.message})\n\nTop excerpts:\n${contextText.slice(0, 2000)}`;
    }
  }

  return {
    owner_user_id: owner,
    query: q,
    hit_count: hits.length,
    chunks: hits,
    summary: summary || contextText.slice(0, 2000),
    text: summary || contextText.slice(0, 2000),
  };
}

/**
 * Workflow / unified query entry: mode=table|rag|auto
 */
export async function runMasterDataQuery(ownerUserId, config = {}, input = {}) {
  const mode = String(config.mode || config.queryMode || 'auto').toLowerCase();
  const query = String(input.query || input.text || config.query || '').trim();
  const tableId = config.tableId || config.table_id || input.table_id || null;
  const documentId = config.documentId || config.document_id || null;
  const topK = config.topK || config.top_k || 5;

  if (mode === 'table' || (mode === 'auto' && tableId)) {
    if (!tableId) throw new Error('tableId required for table query');
    const result = queryTable(ownerUserId, {
      tableId,
      query,
      column: config.column || null,
      equals: config.equals ?? input.equals ?? null,
      limit: config.limit || 50,
    });
    return {
      mode: 'table',
      ok: true,
      text: result.text || `(${result.count} rows)`,
      result,
      rows: result.rows,
      count: result.count,
    };
  }

  if (mode === 'rag' || mode === 'documents' || mode === 'auto') {
    const result = await ragDocuments(ownerUserId, {
      query: query || 'summarize documents',
      topK,
      documentId,
      summarize: config.summarize !== false,
    });
    return {
      mode: 'rag',
      ok: true,
      text: result.text,
      summary: result.summary,
      chunks: result.chunks,
      hit_count: result.hit_count,
    };
  }

  throw new Error(`Unknown masterdata mode: ${mode}`);
}

export function fingerprint(ownerUserId) {
  return createHash('sha256').update(String(ownerUserId)).digest('hex').slice(0, 12);
}
