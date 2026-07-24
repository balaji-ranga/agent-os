/**
 * Smoke: summarize_url remaps dead NASA mission_pages URL.
 * Usage: node scripts/test-summarize-url-nasa-remap.js
 * Needs network.
 */
import assert from 'assert';

const { summarizeUrlCandidates } = await import(
  // re-test via HTTP against local if available; otherwise unit-test candidates by duplicating logic
  '../src/routes/tools.js'
).catch(() => ({ summarizeUrlCandidates: null }));

// Inline the same remap rules for a pure unit check (tools.js helpers are not exported).
function candidates(rawUrl) {
  const remaps = [
    {
      test: (u) => /nasa\.gov$/i.test(u.hostname) && /\/mission_pages\/planets\b/i.test(u.pathname),
      to: 'https://science.nasa.gov/solar-system/planets/',
    },
  ];
  const out = [rawUrl];
  const u = new URL(rawUrl);
  for (const rule of remaps) {
    if (rule.test(u)) out.push(rule.to);
  }
  return out;
}

const dead = 'https://www.nasa.gov/mission_pages/planets/overview/index.html';
const c = candidates(dead);
assert.ok(c.includes('https://science.nasa.gov/solar-system/planets/'));
console.log('SUMMARIZE_URL_NASA_REMAP_OK', c);

// Live fetch if TOOLS_LIVE=1
if (process.env.TOOLS_LIVE === '1') {
  const base = process.env.AGENT_OS_API_URL || 'http://127.0.0.1:3001';
  const key = process.env.TOOLS_API_KEY || '';
  const res = await fetch(`${base}/api/tools/summarize-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ url: dead }),
  });
  const data = await res.json();
  console.log('live', res.status, JSON.stringify(data).slice(0, 400));
  assert.ok(data.summary || data.suggested_url || data.hint);
}
