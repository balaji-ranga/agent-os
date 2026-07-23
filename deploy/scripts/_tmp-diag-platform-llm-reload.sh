#!/bin/bash
set -uo pipefail

echo "=== python gateway scan ==="
docker exec -i agent-os-openclaw-1 python3 - <<'PY'
from pathlib import Path
found=0
for line in sorted(Path("/proc").iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 0):
    if not line.name.isdigit(): continue
    try:
        cmd = (line/"cmdline").read_bytes().replace(b"\0",b" ").decode("utf-8","ignore")
    except Exception:
        continue
    if not cmd.strip(): continue
    low=cmd.lower()
    if any(x in low for x in ("openclaw", "gateway", "entrypoint", "node")):
        print("PID", line.name, cmd[:220])
        found += 1
        try:
            env=(line/"environ").read_bytes().split(b"\0")
            for e in env:
                if e.startswith(b"OPENAI_API_KEY=") or e.startswith(b"OPENAI_BASE_URL="):
                    s=e.decode()
                    if s.startswith("OPENAI_API_KEY="):
                        k=s.split("=",1)[1]
                        print("  KEY", k[:10]+"..."+k[-4:], "sk_proj", k.startswith("sk-proj"))
                    else:
                        print(" ", s)
        except Exception as ex:
            print("  env err", ex)
print("found", found)
PY

echo "=== backend status via file ==="
cat > /tmp/_plat_status.mjs <<'EOF'
import { getPlatformLlmStatusPublic, setPlatformLlmActiveEndpoint } from './src/services/platform-llm-settings.js';
import { readFileSync, existsSync } from 'fs';
import { getOpenClawDir, getOpenClawConfigPath } from './src/config/openclaw-paths.js';

const st = getPlatformLlmStatusPublic();
console.log('STATUS', JSON.stringify(st, null, 2));
const dir = getOpenClawDir();
console.log('dir', dir);
for (const f of ['platform-llm-active.json', 'platform-llm-runtime.env']) {
  const p = `${dir}/${f}`;
  if (!existsSync(p)) { console.log(f, 'MISSING'); continue; }
  let t = readFileSync(p, 'utf8');
  t = t.replace(/(KEY=)(.{10}).*/g, '$1$2...(redacted)');
  console.log('---', f, '---\n', t);
}
const cfg = JSON.parse(readFileSync(getOpenClawConfigPath(), 'utf8'));
const o = ((cfg.models || {}).providers || {}).openai || {};
const k = String(o.apiKey || '');
console.log('defaults', JSON.stringify(cfg.agents?.defaults?.model));
console.log('openai', JSON.stringify({
  baseUrl: o.baseUrl || null,
  api: o.api || null,
  key: k ? `${k.slice(0,10)}...${k.slice(-4)}` : null,
  models: (o.models || []).map((m) => m.id || m).slice(0, 6),
}));

const which = process.argv[2];
if (which === 'primary' || which === 'secondary') {
  console.log('SWITCHING', which);
  const r = setPlatformLlmActiveEndpoint(which);
  console.log(JSON.stringify({
    llm_active_endpoint: r.llm_active_endpoint,
    openclaw: {
      ok: r.openclaw?.ok,
      active: r.openclaw?.active,
      primary: r.openclaw?.primary,
      fallbacks: r.openclaw?.fallbacks,
      provider: r.openclaw?.provider,
    },
    effective_model: r.endpoints?.primary?.model,
    effective_base: r.endpoints?.primary?.baseUrl,
    effective_key_prefix: String(r.endpoints?.primary?.apiKey || '').slice(0, 10),
  }, null, 2));
}
EOF
docker cp /tmp/_plat_status.mjs agent-os-backend-1:/opt/agent-os/backend/_plat_status.mjs
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs
echo "=== switch to primary ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs primary
echo "=== wait for watcher ==="
for i in $(seq 1 30); do
  if docker logs agent-os-openclaw-1 --since 45s 2>&1 | grep -q 'platform-llm-active.json changed'; then
    echo "WATCHER_OK at ${i}s"
    break
  fi
  sleep 1
done
docker logs agent-os-openclaw-1 --since 60s 2>&1 | grep -E 'platform-llm|Sourced|Starting gateway|changed|Honoring|providers.openai|defaults.model|fallbacks' | tail -50
echo "=== status after ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node _plat_status.mjs
echo "=== gateway env after ==="
docker exec -i agent-os-openclaw-1 python3 - <<'PY'
from pathlib import Path
for line in Path("/proc").iterdir():
    if not line.name.isdigit(): continue
    try:
        cmd=(line/"cmdline").read_bytes().replace(b"\0",b" ").decode("utf-8","ignore")
    except Exception:
        continue
    if "gateway" not in cmd: continue
    env=(line/"environ").read_bytes().split(b"\0")
    for e in env:
        if e.startswith(b"OPENAI_API_KEY=") or e.startswith(b"OPENAI_BASE_URL="):
            s=e.decode()
            if "KEY=" in s:
                k=s.split("=",1)[1]; print("KEY", k[:10]+"..."+k[-4:], "sk_proj", k.startswith("sk-proj"))
            else: print(s)
    print("CMD", cmd[:160])
PY
