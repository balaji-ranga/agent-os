import { createOcConsoleLaunchUrl } from '../src/services/openconnector-console-proxy.js';

const launch = createOcConsoleLaunchUrl({ id: 'admin-diag', role: 'admin' });
const cookie = `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}`;
const js = await (
  await fetch('http://127.0.0.1:3001/openconnector/assets/index-Cy8D51DO.js', {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30000),
  })
).text();

// Find Sy / function Sy
for (const n of ['function Sy(', 'function Sy(', 'Sy=e', 'function Sy']) {
  console.log(n, js.indexOf(n));
}

// Search definition near usage Sy(n.pathname)
const usage = js.indexOf('Sy(n.pathname)');
console.log('usage', usage);
// Search backwards for function Sy
let idx = js.lastIndexOf('function S', usage);
console.log('near', js.slice(usage - 2000, usage + 200));

// Grep for Sy=
const matches = [...js.matchAll(/function ([A-Za-z0-9$]+)\(e\)\{return e\.split/g)];
console.log('split fns', matches.slice(0, 10));

const syDef = js.match(/function Sy\([^)]*\)\{[^}]+\}/);
console.log('syDef', syDef?.[0]);

// More flexible
let i = 0;
while ((i = js.indexOf('function Sy', i)) >= 0) {
  console.log('fn Sy', i, js.slice(i, i + 200));
  i += 10;
}

// Maybe minified as function Sy(e){...}
i = js.indexOf('Sy=');
console.log('Sy=', i, js.slice(i, i + 150));

// Check path helpers used by shell
const sliceFind = js.indexOf('e.path.slice(1)');
console.log('sliceFind ctx', js.slice(sliceFind - 100, sliceFind + 80));

// Verify runtime-tokens through proxy
for (const p of [
  '/openconnector/api/runtime-tokens',
  '/openconnector/api/auth/logout',
  '/openconnector/favicon.png',
  '/openconnector/assets/oomol-connect-logo-gOKeI2rR.png',
]) {
  const r = await fetch('http://127.0.0.1:3001' + p, {
    headers: { Cookie: cookie },
    method: p.includes('logout') ? 'POST' : 'GET',
    signal: AbortSignal.timeout(15000),
  });
  console.log(p, r.status, r.headers.get('content-type'));
}
