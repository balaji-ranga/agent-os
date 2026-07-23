#!/usr/bin/env node
const fs = require('fs');
const label = process.argv[2] || 'state';
const c = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
const p = c.models?.providers?.openai || {};
let marker = null;
try {
  marker = JSON.parse(fs.readFileSync('/root/.openclaw/platform-llm-active.json', 'utf8'));
} catch {}
console.log(
  label,
  JSON.stringify(
    {
      defaults: c.agents?.defaults?.model,
      openai: {
        baseUrl: p.baseUrl || null,
        api: p.api,
        key: (p.apiKey || '').slice(0, 7) + '...',
        models: (p.models || []).map((m) => m.id || m).slice(0, 8),
      },
      marker,
    },
    null,
    2
  )
);
