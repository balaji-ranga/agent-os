/**
 * Phase 1 storyboard exports: HTML + PDF + SVG contact sheet.
 * Persists under OpenClaw media with CEO ownership; Master Data video_storyboards + RAG.
 * Cast mid-gate: story draft → CEO confirm reusable character_ids → Scene/Prompt.
 */
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { findTableByName, insertRow, updateRow, listRows, ensureTableColumns } from './master-data.js';
import { seedVideoContentKnowledgeTables } from './video-content-knowledge.js';

export const STORY_STATUS = {
  PENDING_CEO: 'pending_ceo_approval',
  CEO_APPROVED: 'ceo_approved',
  VIDEO_GENERATED: 'video_generated',
  REJECTED: 'rejected',
};

const STORYBOARD_COLS = [
  'storyboard_id',
  'title',
  'status',
  'duration_sec',
  'plan_json',
  'html_path',
  'pdf_path',
  'image_path',
  'final_video_path',
  'asset_manifest_json',
  'workflow_run_id',
  'rag_document_id',
  'updated',
];

const CHARACTER_COLS = [
  'character_id',
  'name',
  'role',
  'ref_media',
  'image_id',
  'appearance',
  'series',
  'notes',
  'updated',
];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function slugCharacterId(nameOrId) {
  const raw = String(nameOrId || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return raw || `c-${randomUUID().slice(0, 6)}`;
}

export function normalizeCharacter(c = {}) {
  const character_id = slugCharacterId(c.character_id || c.id || c.name);
  return {
    character_id,
    id: character_id,
    name: String(c.name || character_id).trim() || character_id,
    role: String(c.role || '').trim(),
    ref_media: String(c.ref_media || c.media || '').trim(),
    image_id: String(c.image_id || '').trim(),
    appearance: String(c.appearance || c.appearance_notes || '').trim(),
    series: String(c.series || '').trim(),
    notes: String(c.notes || '').trim(),
  };
}

/**
 * True when ref_media points at a real OpenClaw media file — not agent placeholders
 * like MEDIA:/api/media/thenali-raman-ref (no openclaw path / no image bytes).
 */
export function isUsableVideoRefMedia(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return false;
  if (/^(?:MEDIA:\s*)?\/api\/media\/(?!openclaw\/)/i.test(raw)) return false;
  if (/^MEDIA:/i.test(raw) && /\.openclaw\/media\//i.test(raw)) return true;
  if (/^(?:MEDIA:\s*)?\/api\/media\/openclaw\//i.test(raw)) return true;
  if (/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(raw) && /(?:openclaw\/media|\/media\/)/i.test(raw)) {
    return true;
  }
  return false;
}

/** Prefer Master Data portrait over Story/Prompt invented ref_media. */
function mergeCharacterRef(proposed, libraryHit) {
  const p = normalizeCharacter(proposed || {});
  const hit = libraryHit ? normalizeCharacter(libraryHit) : null;
  const ref =
    (hit && isUsableVideoRefMedia(hit.ref_media) && hit.ref_media) ||
    (isUsableVideoRefMedia(p.ref_media) && p.ref_media) ||
    '';
  const image_id =
    (hit && isUsableVideoRefMedia(hit.ref_media) && hit.image_id) ||
    (isUsableVideoRefMedia(p.ref_media) && p.image_id) ||
    hit?.image_id ||
    p.image_id ||
    '';
  return normalizeCharacter({
    ...p,
    name: p.name || hit?.name || p.character_id,
    role: p.role || hit?.role || '',
    appearance: p.appearance || hit?.appearance || '',
    series: p.series || hit?.series || '',
    notes: p.notes || (hit ? 'reused from library' : p.notes),
    ref_media: ref,
    image_id: ref ? image_id : '',
  });
}

/** Kanban Artifacts: emit /api/media/openclaw… so AuthenticatedImage can load portraits. */
function portraitArtifactLines(characters) {
  const lines = [];
  for (const c of characters || []) {
    if (!isUsableVideoRefMedia(c.ref_media)) continue;
    const pasted = pasteLinesFromStoredPath(c.ref_media);
    const apiUrl = pasted.relative_url || (String(c.ref_media).startsWith('/api/media/') ? c.ref_media : '');
    if (!apiUrl) continue;
    lines.push(`## Portrait · ${c.character_id} (${c.name})`, apiUrl);
  }
  return lines;
}

function normalizeStoryboard(raw) {
  const board = raw && typeof raw === 'object' ? raw : {};
  const characters = (Array.isArray(board.characters) ? board.characters : []).map(normalizeCharacter);
  const scenes = Array.isArray(board.scenes) ? board.scenes : [];
  return {
    title: String(board.title || 'Untitled storyboard').trim() || 'Untitled storyboard',
    duration_sec:
      Number(board.duration_sec) || scenes.reduce((a, s) => a + (Number(s.duration_sec) || 8), 0) || 60,
    characters,
    scenes,
    logline: board.logline || '',
    tone: board.tone || '',
  };
}

function ensureVideoTables(ownerUserId) {
  seedVideoContentKnowledgeTables(ownerUserId);
  const sb = findTableByName(ownerUserId, 'video_storyboards');
  if (sb?.id) ensureTableColumns(ownerUserId, sb.id, STORYBOARD_COLS);
  const ch = findTableByName(ownerUserId, 'video_characters');
  if (ch?.id) ensureTableColumns(ownerUserId, ch.id, CHARACTER_COLS);
  return { storyboards: findTableByName(ownerUserId, 'video_storyboards'), characters: findTableByName(ownerUserId, 'video_characters') };
}

function listCharacterLibrary(ownerUserId) {
  const { characters: table } = ensureVideoTables(ownerUserId);
  if (!table) return [];
  const listed = listRows(ownerUserId, table.id, { limit: 500 });
  return (listed?.rows || []).map((r) => normalizeCharacter(r.data || {}));
}

export { listCharacterLibrary };

function buildCharacterRosterLines(characters) {
  const lines = ['Character roster (character_id → Master Data video_characters)', ''];
  if (!characters.length) {
    lines.push('(none)');
    return lines.join('\n');
  }
  for (const c of characters) {
    lines.push(
      `- character_id: ${c.character_id} | name: ${c.name} | role: ${c.role || '—'} | image_id: ${c.image_id || '—'} | ref_media: ${c.ref_media || '(none)'} | appearance: ${c.appearance || '—'}`
    );
  }
  return lines.join('\n');
}

function buildHtml(board) {
  const rosterRows = board.characters
    .map(
      (c) => `<tr>
  <td><code>${escapeHtml(c.character_id)}</code></td>
  <td>${escapeHtml(c.name)}</td>
  <td>${escapeHtml(c.role || '')}</td>
  <td>${escapeHtml(c.ref_media || '—')}</td>
  <td>${escapeHtml(c.appearance || '—')}</td>
</tr>`
    )
    .join('\n');
  const scenesHtml = board.scenes
    .map((sc, i) => {
      const idx = sc.index ?? i + 1;
      const castIds = (sc.characters || []).map((x) => String(x)).join(', ');
      return `<section class="scene">
  <h2>Scene ${escapeHtml(idx)} · ${escapeHtml(sc.duration_sec || 8)}s</h2>
  <p class="desc">${escapeHtml(sc.description || '')}</p>
  <p><strong>character_ids:</strong> ${escapeHtml(castIds || '—')}</p>
  <p><strong>Continuity:</strong> ${escapeHtml(sc.continuity_notes || '')}</p>
  <h3>Veo / Flow prompt</h3>
  <pre>${escapeHtml(sc.veo_prompt || '')}</pre>
  <h3>Negative</h3>
  <pre>${escapeHtml(sc.negative_prompt || '')}</pre>
</section>`;
    })
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(board.title)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.75rem; }
  .meta { color: #555; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; margin: 0.75rem 0 1.5rem; }
  th, td { border: 1px solid #ddd; padding: 0.4rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f6f6f4; }
  .scene { border-top: 1px solid #ddd; padding: 1rem 0; }
  pre { white-space: pre-wrap; background: #f6f6f4; padding: 0.75rem; border-radius: 4px; font-size: 0.9rem; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
  <h1>${escapeHtml(board.title)}</h1>
  <p class="meta">${escapeHtml(board.duration_sec)}s · ${board.scenes.length} scenes</p>
  ${board.logline ? `<p>${escapeHtml(board.logline)}</p>` : ''}
  <h2>Characters (character_id mapping)</h2>
  <table>
    <thead><tr><th>character_id</th><th>name</th><th>role</th><th>ref_media</th><th>appearance</th></tr></thead>
    <tbody>${rosterRows || '<tr><td colspan="5">None listed</td></tr>'}</tbody>
  </table>
  ${scenesHtml}
  <p class="meta">Flolah video storyboard · characters locked to Master Data video_characters</p>
</body>
</html>`;
}

function buildSvgContactSheet(board) {
  const w = 1080;
  const rowH = 160;
  const charH = 28 + board.characters.length * 22;
  const h = 120 + charH + board.scenes.length * rowH;
  const charRows = board.characters
    .map((c, i) => {
      const y = 110 + i * 22;
      return `<text x="60" y="${y}" font-size="14" font-family="monospace" fill="#333">${escapeHtml(c.character_id)} → ${escapeHtml(c.name)} (${escapeHtml(c.role || '')})</text>`;
    })
    .join('\n');
  const rows = board.scenes
    .map((sc, i) => {
      const y = 100 + charH + i * rowH;
      const idx = sc.index ?? i + 1;
      const desc = String(sc.description || '').slice(0, 90);
      const ids = (sc.characters || []).map(String).join(',').slice(0, 60);
      return `<rect x="40" y="${y}" width="${w - 80}" height="${rowH - 16}" rx="8" fill="#f4f1ea" stroke="#ccc"/>
<text x="60" y="${y + 28}" font-size="22" font-family="Georgia, serif" fill="#222">Scene ${escapeHtml(idx)} · ${escapeHtml(sc.duration_sec || 8)}s · ids: ${escapeHtml(ids)}</text>
<text x="60" y="${y + 58}" font-size="16" font-family="Georgia, serif" fill="#444">${escapeHtml(desc)}</text>
<text x="60" y="${y + 88}" font-size="14" font-family="monospace" fill="#666">${escapeHtml(String(sc.veo_prompt || '').slice(0, 120))}</text>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="100%" height="100%" fill="#fffef8"/>
  <text x="40" y="48" font-size="32" font-family="Georgia, serif" fill="#111">${escapeHtml(board.title)}</text>
  <text x="40" y="78" font-size="16" font-family="Georgia, serif" fill="#666">${escapeHtml(board.duration_sec)}s · ${board.scenes.length} scenes · character_id map</text>
  ${charRows}
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
    doc.fontSize(12).fillColor('#111').text('Characters (character_id → video_characters)', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(9).fillColor('#000');
    for (const c of board.characters) {
      doc.text(
        `${c.character_id}  |  ${c.name}  |  role: ${c.role || '—'}  |  ref: ${c.ref_media || '(none)'}`
      );
      if (c.appearance) doc.fillColor('#444').text(`   appearance: ${c.appearance}`).fillColor('#000');
    }
    if (!board.characters.length) doc.text('(none)');

    for (const sc of board.scenes) {
      doc.moveDown(0.55);
      const castIds = (sc.characters || []).map(String).join(', ') || '—';
      doc.fontSize(12).fillColor('#111').text(`Scene ${sc.index ?? ''} · ${sc.duration_sec || 8}s`, {
        underline: true,
      });
      doc.moveDown(0.15);
      doc.fontSize(9).fillColor('#333').text(`character_ids: ${castIds}`);
      doc.moveDown(0.15);
      doc.fontSize(10).fillColor('#000').text(String(sc.description || ''), { lineGap: 2 });
      if (sc.continuity_notes) {
        doc.moveDown(0.15);
        doc.fillColor('#444').text(`Continuity: ${sc.continuity_notes}`);
      }
      doc.moveDown(0.25);
      doc.fillColor('#111').text('Veo / Flow prompt:');
      doc.fillColor('#222').text(String(sc.veo_prompt || ''), { lineGap: 1 });
      if (sc.negative_prompt) {
        doc.moveDown(0.15);
        doc.fillColor('#111').text('Negative:');
        doc.fillColor('#444').text(String(sc.negative_prompt));
      }
    }
    doc.moveDown(1);
    doc.fontSize(9).fillColor('#888').text('Flolah video storyboard · reuse character_id for visual continuity');
    doc.end();
  });
}

function persistStoryboardRow(ownerUserId, payload) {
  ensureVideoTables(ownerUserId);
  const table = findTableByName(ownerUserId, 'video_storyboards');
  if (!table) throw Object.assign(new Error('video_storyboards table missing'), { status: 500 });
  const row = {
    storyboard_id: payload.storyboard_id,
    title: payload.title,
    status: payload.status || STORY_STATUS.PENDING_CEO,
    duration_sec: String(payload.duration_sec || ''),
    plan_json: JSON.stringify(payload.plan || {}),
    html_path: payload.html_path || '',
    pdf_path: payload.pdf_path || '',
    image_path: payload.image_path || '',
    workflow_run_id: payload.workflow_run_id || '',
    rag_document_id: payload.rag_document_id || '',
    updated: new Date().toISOString(),
  };
  const listed = listRows(ownerUserId, table.id, { limit: 500 });
  const existing = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === payload.storyboard_id);
  if (existing?.id) {
    const merged = { ...(existing.data || {}), ...row };
    if (payload.rag_document_id === undefined && existing.data?.rag_document_id) {
      merged.rag_document_id = existing.data.rag_document_id;
    }
    updateRow(ownerUserId, table.id, existing.id, merged);
    return { table_id: table.id, row_id: existing.id, action: 'updated', data: merged };
  }
  const inserted = insertRow(ownerUserId, table.id, row);
  return { table_id: table.id, row_id: inserted?.id || inserted, action: 'created', data: row };
}

async function indexStoryboardRag(ownerUserId, { title, storyboardId, status, workflowRunId, board, pdfBuffer }) {
  try {
    const { indexDocumentForAgent } = await import('./master-data-tools.js');
    const roster = buildCharacterRosterLines(board.characters || []);
    const sceneLines = (board.scenes || [])
      .map((sc, i) => {
        const idx = sc.index ?? i + 1;
        return `Scene ${idx} (${sc.duration_sec || 8}s) character_ids=[${(sc.characters || []).join(',')}]: ${sc.description || ''}\nPrompt: ${sc.veo_prompt || ''}`;
      })
      .join('\n\n');
    const text = [
      `Video storyboard`,
      `title: ${title}`,
      `storyboard_id: ${storyboardId}`,
      `workflow_run_id: ${workflowRunId || ''}`,
      `status: ${status}`,
      `updated: ${new Date().toISOString()}`,
      '',
      roster,
      '',
      board.logline ? `logline: ${board.logline}` : '',
      '',
      sceneLines,
    ]
      .filter(Boolean)
      .join('\n');

    const indexedText = await indexDocumentForAgent(ownerUserId, {
      content_text: text,
      filename: `video-storyboard-${storyboardId}.md`,
      title: `Video storyboard · ${title} · ${status}`,
      mime_type: 'text/markdown',
      tags: ['video_storyboard', status, storyboardId],
      agent_id: 'video-storyboard-export',
    });

    let indexedPdf = null;
    if (pdfBuffer && Buffer.isBuffer(pdfBuffer) && pdfBuffer.length) {
      try {
        indexedPdf = await indexDocumentForAgent(ownerUserId, {
          content_base64: pdfBuffer.toString('base64'),
          filename: `video-storyboard-${storyboardId}.pdf`,
          title: `Video storyboard PDF · ${title}`,
          mime_type: 'application/pdf',
          tags: ['video_storyboard', 'pdf', storyboardId],
          agent_id: 'video-storyboard-export',
        });
      } catch (e) {
        console.warn('[video-storyboard] PDF RAG index failed', e?.message || e);
      }
    }

    const ragId = indexedPdf?.document?.id || indexedText?.document?.id || '';
    console.info('[video-storyboard] RAG indexed owner=%s id=%s rag=%s', ownerUserId, storyboardId, ragId);
    return { text: indexedText, pdf: indexedPdf, rag_document_id: ragId };
  } catch (e) {
    console.warn('[video-storyboard] RAG index failed', e?.message || e);
    return null;
  }
}

/**
 * Save + export storyboard for entitled CEO.
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
  const formats =
    Array.isArray(input.formats) && input.formats.length
      ? input.formats.map((f) => String(f).toLowerCase())
      : ['html', 'pdf', 'image'];
  const status = String(input.status || STORY_STATUS.PENDING_CEO).trim() || STORY_STATUS.PENDING_CEO;

  const slug =
    board.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'storyboard';

  const exports = {};
  const media_lines = [];
  let pdfBuf = null;

  if (formats.includes('html')) {
    const html = Buffer.from(buildHtml(board), 'utf8');
    const media = persistGeneratedOpenClawMedia(html, `${slug}-${storyboardId}.html`, 'generated', owner);
    exports.html = media;
    media_lines.push(media.paste_exactly || media.media_uri || media.relative_url);
  }
  if (formats.includes('pdf')) {
    pdfBuf = await pdfBufferFromBoard(board);
    const media = persistGeneratedOpenClawMedia(pdfBuf, `${slug}-${storyboardId}.pdf`, 'generated', owner);
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
  let rag = null;
  if (input.persist !== false) {
    if (input.index_rag !== false) {
      rag = await indexStoryboardRag(owner, {
        title: board.title,
        storyboardId,
        status,
        workflowRunId: input.workflow_run_id || '',
        board,
        pdfBuffer: pdfBuf,
      });
    }
    md = persistStoryboardRow(owner, {
      storyboard_id: storyboardId,
      title: board.title,
      status,
      duration_sec: board.duration_sec,
      plan: board,
      html_path: exports.html?.relative_url || exports.html?.paste_exactly || '',
      pdf_path: exports.pdf?.relative_url || exports.pdf?.paste_exactly || '',
      image_path: exports.image?.relative_url || exports.image?.paste_exactly || '',
      workflow_run_id: input.workflow_run_id || '',
      rag_document_id: rag?.rag_document_id || '',
    });
  }

  console.info(
    '[video-storyboard] export owner=%s id=%s status=%s formats=%s',
    owner,
    storyboardId,
    status,
    formats.join(',')
  );

  return {
    ok: true,
    storyboard_id: storyboardId,
    title: board.title,
    status,
    duration_sec: board.duration_sec,
    scene_count: board.scenes.length,
    characters: board.characters,
    exports,
    media_lines,
    paste_block: media_lines.join('\n'),
    master_data: md,
    rag_document_id: rag?.rag_document_id || md?.data?.rag_document_id || '',
    delivery_hint:
      'Paste each MEDIA: line in chat so the CEO can open HTML/PDF/image. Character roster maps character_id to Master Data video_characters.',
  };
}

function sliceJsonObject(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unwrapStoryboardObject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (Array.isArray(obj.scenes)) return obj;
  if (obj.storyboard && Array.isArray(obj.storyboard.scenes)) return obj.storyboard;
  if (obj.plan && Array.isArray(obj.plan.scenes)) return obj.plan;
  return null;
}

export function looksLikeVideoStoryboard(obj) {
  const board = unwrapStoryboardObject(obj);
  if (!board || !Array.isArray(board.scenes) || !board.scenes.length) return false;
  return board.scenes.some(
    (s) => s && typeof s === 'object' && (s.veo_prompt || s.description || s.camera || s.negative_prompt)
  );
}

/** Story Agent draft: title + characters_used / beats (before scenes/prompts). */
export function looksLikeStoryCastDraft(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  if (looksLikeVideoStoryboard(obj)) return false;
  const hasTitle = Boolean(String(obj.title || '').trim());
  const chars = obj.characters_used || obj.characters;
  const hasChars = Array.isArray(chars) && chars.length > 0;
  const hasBeats = Array.isArray(obj.beats) && obj.beats.length > 0;
  return hasTitle && (hasChars || hasBeats);
}

export function extractJsonObjectFromText(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  let t = String(raw).trim();
  if (!t) return null;
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  let obj = tryParseJson(t);
  if (!obj) {
    const i = t.indexOf('{');
    if (i >= 0) {
      const sliced = sliceJsonObject(t, i);
      obj = sliced ? tryParseJson(sliced) : null;
    }
  }
  return obj;
}

export function extractStoryboardFromText(raw) {
  const obj = extractJsonObjectFromText(raw);
  return unwrapStoryboardObject(obj);
}

export function extractStoryCastFromText(raw) {
  const obj = extractJsonObjectFromText(raw);
  if (!looksLikeStoryCastDraft(obj) && !(obj && (obj.characters_used || obj.title))) return null;
  return obj;
}

function charactersFromStoryDraft(draft, library = []) {
  const libById = new Map(library.map((c) => [c.character_id, c]));
  const libByName = new Map(library.map((c) => [String(c.name).toLowerCase(), c]));
  const rawList = Array.isArray(draft?.characters_used)
    ? draft.characters_used
    : Array.isArray(draft?.characters)
      ? draft.characters
      : [];
  const out = [];
  for (const item of rawList) {
    if (typeof item === 'string') {
      const id = slugCharacterId(item);
      const hit = libById.get(id) || libByName.get(item.toLowerCase());
      out.push(
        normalizeCharacter(
          hit || {
            character_id: id,
            name: item,
            role: 'cast',
          }
        )
      );
      continue;
    }
    if (item && typeof item === 'object') {
      const proposed = normalizeCharacter(item);
      const hit = libById.get(proposed.character_id) || libByName.get(proposed.name.toLowerCase());
      out.push(mergeCharacterRef(proposed, hit));
    }
  }
  return out;
}

export function formatStoryboardApprovalSummary(rawBoard) {
  const board = normalizeStoryboard(rawBoard);
  const lines = [`${board.title}`, `${board.duration_sec}s · ${board.scenes.length} scenes`];
  if (board.logline) lines.push(String(board.logline));
  if (board.tone) lines.push(`Tone: ${board.tone}`);
  lines.push('', buildCharacterRosterLines(board.characters), '', 'Scenes:');
  for (let i = 0; i < board.scenes.length; i++) {
    const sc = board.scenes[i];
    const idx = sc.index ?? i + 1;
    const dur = sc.duration_sec || 8;
    const ids = (sc.characters || []).map(String).join(',');
    const desc = String(sc.description || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240);
    lines.push(`${idx}. (${dur}s) ids=[${ids || '—'}] ${desc || '(no description)'}`);
  }
  return lines.join('\n');
}

export function formatCastApprovalSummary(draft, resolvedCharacters) {
  const title = String(draft?.title || 'Untitled story').trim();
  const lines = [
    `Cast review · ${title}`,
    draft?.logline ? String(draft.logline) : '',
    draft?.duration_sec ? `Target duration: ${draft.duration_sec}s` : '',
    '',
    'Approve to lock character_id → video_characters (reuse same faces in every video).',
    'Reject to stop before Scene/Prompt.',
    '',
    buildCharacterRosterLines(resolvedCharacters),
  ];
  if (Array.isArray(draft?.beats) && draft.beats.length) {
    lines.push('', 'Story beats (preview):');
    draft.beats.slice(0, 12).forEach((b, i) => {
      lines.push(`${i + 1}. ${typeof b === 'string' ? b : JSON.stringify(b)}`);
    });
  }
  return lines.filter((x, i) => x !== '' || i === 0).join('\n');
}

/**
 * List storyboard knowledge rows (for Orchestrator / tools).
 */
function pasteLinesFromStoredPath(pathOrMedia) {
  const raw = String(pathOrMedia || '').trim();
  if (!raw) return { media_lines: [], relative_url: '', paste_exactly: '' };
  if (/^MEDIA:/i.test(raw)) {
    const local = raw.replace(/^MEDIA:\s*/i, '');
    const m = local.replace(/\\/g, '/').match(/\/media\/([^/]+)\/(.+)$/i);
    const relative_url = m ? `/api/media/openclaw/${m[1]}/${m[2]}` : '';
    return { media_lines: [raw, relative_url].filter(Boolean), relative_url, paste_exactly: raw };
  }
  if (raw.startsWith('/api/media/openclaw/')) {
    try {
      const rest = raw.slice('/api/media/openclaw/'.length);
      const [subdir, ...nameParts] = rest.split('/');
      const local = join(getOpenClawMediaDir(subdir), ...nameParts);
      if (existsSync(local)) {
        const paste = `MEDIA:${local}`;
        return { media_lines: [paste, raw], relative_url: raw, paste_exactly: paste };
      }
    } catch {
      /* fall through */
    }
    return { media_lines: [raw], relative_url: raw, paste_exactly: raw };
  }
  if (raw.startsWith('/api/media/')) {
    return { media_lines: [raw], relative_url: raw, paste_exactly: raw };
  }
  return { media_lines: [raw], relative_url: raw, paste_exactly: raw };
}

/**
 * Resolve stored storyboard export paths into chat-ready MEDIA: /api/media lines for Orchestrator.
 */
export function attachVideoStoryboardMedia(ownerUserId, { storyboard_id = '', title = '', workflow_run_id = '' } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  ensureVideoTables(owner);
  const table = findTableByName(owner, 'video_storyboards');
  if (!table) throw Object.assign(new Error('video_storyboards table missing'), { status: 500 });
  const listed = listRows(owner, table.id, { limit: 500 });
  let row = null;
  if (storyboard_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === String(storyboard_id));
  }
  if (!row && workflow_run_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.workflow_run_id) === String(workflow_run_id));
  }
  if (!row && title) {
    const needle = String(title).toLowerCase();
    const matches = (listed?.rows || []).filter((r) => String(r.data?.title || '').toLowerCase().includes(needle));
    matches.sort((a, b) => String(b.data?.updated || '').localeCompare(String(a.data?.updated || '')));
    row = matches[0] || null;
  }
  if (!row && !storyboard_id && !title && !workflow_run_id) {
    const all = [...(listed?.rows || [])].sort((a, b) =>
      String(b.data?.updated || '').localeCompare(String(a.data?.updated || ''))
    );
    row = all.find((r) => r.data?.pdf_path || r.data?.html_path || r.data?.image_path) || all[0] || null;
  }
  if (!row?.data) {
    throw Object.assign(new Error('storyboard not found for attach'), { status: 404 });
  }
  const d = row.data;
  const pdf = pasteLinesFromStoredPath(d.pdf_path);
  const html = pasteLinesFromStoredPath(d.html_path);
  const image = pasteLinesFromStoredPath(d.image_path);
  const media_lines = [...pdf.media_lines, ...html.media_lines, ...image.media_lines].filter(Boolean);
  const unique = [...new Set(media_lines)];
  const paste_block = unique.join('\n');
  console.info(
    '[video-storyboard] attach owner=%s id=%s lines=%s',
    owner,
    d.storyboard_id,
    unique.length
  );
  return {
    ok: true,
    storyboard_id: d.storyboard_id,
    title: d.title,
    status: d.status,
    workflow_run_id: d.workflow_run_id || '',
    exports: {
      pdf: { relative_url: pdf.relative_url || d.pdf_path || '', paste_exactly: pdf.paste_exactly },
      html: { relative_url: html.relative_url || d.html_path || '', paste_exactly: html.paste_exactly },
      image: { relative_url: image.relative_url || d.image_path || '', paste_exactly: image.paste_exactly },
    },
    media_lines: unique,
    paste_block,
    delivery_hint:
      'Paste paste_block into the chat reply: each MEDIA: or /api/media line on its own line so Dashboard shows PDF/HTML/image inline and WhatsApp can attach files.',
  };
}

export function listVideoStoryStatuses(ownerUserId, { title = '', limit = 50 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  ensureVideoTables(owner);
  const table = findTableByName(owner, 'video_storyboards');
  if (!table) return { ok: true, stories: [], pending_ceo_approval: [] };
  const listed = listRows(owner, table.id, { limit: Math.min(500, Number(limit) || 50) });
  const needle = String(title || '')
    .trim()
    .toLowerCase();
  let stories = (listed?.rows || []).map((r) => {
    const pdf = pasteLinesFromStoredPath(r.data?.pdf_path);
    const html = pasteLinesFromStoredPath(r.data?.html_path);
    const image = pasteLinesFromStoredPath(r.data?.image_path);
    const media_lines = [...new Set([...pdf.media_lines, ...html.media_lines, ...image.media_lines].filter(Boolean))];
    return {
      row_id: r.id,
      storyboard_id: r.data?.storyboard_id,
      title: r.data?.title,
      status: r.data?.status,
      workflow_run_id: r.data?.workflow_run_id,
      pdf_path: r.data?.pdf_path,
      html_path: r.data?.html_path,
      image_path: r.data?.image_path,
      rag_document_id: r.data?.rag_document_id,
      updated: r.data?.updated,
      media_lines,
      paste_block: media_lines.join('\n'),
      has_exports: Boolean(r.data?.pdf_path || r.data?.html_path || r.data?.image_path),
    };
  });
  if (needle) {
    stories = stories.filter((s) => String(s.title || '').toLowerCase().includes(needle));
  }
  stories.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  const pending = stories.filter((s) => s.status === STORY_STATUS.PENDING_CEO);
  const titles90d = recentTitles(stories, 90);
  return {
    ok: true,
    stories,
    pending_ceo_approval: pending,
    recent_titles_90d: titles90d,
    advice: pending.length
      ? `Found ${pending.length} story(ies) pending CEO approval. Ask the CEO to approve/reject those Kanban cards before starting a new storyboard workflow for the same or any new title.`
      : null,
  };
}

function recentTitles(stories, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const titles = [];
  for (const s of stories) {
    const t = Date.parse(s.updated || '');
    if (!Number.isFinite(t) || t < cutoff) continue;
    if (s.title) titles.push({ title: s.title, status: s.status, updated: s.updated, storyboard_id: s.storyboard_id });
  }
  return titles;
}

/** Load one storyboard Master Data row (CEO-scoped). */
export function getVideoStoryboardRecord(ownerUserId, { storyboard_id = '', title = '', workflow_run_id = '' } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return null;
  ensureVideoTables(owner);
  const table = findTableByName(owner, 'video_storyboards');
  if (!table) return null;
  const listed = listRows(owner, table.id, { limit: 500 });
  let row = null;
  if (storyboard_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === String(storyboard_id));
  }
  if (!row && workflow_run_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.workflow_run_id) === String(workflow_run_id));
  }
  if (!row && title) {
    const needle = String(title).toLowerCase();
    row = (listed?.rows || []).find((r) => String(r.data?.title || '').toLowerCase().includes(needle));
  }
  if (!row) return null;
  return { row_id: row.id, ...(row.data || {}) };
}

export function updateVideoStoryboardStatus(ownerUserId, { storyboard_id, workflow_run_id, title, status }) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  ensureVideoTables(owner);
  const table = findTableByName(owner, 'video_storyboards');
  if (!table) throw Object.assign(new Error('video_storyboards missing'), { status: 500 });
  const listed = listRows(owner, table.id, { limit: 500 });
  let row = null;
  if (storyboard_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === String(storyboard_id));
  }
  if (!row && workflow_run_id) {
    row = (listed?.rows || []).find((r) => String(r.data?.workflow_run_id) === String(workflow_run_id));
  }
  if (!row && title) {
    const needle = String(title).toLowerCase();
    row = (listed?.rows || []).find((r) => String(r.data?.title || '').toLowerCase() === needle);
  }
  if (!row?.id) return { ok: false, error: 'storyboard row not found' };
  const next = {
    ...(row.data || {}),
    status: status || row.data?.status,
    updated: new Date().toISOString(),
  };
  updateRow(owner, table.id, row.id, next);
  return { ok: true, storyboard_id: next.storyboard_id, status: next.status, title: next.title };
}

/** Upsert characters into video_characters (owner-scoped). */
export function saveVideoCharacters(ownerUserId, characters = []) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  ensureVideoTables(owner);
  const table = findTableByName(owner, 'video_characters');
  if (!table) throw Object.assign(new Error('video_characters table missing'), { status: 500 });
  const listed = listRows(owner, table.id, { limit: 500 });
  const byId = new Map((listed?.rows || []).map((r) => [String(r.data?.character_id || ''), r]));
  const saved = [];
  for (const c of characters) {
    const norm = normalizeCharacter(c);
    const row = {
      character_id: norm.character_id,
      name: norm.name,
      role: norm.role,
      ref_media: norm.ref_media,
      image_id: norm.image_id,
      appearance: norm.appearance,
      series: norm.series,
      notes: norm.notes,
      updated: new Date().toISOString(),
    };
    const existing = byId.get(norm.character_id);
    if (existing?.id) {
      updateRow(owner, table.id, existing.id, { ...(existing.data || {}), ...row });
      saved.push({ character_id: norm.character_id, action: 'updated' });
    } else {
      insertRow(owner, table.id, row);
      saved.push({ character_id: norm.character_id, action: 'created' });
    }
  }
  return { ok: true, saved };
}

/**
 * Parse agent storyboard output, export HTML/PDF/SVG, Kanban summary + media URLs.
 */
export async function exportStoryboardForCeoApproval(ownerUserId, { rawText, workflowRunId } = {}) {
  const parsed = extractStoryboardFromText(rawText);
  if (!looksLikeVideoStoryboard(parsed)) return null;
  const owner = String(ownerUserId || '').trim();
  const board = normalizeStoryboard(parsed);
  // Prefer library refs for known character_ids
  if (owner) {
    const lib = listCharacterLibrary(owner);
    const byId = new Map(lib.map((c) => [c.character_id, c]));
    board.characters = board.characters.map((c) => {
      const hit = byId.get(c.character_id);
      return hit ? mergeCharacterRef(c, hit) : mergeCharacterRef(c, null);
    });
  }
  const textSummary = formatStoryboardApprovalSummary(board);
  if (!owner) {
    return { summary: textSummary, pdfUrl: '', htmlUrl: '', imageUrl: '', exported: null, kind: 'storyboard' };
  }
  try {
    const exported = await exportVideoStoryboard(owner, {
      storyboard: board,
      persist: true,
      status: STORY_STATUS.PENDING_CEO,
      workflow_run_id: workflowRunId != null ? String(workflowRunId) : '',
      formats: ['html', 'pdf', 'image'],
      index_rag: true,
    });
    const pdfUrl = exported.exports?.pdf?.relative_url || '';
    const htmlUrl = exported.exports?.html?.relative_url || '';
    const imageUrl = exported.exports?.image?.relative_url || '';
    const parts = [textSummary, ''];
    const portraits = portraitArtifactLines(board.characters);
    if (portraits.length) parts.push(...portraits, '');
    if (pdfUrl) parts.push('## Storyboard PDF', pdfUrl);
    if (htmlUrl) parts.push('', '## Storyboard HTML', htmlUrl);
    if (imageUrl) parts.push('', '## Storyboard contact sheet', imageUrl);
    parts.push(
      '',
      `storyboard_id: ${exported.storyboard_id}`,
      `status: ${STORY_STATUS.PENDING_CEO}`,
      `workflow_run_id: ${workflowRunId || ''}`
    );
    return {
      summary: parts.join('\n'),
      pdfUrl,
      htmlUrl,
      imageUrl,
      exported,
      kind: 'storyboard',
    };
  } catch (e) {
    console.warn('[video-storyboard] ceo-approval export failed', e?.message || e);
    return { summary: textSummary, pdfUrl: '', htmlUrl: '', imageUrl: '', exported: null, kind: 'storyboard' };
  }
}

/**
 * Mid-gate: Story draft → cast card + pending knowledge row (no full scene PDF yet).
 */
export async function exportCastForCeoApproval(ownerUserId, { rawText, workflowRunId } = {}) {
  const draft = extractStoryCastFromText(rawText);
  if (!draft || !looksLikeStoryCastDraft(draft)) return null;
  const owner = String(ownerUserId || '').trim();
  const library = owner ? listCharacterLibrary(owner) : [];
  let resolved = charactersFromStoryDraft(draft, library);
  if (!owner) {
    return {
      summary: formatCastApprovalSummary(draft, resolved),
      kind: 'cast',
      characters: resolved,
    };
  }

  // Generate or reuse portraits before CEO cast review.
  try {
    const { ensureVideoCharacterRefs } = await import('./video-characters.js');
    const ensured = await ensureVideoCharacterRefs(owner, {
      characters: resolved,
      style_hint: 'photoreal cinematic kids-friendly character portrait, consistent face',
    });
    const byId = new Map((ensured.characters || []).map((c) => [c.character_id, c]));
    resolved = resolved.map((c) => mergeCharacterRef(c, byId.get(c.character_id) || c));
  } catch (e) {
    console.warn('[video-storyboard] cast ensure refs failed', e?.message || e);
  }

  const summary = formatCastApprovalSummary(draft, resolved);

  const storyboardId = `sb-${randomUUID().slice(0, 8)}`;
  const title = String(draft.title || 'Untitled').trim();
  persistStoryboardRow(owner, {
    storyboard_id: storyboardId,
    title,
    status: STORY_STATUS.PENDING_CEO,
    duration_sec: draft.duration_sec || '',
    plan: { ...draft, characters: resolved, gate: 'cast' },
    workflow_run_id: workflowRunId != null ? String(workflowRunId) : '',
  });
  try {
    const { indexDocumentForAgent } = await import('./master-data-tools.js');
    await indexDocumentForAgent(owner, {
      content_text: [
        `Video story cast pending CEO approval`,
        `title: ${title}`,
        `storyboard_id: ${storyboardId}`,
        `workflow_run_id: ${workflowRunId || ''}`,
        `status: ${STORY_STATUS.PENDING_CEO}`,
        `updated: ${new Date().toISOString()}`,
        '',
        buildCharacterRosterLines(resolved),
        '',
        draft.logline || '',
      ].join('\n'),
      filename: `video-cast-${storyboardId}.md`,
      title: `Video cast · ${title} · pending_ceo_approval`,
      mime_type: 'text/markdown',
      tags: ['video_storyboard', 'cast', STORY_STATUS.PENDING_CEO, storyboardId],
      agent_id: 'video-cast-gate',
    });
  } catch (e) {
    console.warn('[video-storyboard] cast RAG index failed', e?.message || e);
  }

  const portraitLines = portraitArtifactLines(resolved);

  const parts = [
    summary,
    '',
    ...portraitLines,
    '',
    `storyboard_id: ${storyboardId}`,
    `status: ${STORY_STATUS.PENDING_CEO}`,
    `workflow_run_id: ${workflowRunId || ''}`,
    '',
    '## Cast JSON (locked after approve)',
    '```json',
    JSON.stringify({ title, characters: resolved, storyboard_id: storyboardId }, null, 2),
    '```',
  ];
  return {
    summary: parts.join('\n'),
    kind: 'cast',
    characters: resolved,
    storyboard_id: storyboardId,
    title,
  };
}

/**
 * Called when a video workflow CEO gate is approved/rejected.
 */
export function onVideoCeoApprovalDecision({
  ownerUserId,
  runId,
  nodeId,
  nodeLabel = '',
  approved,
  context = null,
}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { ok: false };
  const label = `${nodeId || ''} ${nodeLabel || ''}`.toLowerCase();
  const isCast = /\bcast\b/.test(label) || String(nodeId || '') === 'ceo-cast';
  const isStoryboard =
    /\bstoryboard\b/.test(label) || String(nodeId || '') === 'ceo-gate' || String(nodeId || '') === 'ceo-storyboard';

  if (!approved) {
    updateVideoStoryboardStatus(owner, {
      workflow_run_id: runId,
      status: STORY_STATUS.REJECTED,
    });
    return { ok: true, status: STORY_STATUS.REJECTED };
  }

  if (isCast) {
    try {
      const storyOut =
        context?.node_outputs?.['story-1']?.reply ||
        context?.node_outputs?.['story-1']?.text ||
        context?.node_outputs?.['story-1']?.result ||
        '';
      const draft = extractStoryCastFromText(storyOut) || extractJsonObjectFromText(storyOut);
      const library = listCharacterLibrary(owner);
      const resolved = charactersFromStoryDraft(draft || {}, library);
      if (resolved.length) saveVideoCharacters(owner, resolved);
      updateVideoStoryboardStatus(owner, {
        workflow_run_id: runId,
        status: STORY_STATUS.PENDING_CEO,
      });
      return { ok: true, gate: 'cast', saved: resolved.map((c) => c.character_id) };
    } catch (e) {
      console.warn('[video-storyboard] cast approve save failed', e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    }
  }

  if (isStoryboard) {
    updateVideoStoryboardStatus(owner, {
      workflow_run_id: runId,
      status: STORY_STATUS.CEO_APPROVED,
    });
    return { ok: true, status: STORY_STATUS.CEO_APPROVED };
  }

  return { ok: true, skipped: true };
}
