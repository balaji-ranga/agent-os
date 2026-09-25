/**
 * Seed platform help + Flolah User Guide into OpenSearch under PLATFORM_OWNER_ID.
 * File bytes are written under AGENT_OS_DATA_DIR/master-data/__platform__/docs/.
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import {
  FLOLAH_GUIDE_FILENAME,
  FLOLAH_GUIDE_TITLE,
  PLATFORM_HELP_DOCUMENTS,
  PLATFORM_HELP_TITLE_PREFIX,
  PUBLIC_DOCS_TITLE_PREFIX,
  readDefaultReadmeContent,
  resolvePlatformHelpDir,
  resolvePublicDocsDir,
} from '../ceo-default-master-data.js';
import { getDocument, indexDocument, listDocuments } from './documents.js';
import { PLATFORM_OWNER_ID, ensurePlatformIndices } from './indices.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function dataRoot() {
  return process.env.AGENT_OS_DATA_DIR || join(__dirname, '../../../data');
}

function platformDocsDir(documentId = null) {
  const base = join(dataRoot(), 'master-data', PLATFORM_OWNER_ID, 'docs');
  if (documentId) {
    return join(base, String(documentId).replace(/[^a-zA-Z0-9_.-]/g, '_'));
  }
  return base;
}

function contentSha256(text) {
  return createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

/** Stable document id from owner + logical filename. */
function stableDocumentId(filename) {
  const h = createHash('sha256')
    .update(`${PLATFORM_OWNER_ID}:${String(filename || '')}`, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `plat_${h}`;
}

function findExistingByTitleOrFilename(docs, title, filename) {
  const fn = String(filename || '').toLowerCase();
  return docs.find(
    (d) =>
      d.title === title ||
      (fn && String(d.filename || '').toLowerCase() === fn)
  );
}

/**
 * Write markdown to disk and upsert into OpenSearch if content hash changed.
 */
async function upsertPlatformMarkdown({
  title,
  filename,
  content,
  existingDocs,
  source = 'platform',
  tags = ['platform-help'],
}) {
  if (!content) {
    return { document: null, created: false, updated: false, skipped: 'content_missing' };
  }
  const sha = contentSha256(content);
  const existing = findExistingByTitleOrFilename(existingDocs, title, filename);
  if (existing?.content_sha256 && existing.content_sha256 === sha && existing.title === title) {
    return { document: existing, created: false, updated: false, skipped: 'unchanged' };
  }
  if (existing && !existing.content_sha256) {
    const full = await getDocument(PLATFORM_OWNER_ID, existing.id);
    if (full?.content_sha256 === sha && full.title === title) {
      return { document: full, created: false, updated: false, skipped: 'unchanged' };
    }
  }

  const docId = existing?.id || stableDocumentId(filename);
  const dir = platformDocsDir(docId);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(dir, filename);
  const buffer = Buffer.from(content, 'utf8');
  writeFileSync(storagePath, buffer);

  const document = await indexDocument({
    ownerUserId: PLATFORM_OWNER_ID,
    documentId: docId,
    title,
    filename,
    mimeType: 'text/markdown',
    sizeBytes: buffer.length,
    storagePath,
    text: content,
    source,
    uploadedByType: 'system',
    uploadedById: 'platform-seed',
    tags,
    contentSha256: sha,
  });

  return {
    document,
    created: !existing,
    updated: Boolean(existing),
    skipped: null,
  };
}

function markdownTitle(content, fallback) {
  const text = String(content || '');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const title = frontmatter?.[1]?.match(/^title:\s*["']?([^\r\n"']+)["']?\s*$/im);
  if (title?.[1]) return title[1].trim();
  const heading = text.match(/^#\s+(.+)$/m);
  return heading?.[1]?.trim() || fallback;
}

function markdownFilesRecursive(root) {
  const files = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(fullPath);
    }
  }
  visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Public static docs are a second, sensitivity-scanned source for Platform Help.
 * Keeping discovery automatic prevents new website help pages from silently
 * remaining invisible to the in-product help agent.
 */
export function listPublicGuideSources() {
  const dir = resolvePublicDocsDir();
  if (!dir) return [];
  return markdownFilesRecursive(dir).map((path) => {
    const relativePath = relative(dir, path).replace(/\\/g, '/');
    const content = readFileSync(path, 'utf8');
    const fallback = relativePath
      .replace(/\.mdx?$/i, '')
      .split('/')
      .map((part) => part.replace(/[-_]+/g, ' '))
      .join(' — ');
    return {
      title: `${PUBLIC_DOCS_TITLE_PREFIX}${markdownTitle(content, fallback)}`,
      filename: `public-guide-${relativePath.replace(/\//g, '--')}`,
      content,
      source: 'platform-public-docs',
      tags: ['platform-help', 'public-docs'],
    };
  });
}

/**
 * Ensure Flolah User Guide + knowledgebase/platform-help/*.md + the public
 * docs-site guide are indexed
 * under PLATFORM_OWNER_ID. Skips docs whose content_sha256 matches.
 *
 * @returns {Promise<{ created: number, updated: number, skipped: number, docs: object[] }>}
 */
export async function ensurePlatformHelpInOpenSearch() {
  await ensurePlatformIndices();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const docs = [];

  let existingDocs = [];
  try {
    // The help corpus is larger than the generic 50-document page. Load the
    // complete supported page so documents beyond the first page are not
    // misclassified as missing and re-embedded on every backend restart.
    const page = await listDocuments(PLATFORM_OWNER_ID, { limit: 200, offset: 0 });
    existingDocs = Array.isArray(page) ? page : page.documents || [];
  } catch (e) {
    console.warn('[opensearch/platform-docs] list failed: %s', e?.message || e);
  }

  const guideContent = readDefaultReadmeContent();
  if (guideContent) {
    const result = await upsertPlatformMarkdown({
      title: FLOLAH_GUIDE_TITLE,
      filename: FLOLAH_GUIDE_FILENAME,
      content: guideContent,
      existingDocs,
    });
    docs.push(result);
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
    if (result.document && !existingDocs.some((d) => d.id === result.document.id)) {
      existingDocs.push(result.document);
    }
  } else {
    skipped += 1;
    docs.push({
      document: null,
      created: false,
      updated: false,
      skipped: 'readme_missing',
    });
  }

  const dir = resolvePlatformHelpDir();
  if (!dir) {
    console.info('[opensearch/platform-docs] platform-help dir missing; guide only');
    return { created, updated, skipped, docs };
  }

  const catalog = [...PLATFORM_HELP_DOCUMENTS];
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
    const filename = `platform-help-${entry.filename}`;
    const result = await upsertPlatformMarkdown({
      title: entry.title,
      filename,
      content,
      existingDocs,
    });
    docs.push(result);
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
    if (result.document) {
      const idx = existingDocs.findIndex((d) => d.id === result.document.id);
      if (idx >= 0) existingDocs[idx] = result.document;
      else existingDocs.push(result.document);
    }
  }

  for (const entry of listPublicGuideSources()) {
    const result = await upsertPlatformMarkdown({
      ...entry,
      existingDocs,
    });
    docs.push(result);
    if (result.created) created += 1;
    else if (result.updated) updated += 1;
    else skipped += 1;
    if (result.document) {
      const idx = existingDocs.findIndex((d) => d.id === result.document.id);
      if (idx >= 0) existingDocs[idx] = result.document;
      else existingDocs.push(result.document);
    }
  }

  console.info(
    '[opensearch/platform-docs] ensure done created=%d updated=%d skipped=%d',
    created,
    updated,
    skipped
  );
  return { created, updated, skipped, docs };
}
