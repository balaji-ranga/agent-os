import { createOcConsoleLaunchUrl } from '../src/services/openconnector-console-proxy.js';
import { writeFileSync } from 'fs';

const launch = createOcConsoleLaunchUrl({ id: 'admin-diag', role: 'admin' });
const cookie = `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}`;

const res = await fetch('http://127.0.0.1:3001/openconnector/assets/index-Cy8D51DO.js', {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(30000),
});
const js = await res.text();
writeFileSync('/tmp/oc-index.js', js);

function ctx(needle, n = 200) {
  let i = 0;
  let c = 0;
  while ((i = js.indexOf(needle, i)) >= 0 && c < 15) {
    console.log(`\n=== ${needle} @${i} ===`);
    console.log(js.slice(Math.max(0, i - n), i + needle.length + n));
    i += needle.length;
    c++;
  }
}

for (const n of [
  'basename',
  '/openconnector/api/',
  'createRouter',
  'RouterProvider',
  'BrowserRouter',
  'createBrowserRouter',
  'pathname',
  'Request failed',
  'fetch(',
  'axios',
  '/openconnector/overview',
  'overview',
]) {
  const count = js.split(n).length - 1;
  console.log('COUNT', n, count);
}

ctx('basename');
ctx('/openconnector/api/');
ctx('createBrowserRouter');
ctx('createRouter');
ctx('RouterProvider');

// Find route path definitions
const routePaths = [...js.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).slice(0, 40);
console.log('\nroute paths', routePaths);

const openconnectorPaths = [...js.matchAll(/\/openconnector\/[a-zA-Z0-9_./:-]{1,60}/g)]
  .map((m) => m[0])
  .filter((v, i, a) => a.indexOf(v) === i)
  .slice(0, 80);
console.log('\nunique /openconnector paths', openconnectorPaths);

// Check upstream raw (no rewrite) via direct OC
const raw = await fetch('http://openconnector:3000/', { signal: AbortSignal.timeout(10000) });
const rawHtml = await raw.text();
const assetMatch = rawHtml.match(/src=["']([^"']+index[^"']+\.js)["']/);
console.log('\nraw html asset', assetMatch?.[1]);
if (assetMatch) {
  const rawJsRes = await fetch(`http://openconnector:3000${assetMatch[1]}`, {
    signal: AbortSignal.timeout(30000),
  });
  const rawJs = await rawJsRes.text();
  writeFileSync('/tmp/oc-index-raw.js', rawJs);
  console.log('raw len', rawJs.length, 'proxied len', js.length);
  console.log('raw basename samples:');
  let i = 0,
    c = 0;
  while ((i = rawJs.indexOf('basename', i)) >= 0 && c < 8) {
    console.log(rawJs.slice(Math.max(0, i - 80), i + 120));
    i += 8;
    c++;
  }
  console.log('raw /api/ count', (rawJs.match(/["'`]\s*\/api\//g) || []).length);
  console.log('raw path: samples', [...rawJs.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).slice(0, 30));
}

// Public HTTPS checks
const publicOrigin = process.env.OPENCONNECTOR_PUBLIC_ORIGIN || 'https://flolah.cloud/openconnector';
const origin = publicOrigin.replace(/\/openconnector\/?$/, '');
console.log('\npublic origin', origin);

async function pub(path, follow = true) {
  const r = await fetch(`${origin}${path}`, {
    headers: { Cookie: cookie, 'User-Agent': 'oc-diag' },
    redirect: follow ? 'follow' : 'manual',
    signal: AbortSignal.timeout(20000),
  });
  const t = await r.text();
  console.log('PUB', path, r.status, (r.headers.get('content-type') || '').slice(0, 40), 'final', r.url, t.slice(0, 100).replace(/\n/g, ' '));
  return t;
}

await pub('/openconnector/');
await pub('/openconnector/api/connections', false);
await pub('/openconnector/api/connections');
await pub('/openconnector/overview');
await pub('/api/connections', false);
await pub('/overview', false);
