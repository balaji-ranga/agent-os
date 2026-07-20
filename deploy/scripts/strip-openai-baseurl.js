const fs = require('fs');
const path = require('path');

function stripOpenAi(obj, label) {
  if (!obj || typeof obj !== 'object') return false;
  let changed = false;
  const providers = obj.providers || obj;
  const oai = providers.openai;
  if (oai && typeof oai === 'object') {
    if ('baseUrl' in oai) {
      delete oai.baseUrl;
      changed = true;
    }
    oai.api = 'openai-responses';
    if (Array.isArray(oai.models)) {
      oai.models = oai.models.map((m) => {
        if (typeof m === 'string') return { id: m, name: m, api: 'openai-responses' };
        const copy = { ...m, api: 'openai-responses' };
        if ('baseUrl' in copy) delete copy.baseUrl;
        return copy;
      });
    }
    changed = true;
  }
  if (changed) console.log('fixed', label);
  return changed;
}

const rootCfg = '/root/.openclaw/openclaw.json';
const cfg = JSON.parse(fs.readFileSync(rootCfg, 'utf8'));
if (stripOpenAi(cfg.models, 'openclaw.json')) {
  fs.writeFileSync(rootCfg, JSON.stringify(cfg, null, 2));
}

const agentsRoot = '/root/.openclaw/agents';
for (const d of fs.readdirSync(agentsRoot)) {
  const mp = path.join(agentsRoot, d, 'agent', 'models.json');
  if (!fs.existsSync(mp)) continue;
  try {
    const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
    if (stripOpenAi(m, mp)) fs.writeFileSync(mp, JSON.stringify(m, null, 2));
  } catch (e) {
    console.warn('skip', mp, e.message);
  }
}
console.log('done');
