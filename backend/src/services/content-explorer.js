/**
 * Content Explorer: list / download / hard-delete this CEO's uploaded + generated media.
 * Uploaded: tenants/{ceo}/workspace/inbound/attachments
 * Generated: ~/.openclaw/media/generated/{ceo}/… (+ ownership registry for legacy)
 */
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import {
  listInboundAttachments,
  resolveInboundRelativePath,
  deleteInboundAttachment,
  deleteAllInboundAttachments,
  purgeAgedInboundAttachments,
} from './inbound-attachments.js';
import {
  ensureOpenClawMediaOwnershipSchema,
  normalizeOpenClawMediaRelative,
} from './openclaw-media-ownership.js';
import { getDb } from '../db/schema.js';
import { guessMimeFromFilename } from './master-data-extract.js';

export function sanitizeContentOwnerPart(ownerUserId) {
  return (
    String(ownerUserId || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown'
  );
}

/** Per-CEO generated media directory under the shared OpenClaw media root. */
export function getCeoGeneratedMediaDir(ownerUserId) {
  return getOpenClawMediaDir('generated', sanitizeContentOwnerPart(ownerUserId));
}

function kindFromMime(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const e = extname(filename || '').toLowerCase();
  if (m.startsWith('audio/') || ['.ogg', '.opus', '.mp3', '.wav', '.m4a', '.aac', '.flac'].includes(e)) return 'audio';
  if (m.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv'].includes(e)) return 'video';
  if (m.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(e)) return 'image';
  if (m.includes('pdf') || e === '.pdf') return 'document';
  return 'file';
}

function listGeneratedOnDisk(ownerUserId) {
  const ceo = sanitizeContentOwnerPart(ownerUserId);
  const dir = getCeoGeneratedMediaDir(ownerUserId);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size <= 0) continue;
      const relative_path = `generated/${ceo}/${name}`;
      const mime = guessMimeFromFilename(name);
      out.push({
        id: `gen:${relative_path}`,
        source: 'generated',
        channel: 'agent',
        filename: name,
        relative_path,
        absolute_path: abs,
        size: st.size,
        mtime: st.mtime.toISOString(),
        mime_guess: mime,
        kind: kindFromMime(mime, name),
        preview_url: `/api/media/openclaw/${relative_path}`,
        download_url: `/api/workspace/content-explorer/download?kind=generated&path=${encodeURIComponent(relative_path)}`,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

function listGeneratedFromRegistry(ownerUserId) {
  ensureOpenClawMediaOwnershipSchema();
  const rows = getDb()
    .prepare(
      `SELECT relative_path, source, bytes, created_at
       FROM openclaw_media_ownership
       WHERE owner_user_id = ?
       ORDER BY created_at DESC
       LIMIT 500`
    )
    .all(ownerUserId);
  const out = [];
  const ceo = sanitizeContentOwnerPart(ownerUserId);
  for (const row of rows) {
    const rel = normalizeOpenClawMediaRelative(row.relative_path);
    if (!rel || rel.startsWith('inbound/')) continue;
    // Prefer disk listing for per-CEO folder; registry covers legacy flat paths.
    if (rel.startsWith(`generated/${ceo}/`)) continue;
    const abs = join(getOpenClawMediaDir(), ...rel.split('/'));
    if (!existsSync(abs)) continue;
    let st;
    try {
      st = statSync(abs);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    const name = basename(rel);
    const mime = guessMimeFromFilename(name);
    out.push({
      id: `gen:${rel}`,
      source: 'generated',
      channel: 'agent',
      filename: name,
      relative_path: rel,
      absolute_path: abs,
      size: st.size || row.bytes || 0,
      mtime: row.created_at || st.mtime.toISOString(),
      mime_guess: mime,
      kind: kindFromMime(mime, name),
      preview_url: `/api/media/openclaw/${rel}`,
      download_url: `/api/workspace/content-explorer/download?kind=generated&path=${encodeURIComponent(rel)}`,
      legacy_flat: !rel.includes(`/${ceo}/`),
    });
  }
  return out;
}

function listUploaded(ownerUserId) {
  return listInboundAttachments(ownerUserId).map((f) => {
    const mime = guessMimeFromFilename(f.filename);
    const wa = /^wa-\d+-/i.test(f.filename);
    return {
      id: `up:${f.relative_path}`,
      source: 'uploaded',
      channel: wa ? 'whatsapp_or_telegram' : 'web',
      filename: f.filename,
      relative_path: f.relative_path,
      absolute_path: f.absolute_path,
      size: f.size,
      mtime: f.mtime,
      mime_guess: mime,
      kind: kindFromMime(mime, f.filename),
      preview_url: null,
      download_url: `/api/workspace/content-explorer/download?kind=uploaded&path=${encodeURIComponent(f.relative_path)}`,
    };
  });
}

/**
 * @returns {{ owner_user_id: string, folders: object, items: object[] }}
 */
export function listContentExplorer(ownerUserId, { source = 'all' } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });

  const uploaded = source === 'generated' ? [] : listUploaded(owner);
  const generated =
    source === 'uploaded'
      ? []
      : [...listGeneratedOnDisk(owner), ...listGeneratedFromRegistry(owner)];

  // Dedupe by relative_path
  const seen = new Set();
  const items = [...uploaded, ...generated]
    .filter((it) => {
      const k = `${it.source}:${it.relative_path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));

  return {
    owner_user_id: owner,
    read_only: false,
    folders: {
      uploaded: 'inbound/attachments (web chat + WhatsApp/Telegram mirrors)',
      generated: `media/generated/${sanitizeContentOwnerPart(owner)}/ (TTS, images, video)`,
    },
    counts: {
      uploaded: uploaded.length,
      generated: generated.length,
      total: items.length,
    },
    items,
  };
}

export function resolveContentExplorerDownload(ownerUserId, { kind, path: relPath } = {}) {
  const owner = String(ownerUserId || '').trim();
  const kindN = String(kind || '').toLowerCase();
  const raw = String(relPath || '').trim();
  if (!owner || !raw) throw Object.assign(new Error('kind and path required'), { status: 400 });

  if (kindN === 'uploaded') {
    const abs = resolveInboundRelativePath(owner, raw);
    if (!abs || !existsSync(abs)) throw Object.assign(new Error('File not found'), { status: 404 });
    return { absolute_path: abs, filename: basename(abs), mime: guessMimeFromFilename(basename(abs)) };
  }

  if (kindN === 'generated') {
    const rel = normalizeOpenClawMediaRelative(raw);
    const ceo = sanitizeContentOwnerPart(owner);
    const allowed =
      rel.startsWith(`generated/${ceo}/`) ||
      (() => {
        ensureOpenClawMediaOwnershipSchema();
        const row = getDb()
          .prepare(`SELECT owner_user_id FROM openclaw_media_ownership WHERE relative_path = ?`)
          .get(rel);
        return row && String(row.owner_user_id) === owner;
      })();
    if (!allowed) throw Object.assign(new Error('Forbidden'), { status: 403 });
    const abs = join(getOpenClawMediaDir(), ...rel.split('/').filter(Boolean));
    if (!existsSync(abs)) throw Object.assign(new Error('File not found'), { status: 404 });
    return { absolute_path: abs, filename: basename(abs), mime: guessMimeFromFilename(basename(abs)) };
  }

  throw Object.assign(new Error('kind must be uploaded or generated'), { status: 400 });
}

function scrubOwnershipRow(rel) {
  try {
    ensureOpenClawMediaOwnershipSchema();
    getDb().prepare(`DELETE FROM openclaw_media_ownership WHERE relative_path = ?`).run(rel);
  } catch {
    /* best-effort */
  }
}

/**
 * Hard-delete one generated media file owned by this CEO (disk + ownership row).
 */
export function deleteGeneratedMedia(ownerUserId, relativePath) {
  const owner = String(ownerUserId || '').trim();
  const file = resolveContentExplorerDownload(owner, { kind: 'generated', path: relativePath });
  unlinkSync(file.absolute_path);
  const rel = normalizeOpenClawMediaRelative(relativePath);
  scrubOwnershipRow(rel);
  console.info('[content-explorer] hard-deleted generated', {
    owner: sanitizeContentOwnerPart(owner),
    path: rel,
  });
  return { deleted: true, kind: 'generated', path: rel, filename: file.filename };
}

/**
 * Hard-delete all generated media for this CEO (per-CEO folder + owned legacy registry files).
 */
export function deleteAllGeneratedMedia(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  let deleted = 0;
  const items = [...listGeneratedOnDisk(owner), ...listGeneratedFromRegistry(owner)];
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.relative_path)) continue;
    seen.add(it.relative_path);
    try {
      deleteGeneratedMedia(owner, it.relative_path);
      deleted += 1;
    } catch (e) {
      console.warn('[content-explorer] delete-all generated skip', it.relative_path, e?.message || e);
    }
  }
  console.info('[content-explorer] delete-all generated done', {
    owner: sanitizeContentOwnerPart(owner),
    deleted,
  });
  return { deleted };
}

/**
 * Hard-delete selected Content Explorer items.
 * @param {{ items?: Array<{ kind?: string, source?: string, path?: string, relative_path?: string }>, all?: boolean, source?: string }} opts
 */
export function deleteContentExplorerItems(ownerUserId, opts = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });

  const source = String(opts.source || 'all').toLowerCase();
  if (opts.all) {
    let uploaded = 0;
    let generated = 0;
    if (source !== 'generated') {
      uploaded = deleteAllInboundAttachments(owner).deleted || 0;
    }
    if (source !== 'uploaded') {
      generated = deleteAllGeneratedMedia(owner).deleted || 0;
    }
    console.info('[content-explorer] delete-all', { owner: sanitizeContentOwnerPart(owner), source, uploaded, generated });
    return { ok: true, all: true, source, deleted: { uploaded, generated, total: uploaded + generated } };
  }

  const items = Array.isArray(opts.items) ? opts.items : [];
  if (!items.length) throw Object.assign(new Error('items required (or all=true)'), { status: 400 });

  const results = [];
  let uploaded = 0;
  let generated = 0;
  for (const raw of items) {
    const kind = String(raw?.kind || raw?.source || '').toLowerCase();
    const path = String(raw?.path || raw?.relative_path || '').trim();
    try {
      if (kind === 'uploaded') {
        const r = deleteInboundAttachment(owner, path);
        uploaded += 1;
        results.push({ ok: true, kind: 'uploaded', path, filename: r.filename });
      } else if (kind === 'generated') {
        const r = deleteGeneratedMedia(owner, path);
        generated += 1;
        results.push({ ok: true, kind: 'generated', path: r.path, filename: r.filename });
      } else {
        results.push({ ok: false, path, error: 'kind must be uploaded or generated' });
      }
    } catch (e) {
      results.push({ ok: false, kind, path, error: e.message || String(e) });
    }
  }
  console.info('[content-explorer] delete selected', {
    owner: sanitizeContentOwnerPart(owner),
    uploaded,
    generated,
    failed: results.filter((r) => !r.ok).length,
  });
  return {
    ok: true,
    all: false,
    deleted: { uploaded, generated, total: uploaded + generated },
    results,
  };
}

/**
 * Retention: hard-delete aged uploaded + generated CEO media (by file mtime).
 */
export function purgeAgedContentExplorerMedia(ownerUserId, retentionDays) {
  const owner = String(ownerUserId || '').trim();
  const days = Math.max(1, Number(retentionDays) || 90);
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const inbound = purgeAgedInboundAttachments(owner, days);

  let generated = 0;
  const genItems = [...listGeneratedOnDisk(owner), ...listGeneratedFromRegistry(owner)];
  const seen = new Set();
  for (const it of genItems) {
    if (seen.has(it.relative_path)) continue;
    seen.add(it.relative_path);
    try {
      const st = statSync(it.absolute_path);
      if (st.mtimeMs < cutoffMs) {
        deleteGeneratedMedia(owner, it.relative_path);
        generated += 1;
      }
    } catch (e) {
      console.warn('[content-explorer] retention skip', it.relative_path, e?.message || e);
    }
  }

  return {
    inbound_attachments: inbound.deleted || 0,
    generated_media: generated,
  };
}

/** Bytes on disk under media/generated/{ceo}/ (for Efficiency storage). */
export function generatedMediaStorageBytes(ownerUserId) {
  const dir = getCeoGeneratedMediaDir(ownerUserId);
  if (!existsSync(dir)) return 0;
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, name));
        if (st.isFile()) total += st.size || 0;
      } catch {
        /* skip */
      }
    }
  } catch {
    return 0;
  }
  return total;
}