/**
 * Default Master Data for every CEO:
 * - departments table (same presets as frontend DepartmentPicker)
 * - Flowlah User Guide document (repo README.md) for RAG
 *
 * Called on CEO register and on backend startup backfill.
 */
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  createTable,
  deleteDocument,
  findTableByName,
  getDocumentFile,
  insertRow,
  listDocuments,
  listRows,
  uploadDocument,
} from './master-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEPARTMENTS_TABLE_NAME = 'departments';
export const DEPARTMENTS_COLUMN = 'name';
export const DEPARTMENT_PRESETS = [
  'Executive',
  'Research',
  'Finance',
  'Social',
  'Engineering',
  'Operations',
  'Job Pipeline',
];

export const FLOWLAH_GUIDE_TITLE = 'Flowlah User Guide';
export const FLOWLAH_GUIDE_FILENAME = 'README.md';

/** Resolve repo README.md (local: agent-os/README.md; Docker: /opt/agent-os/README.md). */
export function resolveDefaultReadmePath() {
  const candidates = [
    process.env.AGENT_OS_README_PATH,
    join(__dirname, '..', '..', '..', 'README.md'), // backend/src/services → repo root
    join(__dirname, '..', '..', 'README.md'), // backend/README.md fallback
    '/opt/agent-os/README.md',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function readDefaultReadmeContent() {
  const path = resolveDefaultReadmePath();
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function contentHash(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function findGuideDocument(ownerUserId) {
  return listDocuments(ownerUserId).find(
    (d) =>
      d.title === FLOWLAH_GUIDE_TITLE ||
      String(d.filename || '').toLowerCase() === FLOWLAH_GUIDE_FILENAME.toLowerCase()
  );
}

/**
 * Ensure the CEO has a departments master-data table with preset rows when empty/new.
 */
export function ensureDepartmentsMasterData(ownerUserId) {
  let table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME);
  let created = false;
  if (!table) {
    table = createTable(ownerUserId, {
      name: DEPARTMENTS_TABLE_NAME,
      columns: [DEPARTMENTS_COLUMN],
      description: 'Org departments for agent onboarding (dynamic list)',
    });
    created = true;
  }
  const existingNames = new Set();
  if (!created && (table.row_count || 0) > 0) {
    const { rows } = listRows(ownerUserId, table.id, { limit: 500, offset: 0 });
    for (const r of rows || []) {
      const data = r.data || {};
      const n = String(data.name ?? data.Name ?? data.department ?? '').trim().toLowerCase();
      if (n) existingNames.add(n);
    }
  }
  let inserted = 0;
  if (created || (table.row_count || 0) === 0 || existingNames.size === 0) {
    for (const name of DEPARTMENT_PRESETS) {
      if (existingNames.has(name.toLowerCase())) continue;
      insertRow(ownerUserId, table.id, { [DEPARTMENTS_COLUMN]: name });
      inserted += 1;
      existingNames.add(name.toLowerCase());
    }
    table = findTableByName(ownerUserId, DEPARTMENTS_TABLE_NAME) || table;
  }
  return { table, created, inserted };
}

/**
 * Upload/refresh repo README.md as the CEO's default RAG document.
 */
export function ensureDefaultReadmeDocument(ownerUserId, { refresh = true } = {}) {
  const content = readDefaultReadmeContent();
  if (!content) {
    return { document: null, created: false, updated: false, skipped: 'readme_missing' };
  }
  const existing = findGuideDocument(ownerUserId);
  if (existing) {
    if (!refresh) {
      return { document: existing, created: false, updated: false };
    }
    try {
      const { buffer } = getDocumentFile(ownerUserId, existing.id);
      if (contentHash(buffer.toString('utf8')) === contentHash(content)) {
        return { document: existing, created: false, updated: false };
      }
    } catch (_) {
      /* replace below */
    }
    try {
      deleteDocument(ownerUserId, existing.id);
    } catch (_) {
      /* continue to upload */
    }
  }
  const document = uploadDocument(ownerUserId, {
    title: FLOWLAH_GUIDE_TITLE,
    filename: FLOWLAH_GUIDE_FILENAME,
    mimeType: 'text/markdown',
    contentText: content,
  });
  return {
    document,
    created: !existing,
    updated: Boolean(existing),
  };
}

/** Departments + User Guide for one CEO. */
export function ensureCeoDefaultMasterData(ownerUserId, opts = {}) {
  const departments = ensureDepartmentsMasterData(ownerUserId);
  const guide = ensureDefaultReadmeDocument(ownerUserId, opts);
  return { departments, guide };
}

/**
 * Backfill all CEO users. Returns counts for logging.
 */
export function ensureCeoDefaultMasterDataForAllCeos(listCeoIds, opts = {}) {
  const ids = Array.isArray(listCeoIds) ? listCeoIds : [];
  let deptCreated = 0;
  let deptSeeded = 0;
  let guidesCreated = 0;
  let guidesUpdated = 0;
  let guidesSkipped = 0;
  for (const id of ids) {
    try {
      const { departments, guide } = ensureCeoDefaultMasterData(id, opts);
      if (departments.created) deptCreated += 1;
      if (departments.inserted) deptSeeded += 1;
      if (guide.created) guidesCreated += 1;
      else if (guide.updated) guidesUpdated += 1;
      if (guide.skipped) guidesSkipped += 1;
    } catch (e) {
      console.warn(`[ceo-default-master-data] ${id}:`, e.message);
    }
  }
  return { deptCreated, deptSeeded, guidesCreated, guidesUpdated, guidesSkipped, ceos: ids.length };
}
