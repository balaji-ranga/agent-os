import { getPlatformLlmStatusPublic, setPlatformLlmActiveEndpoint } from './src/services/platform-llm-settings.js';
import { readFileSync, existsSync } from 'fs';
import { getOpenClawDir, getOpenClawConfigPath } from './src/config/openclaw-paths.js';

function redactKey(k) {
  const s = String(k || '');
  if (!s) return null;
  return `${s.slice(0, 10)}...${s.slice(-4)}`;
}

const st = getPlatformLlmStatusPublic();
console.log('STATUS', JSON.stringify(st, null, 2));
const dir = getOpenClawDir();
console.log('dir', dir);
for (const f of ['platform-llm-active.json', 'platform-llm-runtime.env']) {
  const p = `${dir}/${f}`;
  if (!existsSync(p)) {
    console.log(f, 'MISSING');
    continue;
  }
  let t = readFileSync(p, 'utf8');
  t = t.replace(/(KEY=)(.{10}).*/g, '$1$2...(redacted)');
  console.log('---', f, '---\n', t);
}
const cfg = JSON.parse(readFileSync(getOpenClawConfigPath(), 'utf8'));
const o = ((cfg.models || {}).providers || {}).openai || {};
console.log('defaults', JSON.stringify(cfg.agents?.defaults?.model));
console.log(
  'openai',
  JSON.stringify({
    baseUrl: o.baseUrl || null,
    api: o.api || null,
    key: redactKey(o.apiKey),
    models: (o.models || []).map((m) => m.id || m).slice(0, 6),
  })
);

const which = process.argv[2];
if (which === 'primary' || which === 'secondary') {
  console.log('SWITCHING', which);
  const r = setPlatformLlmActiveEndpoint(which);
  console.log(
    JSON.stringify(
      {
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
        effective_key: redactKey(r.endpoints?.primary?.apiKey),
      },
      null,
      2
    )
  );
}
