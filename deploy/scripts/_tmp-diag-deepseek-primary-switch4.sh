#!/bin/bash
set -euo pipefail

echo "=== mounts for backend vs openclaw ==="
docker inspect agent-os-backend-1 --format "{{json .Mounts}}" | python3 -m json.tool | grep -E "Source|Destination|Name" | head -40
echo "---"
docker inspect agent-os-openclaw-1 --format "{{json .Mounts}}" | python3 -m json.tool | grep -E "Source|Destination|Name" | head -40

echo "=== host volume files mtime ==="
ls -la --full-time /var/lib/docker/volumes/agent-os_openclaw_home/_data/platform-llm-* /root/.openclaw/platform-llm-* 2>/dev/null
md5sum /var/lib/docker/volumes/agent-os_openclaw_home/_data/platform-llm-runtime.env /root/.openclaw/platform-llm-runtime.env 2>/dev/null || true
md5sum /var/lib/docker/volumes/agent-os_openclaw_home/_data/platform-llm-active.json /root/.openclaw/platform-llm-active.json 2>/dev/null || true

echo "=== gateway process environ ==="
docker exec agent-os-openclaw-1 sh -c '
pid=$(pgrep -n -f "openclaw gateway" || true)
echo pid=$pid
ps aux | grep -i openclaw | grep -v grep | head -5
if [ -n "$pid" ]; then tr "\0" "\n" < /proc/$pid/environ | grep -E "^OPENAI_API_KEY=|^OPENAI_BASE_URL=" | sed -E "s/(KEY=)(.{10}).*/\1\2...(redacted)/"; fi
'

echo "=== dry-run: what sync writes for primary vs secondary (no mutate) ==="
docker exec -w /opt/agent-os/backend agent-os-backend-1 node --input-type=module <<'"'"'NODE'"'"'
import { readFileSync, existsSync } from "fs";
import {
  getEnvLlmEndpoints,
  getEffectivePlatformLlmEndpoints,
  getPlatformLlmActiveEndpoint,
} from "./src/services/platform-llm-settings.js";
import { getOpenClawDir, getOpenClawConfigPath } from "./src/config/openclaw-paths.js";

const redact = (k) => (!k ? "(empty)" : `${k.slice(0,10)}...${k.slice(-4)} len=${k.length}`);
const env = getEnvLlmEndpoints();
console.log("getPlatformLlmActiveEndpoint", getPlatformLlmActiveEndpoint());
console.log("env.primary", { baseUrl: env.primary.baseUrl, model: env.primary.model, key: redact(env.primary.apiKey) });
console.log("env.secondary", env.secondary && { baseUrl: env.secondary.baseUrl, model: env.secondary.model, key: redact(env.secondary.apiKey) });
const eff = getEffectivePlatformLlmEndpoints();
console.log("effective.active", eff.active);
console.log("effective.primary would drive sync", { baseUrl: eff.primary.baseUrl, model: eff.primary.model, key: redact(eff.primary.apiKey) });
console.log("openclaw dir", getOpenClawDir(), "cfg", getOpenClawConfigPath());
console.log("runtime exists", existsSync(getOpenClawDir()+"/platform-llm-runtime.env"));
if (existsSync(getOpenClawDir()+"/platform-llm-runtime.env")) {
  console.log("runtime from backend view:\n"+readFileSync(getOpenClawDir()+"/platform-llm-runtime.env","utf8").replace(/(KEY=)(.{10}).*/g,"$1$2...(redacted)"));
}
NODE

echo "=== check if backend /root/.openclaw is same inode as volume ==="
docker exec agent-os-backend-1 sh -c "ls -li /root/.openclaw/platform-llm-runtime.env; cat /root/.openclaw/platform-llm-runtime.env | sed -E \"s/(KEY=)(.{10}).*/\1\2...(redacted)/\""
docker exec agent-os-openclaw-1 sh -c "ls -li /root/.openclaw/platform-llm-runtime.env; cat /root/.openclaw/platform-llm-runtime.env | sed -E \"s/(KEY=)(.{10}).*/\1\2...(redacted)/\""

echo DONE
