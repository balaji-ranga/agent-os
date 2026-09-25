/**
 * Northstar featured demo: temporary CEO session, live UI capture, narration and final MP4.
 *
 * Run in the backend container:
 *   node scripts/northstar-demo-video.mjs issue-session
 *   node scripts/northstar-demo-video.mjs render
 *   node scripts/northstar-demo-video.mjs revoke-session
 *
 * Run capture in the openclaw container (Playwright Core + Chromium are already present):
 *   node /tmp/northstar-demo-video.mjs capture
 *
 * No token is printed. The temporary token file is mode 0600 and revoke-session removes it.
 */
import { spawn } from 'child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DATA_ROOT = process.env.AGENT_OS_DATA_DIR || join(REPO_ROOT, 'data', 'agent-os');
const WORK_ROOT = join(DATA_ROOT, 'video-tours', 'northstar-featured');
const TOKEN_FILE = process.env.NORTHSTAR_CAPTURE_TOKEN_FILE || join(WORK_ROOT, '.capture-session');
const CAPTURE_FILE = join(WORK_ROOT, 'northstar-live-ui.webm');
const FINAL_FILE = join(WORK_ROOT, '13-northstar-ai-native-company.mp4');
const QA_FILE = join(WORK_ROOT, '13-northstar-ai-native-company-final-frame.png');
const PERSISTENT_ASSET_DIR = join(DATA_ROOT, 'video-tours', 'assets');
const PERSISTENT_FILE = join(PERSISTENT_ASSET_DIR, '13-northstar-ai-native-company.mp4');
const OWNER_ID = process.env.NORTHSTAR_DEMO_OWNER_ID || 'ceo-maya-tan-6a2232';
const BASE_URL = (process.env.NORTHSTAR_DEMO_BASE_URL || 'https://login.flolah.cloud').replace(/\/$/, '');
const TTS_URL = (process.env.SPEECH_TTS_URL || 'http://piper:5500').replace(/\/$/, '');
const SCRIPT_FILE = join(REPO_ROOT, 'knowledgebase', 'video-tours', 'scripts', '13-northstar-ai-native-company.md');
const MIRROR_DIR = join(REPO_ROOT, 'knowledgebase', 'video-tours', 'assets');
const MIRROR_FILE = join(MIRROR_DIR, '13-northstar-ai-native-company.mp4');
const MIRROR_VTT = join(MIRROR_DIR, '13-northstar-ai-native-company.vtt');
const CAPTION_SOURCE = join(REPO_ROOT, 'knowledgebase', 'video-tours', 'scripts', '13-northstar-ai-native-company.vtt');

const SCENES = [
  { name: 'One operating context', routes: ['/master-data'], seconds: 34 },
  { name: 'Human and AI organisation', routes: ['/org'], seconds: 34 },
  { name: 'Objectives and key results', routes: ['/objectives'], seconds: 42 },
  { name: 'Repeatable workflows', routes: ['/workflows'], seconds: 38 },
  { name: 'Revenue and CRM', routes: ['/master-data'], table: 'demo_northstar_crm_opportunities', seconds: 42 },
  { name: 'Cost, fulfilment and ERP', routes: ['/master-data'], table: 'demo_northstar_erp_invoices', seconds: 42 },
  { name: 'Autonomy with policy', routes: ['/policies'], seconds: 36 },
  { name: 'Agent budgets and efficiency', routes: ['/efficiency'], seconds: 34 },
  { name: 'CEO channel', routes: ['/workspace'], seconds: 38 },
  { name: 'Compounding improvement', routes: ['/objectives'], seconds: 40 },
];

function log(message, detail = '') {
  console.info(`[northstar-demo-video] ${message}${detail ? ` ${detail}` : ''}`);
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-1800)}`));
    });
  });
}

function extractVoiceScenes(markdown) {
  return [...String(markdown).matchAll(/## Scene\s+\d+[^\n]*[\s\S]*?### Voiceover\s*\n+([\s\S]*?)(?=\n## Scene|\n## Production notes|$)/gi)]
    .map((match) => match[1].trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

async function issueSession() {
  mkdirSync(WORK_ROOT, { recursive: true });
  const { createSession } = await import('../src/services/auth/session.js');
  const session = createSession(OWNER_ID);
  writeFileSync(TOKEN_FILE, session.token, { encoding: 'utf8', mode: 0o600 });
  chmodSync(TOKEN_FILE, 0o600);
  log('temporary CEO capture session issued; token not displayed');
}

async function revokeSession() {
  if (!existsSync(TOKEN_FILE)) {
    log('no temporary session file found');
    return;
  }
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  const { revokeSession: revoke } = await import('../src/services/auth/session.js');
  revoke(token);
  rmSync(TOKEN_FILE, { force: true });
  log('temporary CEO capture session revoked and token file removed');
}

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE_PATH,
    '/usr/local/lib/node_modules/openclaw/node_modules/playwright-core/index.js',
    '/usr/local/lib/node_modules/openclaw/node_modules/playwright-core/lib/inprocess.js',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const module = await import(pathToFileURL(candidate).href);
    if (module.chromium) return module;
    if (module.default?.chromium) return module.default;
  }
  throw new Error('Playwright Core was not found; run capture inside the openclaw container');
}

async function capture() {
  if (!existsSync(TOKEN_FILE)) throw new Error('temporary capture session is missing');
  mkdirSync(WORK_ROOT, { recursive: true });
  rmSync(CAPTURE_FILE, { force: true });
  const token = readFileSync(TOKEN_FILE, 'utf8').trim();
  const { chromium } = await loadPlaywright();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/opt/playwright/chromium-1243/chrome-linux64/chrome';
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: WORK_ROOT, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript((captureToken) => {
    localStorage.setItem('agent-os-auth-token', captureToken);
    localStorage.setItem('agent-os-nav-collapsed', '0');
  }, token);
  const page = await context.newPage();
  const video = page.video();

  try {
    for (let index = 0; index < SCENES.length; index += 1) {
      const scene = SCENES[index];
      const perRouteMs = Math.max(7000, Math.floor((scene.seconds * 1000) / scene.routes.length));
      log(`capture scene ${index + 1}/${SCENES.length}:`, scene.name);
      for (const route of scene.routes) {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForTimeout(3500);
        const bannerCount = await page.locator('.impersonation-banner').count();
        if (bannerCount) throw new Error('impersonation banner detected; refusing to record Admin context');
        const bodyText = await page.locator('body').innerText().catch(() => '');
        if (/sign in|login to flolah/i.test(bodyText.slice(0, 1200))) throw new Error(`capture session was not accepted on ${route}`);
        if (scene.table) {
          const tableButton = page.getByRole('button', { name: new RegExp(`^${scene.table}\\b`, 'i') }).first();
          await tableButton.waitFor({ state: 'visible', timeout: 30000 });
          await tableButton.click();
          const selectedHeading = page.getByRole('heading', { name: new RegExp(`^${scene.table}\\b`, 'i') }).last();
          await selectedHeading.waitFor({ state: 'visible', timeout: 30000 });
          await selectedHeading.scrollIntoViewIfNeeded();
          await page.waitForTimeout(1800);
        }
        await page.mouse.move(1720, 180, { steps: 12 });
        await page.waitForTimeout(Math.max(1200, perRouteMs - 7000));
        await page.mouse.wheel(0, 420);
        await page.waitForTimeout(1600);
        await page.mouse.wheel(0, -420);
        await page.waitForTimeout(700);
      }
    }
    await page.screenshot({ path: QA_FILE, fullPage: false });
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }

  const recordedPath = await video.path();
  if (resolve(recordedPath) !== resolve(CAPTURE_FILE)) copyFileSync(recordedPath, CAPTURE_FILE);
  if (!existsSync(CAPTURE_FILE) || statSync(CAPTURE_FILE).size < 200_000) throw new Error('browser recording is missing or too small');
  log('live UI capture complete', CAPTURE_FILE);
}

async function synthesize(text, destination) {
  const response = await fetch(`${TTS_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
    body: JSON.stringify({ text, length_scale: 1.02 }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Piper TTS ${response.status}: ${(await response.text()).slice(0, 400)}`);
  writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

async function duration(path) {
  const result = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]);
  const value = Number(result.stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`unable to measure ${path}`);
  return value;
}

function vttTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function buildVtt(voiceScenes, sceneDurations) {
  const cues = ['WEBVTT', ''];
  let cursor = 0;
  for (let sceneIndex = 0; sceneIndex < voiceScenes.length; sceneIndex += 1) {
    const sentences = voiceScenes[sceneIndex].match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [voiceScenes[sceneIndex]];
    const weights = sentences.map((sentence) => Math.max(1, sentence.split(/\s+/).length));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const sceneDuration = sceneDurations[sceneIndex];
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const cueDuration = sceneDuration * (weights[sentenceIndex] / totalWeight);
      const end = cursor + cueDuration;
      cues.push(`${vttTimestamp(cursor)} --> ${vttTimestamp(end)}`);
      cues.push(sentences[sentenceIndex]);
      cues.push('');
      cursor = end;
    }
  }
  return cues.join('\n');
}

async function render() {
  if (!existsSync(CAPTURE_FILE)) throw new Error('live UI capture is missing');
  mkdirSync(WORK_ROOT, { recursive: true });
  const voiceScenes = extractVoiceScenes(readFileSync(SCRIPT_FILE, 'utf8'));
  if (voiceScenes.length !== SCENES.length) throw new Error(`expected ${SCENES.length} voice scenes, found ${voiceScenes.length}`);

  const wavFiles = [];
  const sceneDurations = [];
  for (let index = 0; index < voiceScenes.length; index += 1) {
    const wav = join(WORK_ROOT, `voice-${String(index + 1).padStart(2, '0')}.wav`);
    log(`narration ${index + 1}/${voiceScenes.length}`);
    await synthesize(voiceScenes[index], wav);
    wavFiles.push(wav);
    sceneDurations.push(await duration(wav));
  }
  const concatFile = join(WORK_ROOT, 'narration.txt');
  writeFileSync(concatFile, wavFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
  const narration = join(WORK_ROOT, 'northstar-narration.wav');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c:a', 'pcm_s16le', narration]);

  const [videoSeconds, audioSeconds] = await Promise.all([duration(CAPTURE_FILE), duration(narration)]);
  const stretch = audioSeconds / videoSeconds;
  log('assembling', `video=${videoSeconds.toFixed(1)}s audio=${audioSeconds.toFixed(1)}s`);
  await run('ffmpeg', [
    '-y', '-i', CAPTURE_FILE, '-i', narration,
    '-filter_complex', `[0:v]setpts=${stretch.toFixed(8)}*PTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black[v]`,
    '-map', '[v]', '-map', '1:a:0', '-t', audioSeconds.toFixed(3),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', FINAL_FILE,
  ]);
  mkdirSync(PERSISTENT_ASSET_DIR, { recursive: true });
  mkdirSync(MIRROR_DIR, { recursive: true });
  writeFileSync(CAPTION_SOURCE, buildVtt(voiceScenes, sceneDurations), 'utf8');
  copyFileSync(FINAL_FILE, PERSISTENT_FILE);
  copyFileSync(FINAL_FILE, MIRROR_FILE);
  copyFileSync(CAPTION_SOURCE, MIRROR_VTT);
  log('final video ready', `${FINAL_FILE} (${statSync(FINAL_FILE).size} bytes)`);
}

const mode = process.argv[2];
if (mode === 'issue-session') await issueSession();
else if (mode === 'capture') await capture();
else if (mode === 'render') await render();
else if (mode === 'revoke-session') await revokeSession();
else throw new Error('usage: northstar-demo-video.mjs issue-session|capture|render|revoke-session');
