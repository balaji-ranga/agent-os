/**
 * S4 video clip jobs: per-scene generation (≤8s) via flow_browser | replicate_api.
 * Persists paths in Master Data video_jobs; never base64 in workflow payloads.
 */
import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { getVideoConfig } from '../config/tools.js';
import { persistGeneratedOpenClawMedia } from './media-url.js';
import { resolveInboundRelativePath } from './inbound-attachments.js';
import { isBrowserWorkerOnline } from './browser-worker-dispatch.js';
import { startBrowserTask, getBrowserTask } from './browser-tasks.js';
import { getDb } from '../db/schema.js';
import {
  STORY_STATUS,
  getVideoStoryboardRecord,
  updateVideoStoryboardStatus,
} from './video-storyboard-export.js';
import {
  findTableByName,
  insertRow,
  updateRow,
  listRows,
  ensureTableColumns,
} from './master-data.js';
import { seedVideoContentKnowledgeTables } from './video-content-knowledge.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';

/** Google Flow / Veo clip budget — each scene is generated separately. */
export const MAX_SCENE_DURATION_SEC = 8;
export const VIDEO_PROVIDERS = Object.freeze({
  FLOW_BROWSER: 'flow_browser',
  REPLICATE_API: 'replicate_api',
});

const JOB_COLS = [
  'job_id',
  'storyboard_id',
  'scene_index',
  'status',
  'provider',
  'prompt',
  'duration_sec',
  'media_path',
  'browse_task_id',
  'replicate_prediction_id',
  'error',
  'updated',
];

const FLOW_START_URL = process.env.VIDEO_FLOW_START_URL || 'https://labs.google/fx/tools/flow';

function ensureJobTable(ownerUserId) {
  seedVideoContentKnowledgeTables(ownerUserId);
  const table = findTableByName(ownerUserId, 'video_jobs');
  if (!table?.id) throw Object.assign(new Error('video_jobs table missing'), { status: 500 });
  ensureTableColumns(ownerUserId, table.id, JOB_COLS);
  return findTableByName(ownerUserId, 'video_jobs');
}

function ffmpegBin() {
  return String(process.env.FFMPEG_PATH || 'ffmpeg').trim() || 'ffmpeg';
}

function runFfmpeg(args, timeoutMs = 120000) {
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
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function capDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return MAX_SCENE_DURATION_SEC;
  return Math.min(MAX_SCENE_DURATION_SEC, Math.max(1, Math.round(n)));
}

function coerceStoryboardId(payload = {}) {
  if (payload.storyboard_id) return String(payload.storyboard_id).trim();
  const blob = [payload.input, payload.text, payload.message, payload.body]
    .map((x) => (typeof x === 'string' ? x : x ? JSON.stringify(x) : ''))
    .join('\n');
  const m = blob.match(/\bsb-[a-f0-9]{6,12}\b/i);
  if (m) return m[0];
  try {
    const j = JSON.parse(blob);
    if (j?.storyboard_id) return String(j.storyboard_id).trim();
  } catch (_) {}
  return '';
}

function normalizeProvider(raw) {
  const p = String(raw || '')
    .trim()
    .toLowerCase();
  if (p === 'flow' || p === 'google_flow' || p === 'flow_browser' || p === 'flavour1' || p === 'flavor1') {
    return VIDEO_PROVIDERS.FLOW_BROWSER;
  }
  if (p === 'replicate' || p === 'replicate_api' || p === 'veo' || p === 'flavour2' || p === 'flavor2') {
    return VIDEO_PROVIDERS.REPLICATE_API;
  }
  return VIDEO_PROVIDERS.REPLICATE_API;
}

function coerceProvider(payload = {}) {
  if (payload.provider) return normalizeProvider(payload.provider);
  const blob = String(payload.input || payload.text || '').toLowerCase();
  if (/flow_browser|flavour\s*1|flavor\s*1|google\s*flow/.test(blob)) return VIDEO_PROVIDERS.FLOW_BROWSER;
  if (/replicate|flavour\s*2|flavor\s*2/.test(blob)) return VIDEO_PROVIDERS.REPLICATE_API;
  return VIDEO_PROVIDERS.FLOW_BROWSER;
}

function parsePlan(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function scenePrompt(scene, board, index) {
  const prompt =
    String(scene.veo_prompt || scene.prompt || scene.description || '').trim() ||
    `Cinematic scene ${index} for ${board.title || 'story'}: ${scene.description || 'action'}`;
  const chars = Array.isArray(scene.characters) ? scene.characters.join(', ') : '';
  const neg = scene.negative_prompt ? ` Negative: ${scene.negative_prompt}` : '';
  const cont = scene.continuity_notes ? ` Continuity: ${scene.continuity_notes}` : '';
  return `${prompt}${chars ? ` Cast character_ids: ${chars}.` : ''}${cont}${neg}`.slice(0, 1800);
}

export function listVideoJobs(ownerUserId, { storyboard_id = '', scene_index = null } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  const table = ensureJobTable(owner);
  const listed = listRows(owner, table.id, { limit: 500 });
  let rows = (listed?.rows || []).map((r) => ({ row_id: r.id, ...(r.data || {}) }));
  if (storyboard_id) {
    rows = rows.filter((r) => String(r.storyboard_id) === String(storyboard_id));
  }
  if (scene_index != null && scene_index !== '') {
    rows = rows.filter((r) => Number(r.scene_index) === Number(scene_index));
  }
  rows.sort((a, b) => Number(a.scene_index) - Number(b.scene_index));
  return { ok: true, jobs: rows };
}

function upsertJob(owner, data) {
  const table = ensureJobTable(owner);
  const listed = listRows(owner, table.id, { limit: 500 });
  const existing = (listed?.rows || []).find(
    (r) =>
      String(r.data?.storyboard_id) === String(data.storyboard_id) &&
      Number(r.data?.scene_index) === Number(data.scene_index)
  );
  const row = {
    job_id: data.job_id || existing?.data?.job_id || `vj-${randomUUID().slice(0, 10)}`,
    storyboard_id: String(data.storyboard_id),
    scene_index: Number(data.scene_index),
    status: data.status || 'pending',
    provider: data.provider || '',
    prompt: data.prompt || '',
    duration_sec: String(data.duration_sec ?? ''),
    media_path: data.media_path || '',
    browse_task_id: data.browse_task_id || '',
    replicate_prediction_id: data.replicate_prediction_id || '',
    error: data.error || '',
    updated: new Date().toISOString(),
  };
  if (existing?.id) {
    updateRow(owner, table.id, existing.id, { ...(existing.data || {}), ...row });
    return { ...row, row_id: existing.id, action: 'updated' };
  }
  const inserted = insertRow(owner, table.id, row);
  return { ...row, row_id: inserted?.id || inserted, action: 'created' };
}

function resolveMediaLocalPath(pathHint) {
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

async function pollReplicatePrediction(ownerUserId, jobId, { maxAttempts = 60, delayMs = 5000 } = {}) {
  const { primary } = getVideoConfig(ownerUserId);
  if (!primary?.apiToken || !jobId) return null;
  const base = String(primary.apiUrl || '').replace(/\/$/, '');
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await fetch(`${base}/predictions/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${primary.apiToken}` },
      signal: AbortSignal.timeout(20000),
    });
    const pred = await res.json().catch(() => ({}));
    const status = String(pred.status || '');
    const outVal = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    const url = typeof outVal === 'string' ? outVal : outVal?.url || null;
    if (url) return { url, status, pred };
    if (status === 'failed' || status === 'canceled') {
      return { url: null, status, error: pred.error || status, pred };
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { url: null, status: 'timeout', error: 'Replicate prediction timed out' };
}

async function downloadAndPersistVideo(owner, remoteUrl, filenameHint) {
  const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(180000) });
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  const ext = ct.includes('webm') ? '.webm' : '.mp4';
  return persistGeneratedOpenClawMedia(buf, `${filenameHint}${ext}`, 'generated', owner);
}

/**
 * Create a short silent color MP4 for e2e / Flow-download stand-in (not a Veo call).
 */
export async function createFixtureSceneClip(ownerUserId, { storyboard_id, scene_index, duration_sec = 8, label = '' } = {}) {
  const owner = String(ownerUserId || '').trim();
  const dur = capDuration(duration_sec);
  const dir = mkdtempSync(join(tmpdir(), 'aos-vclip-'));
  const outPath = join(dir, `scene-${scene_index}.mp4`);
  try {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x1a2332:s=1280x720:d=${dur}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-t',
      String(dur),
      outPath,
    ]);
    const buf = readFileSync(outPath);
    return persistGeneratedOpenClawMedia(
      buf,
      `flow-scene-${storyboard_id}-${scene_index}.mp4`,
      'generated',
      owner
    );
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
}

export function buildAssetManifest(ownerUserId, storyboard_id) {
  const boardRec = getVideoStoryboardRecord(ownerUserId, { storyboard_id });
  if (!boardRec) throw Object.assign(new Error('storyboard not found'), { status: 404 });
  const plan = parsePlan(boardRec.plan_json);
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const { jobs } = listVideoJobs(ownerUserId, { storyboard_id });
  const byScene = new Map(jobs.map((j) => [Number(j.scene_index), j]));
  const clips = scenes.map((sc, i) => {
    const idx = Number(sc.index ?? i + 1);
    const job = byScene.get(idx);
    return {
      scene_index: idx,
      duration_sec: capDuration(sc.duration_sec || job?.duration_sec || MAX_SCENE_DURATION_SEC),
      media_path: job?.media_path || '',
      status: job?.status || 'missing',
      provider: job?.provider || '',
      job_id: job?.job_id || '',
      prompt: job?.prompt || scenePrompt(sc, plan, idx),
    };
  });
  const missing = clips.filter((c) => !c.media_path || c.status !== 'completed');
  return {
    ok: true,
    storyboard_id,
    title: boardRec.title,
    status: boardRec.status,
    clips,
    complete: missing.length === 0 && clips.length > 0,
    missing_scenes: missing.map((m) => m.scene_index),
  };
}

/**
 * Bind a CEO-downloaded / worker clip into video_jobs for a scene (Flavour 1 ingest).
 */
export async function ingestVideoSceneClip(
  ownerUserId,
  {
    storyboard_id,
    scene_index,
    relative_path = '',
    inbound_path = '',
    media = '',
    media_uri = '',
    media_path = '',
    provider = VIDEO_PROVIDERS.FLOW_BROWSER,
    duration_sec = '',
    prompt = '',
  } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  if (!storyboard_id) throw Object.assign(new Error('storyboard_id required'), { status: 400 });
  if (scene_index == null || scene_index === '') {
    throw Object.assign(new Error('scene_index required'), { status: 400 });
  }
  const boardRec = getVideoStoryboardRecord(owner, { storyboard_id });
  if (!boardRec) throw Object.assign(new Error('storyboard not found'), { status: 404 });

  const pathHint = String(relative_path || inbound_path || media || media_uri || media_path || '').trim();
  if (!pathHint) {
    throw Object.assign(
      new Error('Provide relative_path (inbound/…) or MEDIA:/… or /api/media/… for the scene clip'),
      { status: 400 }
    );
  }

  let buffer = null;
  let filenameHint = `scene-${storyboard_id}-${scene_index}.mp4`;
  let existingRef = '';

  if (/^inbound\//i.test(pathHint) || pathHint.includes('inbound/attachments')) {
    const rel = pathHint.replace(/^\/+/, '');
    const abs =
      resolveInboundRelativePath(owner, rel.startsWith('inbound/') ? rel : `inbound/attachments/${basename(rel)}`) ||
      resolveInboundRelativePath(owner, rel);
    if (!abs || !existsSync(abs)) {
      throw Object.assign(new Error(`Inbound file not found: ${pathHint}`), { status: 404 });
    }
    buffer = readFileSync(abs);
    filenameHint = `scene-${storyboard_id}-${scene_index}-${basename(abs)}`;
  } else {
    const local = resolveMediaLocalPath(pathHint);
    if (local) {
      buffer = readFileSync(local);
      filenameHint = `scene-${storyboard_id}-${scene_index}-${basename(local)}`;
    } else if (/^\/api\/media\/openclaw\//i.test(pathHint)) {
      existingRef = pathHint;
    } else if (/^https?:\/\//i.test(pathHint)) {
      const mediaOut = await downloadAndPersistVideo(owner, pathHint, `scene-${storyboard_id}-${scene_index}`);
      existingRef = mediaOut.paste_exactly || mediaOut.media_uri || mediaOut.relative_url;
    } else {
      throw Object.assign(new Error('Unsupported media path for clip ingest'), { status: 400 });
    }
  }

  let mediaOut;
  if (buffer) {
    mediaOut = persistGeneratedOpenClawMedia(buffer, filenameHint, 'generated', owner);
  } else {
    mediaOut = {
      paste_exactly: existingRef,
      media_uri: existingRef,
      relative_url: existingRef.startsWith('/api/') ? existingRef : '',
      local_path: '',
    };
  }

  const ref = mediaOut.paste_exactly || mediaOut.media_uri || mediaOut.relative_url;
  const plan = parsePlan(boardRec.plan_json);
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  const scene = scenes.find((s, i) => Number(s.index ?? i + 1) === Number(scene_index)) || {};
  const job = upsertJob(owner, {
    storyboard_id,
    scene_index: Number(scene_index),
    status: 'completed',
    provider: normalizeProvider(provider),
    prompt: prompt || scenePrompt(scene, plan, scene_index),
    duration_sec: capDuration(duration_sec || scene.duration_sec || MAX_SCENE_DURATION_SEC),
    media_path: ref,
    error: '',
  });

  console.info(
    '[video-media] ingest owner=%s storyboard=%s scene=%s provider=%s',
    owner,
    storyboard_id,
    scene_index,
    job.provider
  );

  return {
    ok: true,
    job,
    media_lines: [mediaOut.paste_exactly, mediaOut.relative_url].filter(Boolean),
    paste_block: [mediaOut.paste_exactly, mediaOut.relative_url].filter(Boolean).join('\n'),
    delivery_hint: 'Scene clip stored. When all scenes are complete, call video_assemble.',
  };
}

async function generateOneReplicateScene(owner, boardRec, scene, index, force) {
  const { jobs } = listVideoJobs(owner, { storyboard_id: boardRec.storyboard_id, scene_index: index });
  const existing = jobs[0];
  if (existing?.media_path && existing.status === 'completed' && !force) {
    return { ...existing, action: 'reused' };
  }

  const duration_sec = capDuration(scene.duration_sec);
  const prompt = scenePrompt(scene, parsePlan(boardRec.plan_json), index);
  const videoCfg = getVideoConfig(owner);
  if (videoCfg.error) {
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'failed',
      provider: VIDEO_PROVIDERS.REPLICATE_API,
      prompt,
      duration_sec,
      error: videoCfg.error,
    });
    return { ...job, action: 'error', error: videoCfg.error };
  }
  const { primary, secondary } = videoCfg;
  const endpoints = [primary, secondary].filter((ep) => ep && ep.apiToken && ep.modelVersion);
  if (!endpoints.length) {
    const err = 'Video generation not configured (REPLICATE_API_TOKEN or Replicate_BYOK)';
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'failed',
      provider: VIDEO_PROVIDERS.REPLICATE_API,
      prompt,
      duration_sec,
      error: err,
    });
    return { ...job, action: 'error', error: err };
  }

  let lastErr = '';
  for (const vid of endpoints) {
    try {
      const createRes = await fetch(`${vid.apiUrl.replace(/\/$/, '')}/predictions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${vid.apiToken}`,
        },
        body: JSON.stringify({
          version: vid.modelVersion,
          input: { prompt: prompt.slice(0, vid.maxPromptChars || 2000) },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const pred = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        lastErr = pred?.detail || pred?.error || createRes.statusText || 'Replicate error';
        continue;
      }
      const predictionId = pred.id;
      upsertJob(owner, {
        storyboard_id: boardRec.storyboard_id,
        scene_index: index,
        status: 'running',
        provider: VIDEO_PROVIDERS.REPLICATE_API,
        prompt,
        duration_sec,
        replicate_prediction_id: predictionId,
        error: '',
      });
      let url =
        (Array.isArray(pred.output) ? pred.output[0] : pred.output) ||
        null;
      url = typeof url === 'string' ? url : url?.url || null;
      if (!url) {
        const polled = await pollReplicatePrediction(owner, predictionId);
        url = polled?.url || null;
        if (!url) {
          lastErr = polled?.error || 'no output url';
          continue;
        }
      }
      const media = await downloadAndPersistVideo(
        owner,
        url,
        `veo-scene-${boardRec.storyboard_id}-${index}`
      );
      const ref = media.paste_exactly || media.media_uri || media.relative_url;
      const job = upsertJob(owner, {
        storyboard_id: boardRec.storyboard_id,
        scene_index: index,
        status: 'completed',
        provider: VIDEO_PROVIDERS.REPLICATE_API,
        prompt,
        duration_sec,
        media_path: ref,
        replicate_prediction_id: predictionId,
        error: '',
      });
      return { ...job, action: 'generated', relative_url: media.relative_url, paste_exactly: media.paste_exactly };
    } catch (e) {
      lastErr = e.message || String(e);
    }
  }
  const job = upsertJob(owner, {
    storyboard_id: boardRec.storyboard_id,
    scene_index: index,
    status: 'failed',
    provider: VIDEO_PROVIDERS.REPLICATE_API,
    prompt,
    duration_sec,
    error: lastErr || 'Replicate failed',
  });
  return { ...job, action: 'error', error: lastErr };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Desktop Local has one Chrome — never run multiple Flow browse tasks at once. */
async function waitForIdleFlowBrowse(owner, { timeoutMs = 180000 } = {}) {
  const db = getDb();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const running = db
      .prepare(
        `SELECT id FROM browser_tasks
         WHERE ceo_user_id = ?
           AND status IN ('running', 'queued', 'pending')
           AND goal_text LIKE '%Google Flow%'
         LIMIT 8`
      )
      .all(owner);
    if (!running.length) return { ok: true, waited_ms: Date.now() - t0 };
    await sleep(2500);
  }
  return { ok: false, error: 'Timed out waiting for prior Google Flow browse task to finish' };
}

async function generateOneFlowScene(owner, boardRec, scene, index, force, { use_test_clips = false } = {}) {
  const { jobs } = listVideoJobs(owner, { storyboard_id: boardRec.storyboard_id, scene_index: index });
  const existing = jobs[0];
  if (existing?.media_path && existing.status === 'completed' && !force) {
    return { ...existing, action: 'reused' };
  }

  const duration_sec = capDuration(scene.duration_sec);
  const prompt = scenePrompt(scene, parsePlan(boardRec.plan_json), index);

  // E2E / CEO-assisted stand-in: fixture clips act as “downloaded from Flow”.
  if (use_test_clips || process.env.VIDEO_FLOW_TEST_FIXTURES === '1') {
    const media = await createFixtureSceneClip(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      duration_sec,
      label: `Flow S${index}`,
    });
    const ref = media.paste_exactly || media.media_uri || media.relative_url;
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'completed',
      provider: VIDEO_PROVIDERS.FLOW_BROWSER,
      prompt,
      duration_sec,
      media_path: ref,
      error: '',
    });
    return {
      ...job,
      action: 'fixture_clip',
      relative_url: media.relative_url,
      paste_exactly: media.paste_exactly,
      note: 'Test/fixture clip standing in for a Google Flow download (≤8s). Use video_media_ingest_clip for real Flow files.',
    };
  }

  if (!isBrowserWorkerOnline(owner)) {
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'needs_worker',
      provider: VIDEO_PROVIDERS.FLOW_BROWSER,
      prompt,
      duration_sec,
      error: 'Desktop Local browser worker offline — start worker, login to Google Flow, then retry or ingest clip',
    });
    return {
      ...job,
      action: 'needs_worker',
      ask_ceo:
        'Desktop Local browser worker is offline. Start the Connectors Desktop Local worker, sign into Google Flow in that Chrome profile, then retry — or download each ≤8s scene clip and I will map it with video_media_ingest_clip.',
    };
  }

  const idle = await waitForIdleFlowBrowse(owner);
  if (!idle.ok) {
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'awaiting_flow',
      provider: VIDEO_PROVIDERS.FLOW_BROWSER,
      prompt,
      duration_sec,
      error: idle.error,
    });
    return { ...job, action: 'busy', error: idle.error, ask_ceo: idle.error };
  }

  const goal = [
    `Open Google Flow (${FLOW_START_URL}) in the existing logged-in Desktop Local session (already signed in).`,
    `Work on SCENE ${index} only (max ${duration_sec}s — Flow/Veo clips are ≤8s; do not combine scenes).`,
    `If you are already inside a Flow project editor (prompt textbox / Add Media / Scenes visible), stay there — do NOT hunt for a "New project" button.`,
    `If on the Flow home/projects list, click an existing project or create one, then use the project editor prompt box.`,
    `Clear any prior prompt text, then paste/type this prompt exactly into the prompt / editable text box:`,
    `<<<FLOW_PROMPT_START>>>`,
    prompt,
    `<<<FLOW_PROMPT_END>>>`,
    `Click to start generation for this one scene and wait until the clip is ready.`,
    `Download the resulting video file to the default Downloads folder.`,
    `When done, summarize the download filename and full path. Do not claim success without a downloaded file.`,
  ].join('\n');

  let task;
  try {
    task = await startBrowserTask(owner, {
      goal_text: goal,
      start_url: FLOW_START_URL,
      mode: 'autonomous',
      max_steps: 48,
      agent_id: 'video-orch-ceobala',
    });
  } catch (e) {
    const job = upsertJob(owner, {
      storyboard_id: boardRec.storyboard_id,
      scene_index: index,
      status: 'failed',
      provider: VIDEO_PROVIDERS.FLOW_BROWSER,
      prompt,
      duration_sec,
      error: e.message || String(e),
    });
    return { ...job, action: 'error', error: e.message || String(e) };
  }

  const job = upsertJob(owner, {
    storyboard_id: boardRec.storyboard_id,
    scene_index: index,
    status: 'awaiting_flow',
    provider: VIDEO_PROVIDERS.FLOW_BROWSER,
    prompt,
    duration_sec,
    browse_task_id: task?.id || task?.task_id || '',
    error: '',
  });

  return {
    ...job,
    action: 'browse_started',
    browse_task_id: job.browse_task_id,
    ask_ceo:
      'Flow generation started in Desktop Local browser for this scene (≤8s). When the clip downloads, call video_media_ingest_clip with storyboard_id, scene_index, and the MEDIA/inbound path — or wait and poll video_media_jobs.',
  };
}

/**
 * S4 entry: generate (or kick off) per-scene clips for an approved storyboard.
 */
export async function generateVideoMedia(
  ownerUserId,
  {
    storyboard_id = '',
    provider = VIDEO_PROVIDERS.FLOW_BROWSER,
    scene_index = null,
    force = false,
    use_test_clips = false,
    input = '',
    text = '',
    message = '',
    body = null,
  } = {}
) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 403 });
  const sid =
    String(storyboard_id || '').trim() ||
    coerceStoryboardId({ storyboard_id, input, text, message, body });
  if (!sid) throw Object.assign(new Error('storyboard_id required'), { status: 400 });

  const boardRec = getVideoStoryboardRecord(owner, { storyboard_id: sid });
  if (!boardRec) throw Object.assign(new Error('storyboard not found'), { status: 404 });

  const status = String(boardRec.status || '');
  const allowed = new Set([STORY_STATUS.CEO_APPROVED, STORY_STATUS.VIDEO_GENERATED]);
  if (status === STORY_STATUS.PENDING_CEO) {
    throw Object.assign(
      new Error('Storyboard still pending_ceo_approval — approve the Kanban card before S4 media'),
      { status: 409, code: 'pending_ceo_approval' }
    );
  }
  if (!allowed.has(status) && !force) {
    throw Object.assign(
      new Error(`Storyboard status must be ceo_approved (got ${status || 'empty'}) before S4`),
      { status: 409, code: 'not_ceo_approved' }
    );
  }

  const plan = parsePlan(boardRec.plan_json);
  const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
  if (!scenes.length) {
    throw Object.assign(new Error('storyboard has no scenes in plan_json'), { status: 400 });
  }

  const prov = normalizeProvider(
    provider || coerceProvider({ provider, input, text })
  );
  let targets = scenes
    .map((sc, i) => ({ scene: sc, index: Number(sc.index ?? i + 1) }))
    .filter((t) => scene_index == null || scene_index === '' || Number(t.index) === Number(scene_index));

  // Flow uses one shared Desktop Local Chrome — never fan out all scenes in one call.
  // Kick the first incomplete scene; Orchestrator continues with scene_index=N+1.
  let flowContinueHint = null;
  if (prov === VIDEO_PROVIDERS.FLOW_BROWSER && (scene_index == null || scene_index === '')) {
    const incomplete = [];
    for (const t of targets) {
      const { jobs: existingJobs } = listVideoJobs(owner, {
        storyboard_id: sid,
        scene_index: t.index,
      });
      const hit = existingJobs[0];
      if (!(hit?.media_path && hit.status === 'completed') || force) incomplete.push(t);
    }
    if (!incomplete.length) {
      targets = [];
    } else {
      const next = incomplete[0];
      targets = [next];
      if (incomplete.length > 1) {
        flowContinueHint = {
          next_scene_index: incomplete[1].index,
          remaining_scenes: incomplete.slice(1).map((x) => x.index),
          instruction:
            'Flow browser is serial. After this scene clip is ingested/completed, call video_media_generate again with the same storyboard_id, provider=flow_browser, and scene_index=next_scene_index.',
        };
      }
    }
  }

  const results = [];
  for (const t of targets) {
    t.scene = { ...t.scene, duration_sec: capDuration(t.scene.duration_sec) };
    if (prov === VIDEO_PROVIDERS.FLOW_BROWSER) {
      results.push(await generateOneFlowScene(owner, boardRec, t.scene, t.index, force, { use_test_clips }));
    } else {
      results.push(await generateOneReplicateScene(owner, boardRec, t.scene, t.index, force));
    }
  }

  const manifest = buildAssetManifest(owner, sid);
  const media_lines = results.flatMap((r) => [r.paste_exactly, r.relative_url, r.media_path].filter(Boolean));
  const uniqueLines = [...new Set(media_lines)];

  console.info(
    '[video-media] generate owner=%s storyboard=%s provider=%s scenes=%s complete=%s',
    owner,
    sid,
    prov,
    results.length,
    manifest.complete
  );

  return {
    ok: true,
    provider: prov,
    storyboard_id: sid,
    title: boardRec.title,
    results,
    manifest,
    media_lines: uniqueLines,
    paste_block: uniqueLines.join('\n'),
    flow_serial: prov === VIDEO_PROVIDERS.FLOW_BROWSER,
    flow_continue: flowContinueHint,
    delivery_hint: flowContinueHint
      ? flowContinueHint.instruction
      : manifest.complete
        ? 'All scene clips ready — run video assembly when CEO asks.'
        : prov === VIDEO_PROVIDERS.FLOW_BROWSER
          ? 'Flow generation started for one scene. Poll browse task / video_media_jobs; ingest download with video_media_ingest_clip; then continue next scene_index.'
          : 'Check video_media_jobs for per-scene status.',
  };
}

export async function refreshFlowBrowseJobs(ownerUserId, { storyboard_id } = {}) {
  const owner = String(ownerUserId || '').trim();
  const { jobs } = listVideoJobs(owner, { storyboard_id });
  const out = [];
  for (const job of jobs) {
    if (job.provider !== VIDEO_PROVIDERS.FLOW_BROWSER || !job.browse_task_id) continue;
    if (job.status === 'completed' && job.media_path) {
      out.push({ job_id: job.job_id, status: job.status, action: 'unchanged' });
      continue;
    }
    try {
      const st = getBrowserTask(owner, job.browse_task_id);
      out.push({
        job_id: job.job_id,
        scene_index: job.scene_index,
        browse_task_id: job.browse_task_id,
        browse_status: st?.status,
        browse_summary: st?.result?.summary || null,
      });
    } catch (e) {
      out.push({ job_id: job.job_id, error: e.message || String(e) });
    }
  }
  return { ok: true, storyboard_id, browse: out, manifest: buildAssetManifest(owner, storyboard_id) };
}

// re-export for assemble
export { updateVideoStoryboardStatus, STORY_STATUS, capDuration, normalizeProvider };
