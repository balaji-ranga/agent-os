/**
 * Phase 1 storyboard exports: HTML + PDF + SVG image contact sheet.
 * Persists under OpenClaw media with CEO ownership; optional Master Data video_storyboards row.
 */
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { findTableByName, insertRow, updateRow, listRows } from './master-data.js';
import { seedVideoContentKnowledgeTables } from './video-content-knowledge.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeStoryboard(raw) {
  const board = raw && typeof raw === 'object' ? raw : {};
  const characters = Array.isArray(board.characters) ? board.characters : [];
  const scenes = Array.isArray(board.scenes) ? board.scenes : [];
  return {
    title: String(board.title || 'Untitled storyboard').trim() || 'Untitled storyboard',
    duration_sec: Number(board.duration_sec) || scenes.reduce((a, s) => a + (Number(s.duration_sec) || 8), 0) || 60,
    characters,
    scenes,
    logline: board.logline || '',
    tone: board.tone || '',
  };
}

function buildHtml(board) {
  const scenesHtml = board.scenes
    .map((sc, i) => {
      const idx = sc.index ?? i + 1;
      return `<section class="scene">
  <h2>Scene ${escapeHtml(idx)} · ${escapeHtml(sc.duration_sec || 8)}s</h2>
  <p class="desc">${escapeHtml(sc.description || '')}</p>
  <p><strong>Characters:</strong> ${escapeHtml((sc.characters || []).join(', '))}</p>
  <p><strong>Continuity:</strong> ${escapeHtml(sc.continuity_notes || '')}</p>
  <h3>Veo / Flow prompt</h3>
  <pre>${escapeHtml(sc.veo_prompt || '')}</pre>
  <h3>Negative</h3>
  <pre>${escapeHtml(sc.negative_prompt || '')}</pre>
</section>`;
    })
    .join('\n');
  const charsHtml = board.characters
    .map(
      (c) =>
        `<li><strong>${escapeHtml(c.name || c.id)}</strong> (${escapeHtml(c.role || '')}) — ${escapeHtml(c.ref_media || 'no ref')}</li>`
    )
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(board.title)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 820px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.75rem; }
  .meta { color: #555; margin-bottom: 1.5rem; }
  .scene { border-top: 1px solid #ddd; padding: 1rem 0; }
  pre { white-space: pre-wrap; background: #f6f6f4; padding: 0.75rem; border-radius: 4px; font-size: 0.9rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(board.title)}</h1>
  <p class="meta">${escapeHtml(board.duration_sec)}s · ${board.scenes.length} scenes</p>
  ${board.logline ? `<p>${escapeHtml(board.logline)}</p>` : ''}
  <h2>Characters</h2>
  <ul>${charsHtml || '<li>None listed</li>'}</ul>
  ${scenesHtml}
  <p class="meta">Flolah video storyboard · Phase 1 (manual Google Flow / later Replicate Veo)</p>
</body>
</html>`;
}

function buildSvgContactSheet(board) {
  const w = 1080;
  const rowH = 160;
  const h = 120 + board.scenes.length * rowH;
  const rows = board.scenes
    .map((sc, i) => {
      const y = 100 + i * rowH;
      const idx = sc.index ?? i + 1;
      const desc = String(sc.description || '').slice(0, 90);
      const prompt = String(sc.veo_prompt || '').slice(0, 120);
      return `<rect x="40" y="${y}" width="${w - 80}" height="${rowH - 16}" rx="8" fill="#f4f1ea" stroke="#ccc"/>
<text x="60" y="${y + 28}" font-size="22" font-family="Georgia, serif" fill="#222">Scene ${escapeHtml(idx)} · ${escapeHtml(sc.duration_sec || 8)}s</text>
<text x="60" y="${y + 58}" font-size="16" font-family="Georgia, serif" fill="#444">${escapeHtml(desc)}</text>
<text x="60" y="${y + 88}" font-size="14" font-family="monospace" fill="#666">${escapeHtml(prompt)}</text>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#fffef8"/>
  <text x="40" y="48" font-size="32" font-family="Georgia, serif" fill="#111">${escapeHtml(board.title)}</text>
  <text x="40" y="78" font-size="16" font-family="Georgia, serif" fill="#666">${escapeHtml(board.duration_sec)}s · ${board.scenes.length} scenes · Flolah storyboard</text>
  ${rows}
</svg>`;
}

function pdfBufferFromBoard(board) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#111').text(board.title, { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#555').text(`${board.duration_sec}s · ${board.scenes.length} scenes`);
    if (board.logline) {
      doc.moveDown(0.4);
      doc.fontSize(11).fillColor('#222').text(board.logline);
    }
    doc.moveDown(0.6);
    doc.fontSize(12).fillColor('#111').text('Characters', { underline: true });
    doc.moveDown(0.2);
    doc.fontSize(10);
    for (const c of board.characters) {
      doc.text(`• ${c.name || c.id} (${c.role || ''}) ${c.ref_media ? `— ${c.ref_media}` : ''}`);
    }
    if (!board.characters.length) doc.text('• (none)');

    for (const sc of board.scenes) {
      doc.moveDown(0.6);
      doc.fontSize(12).fillColor('#111').text(`Scene ${sc.index ?? ''} · ${sc.duration_sec || 8}s`, {
        underline: true,
      });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor('#000').text(String(sc.description || ''), { lineGap: 2 });
      if (sc.continuity_notes) {
        doc.moveDown(0.2);
        doc.fillColor('#444').text(`Continuity: ${sc.continuity_notes}`);
      }
      doc.moveDown(0.3);
      doc.fillColor('#111').text('Veo / Flow prompt:');
      doc.fillColor('#222').text(String(sc.veo_prompt || ''), { lineGap: 1 });
      if (sc.negative_prompt) {
        doc.moveDown(0.2);
        doc.fillColor('#111').text('Negative:');
        doc.fillColor('#444').text(String(sc.negative_prompt));
      }
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#888').text('Flolah video storyboard · Phase 1');
    doc.end();
  });
}

function persistStoryboardRow(ownerUserId, payload) {
  seedVideoContentKnowledgeTables(ownerUserId);
  let table = findTableByName(ownerUserId, 'video_storyboards');
  if (!table) {
    throw Object.assign(new Error('video_storyboards table missing'), { status: 500 });
  }
  const row = {
    storyboard_id: payload.storyboard_id,
    title: payload.title,
    status: payload.status || 'draft',
    duration_sec: String(payload.duration_sec || ''),
    plan_json: JSON.stringify(payload.plan || {}),
    html_path: payload.html_path || '',
    pdf_path: payload.pdf_path || '',
    image_path: payload.image_path || '',
    workflow_run_id: payload.workflow_run_id || '',
    updated: new Date().toISOString(),
  };
  const listed = listRows(ownerUserId, table.id, { limit: 200 });
  const existing = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === payload.storyboard_id);
  if (existing?.id) {
    updateRow(ownerUserId, table.id, existing.id, row);
    return { table_id: table.id, row_id: existing.id, action: 'updated' };
  }
  const inserted = insertRow(ownerUserId, table.id, row);
  return { table_id: table.id, row_id: inserted?.id || inserted, action: 'created' };
}

/**
 * Save + export storyboard for entitled CEO.
 * @param {string} ownerUserId
 * @param {{ storyboard: object, storyboard_id?: string, formats?: string[], persist?: boolean, workflow_run_id?: string }} input
 */
export async function exportVideoStoryboard(ownerUserId, input = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });

  const board = normalizeStoryboard(input.storyboard || input.plan || input);
  if (!board.scenes.length) {
    throw Object.assign(new Error('storyboard.scenes required'), { status: 400 });
  }

  const storyboardId =
    String(input.storyboard_id || input.id || '').trim() || `sb-${randomUUID().slice(0, 8)}`;
  const formats = Array.isArray(input.formats) && input.formats.length
    ? input.formats.map((f) => String(f).toLowerCase())
    : ['html', 'pdf', 'image'];

  const slug = board.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'storyboard';

  const exports = {};
  const media_lines = [];

  if (formats.includes('html')) {
    const html = Buffer.from(buildHtml(board), 'utf8');
    const media = persistGeneratedOpenClawMedia(html, `${slug}-${storyboardId}.html`, 'generated', owner);
    exports.html = media;
    media_lines.push(media.paste_exactly || media.media_uri || media.relative_url);
  }
  if (formats.includes('pdf')) {
    const pdf = await pdfBufferFromBoard(board);
    const media = persistGeneratedOpenClawMedia(pdf, `${slug}-${storyboardId}.pdf`, 'generated', owner);
    exports.pdf = media;
    media_lines.push(media.paste_exactly || media.media_uri || media.relative_url);
  }
  if (formats.includes('image') || formats.includes('svg')) {
    const svg = Buffer.from(buildSvgContactSheet(board), 'utf8');
    const media = persistGeneratedOpenClawMedia(svg, `${slug}-${storyboardId}.svg`, 'generated', owner);
    exports.image = media;
    media_lines.push(media.paste_exactly || media.media_uri || media.relative_url);
  }

  let md = null;
  if (input.persist !== false) {
    md = persistStoryboardRow(owner, {
      storyboard_id: storyboardId,
      title: board.title,
      status: input.status || 'exported',
      duration_sec: board.duration_sec,
      plan: board,
      html_path: exports.html?.relative_url || exports.html?.paste_exactly || '',
      pdf_path: exports.pdf?.relative_url || exports.pdf?.paste_exactly || '',
      image_path: exports.image?.relative_url || exports.image?.paste_exactly || '',
      workflow_run_id: input.workflow_run_id || '',
    });
  }

  console.info('[video-storyboard] export owner=%s id=%s formats=%s', owner, storyboardId, formats.join(','));

  return {
    ok: true,
    storyboard_id: storyboardId,
    title: board.title,
    duration_sec: board.duration_sec,
    scene_count: board.scenes.length,
    exports,
    media_lines,
    paste_block: media_lines.join('\n'),
    master_data: md,
    delivery_hint:
      'Paste each MEDIA: line in chat so the CEO can open HTML/PDF/image. Files are CEO-owned under Content Explorer.',
  };
}

/** Upsert characters into video_characters (owner-scoped). */
export function saveVideoCharacters(ownerUserId, characters = []) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  seedVideoContentKnowledgeTables(owner);
  const table = findTableByName(owner, 'video_characters');
  if (!table) throw Object.assign(new Error('video_characters table missing'), { status: 500 });
  const listed = listRows(owner, table.id, { limit: 500 });
  const byId = new Map((listed?.rows || []).map((r) => [String(r.data?.character_id || ''), r]));
  const saved = [];
  for (const c of characters) {
    const character_id = String(c.character_id || c.id || '').trim() || `c-${randomUUID().slice(0, 6)}`;
    const row = {
      character_id,
      name: String(c.name || character_id),
      role: String(c.role || ''),
      ref_media: String(c.ref_media || c.media || ''),
      notes: String(c.notes || ''),
      updated: new Date().toISOString(),
    };
    const existing = byId.get(character_id);
    if (existing?.id) {
      updateRow(owner, table.id, existing.id, row);
      saved.push({ character_id, action: 'updated' });
    } else {
      insertRow(owner, table.id, row);
      saved.push({ character_id, action: 'created' });
    }
  }
  return { ok: true, saved };
}
