/**
 * Per-CEO inbound attachments under the user workspace:
 *   workspace/inbound/attachments/<filename>
 * Mirrored for workflows under WORKFLOW_FS_ROOTS / {ceo}/inbound/attachments/
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, copyFileSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { splitPathList } from '../lib/workflow-fs-roots.js';

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
