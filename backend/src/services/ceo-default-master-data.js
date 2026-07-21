/**
 * Default Master Data for every CEO:
 * - departments table (same presets as frontend DepartmentPicker)
 * - Flolah User Guide document (repo README.md) for RAG
 * - Platform Help docs (knowledgebase/platform-help/*.md) for the Platform Help agent
 *
 * Called on CEO register and on backend startup backfill.
 */
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
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
const REPO_ROOT = join(__dirname, '..', '..', '..');

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

export const FLOLAH_GUIDE_TITLE = 'Flolah User Guide';
export const FLOLAH_GUIDE_FILENAME = 'README.md';

/** Title prefix for Platform Help RAG documents. */
export const PLATFORM_HELP_TITLE_PREFIX = 'Flolah Help —';
/** Legacy title prefix (pre-rename); removed on refresh. */
export const LEGACY_PLATFORM_HELP_TITLE_PREFIX = 'Flowlah Help —';
export const LEGACY_USER_GUIDE_TITLE = 'Flowlah User Guide';

/** Logical help files under knowledgebase/platform-help/ (filename → doc title). */
export const PLATFORM_HELP_DOCUMENTS = Object.freeze([
  { filename: 'README.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Index` },
  { filename: '01-getting-started.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Getting Started` },
  { filename: '02-navigation-and-chrome.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Navigation` },
  { filename: '03-dashboard-agents-chat.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Dashboard Agents Chat` },
  { filename: '04-kanban-standups-broadcast.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Kanban Standups Broadcast` },
  { filename: '05-master-data-rag.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Master Data RAG` },
  { filename: '06-workflows-building.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflows Building` },
  { filename: '07-workflow-nodes-reference.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Workflow Nodes Reference` },
  { filename: '08-mcp-integrations.md', title: `${PLATFORM_HELP_TITLE_PREFIX}MCP Integrations` },
  { filename: '09-a2a-agent-exchange.md', title: `${PLATFORM_HELP_TITLE_PREFIX}A2A AgentExchange` },
  { filename: '10-job-applicant-pipeline.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Job Applicant Pipeline` },
  { filename: '11-content-tools-scripts-profile.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Content Tools Scripts Profile` },
  { filename: '12-troubleshooting.md', title: `${PLATFORM_HELP_TITLE_PREFIX}Troubleshooting` },
]);

/** Resolve repo README.md (local: agent-os/README.md; Docker: /opt/agent-os/README.md). */
export function resolveDefaultReadmePath() {
  const candidates = [
    process.env.AGENT_OS_README_PATH,
    join(REPO_ROOT, 'README.md'),
    join(__dirname, '..', '..', 'README.md'), // backend/README.md fallback
    '/opt/agent-os/README.md',
  ].filter(Boolean);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** Resolve knowledgebase/platform-help directory. */
export function resolvePlatformHelpDir() {
  const candidates = [
    process.env.AGENT_OS_PLATFORM_HELP_DIR,
    join(REPO_ROOT, 'knowledgebase', 'platform-help'),
    '/opt/agent-os/knowledgebase/platform-help',
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

function findDocumentByTitleOrFilename(ownerUserId, title, filename, legacyTitles = []) {
  const docs = listDocuments(ownerUserId);
  const fn = String(filename || '').toLowerCase();
  const legacy = new Set((legacyTitles || []).filter(Boolean));
  return docs.find(
    (d) =>
      d.title === title ||
      legacy.has(d.title) ||
      (fn && String(d.filename || '').toLowerCase() === fn)
  );
}

/**
 * Upload or refresh a single markdown Master Data document by title/filename.
 */
function ensureMarkdownDocument(ownerUserId, { title, filename, content, legacyTitles }, { refresh = true } = {}) {
  if (!content) {
    return { document: null, created: false, updated: false, skipped: 'content_missing' };
  }
  const existing = findDocumentByTitleOrFilename(ownerUserId, title, filename, legacyTitles);
  if (existing) {
    if (!refresh) {
      return { document: existing, created: false, updated: false };
    }
    try {
      const { buffer } = getDocumentFile(ownerUserId, existing.id);
      const sameContent = contentHash(buffer.toString('utf8')) === contentHash(content);
      const sameTitle = existing.title === title;
      if (sameContent && sameTitle) {
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
    title,
    filename,
    mimeType: 'text/markdown',
    contentText: content,
  });
  return {
    document,
    created: !existing,
    updated: Boolean(existing),
  };
}

/** Remove leftover docs still titled with the old Flowlah brand. */
function cleanupLegacyBrandDocuments(ownerUserId) {
  const docs = listDocuments(ownerUserId);
  let removed = 0;
  for (const d of docs) {
    const title = String(d.title || '');
    const isLegacyHelp =
      title.startsWith(LEGACY_PLATFORM_HELP_TITLE_PREFIX) ||
      title.startsWith('Flowlah Help -') ||
      title === LEGACY_USER_GUIDE_TITLE;
    if (!isLegacyHelp) continue;
    try {
      deleteDocument(ownerUserId, d.id);
      removed += 1;
    } catch (_) {
      /* ignore */
    }
  }
  return removed;
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
export function ensureDefaultReadmeDocument(ownerUserId, opts = {}) {
  const content = readDefaultReadmeContent();
  if (!content) {
    return { document: null, created: false, updated: false, skipped: 'readme_missing' };
  }
  return ensureMarkdownDocument(
    ownerUserId,
    {
      title: FLOLAH_GUIDE_TITLE,
      filename: FLOLAH_GUIDE_FILENAME,
      content,
      legacyTitles: [LEGACY_USER_GUIDE_TITLE],
    },
    opts
  );
}

/**
 * Upload/refresh Platform Help markdown set for Master Data RAG (Platform Help agent).
 */
export function ensurePlatformHelpDocuments(ownerUserId, opts = {}) {
  const dir = resolvePlatformHelpDir();
  if (!dir) {
    return { docs: [], created: 0, updated: 0, skipped: 'platform_help_dir_missing' };
  }
  let created = 0;
  let updated = 0;
  const docs = [];
  const catalog = [...PLATFORM_HELP_DOCUMENTS];
  // Also pick up any extra *.md dropped in the folder later.
  try {
    for (const name of readdirSync(dir)) {
      if (!/\.md$/i.test(name)) continue;
      if (catalog.some((c) => c.filename.toLowerCase() === name.toLowerCase())) continue;
      catalog.push({
        filename: name,
        title: `${PLATFORM_HELP_TITLE_PREFIX}${name.replace(/\.md$/i, '')}`,
      });
    }
  } catch (_) {
    /* ignore */
  }
  for (const entry of catalog) {
    const path = join(dir, entry.filename);
    if (!existsSync(path)) continue;
    let content;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const legacyTitle = `${LEGACY_PLATFORM_HELP_TITLE_PREFIX}${entry.title.slice(PLATFORM_HELP_TITLE_PREFIX.length)}`;
    const result = ensureMarkdownDocument(
      ownerUserId,
      {
        title: entry.title,
        filename: `platform-help-${entry.filename}`,
        content,
        legacyTitles: [legacyTitle, entry.title.replace(PLATFORM_HELP_TITLE_PREFIX, 'Flowlah Help - ')],
      },
      opts
    );
    docs.push(result);
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
  }
  const legacyRemoved = cleanupLegacyBrandDocuments(ownerUserId);
  return { docs, created, updated, legacyRemoved };
}

/** Departments + User Guide + Platform Help for one CEO. */
export function ensureCeoDefaultMasterData(ownerUserId, opts = {}) {
  const departments = ensureDepartmentsMasterData(ownerUserId);
  const guide = ensureDefaultReadmeDocument(ownerUserId, opts);
  const platformHelp = ensurePlatformHelpDocuments(ownerUserId, opts);
  return { departments, guide, platformHelp };
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
  let helpCreated = 0;
  let helpUpdated = 0;
  for (const id of ids) {
    try {
      const { departments, guide, platformHelp } = ensureCeoDefaultMasterData(id, opts);
      if (departments.created) deptCreated += 1;
      if (departments.inserted) deptSeeded += 1;
      if (guide.created) guidesCreated += 1;
      else if (guide.updated) guidesUpdated += 1;
      if (guide.skipped) guidesSkipped += 1;
      helpCreated += platformHelp?.created || 0;
      helpUpdated += platformHelp?.updated || 0;
    } catch (e) {
      console.warn(`[ceo-default-master-data] ${id}:`, e.message);
    }
  }
  return {
    deptCreated,
    deptSeeded,
    guidesCreated,
    guidesUpdated,
    guidesSkipped,
    helpCreated,
    helpUpdated,
    ceos: ids.length,
  };
}
