#!/bin/bash
set -euo pipefail
OC=agent-os-openclaw-1

echo "=== Host paths (if any) ==="
ls -la /root/.openclaw/agents/t-ceo-byok-*/agent/ 2>/dev/null || echo "(no host /root/.openclaw BYOK agents)"

echo ""
echo "=== Container agent dirs matching t-ceo-byok-* ==="
docker exec "$OC" sh -c 'ls -d /root/.openclaw/agents/t-ceo-byok-* 2>/dev/null || echo "(none)"'

echo ""
echo "=== Per-agent auth-related files ==="
docker exec -i "$OC" node <<'NODE'
const fs = require('fs');
const path = require('path');
const agentsRoot = '/root/.openclaw/agents';
const dirs = fs.readdirSync(agentsRoot)
  .filter((n) => n.startsWith('t-ceo-byok-'))
  .map((n) => path.join(agentsRoot, n, 'agent'))
  .filter((d) => {
    try { return fs.statSync(d).isDirectory(); } catch { return false; }
  })
  .sort();

if (!dirs.length) {
  console.log('(no t-ceo-byok-* agent dirs)');
  process.exit(0);
}

const watch = ['auth-profiles.json', 'auth.json', 'openclaw-agent.sqlite'];

function redactProfile(key, v) {
  const out = { key };
  if (v && typeof v === 'object') {
    if (v.provider) out.provider = v.provider;
    if (v.type) out.type = v.type;
    if (v.mode) out.mode = v.mode;
    for (const sk of ['key', 'apiKey', 'token', 'access', 'refresh', 'password', 'secret']) {
      if (v[sk] != null) out[sk] = `[REDACTED len=${String(v[sk]).length}]`;
    }
    if (v.credentials && typeof v.credentials === 'object') {
      out.credentialsKeys = Object.keys(v.credentials);
    }
  }
  return out;
}

for (const d of dirs) {
  console.log(`--- ${d} ---`);
  let listing = [];
  try { listing = fs.readdirSync(d); } catch (e) { console.log('readdir error:', e.message); }
  console.log('dir entries:', listing.join(', ') || '(empty)');
  for (const f of watch) {
    const p = path.join(d, f);
    try {
      const st = fs.statSync(p);
      console.log(`PRESENT: ${p} (${st.size} bytes, mtime=${st.mtime.toISOString()})`);
    } catch {
      console.log(`MISSING: ${p}`);
    }
  }
  const ap = path.join(d, 'auth-profiles.json');
  if (fs.existsSync(ap)) {
    try {
      const j = JSON.parse(fs.readFileSync(ap, 'utf8'));
      const profiles = j.profiles || {};
      const keys = Object.keys(profiles);
      console.log('auth-profiles.json topKeys:', Object.keys(j).join(', ') || '(none)');
      console.log('auth-profiles.json profileKeys:', keys.length ? keys.join(', ') : '(none)');
      for (const k of keys) {
        console.log('  profile:', JSON.stringify(redactProfile(k, profiles[k])));
      }
    } catch (e) {
      console.log('auth-profiles.json parse error:', e.message);
    }
  }
  console.log('');
}
NODE

echo ""
echo "=== openclaw.json auth.profiles keys starting with byok- ==="
docker exec -i "$OC" node <<'NODE'
const fs = require('fs');
const c = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
const profiles = (c.auth && c.auth.profiles) || {};
const byok = Object.keys(profiles).filter((k) => k.startsWith('byok-')).sort();
console.log(JSON.stringify({
  count: byok.length,
  keys: byok,
  detail: byok.map((k) => {
    const v = profiles[k] || {};
    const out = { key: k };
    if (v.provider) out.provider = v.provider;
    if (v.type) out.type = v.type;
    if (v.mode) out.mode = v.mode;
    for (const sk of ['key', 'apiKey', 'token', 'access', 'refresh', 'password', 'secret']) {
      if (v[sk] != null) out[sk] = `[REDACTED len=${String(v[sk]).length}]`;
    }
    return out;
  }),
}, null, 2));
NODE

echo ""
echo "=== Cleanup candidates (paths that need cleanup on switchback) ==="
docker exec -i "$OC" node <<'NODE'
const fs = require('fs');
const path = require('path');
const agentsRoot = '/root/.openclaw/agents';
const watch = ['auth-profiles.json', 'auth.json', 'openclaw-agent.sqlite'];
const out = [];
for (const n of fs.readdirSync(agentsRoot).filter((x) => x.startsWith('t-ceo-byok-')).sort()) {
  const d = path.join(agentsRoot, n, 'agent');
  for (const f of watch) {
    const p = path.join(d, f);
    if (fs.existsSync(p)) out.push(p);
  }
}
const c = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
const profiles = (c.auth && c.auth.profiles) || {};
const byok = Object.keys(profiles).filter((k) => k.startsWith('byok-')).sort();
console.log('Agent auth files to remove/reset:');
out.forEach((p) => console.log('  ' + p));
if (!out.length) console.log('  (none)');
console.log('openclaw.json auth.profiles keys to remove:');
byok.forEach((k) => console.log('  ' + k));
if (!byok.length) console.log('  (none)');
console.log('Config path: /root/.openclaw/openclaw.json (edit auth.profiles)');
NODE
