/**
 * Smoke: chat media URL detection + authenticated media fetch.
 * Usage: node scripts/test-chat-media-inline.js
 * Env: API_BASE (default http://127.0.0.1:3001/api), AGENT_OS_TEST_EMAIL, AGENT_OS_TEST_PASSWORD
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- URL detection parity with ChatMessageContent ---
function detectMedia(contentStr) {
  const imageExt = /\.(png|jpe?g|gif|webp|bmp)(\?[^\s"'<>]*)?$/i;
  const videoExt = /\.(mp4|webm|ogg)(\?[^\s"'<>]*)?$/i;
  const media = [];
  const overlaps = (start, len) => media.some((x) => start < x.index + x.length && start + len > x.index);
  const clean = (u) => String(u || '').trim().replace(/[:;.,]+$/g, '');

  const reJson = /\{\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  let m;
  while ((m = reJson.exec(contentStr)) !== null) {
    if (!overlaps(m.index, m[0].length)) media.push({ type: 'image', src: m[1] });
  }
  const reApiMedia = /(?:^|[\s"'(\[])(\/api\/media\/[^\s<>"'\)\]]+)/g;
  while ((m = reApiMedia.exec(contentStr)) !== null) {
    const url = clean(m[1]);
    const start = m.index + (m[0].length - url.length);
    if (!overlaps(start, url.length)) media.push({ type: videoExt.test(url) ? 'video' : 'image', src: url });
  }
  const reHttp = /https?:\/\/[^\s<>"']+/g;
  while ((m = reHttp.exec(contentStr)) !== null) {
    const url = m[0];
    if (!overlaps(m.index, url.length) && (imageExt.test(url) || /\/api\/media\//i.test(url))) {
      media.push({ type: 'image', src: url });
    }
  }
  return media;
}

const sample = `Here's a biryani image and recipe.\n{"url":"/api/media/openclaw/generated/abc.png"}\nEnjoy!`;
const found = detectMedia(sample);
assert(found.length >= 1, 'should detect JSON url');
assert(found[0].src.includes('/api/media/'), 'src is media path');

const bare = `Image: /api/media/openclaw/generated/xyz.webp ready`;
assert(detectMedia(bare).some((x) => x.src.includes('xyz.webp')), 'bare /api/media path detected');

console.log('OK detection', found.map((f) => f.src));

// --- Optional live API auth check ---
const API = (process.env.API_BASE || 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const email = process.env.AGENT_OS_TEST_EMAIL || '';
const password = process.env.AGENT_OS_TEST_PASSWORD || '';

async function live() {
  if (!email || !password) {
    console.log('SKIP live auth (set AGENT_OS_TEST_EMAIL / AGENT_OS_TEST_PASSWORD)');
    return;
  }
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json().catch(() => ({}));
  assert(login.ok, `login failed: ${loginBody.error || login.status}`);
  const token = loginBody.token || loginBody.session_token;
  assert(token, 'no token');

  const unauth = await fetch(`${API}/media/openclaw/generated/does-not-exist.png`);
  assert(unauth.status === 401 || unauth.status === 404, `expected 401/404 without auth, got ${unauth.status}`);

  // Any existing generated file if present in a recent tool log is hard; just verify auth header accepted (404 ok)
  const auth = await fetch(`${API}/media/openclaw/generated/does-not-exist.png`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert(auth.status !== 401, `authed request should not 401, got ${auth.status}`);
  console.log('OK live media auth (unauth=', unauth.status, 'auth=', auth.status, ')');
}

// Frontend build presence
const dist = join(ROOT, 'frontend', 'dist', 'index.html');
if (existsSync(dist)) {
  const html = readFileSync(dist, 'utf8');
  assert(html.includes('script'), 'dist index has scripts');
  console.log('OK frontend dist present');
} else {
  console.log('NOTE: frontend/dist missing — run npm run build in frontend for deploy');
}

await live();
console.log('PASS test-chat-media-inline');
