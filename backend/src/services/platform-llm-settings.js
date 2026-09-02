/**
 * Platform-wide LLM endpoint preference (admin-controlled).
 * When active=secondary, platform_decided users and OpenClaw defaults use OPENAI_SECONDARY_* / Ollama.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getDb } from '../db/schema.js';
import { getOpenClawConfigPath, getOpenClawDir } from '../config/openclaw-paths.js';
import { readOpenClawConfigSafe, writeOpenClawConfigSafe } from './openclaw-config-safe.js';

export function ensurePlatformSettingsTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

export function getPlatformSetting(key, fallback = null) {
  ensurePlatformSettingsTable();
  const row = getDb().prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row?.value != null ? String(row.value) : fallback;
}

export function setPlatformSetting(key, value) {
  ensurePlatformSettingsTable();
  getDb()
    .prepare(
      `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .run(String(key), String(value));
}

/** @returns {'primary'|'secondary'} */
export function getPlatformLlmActiveEndpoint() {
  const v = String(getPlatformSetting('llm_active_endpoint', 'primary') || 'primary')
    .trim()
    .toLowerCase();
  return v === 'secondary' ? 'secondary' : 'primary';
}

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/$/, '');
}

function isLocalOllama(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === 'ollama'
    );
  } catch {
    return false;
  }
}

/** Human-readable provider family from base URL (for Admin UI — not hardcoded OpenAI/Ollama). */
export function describeLlmEndpoint(ep) {
  if (!ep?.baseUrl && !ep?.model) return { provider: 'unconfigured', label: 'not configured' };
  let host = '';
  try {
    host = new URL(ep.baseUrl).hostname.toLowerCase();
  } catch {
    host = String(ep.baseUrl || '');
  }
  let provider = 'custom';
  if (isLocalOllama(ep.baseUrl) || host === 'ollama') provider = 'Ollama';
  else if (host.includes('openai.com')) provider = 'OpenAI';
  else if (host.includes('openrouter')) provider = 'OpenRouter';
  else if (host.includes('deepseek')) provider = 'DeepSeek';
  else if (host.includes('anthropic')) provider = 'Anthropic';
  else if (host) provider = host;
  const model = String(ep.model || '').trim() || '—';
  return {
    provider,
    model,
    label: `${provider} · ${model}`,
    baseUrl: ep.baseUrl || '',
  };
}

/**
 * Env-defined primary + secondary endpoints (no BYOK).
 * Secondary is ONLY from OPENAI_SECONDARY_* — never auto-inferred from OLLAMA_BASE_URL
 * (that was causing Admin to show Ollama when .env secondary was gpt-4o / DeepSeek).
 * To use Ollama as secondary, set:
 *   OPENAI_SECONDARY_BASE_URL=http://ollama:11434/v1
 *   OPENAI_SECONDARY_API_KEY=ollama
 *   OPENAI_SECONDARY_MODEL=llama3.2
 */
export function getEnvLlmEndpoints() {
  const defaultBase = 'https://api.openai.com/v1';
  const primaryBase =
    normalizeBaseUrl(
      process.env.OPENAI_BASE_URL ||
        process.env.OPENAI_API_URL ||
        process.env.OPENAI_PRIMARY_BASE_URL ||
        defaultBase
    ) || defaultBase;
  let primaryKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const primaryModel =
    (process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini').trim() ||
    'gpt-4o-mini';
  if (!primaryKey && isLocalOllama(primaryBase)) primaryKey = 'ollama';

  const secondaryBase = normalizeBaseUrl(process.env.OPENAI_SECONDARY_BASE_URL || '');
  let secondaryKey = (process.env.OPENAI_SECONDARY_API_KEY || '').trim();
  const secondaryModel = (process.env.OPENAI_SECONDARY_MODEL || '').trim();
  if (!secondaryKey && secondaryBase && isLocalOllama(secondaryBase)) {
    secondaryKey = (process.env.OLLAMA_API_KEY || '').trim() || 'ollama';
  }

  const primary = { baseUrl: primaryBase, apiKey: primaryKey, model: primaryModel, source: 'env_primary' };
  const secondary =
    secondaryBase && secondaryModel
      ? {
          baseUrl: secondaryBase,
          apiKey: secondaryKey || (isLocalOllama(secondaryBase) ? 'ollama' : ''),
          model: secondaryModel,
          source: 'env_secondary',
        }
      : null;

  return { primary, secondary };
}

/**
 * Effective platform endpoint after admin primary/secondary switch.
 * secondary active → swap so "primary" slot is the secondary env endpoint.
 */
export function getEffectivePlatformLlmEndpoints() {
  const { primary, secondary } = getEnvLlmEndpoints();
  const forceLocal =
    process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true';
  const active = forceLocal ? 'primary' : getPlatformLlmActiveEndpoint();
  if (active === 'secondary' && secondary) {
    return {
      primary: { ...secondary, source: 'env_secondary_active' },
      secondary: { ...primary, source: 'env_primary_as_fallback' },
      active,
    };
  }
  return { primary, secondary, active: 'primary' };
}

/** True when platform + OpenClaw primary is self-hosted Ollama (CPU box must not block UI on LLM titles). */
export function isPlatformLocalOllama() {
  return (
    process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true' ||
    String(process.env.OPENCLAW_MODEL_PRIMARY || '').toLowerCase().startsWith('ollama/')
  );
}

function readOpenClawConfig() {
  const c = readOpenClawConfigSafe();
  if (!c.agents) c.agents = { defaults: { model: {} } };
  if (!c.agents.defaults) c.agents.defaults = { model: {} };
  if (!c.models) c.models = { providers: {} };
  return c;
}

function writeOpenClawConfig(config) {
  writeOpenClawConfigSafe(config);
}

function openClawSlugForEndpoint(ep) {
  if (!ep?.baseUrl) return null;
  const model = String(ep.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
  if (isLocalOllama(ep.baseUrl)) return `ollama/${model}`;
  try {
    const host = new URL(ep.baseUrl).hostname.toLowerCase();
    if (host === 'litellm' || host.includes('litellm')) return `litellm/${model}`;
    if (host.includes('openrouter')) return `openrouter/${model.includes('/') ? model : `openai/${model}`}`;
    if (host.includes('deepseek')) return `deepseek/${model}`;
  } catch {
    /* ignore */
  }
  return `openai/${model}`;
}

function providerPrefixForSlug(slug) {
  const s = String(slug || '');
  const i = s.indexOf('/');
  return i > 0 ? s.slice(0, i) : s;
}

function isOfficialOpenAiBase(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

/**
 * Align the effective platform endpoint with a dedicated OpenClaw provider.
 * Official OpenAI uses openai/* and DeepSeek uses deepseek/* so both can be
 * configured concurrently and participate in real gateway failover.
 */
function applyPlatformOpenAiProvider(config, ep) {
  if (!ep?.baseUrl || !ep?.apiKey) return null;
  if (isLocalOllama(ep.baseUrl)) return null;
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const modelId = String(ep.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
  const base = normalizeBaseUrl(ep.baseUrl);
  let endpointHost = '';
  try { endpointHost = new URL(base).hostname.toLowerCase(); } catch { /* ignore */ }
  if (endpointHost === 'litellm' || endpointHost.includes('litellm')) {
    config.models.providers.litellm = {
      baseUrl: base.endsWith('/v1') ? base : `${base}/v1`,
      apiKey: ep.apiKey,
      api: 'openai-completions',
      models: [{
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
        api: 'openai-completions',
      }],
    };
    return { mode: 'litellm', modelId, baseUrl: config.models.providers.litellm.baseUrl };
  }
  const providerKey = isOfficialOpenAiBase(base) ? 'openai' : 'deepseek';
  const existing = config.models.providers[providerKey] || {};

  if (isOfficialOpenAiBase(base)) {
    const catalogIds = [modelId, 'gpt-4o-mini', 'gpt-4o'].filter(
      (id, i, arr) => id && arr.indexOf(id) === i
    );
    let models = Array.isArray(existing.models) ? existing.models.slice() : [];
    const ids = new Set(models.map((m) => (typeof m === 'string' ? m : m?.id)).filter(Boolean));
    for (const id of catalogIds) {
      if (ids.has(id)) continue;
      models.push({
        id,
        name: id,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      });
      ids.add(id);
    }
    // Drop DeepSeek-only catalog entries when pointing at official OpenAI.
    models = models.filter((m) => {
      const id = typeof m === 'string' ? m : m?.id;
      return id && !String(id).toLowerCase().includes('deepseek');
    });
    config.models.providers.openai = {
      ...existing,
      apiKey: ep.apiKey,
      api: 'openai-responses',
      // Explicit official baseUrl — if omitted, OpenClaw may fall back to container
      // OPENAI_BASE_URL (often DeepSeek primary) and gpt-4o-mini calls fail/404.
      baseUrl: 'https://api.openai.com/v1',
      models: models.map((m) =>
        typeof m === 'string' ? m : { ...m, api: m.api || 'openai-responses' }
      ),
    };
    return { mode: 'official', modelId, baseUrl: 'https://api.openai.com/v1' };
  }

  const openaiBase = base.endsWith('/v1') ? base : `${base}/v1`;
  const catalogIds = [modelId, 'deepseek-v4-flash', 'deepseek-v4-pro'].filter(
    (id, i, arr) => id && arr.indexOf(id) === i
  );
  config.models.providers.deepseek = {
    baseUrl: openaiBase,
    apiKey: ep.apiKey,
    api: 'openai-completions',
    models: catalogIds.map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 65536,
      api: 'openai-completions',
    })),
  };
  return { mode: 'compat', modelId, baseUrl: openaiBase };
}

/**
 * OpenClaw gateway prefers env OPENAI_API_KEY over providers.openai.apiKey.
 * Always write the *effective* endpoint (after Admin primary/secondary flip) so
 * entrypoint can source DeepSeek or OpenAI keys. Marker mtime change triggers gateway reload.
 */
function writePlatformLlmRuntimeEnv(ep) {
  try {
    const dir = getOpenClawDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = `${dir.replace(/\/$/, '')}/platform-llm-runtime.env`;
    if (!ep?.apiKey) {
      // Clear stale secondary OpenAI key so primary DeepSeek is not shadowed
      try {
        if (existsSync(path)) writeFileSync(path, '# cleared — no effective API key\n', 'utf8');
      } catch {
        /* ignore */
      }
      return;
    }
    if (isLocalOllama(ep.baseUrl)) {
      const base = normalizeBaseUrl(ep.baseUrl || 'http://ollama:11434/v1');
      writeFileSync(
        path,
        `OPENAI_API_KEY=${ep.apiKey || 'ollama'}\nOPENAI_BASE_URL=${base}\n`,
        'utf8'
      );
      return;
    }
    const base = normalizeBaseUrl(ep.baseUrl || 'https://api.openai.com/v1');
    writeFileSync(path, `OPENAI_API_KEY=${ep.apiKey}\nOPENAI_BASE_URL=${base}\n`, 'utf8');
  } catch {
    /* non-fatal */
  }
}

/**
 * Touch marker after runtime.env so entrypoint watcher always sees an order:
 * runtime.env written first, then marker mtime bump → reload sources fresh env.
 */
function writePlatformLlmActiveMarker(payload) {
  try {
    const dir = getOpenClawDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const markerPath = `${dir.replace(/\/$/, '')}/platform-llm-active.json`;
    writeFileSync(
      markerPath,
      JSON.stringify({ ...payload, updated_at: new Date().toISOString() }, null, 2),
      'utf8'
    );
  } catch {
    /* non-fatal */
  }
}

/**
 * Mirror admin platform endpoint choice into OpenClaw defaults (for platform_decided CEOs).
 * Does not touch per-CEO byok-* providers.
 */
export function syncPlatformEndpointToOpenClaw() {
  const effective = getEffectivePlatformLlmEndpoints();
  let { primary, secondary, active } = effective;
  const routingEnabled =
    (process.env.MODEL_ROUTING_ENABLED === '1' || process.env.MODEL_ROUTING_ENABLED === 'true') &&
    !!String(process.env.LITELLM_MASTER_KEY || '').trim();
  if (routingEnabled) {
    primary = {
      baseUrl: process.env.LITELLM_BASE_URL || 'http://litellm:4000/v1',
      apiKey: process.env.LITELLM_MASTER_KEY,
      model: active === 'secondary' ? 'flolah-platform-secondary' : 'flolah-platform-primary',
      source: 'model_registry',
    };
    // LiteLLM owns provider failover; avoid a second transport retry loop in OpenClaw.
    secondary = null;
  }
  const config = readOpenClawConfig();
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};
  if (!config.agents.defaults.model) config.agents.defaults.model = {};

  const primarySlug = openClawSlugForEndpoint(primary);
  if (primarySlug) config.agents.defaults.model.primary = primarySlug;

  const primaryPrefix = providerPrefixForSlug(primarySlug);
  const fallbacks = [];
  if (secondary) {
    const secSlug = openClawSlugForEndpoint(secondary);
    // Skip inactive endpoint when it shares the openai/* provider prefix —
    // one models.providers.openai block cannot serve DeepSeek and OpenAI at once.
    if (
      secSlug &&
      secSlug !== primarySlug &&
      providerPrefixForSlug(secSlug) !== primaryPrefix
    ) {
      fallbacks.push(secSlug);
    }
  }
  // Honor OPENCLAW_MODEL_FALLBACKS when set; strip ollama/* unless explicitly enabled
  const enableOllama =
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === '1' ||
    process.env.OPENCLAW_ENABLE_OLLAMA_FALLBACK === 'true';
  const extra = String(process.env.OPENCLAW_MODEL_FALLBACKS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const slug of extra) {
    if (!fallbacks.includes(slug) && slug !== primarySlug) {
      if (!enableOllama && String(slug).toLowerCase().startsWith('ollama/')) continue;
      // Prefer not to add openai/* fallbacks that conflict with active openai provider shape
      if (providerPrefixForSlug(slug) === 'openai' && primaryPrefix === 'openai') continue;
      fallbacks.push(slug);
    }
  }
  if (enableOllama) {
    const ollamaModel = (process.env.OPENCLAW_OLLAMA_FALLBACK_MODEL || process.env.OLLAMA_MODEL || 'llama3.2').trim();
    const ollamaSlug = `ollama/${ollamaModel}`;
    if (!fallbacks.includes(ollamaSlug) && ollamaSlug !== primarySlug) fallbacks.push(ollamaSlug);
  } else {
    for (let i = fallbacks.length - 1; i >= 0; i--) {
      if (String(fallbacks[i]).toLowerCase().startsWith('ollama/')) fallbacks.splice(i, 1);
    }
  }
  config.agents.defaults.model.fallbacks = fallbacks;

  const providerSync = applyPlatformOpenAiProvider(config, primary);
  // Materialize a different-provider secondary as its own OpenClaw provider
  // so primary quota/outage failover is executable rather than just metadata.
  if (
    secondary &&
    providerPrefixForSlug(openClawSlugForEndpoint(secondary)) !== primaryPrefix
  ) {
    applyPlatformOpenAiProvider(config, secondary);
  }
  writePlatformLlmRuntimeEnv(primary);

  // Ensure ollama provider exists when platform primary is local Ollama
  const localOllamaPrimary =
    isLocalOllama(primary.baseUrl) ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === '1' ||
    process.env.PLATFORM_USE_LOCAL_OLLAMA === 'true' ||
    String(process.env.OPENCLAW_MODEL_PRIMARY || '').toLowerCase().startsWith('ollama/');
  if (localOllamaPrimary) {
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    const modelId = String(primary.model || process.env.OLLAMA_MODEL || 'llama3.2').replace(/^[^/]+\//, '');
    const inferCtx = Math.max(8192, Number(process.env.OLLAMA_NUM_CTX || 32768) || 32768);
    const timeoutSec = Math.max(60, Math.ceil((Number(process.env.OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS || 300000) || 300000) / 1000));
    const ollamaBase = String(primary.baseUrl || process.env.OLLAMA_BASE_URL || 'http://ollama:11434')
      .replace(/\/$/, '')
      .replace(/\/v1$/i, '');
    config.models.providers.ollama = {
      ...(config.models.providers.ollama || {}),
      baseUrl: ollamaBase,
      apiKey: primary.apiKey || process.env.OLLAMA_API_KEY || 'ollama-local',
      api: 'ollama',
      timeoutSeconds: timeoutSec,
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: Math.max(
            65536,
            Number(process.env.OLLAMA_CONTEXT_WINDOW || 65536) || 65536
          ),
          maxTokens: Math.max(1024, Number(process.env.OLLAMA_MAX_TOKENS || 4096) || 4096),
          api: 'ollama',
          params: {
            num_ctx: inferCtx,
            thinking: false,
            keep_alive: '30m',
          },
        },
      ],
    };
  }

  writeOpenClawConfig(config);
  writePlatformLlmActiveMarker({
    active,
    primary: primarySlug,
    provider: providerSync,
    fallbacks,
  });
  return {
    ok: true,
    active,
    routing_enabled: routingEnabled,
    primary: primarySlug,
    fallbacks,
    provider: providerSync,
  };
}

/**
 * Admin: set platform LLM to primary or secondary and sync OpenClaw defaults.
 * @param {'primary'|'secondary'} endpoint
 */
export function setPlatformLlmActiveEndpoint(endpoint) {
  const which = String(endpoint || '').trim().toLowerCase() === 'secondary' ? 'secondary' : 'primary';
  if (which === 'secondary') {
    const { secondary } = getEnvLlmEndpoints();
    if (!secondary?.baseUrl) {
      throw Object.assign(new Error('Secondary LLM endpoint is not configured (OPENAI_SECONDARY_* or OLLAMA_BASE_URL)'), {
        status: 400,
      });
    }
  }
  setPlatformSetting('llm_active_endpoint', which);
  const sync = syncPlatformEndpointToOpenClaw();
  return {
    llm_active_endpoint: which,
    openclaw: sync,
    endpoints: getEffectivePlatformLlmEndpoints(),
  };
}

export function getPlatformLlmStatusPublic() {
  const env = getEnvLlmEndpoints();
  const effective = getEffectivePlatformLlmEndpoints();
  const primaryMeta = describeLlmEndpoint(env.primary);
  const secondaryMeta = env.secondary ? describeLlmEndpoint(env.secondary) : null;
  const effectiveMeta = describeLlmEndpoint(effective.primary);
  return {
    llm_active_endpoint: effective.active,
    primary: {
      baseUrl: env.primary.baseUrl,
      model: env.primary.model,
      configured: !!(env.primary.apiKey || isLocalOllama(env.primary.baseUrl)),
      provider: primaryMeta.provider,
      label: primaryMeta.label,
    },
    secondary: env.secondary
      ? {
          baseUrl: env.secondary.baseUrl,
          model: env.secondary.model,
          configured: !!(env.secondary.apiKey || isLocalOllama(env.secondary.baseUrl)),
          provider: secondaryMeta.provider,
          label: secondaryMeta.label,
        }
      : null,
    effective_primary: {
      baseUrl: effective.primary.baseUrl,
      model: effective.primary.model,
      source: effective.primary.source,
      provider: effectiveMeta.provider,
      label: effectiveMeta.label,
    },
  };
}
