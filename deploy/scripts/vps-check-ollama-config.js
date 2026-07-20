const fs = require('fs');
const j = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf8'));
const o = j.models?.providers?.ollama || null;
const out = {
  ollamaProvider: o
    ? {
        baseUrl: o.baseUrl,
        api: o.api,
        modelIds: (o.models || []).slice(0, 5).map((m) => m.id || m.name || m),
      }
    : null,
  providerKeys: Object.keys(j.models?.providers || {}),
};
console.log(JSON.stringify(out, null, 2));
