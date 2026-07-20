const fs = require('fs');
const p = '/root/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.models) c.models = {};
// Prefer our provider catalog over auto openai plugin completions models
c.models.mode = 'replace';
const existing = c.models.providers?.openai || {};
const models = (Array.isArray(existing.models) ? existing.models : [
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
  { id: 'gpt-4o', name: 'gpt-4o' },
]).map((m) => {
  if (typeof m === 'string') return { id: m, name: m, api: 'openai-responses' };
  const copy = { ...m, api: 'openai-responses' };
  delete copy.baseUrl;
  return copy;
});
c.models.providers = c.models.providers || {};
c.models.providers.openai = {
  apiKey: existing.apiKey || process.env.OPENAI_API_KEY,
  api: 'openai-responses',
  models,
};
delete c.models.providers.openai.baseUrl;
c.agents = c.agents || {};
c.agents.defaults = c.agents.defaults || {};
c.agents.defaults.model = c.agents.defaults.model || {};
c.agents.defaults.model.primary = 'openai/gpt-4o-mini';
c.agents.defaults.model.fallbacks = [];
if (!c.plugins) c.plugins = {};
if (!Array.isArray(c.plugins.allow)) c.plugins.allow = [];
for (const id of ['agent-os-content-tools', 'browser']) {
  if (!c.plugins.allow.includes(id)) c.plugins.allow.push(id);
}
if (c.plugins.entries?.['agent-os-content-tools']) {
  c.plugins.entries['agent-os-content-tools'].enabled = true;
}
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log(JSON.stringify({
  mode: c.models.mode,
  api: c.models.providers.openai.api,
  modelApis: c.models.providers.openai.models.map((m) => m.api),
  primary: c.agents.defaults.model.primary,
  allow: c.plugins.allow,
}, null, 2));
