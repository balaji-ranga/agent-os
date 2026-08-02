/**
 * Export CEO Video Tours as navigational walkthrough mp4s.
 * Piper TTS + multi-slide FloLah UI mockups with pointer callouts.
 *
 *   node scripts/export-video-tours.js
 *   FORCE=1 node scripts/export-video-tours.js
 *   node scripts/export-video-tours.js --only=01-vision-architecture
 */
import { spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statSync,
  mkdtempSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { slidesForStem } from './video-tours-storyboards.js';
import { renderSlideSvg } from './video-tours-render-slides.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const TOURS_ROOT = process.env.VIDEO_TOURS_DIR || join(REPO_ROOT, 'knowledgebase', 'video-tours');
const DATA_DIR = process.env.AGENT_OS_DATA_DIR || join(REPO_ROOT, 'data', 'agent-os');
const OUT_DIR = join(DATA_DIR, 'video-tours', 'assets');
const MIRROR_DIR = join(TOURS_ROOT, 'assets');
const SLIDES_DIR = join(DATA_DIR, 'video-tours', 'slides');
const TTS_URL = (process.env.SPEECH_TTS_URL || 'http://piper:5500').replace(/\/$/, '');
const FORCE = process.env.FORCE === '1' || process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const MAX_SEC = 60;

function log(...args) {
  console.info('[export-video-tours]', ...args);
}

function extractVoiceScript(md) {
  const text = String(md || '');
  const m = text.match(/## Voice script[^\n]*\n+([\s\S]*?)(?:\n## |\n*$)/i);
  return (m?.[1] || '').trim();
}

function loadPlaylist() {
  return JSON.parse(readFileSync(join(TOURS_ROOT, 'playlist.json'), 'utf8'));
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

async function synthesizeWav(text, outPath) {
  const payload = { text: String(text || '').trim().slice(0, 2500), length_scale: 1.0 };
  const res = await fetch(`${TTS_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function probeDurationSec(wavPath) {
  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawn(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', wavPath],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      );
      let stdout = '';
      child.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(stdout.trim()) : reject(new Error('ffprobe'))));
    });
    const n = Number(out);
    return Number.isFinite(n) ? n : 40;
  } catch {
    return 40;
  }
}

async function ensureRsvg() {
  try {
    await run('rsvg-convert', ['--version']);
    return true;
  } catch {
    log('installing librsvg2-bin…');
    await run('bash', ['-lc', 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq librsvg2-bin >/tmp/rsvg-install.log 2>&1']);
    await run('rsvg-convert', ['--version']);
    return true;
  }
}

async function svgToPng(svgPath, pngPath) {
  await run('rsvg-convert', ['-w', '1280', '-h', '720', svgPath, '-o', pngPath]);
}

async function renderSlideshow(pngPaths, durations, wavPath, outPath) {
  // Build concat demuxer file with per-image duration, then mux audio.
  const listPath = join(dirname(outPath), 'slides.txt');
  const lines = [];
  for (let i = 0; i < pngPaths.length; i += 1) {
    const p = pngPaths[i].replace(/'/g, "'\\''");
    lines.push(`file '${p}'`);
    lines.push(`duration ${durations[i].toFixed(3)}`);
  }
  // concat demuxer needs last file repeated without duration
  const last = pngPaths[pngPaths.length - 1].replace(/'/g, "'\\''");
  lines.push(`file '${last}'`);
  writeFileSync(listPath, lines.join('\n'), 'utf8');

  const silentArgs = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-i',
    wavPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '30',
    '-preset',
    'veryfast',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outPath,
  ];
  await run('ffmpeg', silentArgs);
}

async function exportOne(item) {
  const stem = item.stem;
  const outPrimary = join(OUT_DIR, `${stem}.mp4`);
  const outMirror = join(MIRROR_DIR, `${stem}.mp4`);
  if (!FORCE && existsSync(outPrimary) && statSync(outPrimary).size > 80_000) {
    log('skip existing', stem);
    return { stem, skipped: true, path: outPrimary };
  }

  const mdPath = join(TOURS_ROOT, 'scripts', `${stem}.md`);
  const voice = extractVoiceScript(readFileSync(mdPath, 'utf8'));
  if (!voice) throw new Error(`empty voice script for ${stem}`);

  const slides = slidesForStem(stem);
  const work = mkdtempSync(join(tmpdir(), 'vt-'));
  const wavPath = join(work, `${stem}.wav`);
  const tmpMp4 = join(work, `${stem}.mp4`);
  const slideRoot = join(SLIDES_DIR, stem);
  mkdirSync(slideRoot, { recursive: true });

  try {
    log('tts', stem, 'chars=', voice.length, 'slides=', slides.length);
    await synthesizeWav(voice, wavPath);
    const durationSec = Math.min(MAX_SEC, await probeDurationSec(wavPath));
    const per = durationSec / slides.length;
    const durations = slides.map(() => per);

    const pngPaths = [];
    for (let i = 0; i < slides.length; i += 1) {
      const svg = renderSlideSvg(slides[i], { title: item.title, number: item.number });
      const svgPath = join(work, `slide-${i}.svg`);
      const pngPath = join(slideRoot, `${String(i + 1).padStart(2, '0')}.png`);
      writeFileSync(svgPath, svg, 'utf8');
      await svgToPng(svgPath, pngPath);
      // also keep a copy in work for concat absolute paths
      const workPng = join(work, `slide-${i}.png`);
      copyFileSync(pngPath, workPng);
      pngPaths.push(workPng);
    }

    log('render', stem, 'dur=', durationSec.toFixed(1), 'perSlide=', per.toFixed(2));
    await renderSlideshow(pngPaths, durations, wavPath, tmpMp4);

    mkdirSync(OUT_DIR, { recursive: true });
    copyFileSync(tmpMp4, outPrimary);
    try {
      mkdirSync(MIRROR_DIR, { recursive: true });
      copyFileSync(tmpMp4, outMirror);
    } catch (e) {
      log('mirror warn', e.message);
    }
    const size = statSync(outPrimary).size;
    log('done', stem, 'bytes=', size);
    return { stem, skipped: false, path: outPrimary, bytes: size, slides: slides.length };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await ensureRsvg();
  const playlist = loadPlaylist();
  let items = playlist.items || [];
  if (ONLY) items = items.filter((i) => i.stem === ONLY || i.stem.startsWith(ONLY));
  log('start', { count: items.length, out: OUT_DIR, force: FORCE });

  try {
    const h = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(5000) });
    log('piper health', h.status);
  } catch (e) {
    log('piper health warn', e.message);
  }

  const results = [];
  for (const item of items) {
    try {
      results.push(await exportOne(item));
    } catch (e) {
      console.error('[export-video-tours] FAILED', item.stem, e.message || e);
      results.push({ stem: item.stem, error: e.message || String(e) });
    }
  }
  const failed = results.filter((r) => r.error);
  log('summary', { ok: results.length - failed.length, failed: failed.length });
  if (failed.length) {
    console.error(JSON.stringify(failed, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  }
}

main().catch((e) => {
  console.error('[export-video-tours] fatal', e);
  process.exit(1);
});