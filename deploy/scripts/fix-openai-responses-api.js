const fs = require('fs');
const p = '/root/.openclaw/openclaw.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
if (!c.models) c.models = {};
if (!c.models.providers) c.models.providers = {};
const existing = c.models.providers.openai || {};
const models = (Array.isArray(existing.models) ? existing.models : []).map((m) => {
  if (typeof m === 'string') return { id: m, name: m, api: 'openai-responses' };
  return { ...m, api: 'openai-responses' };
});
const { baseUrl, ...rest } = existing;
c.models.providers.openai = {
  ...rest,
  apiKey: existing.apiKey,
  api: 'openai-responses',
  models,
};
delete c.models.providers.openai.baseUrl;
c.agents = c.agents || {};
c.agents.defaults = c.agents.defaults || {};
c.agents.defaults.model = c.agents.defaults.model || {};
c.agents.defaults.model.primary = c.agents.defaults.model.primary || 'openai/gpt-4o-mini';
c.agents.defaults.model.fallbacks = [];
if (!Array.isArray(c.plugins?.allow)) c.plugins = { ...(c.plugins || {}), allow: [] };
if (!c.plugins.allow.includes('browser')) c.plugins.allow.push('browser');
fs.writeFileSync(p, JSON.stringify(c, null, 2));
console.log('openai.api', c.models.providers.openai.api);
console.log('openai.hasBaseUrl', 'baseUrl' in c.models.providers.openai);
console.log('fallbacks', c.agents.defaults.model.fallbacks);
console.log('model sample api', c.models.providers.openai.models?.[0]?.api);
