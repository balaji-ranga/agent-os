/**
 * Per-CEO inbound attachments under the user workspace:
 *   workspace/inbound/attachments/<filename>
 * Mirrored for workflows under WORKFLOW_FS_ROOTS / {ceo}/inbound/attachments/
 */
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  copyFileSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join, basename } from 'path';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { splitPathList } from '../lib/workflow-fs-roots.js';
import { suppressInboundOpenclawMirror } from './inbound-media-sync-ledger.js';

function sanitizeIdPart(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-zA-Z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

function safeFilename(name) {
  const base = basename(String(name || 'file.bin')).replace(/[^\w.\- ()[\]]+/g, '_');
  return base.slice(0, 180) || 'file.bin';
}

function dataDir() {
  return process.env.AGENT_OS_DATA_DIR || join(process.cwd(), 'data');
}

function workflowFsRoot() {
  const parts = splitPathList(process.env.WORKFLOW_FS_ROOTS || '');
  if (parts[0]) return parts[0];
  return join(dataDir(), 'workflow-fs');
}

/** Canonical relative path used as workflow chat trigger input. */
export function relativeInboundPath(filename) {
  return `inbound/attachments/${safeFilename(filename)}`;
}

export function getInboundAttachmentsDir(ownerUserId) {
  const ceo = sanitizeIdPart(ownerUserId);
  // Shared user workspace (visible to COO + specialists under the tenant).
  return join(getOpenClawDir(), 'tenants', ceo, 'workspace', 'inbound', 'attachments');
}

export function getInboundWorkflowMirrorDir(ownerUserId) {
  return join(workflowFsRoot(), sanitizeIdPart(ownerUserId), 'inbound', 'attachments');
}

export function ensureInboundAttachmentsDirs(ownerUserId) {
  const primary = getInboundAttachmentsDir(ownerUserId);
  const mirror = getInboundWorkflowMirrorDir(ownerUserId);
  mkdirSync(primary, { recursive: true });
  mkdirSync(mirror, { recursive: true });
  return { primary, mirror };
}

/**
 * Persist an inbound media/document for the CEO workspace.
 * @returns {{ relative_path, absolute_path, workflow_path, filename, bytes }}
 */
export function saveInboundAttachment(ownerUserId, { buffer, filename, mimeType } = {}) {
  if (!ownerUserId) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw Object.assign(new Error('buffer required'), { status: 400 });
  }
  const { primary, mirror } = ensureInboundAttachmentsDirs(ownerUserId);
  let name = safeFilename(filename || 'upload.bin');
  // Avoid clobber: prefix timestamp if exists
  if (existsSync(join(primary, name))) {
    const stamp = Date.now();
    const i = name.lastIndexOf('.');
    name = i > 0 ? `${name.slice(0, i)}-${stamp}${name.slice(i)}` : `${name}-${stamp}`;
  }
  const abs = join(primary, name);
  writeFileSync(abs, buffer);
  const mirrorAbs = join(mirror, name);
  try {
    copyFileSync(abs, mirrorAbs);
  } catch (e) {
    writeFileSync(mirrorAbs, buffer);
  }
  const relative_path = relativeInboundPath(name);
  console.info('[inbound-attachments] saved', {
    owner: sanitizeIdPart(ownerUserId),
    filename: name,
    bytes: buffer.length,
    mime: mimeType || null,
  });
  return {
    relative_path,
    absolute_path: abs,
    workflow_path: mirrorAbs,
    filename: name,
    bytes: buffer.length,
    mime_type: mimeType || 'application/octet-stream',
  };
}

export function listInboundAttachments(ownerUserId) {
  const dir = getInboundAttachmentsDir(ownerUserId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => {
      try {
        return statSync(join(dir, n)).isFile();
      } catch {
        return false;
      }
    })
    .map((n) => {
      const st = statSync(join(dir, n));
      return {
        filename: n,
        relative_path: relativeInboundPath(n),
        absolute_path: join(dir, n),
        size: st.size,
        mtime: st.mtime.toISOString(),
      };
    });
}

/**
 * OpenClaw stages media as <uuid>.<ext>. We mirror as wa-<uuid>.<ext>.
 * Older builds used wa-<timestamp>-<uuid>.<ext> and re-copied on every restart.
 * @returns {string|null} openclaw basename key, or null if not a WA mirror name
 */
export function openclawBasenameFromWaMirror(filename) {
  const n = basename(String(filename || ''));
  const m = n.match(/^wa-(?:\d+-)?(.+)$/i);
  return m ? m[1] : null;
}

/**
 * Find an existing inbound copy of an OpenClaw inbound media file (any naming generation).
 */
export function findExistingInboundMirror(ownerUserId, openclawFilename, size = null) {
  const needle = basename(String(openclawFilename || '')).toLowerCase();
  if (!needle) return null;
  const wantSize = size == null ? null : Number(size);
  for (const f of listInboundAttachments(ownerUserId)) {
    const name = String(f.filename || '');
    const key = openclawBasenameFromWaMirror(name);
    const match =
      name.toLowerCase() === needle ||
      name.toLowerCase() === `wa-${needle}` ||
      (key && key.toLowerCase() === needle);
    if (!match) continue;
    if (wantSize != null && Number(f.size) !== wantSize) continue;
    return f;
  }
  return null;
}

/**
 * Collapse duplicate wa-<timestamp>-<uuid> copies left by restart remirrors.
 * Keeps the oldest file per OpenClaw basename; hard-deletes the rest.
 */
export function dedupeWaInboundMirrors(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const groups = new Map();
  for (const f of listInboundAttachments(owner)) {
    const key = openclawBasenameFromWaMirror(f.filename);
    if (!key) continue;
    const k = key.toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  let deleted = 0;
  let kept = 0;
  for (const group of groups.values()) {
    if (group.length < 2) {
      kept += group.length;
      continue;
    }
    group.sort((a, b) => String(a.mtime || '').localeCompare(String(b.mtime || '')));
    kept += 1;
    for (const f of group.slice(1)) {
      try {
        deleteInboundAttachment(owner, f.relative_path);
        deleted += 1;
      } catch (e) {
        console.warn('[inbound-attachments] dedupe skip', f.filename, e?.message || e);
      }
    }
  }
  if (deleted) {
    console.info('[inbound-attachments] deduped WA mirrors', {
      owner: sanitizeIdPart(owner),
      deleted,
      kept,
      groups: groups.size,
    });
  }
  return { deleted, kept, groups: groups.size };
}

/** Resolve relative inbound path to absolute workspace file (security: no ..). */
export function resolveInboundRelativePath(ownerUserId, relativePath) {
  const raw = String(relativePath || '')
    .trim()
    .replace(/^workspace\//i, '')
    .replace(/\\/g, '/');
  const m = raw.match(/^(?:\.\/)?inbound\/attachments\/([^/]+)$/i);
  if (!m) return null;
  const name = safeFilename(m[1]);
  if (name.includes('..')) return null;
  const abs = join(getInboundAttachmentsDir(ownerUserId), name);
  if (!existsSync(abs)) {
    const mirror = join(getInboundWorkflowMirrorDir(ownerUserId), name);
    if (existsSync(mirror)) return mirror;
    return null;
  }
  return abs;
}

function hardUnlink(path) {
  if (!path || !existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

/**
 * Hard-delete one inbound attachment from workspace + workflow-fs mirror (no recycle bin).
 * @returns {{ deleted: boolean, filename: string, paths: string[] }}
 */
export function deleteInboundAttachment(ownerUserId, relativePath) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const raw = String(relativePath || '')
    .trim()
    .replace(/^workspace\//i, '')
    .replace(/\\/g, '/');
  const m = raw.match(/^(?:\.\/)?inbound\/attachments\/([^/]+)$/i);
  if (!m) throw Object.assign(new Error('Invalid inbound path'), { status: 400 });
  const name = safeFilename(m[1]);
  if (!name || name.includes('..')) throw Object.assign(new Error('Invalid filename'), { status: 400 });

  const primary = join(getInboundAttachmentsDir(owner), name);
  const mirror = join(getInboundWorkflowMirrorDir(owner), name);
  const removed = [];
  if (hardUnlink(primary)) removed.push(primary);
  if (hardUnlink(mirror)) removed.push(mirror);
  if (!removed.length) throw Object.assign(new Error('File not found'), { status: 404 });
  // Stop OpenClaw media/inbound remirror on next backend restart / poll.
  try {
    suppressInboundOpenclawMirror(owner, name);
  } catch (e) {
    console.warn('[inbound-attachments] suppress ledger failed', name, e?.message || e);
  }
  console.info('[inbound-attachments] hard-deleted', {
    owner: sanitizeIdPart(owner),
    filename: name,
    paths: removed.length,
  });
  return { deleted: true, filename: name, paths: removed };
}

/**
 * Hard-delete all inbound attachments for a CEO (primary + mirror dirs).
 */
export function deleteAllInboundAttachments(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  let deleted = 0;
  for (const f of listInboundAttachments(owner)) {
    try {
      deleteInboundAttachment(owner, f.relative_path);
      deleted += 1;
    } catch (e) {
      console.warn('[inbound-attachments] delete-all skip', f.filename, e?.message || e);
    }
  }
  // Sweep orphan mirror files not listed from primary
  const mirrorDir = getInboundWorkflowMirrorDir(owner);
  if (existsSync(mirrorDir)) {
    for (const n of readdirSync(mirrorDir)) {
      try {
        const p = join(mirrorDir, n);
        if (statSync(p).isFile() && hardUnlink(p)) deleted += 1;
      } catch {
        /* skip */
      }
    }
  }
  console.info('[inbound-attachments] delete-all done', { owner: sanitizeIdPart(owner), deleted });
  return { deleted };
}

/**
 * Retention: hard-delete inbound files whose mtime is older than retentionDays.
 */
export function purgeAgedInboundAttachments(ownerUserId, retentionDays) {
  const owner = String(ownerUserId || '').trim();
  const days = Math.max(1, Number(retentionDays) || 90);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const f of listInboundAttachments(owner)) {
    try {
      const st = statSync(f.absolute_path);
      if (st.mtimeMs < cutoffMs) {
        deleteInboundAttachment(owner, f.relative_path);
        deleted += 1;
      }
    } catch (e) {
      console.warn('[inbound-attachments] retention skip', f.filename, e?.message || e);
    }
  }
  // Aged orphans on mirror only
  const mirrorDir = getInboundWorkflowMirrorDir(owner);
  if (existsSync(mirrorDir)) {
    for (const n of readdirSync(mirrorDir)) {
      try {
        const p = join(mirrorDir, n);
        const st = statSync(p);
        if (st.isFile() && st.mtimeMs < cutoffMs && hardUnlink(p)) deleted += 1;
      } catch {
        /* skip */
      }
    }
  }
  if (deleted) {
    console.info('[inbound-attachments] retention purged', {
      owner: sanitizeIdPart(owner),
      days,
      deleted,
    });
  }
  return { deleted };
}



/** Copy MEDIA:/abs paths mentioned in chat text into CEO inbound/attachments. */
export function mirrorChatMediaToInbound(ownerUserId, text) {
  const re = /MEDIA:(\/[^\s]+)/gi;
  let m;
  const out = [];
  const seen = new Set();
  while ((m = re.exec(String(text || ''))) !== null) {
    const abs = m[1];
    if (!abs || seen.has(abs) || !existsSync(abs)) continue;
    seen.add(abs);
    try {
      const buffer = readFileSync(abs);
      out.push(saveInboundAttachment(ownerUserId, { buffer, filename: basename(abs) }));
    } catch (e) {
      console.warn('[inbound-attachments] mirror failed', { abs, error: e?.message || String(e) });
    }
  }
  return out;
}
