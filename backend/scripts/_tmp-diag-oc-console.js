import { createOcConsoleLaunchUrl } from '../src/services/openconnector-console-proxy.js';

const launch = createOcConsoleLaunchUrl({ id: 'admin-diag', role: 'admin' });
const cookie = `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}`;

async function get(path) {
  const res = await fetch(`http://127.0.0.1:3001${path}`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return { status: res.status, ct, text, headers: Object.fromEntries(res.headers) };
}

const html = await get('/openconnector/');
console.log('HTML', html.status, html.ct, 'len', html.text.length);
console.log('---HTML---');
console.log(html.text);
console.log('---END---');
console.log('has_patch', html.text.includes('data-oc-path-patch'));
console.log('has_base', /<base\s/i.test(html.text));

const refs = [...html.text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
console.log('refs', refs);

for (const ref of refs.filter((r) => /\.(js|css|mjs)/i.test(r) || r.includes('/assets/')).slice(0, 6)) {
  const path = ref.startsWith('http')
    ? new URL(ref).pathname
    : ref.startsWith('/')
      ? ref
      : `/openconnector/${ref}`;
  const asset = await get(path);
  console.log('\nASSET', path, asset.status, asset.ct, 'len', asset.text.length);
  if (/\.js/i.test(path) || asset.ct.includes('javascript')) {
    const bareApi = (asset.text.match(/["'`]\s*\/api\//g) || []).length;
    const prefApi = (asset.text.match(/\/openconnector\/api\//g) || []).length;
    const bareOverview = (asset.text.match(/["'`]\/overview["'`]/g) || []).length;
    const createBrowser = asset.text.includes('createBrowserRouter') || asset.text.includes('BrowserRouter');
    const basename = (asset.text.match(/basename\s*[:=]\s*["'][^"']+["']/g) || []).slice(0, 5);
    console.log({ bareApi, prefApi, bareOverview, createBrowser, basename });
    // sample absolute path literals
    const abs = [...asset.text.matchAll(/["'`](\/(?:api|v1|overview|providers|actions|runs|assets)[^"'`]{0,80})["'`]/g)]
      .map((m) => m[1])
      .slice(0, 30);
    console.log('abs_samples', abs);
  }
}

// Through nginx container if reachable
for (const path of [
  '/openconnector/api/connections',
  '/openconnector/overview',
  '/api/connections',
  '/overview',
]) {
  try {
    const res = await fetch(`http://nginx${path}`, {
      headers: { Cookie: cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    const t = await res.text();
    console.log('NGINX', path, res.status, (res.headers.get('content-type') || '').slice(0, 40), t.slice(0, 80).replace(/\n/g, ' '));
  } catch (e) {
    console.log('NGINX', path, 'ERR', e.message);
  }
}
