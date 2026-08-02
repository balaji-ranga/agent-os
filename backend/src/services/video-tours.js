/**
 * CEO Video Tours — playlist + script/VTT/(optional mp4) from knowledgebase/video-tours.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

function assetsDir() {
  const data = process.env.AGENT_OS_DATA_DIR || join(REPO_ROOT, 'data', 'agent-os');
  const preferred = process.env.VIDEO_TOURS_ASSETS_DIR;
  if (preferred && existsSync(preferred)) return preferred;
  return join(data, 'video-tours', 'assets');
}

function resolveVideoPath(stem) {
  const candidates = [
    join(assetsDir(), `${stem}.mp4`),
    join(toursRoot(), 'assets', `${stem}.mp4`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function toursRoot() {
  const env = process.env.VIDEO_TOURS_DIR;
  if (env && existsSync(env)) return env;
  const candidates = [
    join(REPO_ROOT, 'knowledgebase', 'video-tours'),
    join('/opt/agent-os', 'knowledgebase', 'video-tours'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function loadPlaylist() {
  const root = toursRoot();
  const path = join(root, 'playlist.json');
  if (!existsSync(path)) {
    const err = new Error('Video Tours playlist missing');
    err.status = 404;
    throw err;
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function safeStem(stem) {
  const s = String(stem || '').trim();
  if (!/^\d{2}-[a-z0-9-]+$/i.test(s)) {
    const err = new Error('Invalid tour stem');
    err.status = 400;
    throw err;
  }
  return s;
}

function assetPaths(stem) {
  const root = toursRoot();
  return {
    root,
    script: join(root, 'scripts', `${stem}.md`),
    captions: join(root, 'scripts', `${stem}.vtt`),
    video: resolveVideoPath(stem),
  };
}

function extractVoiceScript(md) {
  const text = String(md || '');
  const m = text.match(/## Voice script[^\n]*\n+([\s\S]*?)(?:\n## |\n*$)/i);
  return (m?.[1] || '').trim();
}

function extractShotList(md) {
  const text = String(md || '');
  const m = text.match(/## Shot list[^\n]*\n+([\s\S]*?)(?:\n## |\n*$)/i);
  return (m?.[1] || '').trim();
}

export function listVideoTours() {
  const playlist = loadPlaylist();
  const items = (playlist.items || []).map((item) => {
    const paths = assetPaths(item.stem);
    const has_script = existsSync(paths.script);
    const has_captions = existsSync(paths.captions);
    const has_video = existsSync(paths.video);
    let video_bytes = null;
    if (has_video) {
      try {
        video_bytes = statSync(paths.video).size;
      } catch {
        video_bytes = null;
      }
    }
    return {
      ...item,
      has_script,
      has_captions,
      has_video,
      video_bytes,
      watchable: has_video || has_script || has_captions,
    };
  });
  console.info('[video-tours] list count=%s root=%s', items.length, toursRoot());
  return {
    title: playlist.title || 'CEO Video Tours',
    max_seconds: playlist.max_seconds || 60,
    root: toursRoot(),
    items,
  };
}

export function getVideoTour(stemRaw) {
  const stem = safeStem(stemRaw);
  const playlist = loadPlaylist();
  const meta = (playlist.items || []).find((i) => i.stem === stem);
  if (!meta) {
    const err = new Error('Tour not found');
    err.status = 404;
    throw err;
  }
  const paths = assetPaths(stem);
  let script_md = null;
  let voice_script = null;
  let shot_list = null;
  let captions_vtt = null;
  if (existsSync(paths.script)) {
    script_md = readFileSync(paths.script, 'utf8');
    voice_script = extractVoiceScript(script_md);
    shot_list = extractShotList(script_md);
  }
  if (existsSync(paths.captions)) {
    captions_vtt = readFileSync(paths.captions, 'utf8');
  }
  const has_video = existsSync(paths.video);
  return {
    ...meta,
    has_script: !!script_md,
    has_captions: !!captions_vtt,
    has_video,
    voice_script,
    shot_list,
    captions_vtt,
    script_md,
    video_url: has_video ? `/api/video-tours/${encodeURIComponent(stem)}/video` : null,
    captions_url: captions_vtt ? `/api/video-tours/${encodeURIComponent(stem)}/captions` : null,
  };
}

export function resolveTourFile(stemRaw, kind) {
  const stem = safeStem(stemRaw);
  const paths = assetPaths(stem);
  const map = {
    script: { path: paths.script, type: 'text/markdown; charset=utf-8' },
    captions: { path: paths.captions, type: 'text/vtt; charset=utf-8' },
    video: { path: paths.video, type: 'video/mp4' },
  };
  const entry = map[kind];
  if (!entry) {
    const err = new Error('Unknown asset kind');
    err.status = 400;
    throw err;
  }
  if (!existsSync(entry.path)) {
    const err = new Error('Asset not found');
    err.status = 404;
    throw err;
  }
  return entry;
}

export function listAvailableStems() {
  const root = join(toursRoot(), 'scripts');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}