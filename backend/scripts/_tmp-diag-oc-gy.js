import { createOcConsoleLaunchUrl } from '../src/services/openconnector-console-proxy.js';
import { writeFileSync } from 'fs';

const launch = createOcConsoleLaunchUrl({ id: 'admin-diag', role: 'admin' });
const cookie = `${launch.cookie.name}=${encodeURIComponent(launch.cookie.value)}`;

const js = await (
  await fetch('http://127.0.0.1:3001/openconnector/assets/index-Cy8D51DO.js', {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30000),
  })
).text();

// Extract gy() shell function area
const i = js.indexOf('function gy(');
console.log(js.slice(i, i + 4500));
writeFileSync('/tmp/oc-gy.js', js.slice(i, i + 8000));

// Compare nav paths after rewrite
const nav = js.indexOf('var sy=[');
console.log('\nNAV', js.slice(nav, nav + 500));

// Routes area
const routes = js.indexOf('index:!0,element');
console.log('\nROUTES', js.slice(routes - 100, routes + 1200));

// Check for any remaining bare /api or /overview in backticks
for (const re of [
  /`\/api\/[^`]{0,40}`/g,
  /`\/overview`/g,
  /`\/providers`/g,
  /"\/api\/[^"]{0,40}"/g,
  /'\/api\/[^']{0,40}'/g,
]) {
  const hits = [...js.matchAll(re)].map((m) => m[0]).slice(0, 20);
  console.log('\nRE', re, hits);
}
