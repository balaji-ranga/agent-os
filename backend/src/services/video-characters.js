/**
 * Video character library: generate or bind CEO-uploaded images to video_characters.
 * Bytes live under media/generated/<ceo>/; Master Data holds character_id ↔ ref_media / image_id.
 */
import { existsSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { resolveInboundRelativePath } from './inbound-attachments.js';
import { invokeContentToolHttp } from './content-tool-http-invoke.js';
import {
  listCharacterLibrary,
  normalizeCharacter,
  saveVideoCharacters,
  slugCharacterId,
} from './video-storyboard-export.js';

async function callGenerateImage(ownerUserId, prompt, styleHint = '') {
  return invokeContentToolHttp(
    'generate_image',
    {
      prompt,
      style_hint: styleHint || undefined,
    },
    ownerUserId,
    { timeoutMs: 180000 }
  );
}

function imageIdFromMedia(media = {}) {
  const path = String(media.local_path || media.relative_url || media.paste_exactly || media.media_uri || '');
  const leaf = path.split(/[/\\]/).filter(Boolean).pop() || '';
  return leaf.replace(/\.[a-z0-9]+$/i, '') || '';
}

function resolveOpenClawApiPath(relativeUrl) {
  const rest = String(relativeUrl || '')
    .replace(/^\/api\/media\/openclaw\//i, '')
    .replace(/^\/+/, '');
  if (!rest || rest.includes('..')) return null;
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const local = join(getOpenClawMediaDir(...parts.slice(0, -1)), parts[parts.length - 1]);
  return existsSync(local) ? local : null;
}

function portraitPrompt(c, styleHint) {
  const appearance = c.appearance || 'consistent reusable character design';
  const role = c.role || 'character';
  const series = c.series ? ` series=${c.series}` : '';
  const style =
    styleHint || 'photoreal cinematic character reference sheet, front 3/4 portrait, clean background';
  return (
    `Character reference portrait for reusable video cast. ` +
    `Name: ${c.name}. Role: ${role}.${series} ` +
    `Appearance: ${appearance}. ` +
    `Single character only, face clearly visible, no text overlays, no collage. Style: ${style}`
  );
}

/**
 * Ensure each cast member has ref_media in Master Data.
 * Reuses existing refs; generates + stores new images under Content Explorer when missing.
 */
export async function ensureVideoCharacterRefs(
  ownerUserId,
  { characters = [], force_regenerate = false, style_hint = '', series = '' } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });

  const input = (Array.isArray(characters) ? characters : [])
    .map((c) => {
      if (typeof c === 'string') return normalizeCharacter({ name: c, character_id: slugCharacterId(c) });
      return normalizeCharacter({
        ...c,
        series: c.series || series || '',
      });
    })
    .filter((c) => c.character_id);

  if (!input.length) {
    throw Object.assign(new Error('characters array required'), { status: 400 });
  }

  const library = listCharacterLibrary(owner);
  const byId = new Map(library.map((c) => [c.character_id, c]));
  const results = [];

  for (const c of input) {
    const existing = byId.get(c.character_id);
    const merged = normalizeCharacter({
      ...existing,
      ...c,
      ref_media: c.ref_media || existing?.ref_media || '',
      image_id: c.image_id || existing?.image_id || '',
      appearance: c.appearance || existing?.appearance || '',
      series: c.series || existing?.series || series || '',
    });

    if (merged.ref_media && !force_regenerate) {
      saveVideoCharacters(owner, [merged]);
      results.push({
        character_id: merged.character_id,
        name: merged.name,
        action: 'reused',
        ref_media: merged.ref_media,
        image_id: merged.image_id,
        relative_url: merged.ref_media.startsWith('/api/media/') ? merged.ref_media : '',
        paste_exactly: merged.ref_media,
      });
      continue;
    }

    try {
      const gen = await callGenerateImage(owner, portraitPrompt(merged, style_hint), style_hint);
      let media = {
        paste_exactly: gen.paste_exactly || gen.media_uri || gen.url,
        media_uri: gen.media_uri || gen.paste_exactly || gen.url,
        relative_url: gen.relative_url || '',
        local_path: gen.local_path || '',
      };

      if (gen.local_path && existsSync(gen.local_path)) {
        try {
          const buf = readFileSync(gen.local_path);
          const ext = (gen.local_path.match(/\.[a-z0-9]+$/i) || ['.png'])[0];
          media = persistGeneratedOpenClawMedia(
            buf,
            `char-${merged.character_id}${ext}`,
            'generated',
            owner
          );
        } catch (e) {
          console.warn('[video-characters] re-persist failed', merged.character_id, e?.message || e);
        }
      }

      const image_id = imageIdFromMedia(media);
      const ref_media = media.paste_exactly || media.media_uri || media.relative_url || '';
      const saved = normalizeCharacter({
        ...merged,
        ref_media,
        image_id,
        notes: merged.notes || 'portrait generated for reuse',
      });
      saveVideoCharacters(owner, [saved]);
      results.push({
        character_id: saved.character_id,
        name: saved.name,
        action: 'generated',
        ref_media: saved.ref_media,
        image_id: saved.image_id,
        relative_url: media.relative_url || '',
        paste_exactly: media.paste_exactly || ref_media,
      });
      console.info(
        '[video-characters] generated owner=%s character_id=%s image_id=%s',
        owner,
        saved.character_id,
        saved.image_id
      );
    } catch (e) {
      console.warn('[video-characters] generate failed', merged.character_id, e?.message || e);
      saveVideoCharacters(owner, [merged]);
      results.push({
        character_id: merged.character_id,
        name: merged.name,
        action: 'error',
        error: e.message || String(e),
        ref_media: merged.ref_media || '',
        image_id: merged.image_id || '',
      });
    }
  }

  const media_lines = results
    .flatMap((r) => [r.paste_exactly, r.relative_url, r.ref_media].filter(Boolean))
    .filter((v, i, a) => a.indexOf(v) === i);

  return {
    ok: true,
    owner,
    results,
    characters: results.map((r) => ({
      character_id: r.character_id,
      name: r.name,
      ref_media: r.ref_media,
      image_id: r.image_id,
    })),
    media_lines,
    paste_block: media_lines.join('\n'),
    delivery_hint:
      'Character portraits stored under Content Explorer (media/generated/<ceo>/). Master Data video_characters.ref_media + image_id correlate each face. Paste paste_block to show portraits in chat.',
  };
}

/**
 * Map a CEO-uploaded image (inbound attachment or MEDIA path) to a character name in video_characters.
 * If character_name is missing, returns ask_ceo so Orchestrator prompts for the name.
 */
export function bindVideoCharacterUpload(
  ownerUserId,
  {
    character_name = '',
    name = '',
    character_id = '',
    role = '',
    appearance = '',
    series = '',
    notes = '',
    relative_path = '',
    inbound_path = '',
    media = '',
    media_uri = '',
    ref_media = '',
  } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });

  const pathHint = String(
    relative_path || inbound_path || media || media_uri || ref_media || ''
  ).trim();
  if (!pathHint) {
    throw Object.assign(
      new Error('Provide relative_path (inbound/attachments/…) or MEDIA:/… / /api/media/… for the uploaded image'),
      { status: 400 }
    );
  }

  const displayName = String(character_name || name || '').trim();
  if (!displayName && !character_id) {
    return {
      ok: false,
      code: 'character_name_required',
      ask_ceo:
        'I have your uploaded image. What character name should I map it to? (e.g. Thenali, King). I will store it in Master Data video_characters with this image for reuse.',
      pending_media: pathHint,
    };
  }

  const id = slugCharacterId(character_id || displayName);
  let buffer = null;
  let filenameHint = `char-${id}.png`;
  let existingApiPath = '';

  if (/^inbound\//i.test(pathHint) || pathHint.includes('inbound/attachments')) {
    const rel = pathHint.replace(/^\/+/, '');
    const abs = resolveInboundRelativePath(owner, rel.startsWith('inbound/') ? rel : `inbound/attachments/${basename(rel)}`);
    const abs2 = abs || resolveInboundRelativePath(owner, rel);
    if (!abs2 || !existsSync(abs2)) {
      throw Object.assign(new Error(`Inbound file not found: ${pathHint}`), { status: 404 });
    }
    buffer = readFileSync(abs2);
    filenameHint = `char-${id}-${basename(abs2)}`;
  } else if (/^MEDIA:/i.test(pathHint)) {
    const local = pathHint.replace(/^MEDIA:\s*/i, '');
    if (!existsSync(local)) {
      throw Object.assign(new Error(`MEDIA path not found: ${local}`), { status: 404 });
    }
    buffer = readFileSync(local);
    filenameHint = `char-${id}-${basename(local)}`;
  } else if (/^\/api\/media\/openclaw\//i.test(pathHint)) {
    const local = resolveOpenClawApiPath(pathHint);
    if (local) {
      buffer = readFileSync(local);
      filenameHint = `char-${id}-${basename(local)}`;
    } else {
      existingApiPath = pathHint;
    }
  } else {
    throw Object.assign(
      new Error('Unsupported media path — use inbound/attachments/… or MEDIA:/… or /api/media/openclaw/…'),
      { status: 400 }
    );
  }

  let mediaOut;
  if (buffer) {
    mediaOut = persistGeneratedOpenClawMedia(buffer, filenameHint, 'generated', owner);
  } else {
    mediaOut = {
      paste_exactly: existingApiPath,
      media_uri: existingApiPath,
      relative_url: existingApiPath,
      local_path: '',
    };
  }

  const image_id = imageIdFromMedia(mediaOut);
  const ref = mediaOut.paste_exactly || mediaOut.media_uri || mediaOut.relative_url;
  const saved = saveVideoCharacters(owner, [
    {
      character_id: id,
      name: displayName || id,
      role,
      appearance,
      series,
      notes: notes || 'bound from CEO upload',
      ref_media: ref,
      image_id,
    },
  ]);

  console.info(
    '[video-characters] bind-upload owner=%s character_id=%s image_id=%s',
    owner,
    id,
    image_id
  );

  return {
    ok: true,
    action: buffer ? 'bound_upload' : 'bound_existing',
    character_id: id,
    name: displayName || id,
    ref_media: ref,
    image_id,
    relative_url: mediaOut.relative_url || '',
    paste_exactly: mediaOut.paste_exactly || ref,
    media_lines: [mediaOut.paste_exactly, mediaOut.relative_url].filter(Boolean),
    paste_block: [mediaOut.paste_exactly, mediaOut.relative_url].filter(Boolean).join('\n'),
    saved,
    delivery_hint:
      'Character mapped in video_characters. Paste paste_block to show the portrait. Reuse character_id in future stories.',
  };
}

/**
 * List character library rows for Orchestrator (with media paste hints).
 */
export function listVideoCharacters(ownerUserId, { query = '' } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  let rows = listCharacterLibrary(owner);
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (q) {
    rows = rows.filter(
      (c) =>
        c.character_id.includes(q) ||
        String(c.name).toLowerCase().includes(q) ||
        String(c.role).toLowerCase().includes(q)
    );
  }
  return {
    ok: true,
    characters: rows.map((c) => ({
      ...c,
      has_image: Boolean(c.ref_media),
      media_lines: c.ref_media ? [c.ref_media] : [],
    })),
    missing_images: rows.filter((c) => !c.ref_media).map((c) => c.character_id),
  };
}
