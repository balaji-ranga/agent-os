import { createOcConsoleLaunchUrl } from '../src/services/openconnector-console-proxy.js';

const launch = createOcConsoleLaunchUrl({ id: 'admin-diag', role: 'admin' });
const cookie = `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}`;
const origin = 'https://flolah.cloud';

async function get(path, opts = {}) {
  const res = await fetch(`${origin}${path}`, {
    headers: { Cookie: cookie, Accept: 'application/json', ...(opts.headers || {}) },
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
    ...opts,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  console.log(path, res.status, JSON.stringify(json ?? text.slice(0, 180)).slice(0, 300));
  return { res, json, text };
}

await get('/openconnector/api/auth/session');
await get('/openconnector/api/providers');
await get('/openconnector/api/connections');
await get('/openconnector/api/actions');
await get('/openconnector/api/oauth/configs');
await get('/openconnector/api/runs?limit=5');

// Check raw upstream session with admin bearer
const admin = process.env.OPENCONNECTOR_ADMIN_TOKEN;
const up = await fetch('http://openconnector:3000/api/auth/session', {
  headers: { Authorization: admin.startsWith('Bearer ') ? admin : `Bearer ${admin}` },
  signal: AbortSignal.timeout(10000),
});
console.log('upstream session', up.status, (await up.text()).slice(0, 300));

// Inspect how Ji/qi build requests in JS — find function definitions near /openconnector/api/auth/session
const jsRes = await fetch(`${origin}/openconnector/assets/index-Cy8D51DO.js`, {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(30000),
});
const js = await jsRes.text();
const idx = js.indexOf('/openconnector/api/auth/session');
console.log('\naround auth/session call:\n', js.slice(idx - 500, idx + 800));

const idx2 = js.search(/async function qi\(|function qi\(|qi=async|const qi=|function Ji\(/);
console.log('\nqi/Ji search', idx2);
// find fetch wrapper
for (const name of ['async function qi', 'async function Ji', 'async function Yi', 'async function Xi', 'function qi(', 'qi=async']) {
  const i = js.indexOf(name);
  if (i >= 0) console.log('\nFOUND', name, '\n', js.slice(i, i + 600));
}

// Look for bare /api without openconnector - maybe constructed
const suspicious = [...js.matchAll(/["'`](\/api[^"'`]*|api\/[^"'`]*)["'`]/g)].map((m) => m[1]).slice(0, 40);
console.log('\nsuspicious api strings', suspicious);

const failed = js.indexOf('Request failed');
console.log('\nRequest failed ctx:\n', js.slice(failed - 200, failed + 200));
