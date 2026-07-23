#!/bin/bash
# Show which key OpenClaw openai provider uses (prefix only) + platform_llm status
docker exec agent-os-openclaw-1 node -e '
const fs=require("fs");
const c=JSON.parse(fs.readFileSync("/root/.openclaw/openclaw.json","utf8"));
const auth=c.auth||{};
const profiles=auth.profiles||{};
const keys=Object.keys(profiles);
console.log("auth.profiles keys sample:", keys.slice(0,20));
for (const k of keys) {
  if (/openai|default|platform/i.test(k)) {
    const p=profiles[k];
    const tok=String(p.key||p.apiKey||p.token||"");
    console.log(k, "type=", p.type||p.provider||"", "keyPrefix=", tok?tok.slice(0,10)+"…"+tok.slice(-4):"(none)");
  }
}
console.log("env OPENAI_API_KEY prefix", (process.env.OPENAI_API_KEY||"").slice(0,12)+"…"+(process.env.OPENAI_API_KEY||"").slice(-4));
console.log("env OPENAI_SECONDARY_API_KEY prefix", (process.env.OPENAI_SECONDARY_API_KEY||"").slice(0,12)+"…"+(process.env.OPENAI_SECONDARY_API_KEY||"").slice(-4));
'
docker exec agent-os-backend-1 sh -c 'ls /data/agent-os/platform-llm-active.json 2>/dev/null; cat /data/agent-os/platform-llm-active.json 2>/dev/null; ls /root/.openclaw/platform-llm-active.json 2>/dev/null; cat /root/.openclaw/platform-llm-active.json 2>/dev/null'
docker exec agent-os-openclaw-1 sh -c 'cat /root/.openclaw/platform-llm-active.json 2>/dev/null || echo no-platform-llm-active'
