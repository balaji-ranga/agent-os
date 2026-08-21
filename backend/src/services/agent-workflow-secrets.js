/**
 * Workflow Builder secret hygiene: never persist API key literals in graphs.
 * Bind Settings → API Keys vault refs and summarize what the CEO should store.
 */
import { PLATFORM_BYOK_KEY_NAME } from './user-api-keys.js';

const SECRET_VALUE_KEYS = new Set([
  'apikey',
  'api_key',
  'apikeyvalue',
  'api_key_value',
  'bearertoken',
  'authbearer',
  'authorization',
  'smtppass',
  'smtp_pass',
  'password',
  'basicpassword',
  'privatekey',
  'private_key',
  'passphrase',
  'clientsecret',
  'client_secret',
  'token',
  'accesstoken',
  'secret',
]);

const REF_SUFFIX_KEYS = new Set([
  'apikeyref',
  'api_key_ref',
  'apikeyvalueref',
  'api_key_value_ref',
  'bearertokenref',
  'authbearerref',
  'smtppassref',
  'smtp_pass_ref',
  'passwordref',
  'password_ref',
  'basicpasswordref',
  'privatekeyref',
  'private_key_ref',
  'passphraseref',
  'runtimetokenref',
]);

const PLACEHOLDER_KEYS = new Set(['', 'ollama', 'none', 'n/a', 'na', 'placeholder', 'your-api-key', 'changeme']);

const PROVIDER_BIND_KEYS = {
  openai: PLATFORM_BYOK_KEY_NAME,
  openrouter: PLATFORM_BYOK_KEY_NAME,
  anthropic: PLATFORM_BYOK_KEY_NAME,
  deepseek: 'deepseek_key',
  elevenlabs: 'elevenlabs-key',
  brave: 'BRAVE_SEARCH_BYOK',
  medium: 'MEDIUM_INTEGRATION_TOKEN',
};

const LITERAL_SECRET_RE =
  /^(sk-[A-Za-z0-9_-]{8,}|sk-or-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|xox[baprs]-|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|ya29\.[A-Za-z0-9._-]+|Bearer\s+\S{8,})/i;

let ollamaProbe = { ts: 0, ok: false, probed: false, error: '', models: [], model: '' };

const OLLAMA_MODEL_RANK = [
  'llama3.2',
  'llama3.1',
  'llama3',
  'llama-w1-ctx32k',
  'qwen2.5',
  'qwen',
  'mistral',
  'phi',
  'gemma',
];

function tagMatchesWant(name, want) {
  const n = String(name || '').trim();
  const w = String(want || '').trim();
  if (!n || !w) return false;
  if (n === w || n === `${w}:latest`) return true;
  return n.startsWith(`${w}:`) || n.startsWith(`${w}-`);
}

/** Pick an installed Ollama chat tag. Never returns a cloud-only name like deepseek-v4-flash. */
export function pickOllamaChatModel(tagNames, preferred = '') {
  const names = [...new Set((tagNames || []).map((n) => String(n || '').trim()).filter(Boolean))];
  const envPref = String(preferred || process.env.OLLAMA_MODEL || process.env.OPENCLAW_OLLAMA_MODEL || 'llama3.2').trim();
  if (!names.length) return envPref || 'llama3.2';

  const matchOne = (want) => names.find((n) => tagMatchesWant(n, want)) || '';
  const fromPref = matchOne(envPref);
  if (fromPref) return fromPref;
  for (const r of OLLAMA_MODEL_RANK) {
    const hit = matchOne(r);
    if (hit) return hit;
  }
  return names.find((n) => !/embed|whisper|llava/i.test(n)) || names[0];
}

export function resolveOllamaChatModel(preferred = '') {
  if (Array.isArray(ollamaProbe.models) && ollamaProbe.models.length) {
    return pickOllamaChatModel(ollamaProbe.models, preferred);
  }
  return String(preferred || process.env.OLLAMA_MODEL || process.env.OPENCLAW_OLLAMA_MODEL || 'llama3.2').trim();
}

export function lastOllamaModel() {
  return String(ollamaProbe.model || '').trim();
}

function ollamaTagsUrl() {
  const raw = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  const origin = raw.replace(/\/v1$/i, '');
  return `${origin}/api/tags`;
}

export function bindKeyForProvider(source) {
  const key = String(source || '').toLowerCase().trim();
  return PROVIDER_BIND_KEYS[key] || PLATFORM_BYOK_KEY_NAME;
}

export function looksLikeSecretLiteral(value) {
  const s = String(value ?? '').trim();
  if (!s || PLACEHOLDER_KEYS.has(s.toLowerCase())) return false;
  if (/^\{\{/.test(s) || /^\$keyRef$/i.test(s)) return false;
  if (LITERAL_SECRET_RE.test(s)) return true;
  if (/^(Bearer|Basic)\s+\S{12,}/i.test(s)) return true;
  if (s.length >= 32 && /[A-Za-z]/.test(s) && /\d/.test(s) && !/\s/.test(s) && !/^https?:\/\//i.test(s)) {
    return true;
  }
  return false;
}

export function suggestedBindKeyName({ provider = '', field = '', hint = '' } = {}) {
  const fromProvider = bindKeyForProvider(provider);
  if (provider && PROVIDER_BIND_KEYS[String(provider).toLowerCase()]) return fromProvider;
  const h = `${field} ${hint}`.toLowerCase();
  if (/brave/.test(h)) return 'BRAVE_SEARCH_BYOK';
  if (/medium/.test(h)) return 'MEDIUM_INTEGRATION_TOKEN';
  if (/eleven/.test(h)) return 'elevenlabs-key';
  if (/deepseek/.test(h)) return 'deepseek_key';
  if (/smtp|mail/.test(h)) return 'SMTP_PASSWORD';
  if (/ftp|sftp|password/.test(h)) return 'WORKFLOW_HOST_PASSWORD';
  return PLATFORM_BYOK_KEY_NAME;
}

function isSecretFieldName(name) {
  const n = String(name || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
  if (REF_SUFFIX_KEYS.has(n) || n.endsWith('ref')) return false;
  return SECRET_VALUE_KEYS.has(n) || /^(api_?key|.*password|.*secret|.*token)$/i.test(String(name || ''));
}

function refFieldName(name) {
  const raw = String(name || 'apiKey');
  if (/Ref$/i.test(raw)) return raw;
  if (raw.includes('_')) return `${raw}_ref`;
  return `${raw}Ref`;
}

function sanitizeObjectSecrets(obj, ctx, acc) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = Array.isArray(obj) ? [...obj] : { ...obj };
  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === 'object' && val.$keyRef) {
      const name = String(val.$keyRef || '').trim();
      if (name) acc.keys.add(name);
      continue;
    }
    if (typeof val === 'object' && val) {
      out[key] = sanitizeObjectSecrets(val, { ...ctx, field: key }, acc);
      continue;
    }
    if (typeof val === 'string' && looksLikeSecretLiteral(val) && isSecretFieldName(key)) {
      const bind = suggestedBindKeyName({
        provider: ctx.provider,
        field: key,
        hint: ctx.label,
      });
      out[key] = '';
      const refName = refFieldName(key);
      if (out[refName] == null || out[refName] === '') out[refName] = bind;
      acc.keys.add(String(out[refName] || bind));
      acc.stripped.push({ field: key, nodeId: ctx.nodeId, bind: out[refName] || bind });
    }
  }
  return out;
}

function sanitizeHttpHeadersJson(raw, ctx, acc) {
  const text = String(raw || '').trim();
  if (!text || text === '{}') return raw;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (looksLikeSecretLiteral(text)) {
      acc.stripped.push({ field: 'httpHeadersJson', nodeId: ctx.nodeId, bind: PLATFORM_BYOK_KEY_NAME });
      acc.keys.add(PLATFORM_BYOK_KEY_NAME);
      return '{}';
    }
    return raw;
  }
  if (!parsed || typeof parsed !== 'object') return raw;
  let changed = false;
  const next = { ...parsed };
  for (const [k, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && v.$keyRef) {
      acc.keys.add(String(v.$keyRef));
      continue;
    }
    if (typeof v === 'string' && looksLikeSecretLiteral(v)) {
      const bind = suggestedBindKeyName({ field: k, hint: ctx.label });
      next[k] = { $keyRef: bind };
      acc.keys.add(bind);
      acc.stripped.push({ field: `httpHeadersJson.${k}`, nodeId: ctx.nodeId, bind });
      changed = true;
    }
  }
  return changed ? JSON.stringify(next) : raw;
}

function collectRefFromValue(val, acc) {
  if (!val) return;
  if (typeof val === 'string') {
    const s = val.trim();
    if (s) acc.keys.add(s);
    return;
  }
  if (typeof val === 'object' && val.$keyRef) acc.keys.add(String(val.$keyRef));
}

export function sanitizeWorkflowNodeSecrets(node) {
  if (!node || typeof node !== 'object') {
    return { node, stripped: [], keys: [] };
  }
  const acc = { stripped: [], keys: new Set() };
  const data = node.data && typeof node.data === 'object' ? { ...node.data } : {};
  const cfg = data.taskConfig && typeof data.taskConfig === 'object' ? { ...data.taskConfig } : {};
  const provider = String(cfg.modelSource || cfg.provider || '').toLowerCase();
  const ctx = { nodeId: node.id, label: data.label || node.id, provider };

  const nextCfg = sanitizeObjectSecrets(cfg, ctx, acc);
  if (nextCfg.httpHeadersJson) {
    nextCfg.httpHeadersJson = sanitizeHttpHeadersJson(nextCfg.httpHeadersJson, ctx, acc);
  }
  if (looksLikeSecretLiteral(nextCfg.apiKey || nextCfg.api_key)) {
    const bind = nextCfg.apiKeyRef || nextCfg.api_key_ref || bindKeyForProvider(provider);
    nextCfg.apiKey = '';
    nextCfg.api_key = '';
    nextCfg.apiKeyRef = bind;
    acc.keys.add(bind);
    acc.stripped.push({ field: 'apiKey', nodeId: node.id, bind });
  }
  collectRefFromValue(nextCfg.apiKeyRef || nextCfg.api_key_ref, acc);
  collectRefFromValue(nextCfg.bearerTokenRef || nextCfg.authBearerRef, acc);
  collectRefFromValue(nextCfg.apiKeyValueRef, acc);
  collectRefFromValue(nextCfg.smtpPassRef, acc);
  collectRefFromValue(nextCfg.passwordRef || nextCfg.privateKeyRef, acc);

  data.taskConfig = nextCfg;
  if (Array.isArray(data.inputBindings)) {
    data.inputBindings = data.inputBindings.map((b) => {
      if (!b || typeof b !== 'object') return b;
      const copy = { ...b };
      if (typeof copy.value === 'string' && looksLikeSecretLiteral(copy.value)) {
        const bind = suggestedBindKeyName({ field: copy.id || copy.label, hint: data.label });
        copy.value = `{{var.${bind}}}`;
        acc.stripped.push({ field: `input.${copy.id || 'value'}`, nodeId: node.id, bind });
        acc.keys.add(bind);
      }
      return copy;
    });
  }

  const next = { ...node, data };
  return { node: next, stripped: acc.stripped, keys: [...acc.keys] };
}

export function sanitizeWorkflowGraphSecrets(graph) {
  const raw = graph && typeof graph === 'object' ? graph : { nodes: [], edges: [] };
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const stripped = [];
  const keys = new Set();
  const nextNodes = nodes.map((n) => {
    const out = sanitizeWorkflowNodeSecrets(n);
    stripped.push(...out.stripped);
    out.keys.forEach((k) => keys.add(k));
    return out.node;
  });
  return {
    graph: { ...raw, nodes: nextNodes },
    stripped,
    keys: [...keys].filter(Boolean),
  };
}

export function collectRequiredVaultKeys(graph) {
  return sanitizeWorkflowGraphSecrets(graph).keys;
}

export function graphUsesOllama(graph) {
  const nodes = graph?.nodes || [];
  return nodes.some((n) => {
    if (n.type !== 'brain') return false;
    const src = String(n.data?.taskConfig?.modelSource || 'ollama').toLowerCase();
    return src === 'ollama';
  });
}

export function formatVaultKeysSummary(keys, { ollamaUsed = false, strippedCount = 0 } = {}) {
  const names = [...new Set((keys || []).map((k) => String(k || '').trim()).filter(Boolean))];
  const lines = [];
  if (ollamaUsed) {
    lines.push(
      '**AI model:** free local Ollama (no API key). If a step still names a paid provider, store the bind name below instead of pasting the secret into the workflow.'
    );
  }
  if (!names.length) {
    if (strippedCount) {
      lines.push(
        '**API Keys:** a pasted secret was removed from the workflow. Add it under **Settings → API Keys** and the step will pick it up by name.'
      );
    } else if (!ollamaUsed) {
      lines.push('**API Keys:** none required for this workflow.');
    }
    return lines.join('\n');
  }
  lines.push('**Store these in Settings → API Keys (BYOK)** — do not paste secrets into the workflow chat or node fields:');
  for (const name of names) {
    lines.push(`- \`${name}\``);
  }
  return lines.join('\n');
}

export async function probeOllamaAvailable({ timeoutMs = 900, force = false } = {}) {
  const now = Date.now();
  if (!force && ollamaProbe.probed && now - ollamaProbe.ts < 30_000) {
    return ollamaProbe.ok;
  }
  const url = ollamaTagsUrl();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    let models = [];
    let model = '';
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      models = (Array.isArray(body?.models) ? body.models : [])
        .map((m) => String(m?.name || m?.model || '').trim())
        .filter(Boolean);
      model = pickOllamaChatModel(models, process.env.OLLAMA_MODEL || 'llama3.2');
    }
    ollamaProbe = {
      ts: now,
      ok: res.ok,
      probed: true,
      error: res.ok ? '' : `HTTP ${res.status}`,
      models,
      model,
    };
  } catch (e) {
    ollamaProbe = {
      ts: now,
      ok: false,
      probed: true,
      error: e.message || 'unreachable',
      models: [],
      model: '',
    };
  }
  return ollamaProbe.ok;
}

export function lastOllamaAvailable() {
  return !!ollamaProbe.ok;
}

export function ollamaAvailabilitySnapshot() {
  return { ...ollamaProbe, url: ollamaTagsUrl() };
}

export function extractPastedSecrets(message) {
  const text = String(message || '');
  const found = [];
  const re =
    /\b(sk-[A-Za-z0-9_-]{12,}|sk-or-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
  let m;
  while ((m = re.exec(text))) {
    found.push(m[1]);
  }
  return found;
}
