/**
 * S5 — assemble per-scene clips (paths only) with FFmpeg + QC.
 * Marks video_storyboards.status = video_generated when final MP4 is stored.
 * Provider-agnostic: works for flow_browser and replicate_api S4 outputs.
 */
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import {
  STORY_STATUS,
  getVideoStoryboardRecord,
  updateVideoStoryboardStatus,
} from './video-storyboard-export.js';
import {
  buildAssetManifest,
  MAX_SCENE_DURATION_SEC,
  listVideoJobs,
} from './video-media.js';
import { findTableByName, updateRow, listRows, ensureTableColumns } from './master-data.js';

const STORYBOARD_EXTRA_COLS = ['final_video_path', 'asset_manifest_json'];

function ffmpegBin() {
  return String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
}

function runFfmpeg(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      reject(new Error('ffmpeg timeout'));
    }, timeoutMs);
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve({ ok: true, stderr });
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-600)}`));
    });
  });
}

function resolveClipLocalPath(pathHint) {
  const hint = String(pathHint || '').trim();
  if (!hint) return null;
  if (/^MEDIA:/i.test(hint)) {
    const local = hint.replace(/^MEDIA:\s*/i, '');
    return existsSync(local) ? local : null;
  }
  if (/^\/api\/media\/openclaw\//i.test(hint)) {
    const rest = hint.replace(/^\/api\/media\/openclaw\//i, '').replace(/^\/+/, '');
    const parts = rest.split('/').filter(Boolean);
    if (parts.length < 2 || rest.includes('..')) return null;
    const local = join(getOpenClawMediaDir(...parts.slice(0, -1)), parts[parts.length - 1]);
    return existsSync(local) ? local : null;
  }
  if (existsSync(hint)) return hint;
  return null;
}

function qcManifest(manifest) {
  const issues = [];
  if (!manifest.clips?.length) issues.push('no_clips');
  for (const c of manifest.clips || []) {
    if (!c.media_path) issues.push(`missing_media_scene_${c.scene_index}`);
    else if (c.status !== 'completed') issues.push(`status_${c.status}_scene_${c.scene_index}`);
    if (Number(c.duration_sec) > MAX_SCENE_DURATION_SEC) {
      issues.push(`duration_over_8s_scene_${c.scene_index}`);
    }
    const local = resolveClipLocalPath(c.media_path);
    if (c.media_path && !local) issues.push(`unreadable_path_scene_${c.scene_index}`);
  }
  return {
    ok: issues.length === 0,
    issues,
    scene_count: manifest.clips?.length || 0,
    max_scene_duration_sec: MAX_SCENE_DURATION_SEC,
  };
}

function persistFinalOnStoryboard(owner, storyboardId, { final_video_path, manifest }) {
  const table = findTableByName(owner, 'video_storyboards');
  if (!table?.id) return;
  ensureTableColumns(owner, table.id, [
    'storyboard_id',
    'title',
    'status',
    'duration_sec',
    'plan_json',
    'html_path',
    'pdf_path',
    'image_path',
    'workflow_run_id',
    'rag_document_id',
    'final_video_path',
    'asset_manifest_json',
    'updated',
  ]);
  const listed = listRows(owner, table.id, { limit: 500 });
  const row = (listed?.rows || []).find((r) => String(r.data?.storyboard_id) === String(storyboardId));
  if (!row?.id) return;
  updateRow(owner, table.id, row.id, {
    ...(row.data || {}),
    final_video_path,
    asset_manifest_json: JSON.stringify(manifest),
    status: STORY_STATUS.VIDEO_GENERATED,
    updated: new Date().toISOString(),
  });
}

/**
 * QC + FFmpeg concat of scene clips → final MP4 → status video_generated.
 */
export async function assembleVideoStoryboard(
  ownerUserId,
  { storyboard_id = '', force = false, input = '', text = '', message = '', body = null } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  const sid =
    String(storyboard_id || '').trim() ||
    (() => {
      const blob = [input, text, message, body]
        .map((x) => (typeof x === 'string' ? x : x ? JSON.stringify(x) : ''))
        .join('\n');
      const m = blob.match(/\bsb-[a-f0-9]{6,12}\b/i);
      return m ? m[0] : '';
    })();
  if (!sid) throw Object.assign(new Error('storyboard_id required'), { status: 400 });
  storyboard_id = sid;

  const boardRec = getVideoStoryboardRecord(owner, { storyboard_id });
  if (!boardRec) throw Object.assign(new Error('storyboard not found'), { status: 404 });

  const manifest = buildAssetManifest(owner, storyboard_id);
  const qc = qcManifest(manifest);
  if (!qc.ok && !force) {
    return {
      ok: false,
      code: 'qc_failed',
      storyboard_id,
      title: boardRec.title,
      qc,
      manifest,
      error: `QC failed: ${qc.issues.join(', ')}. Complete S4 clips (each ≤${MAX_SCENE_DURATION_SEC}s) before assembly.`,
    };
  }

  const locals = [];
  for (const c of manifest.clips) {
    const local = resolveClipLocalPath(c.media_path);
    if (!local) {
      if (!force) {
        return {
          ok: false,
          code: 'missing_local_clip',
          storyboard_id,
          scene_index: c.scene_index,
          error: `Cannot resolve local path for scene ${c.scene_index}`,
        };
      }
      continue;
    }
    locals.push({ scene_index: c.scene_index, path: local, duration_sec: c.duration_sec });
  }
  if (!locals.length) {
    throw Object.assign(new Error('No readable scene clips to assemble'), { status: 400 });
  }

  const dir = mkdtempSync(join(tmpdir(), 'aos-assemble-'));
  const listPath = join(dir, 'concat.txt');
  const outPath = join(dir, `final-${storyboard_id}.mp4`);
  try {
    // Normalize each clip to same codec/size then concat (more reliable than raw concat demuxer).
    const normalized = [];
    for (const clip of locals) {
      const norm = join(dir, `n-${clip.scene_index}.mp4`);
      await runFfmpeg([
        '-y',
        '-i',
        clip.path,
        '-t',
        String(Math.min(MAX_SCENE_DURATION_SEC, Number(clip.duration_sec) || MAX_SCENE_DURATION_SEC)),
        '-vf',
        'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        norm,
      ]);
      normalized.push(norm);
    }
    writeFileSync(
      listPath,
      normalized.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8'
    );
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]);
    if (!existsSync(outPath)) throw new Error('ffmpeg produced no final mp4');

    const buf = readFileSync(outPath);
    const media = persistGeneratedOpenClawMedia(
      buf,
      `final-${storyboard_id}.mp4`,
      'generated',
      owner
    );
    const finalPath = media.paste_exactly || media.media_uri || media.relative_url;

    persistFinalOnStoryboard(owner, storyboard_id, {
      final_video_path: finalPath,
      manifest: {
        ...manifest,
        assembled_at: new Date().toISOString(),
        scene_files: locals.map((l) => l.scene_index),
        final_video_path: finalPath,
      },
    });

    updateVideoStoryboardStatus(owner, {
      storyboard_id,
      status: STORY_STATUS.VIDEO_GENERATED,
    });

    try {
      const { indexDocumentForAgent } = await import('./master-data-tools.js');
      await indexDocumentForAgent(owner, {
        content_text: [
          `Video generated`,
          `title: ${boardRec.title}`,
          `storyboard_id: ${storyboard_id}`,
          `status: ${STORY_STATUS.VIDEO_GENERATED}`,
          `final_video_path: ${finalPath}`,
          `scenes: ${locals.map((l) => l.scene_index).join(',')}`,
          `updated: ${new Date().toISOString()}`,
        ].join('\n'),
        filename: `video-final-${storyboard_id}.md`,
        title: `Video final · ${boardRec.title} · ${STORY_STATUS.VIDEO_GENERATED}`,
        mime_type: 'text/markdown',
        tags: ['video_storyboard', STORY_STATUS.VIDEO_GENERATED, storyboard_id],
        agent_id: 'video-assemble',
      });
    } catch (e) {
      console.warn('[video-assemble] RAG index failed', e?.message || e);
    }

    const media_lines = [media.paste_exactly, media.relative_url].filter(Boolean);
    console.info(
      '[video-assemble] ok owner=%s storyboard=%s scenes=%s status=%s',
      owner,
      storyboard_id,
      locals.length,
      STORY_STATUS.VIDEO_GENERATED
    );

    return {
      ok: true,
      storyboard_id,
      title: boardRec.title,
      status: STORY_STATUS.VIDEO_GENERATED,
      qc,
      scenes_assembled: locals.map((l) => l.scene_index),
      final_video_path: finalPath,
      relative_url: media.relative_url || '',
      paste_exactly: media.paste_exactly || finalPath,
      media_lines,
      paste_block: media_lines.join('\n'),
      delivery_hint:
        'Final MP4 stored under Content Explorer. Paste paste_block so chat shows the video. Story status is video_generated.',
      jobs: listVideoJobs(owner, { storyboard_id }).jobs,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

export { qcManifest };
