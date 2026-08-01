/**
 * Internal LLM provider catalog: endpoints + curated chat models for Profile/Register.
 * CEOs pick provider + model; they do not paste base URLs.
 */

export const LLM_CATALOG_PROVIDERS = Object.freeze([
  'platform_decided',
  'openai',
  'openrouter',
  'anthropic',
  'deepseek_cloud',
  'ollama_free',
  'deepseek',
]);

/** Endpoint + auth shape for OpenClaw / chat completions (openai-completions compatible where noted). */
export const LLM_PROVIDER_ENDPOINTS = Object.freeze({
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions',
    needsVaultKey: true,
    vaultKeyName: 'Platform_BYOK',
    profileEnabled: true,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    api: 'openai-completions',
    needsVaultKey: true,
    vaultKeyName: 'Platform_BYOK',
    profileEnabled: true,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    // OpenAI-compatible proxy path is not used; OpenClaw anthropic provider uses this host.
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    needsVaultKey: true,
    vaultKeyName: 'Platform_BYOK',
    // Not wired in Profile yet — catalog reserved for endpoint mapping / future UI.
    profileEnabled: false,
  },
  deepseek_cloud: {
    id: 'deepseek_cloud',
    label: 'DeepSeek (cloud API)',
    baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions',
    needsVaultKey: true,
    vaultKeyName: 'Platform_BYOK',
    profileEnabled: false,
  },
  ollama_free: {
    id: 'ollama_free',
    label: 'Ollama (local)',
    baseUrlEnv: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    api: 'openai-completions',
    needsVaultKey: false,
    profileEnabled: true,
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek V3 (Ollama local)',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    fallbackBaseUrlEnv: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    api: 'openai-completions',
    needsVaultKey: false,
    profileEnabled: true,
  },
  platform_decided: {
    id: 'platform_decided',
    label: 'Platform decided',
    baseUrl: null,
    api: null,
    needsVaultKey: false,
    profileEnabled: true,
  },
});

/**
 * Curated chat models per provider. `id` is what OpenClaw / the API receives.
 * `allowCustom` lets CEOs type a model id not in the list.
 */
export const LLM_PROVIDER_MODELS = Object.freeze({
  openai: {
    allowCustom: true,
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'o4-mini', label: 'o4-mini' },
    ],
  },
  openrouter: {
    allowCustom: true,
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      { id: 'openai/gpt-4o-mini', label: 'OpenAI GPT-4o mini' },
      { id: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
      { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
      { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    ],
  },
  anthropic: {
    allowCustom: true,
    defaultModel: 'claude-sonnet-4-0',
    models: [
      { id: 'claude-sonnet-4-0', label: 'Claude Sonnet 4' },
      { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
  deepseek_cloud: {
    allowCustom: true,
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
  },
  ollama_free: {
    allowCustom: true,
    defaultModel: 'llama3.2',
    models: [
      { id: 'llama3.2', label: 'Llama 3.2' },
      { id: 'llama3.1', label: 'Llama 3.1' },
      { id: 'mistral', label: 'Mistral' },
      { id: 'qwen2.5', label: 'Qwen 2.5' },
    ],
  },
  deepseek: {
    allowCustom: false,
    defaultModel: 'deepseek-v3',
    models: [{ id: 'deepseek-v3', label: 'DeepSeek V3 (local)' }],
  },
  platform_decided: {
    allowCustom: false,
    defaultModel: null,
    models: [],
  },
});

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim().replace(/\/$/, '');
  if (u.endsWith('/chat/completions')) return u.replace(/\/chat\/completions$/, '');
  return u;
}

function withV1(base) {
  const b = normalizeBaseUrl(base);
  if (!b) return '';
  return b.endsWith('/v1') ? b : `${b}/v1`;
}

/**
 * Resolve base URL for a catalog provider (env-aware for local Ollama).
 */
export function resolveProviderBaseUrl(providerId) {
  const id = String(providerId || '').trim();
  const meta = LLM_PROVIDER_ENDPOINTS[id];
  if (!meta) return '';
  if (meta.baseUrl) return normalizeBaseUrl(meta.baseUrl);

  if (id === 'ollama_free') {
    const raw =
      normalizeBaseUrl(process.env.OLLAMA_BASE_URL || '') ||
      normalizeBaseUrl(meta.defaultBaseUrl) ||
      'http://127.0.0.1:11434';
    return withV1(raw);
  }
  if (id === 'deepseek') {
    const raw =
      normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || '') ||
      normalizeBaseUrl(process.env.OLLAMA_BASE_URL || '') ||
      normalizeBaseUrl(meta.defaultBaseUrl) ||
      'http://127.0.0.1:11434';
    return withV1(raw);
  }
  return '';
}

export function getProviderModelCatalog(providerId) {
  const id = String(providerId || '').trim();
  return (
    LLM_PROVIDER_MODELS[id] || {
      allowCustom: false,
      defaultModel: null,
      models: [],
    }
  );
}

/** Providers shown on Profile (excludes reserved/not-yet-wired). */
export function listProfileProviders() {
  return LLM_CATALOG_PROVIDERS.filter((id) => LLM_PROVIDER_ENDPOINTS[id]?.profileEnabled !== false).map(
    (id) => {
      const ep = LLM_PROVIDER_ENDPOINTS[id];
      const models = getProviderModelCatalog(id);
      return {
        id,
        label: ep.label,
        needs_vault_key: !!ep.needsVaultKey,
        vault_key_name: ep.vaultKeyName || null,
        base_url: resolveProviderBaseUrl(id) || ep.baseUrl || null,
        allow_custom_model: !!models.allowCustom,
        default_model: models.defaultModel,
        models: models.models,
      };
    }
  );
}

/**
 * Public catalog for Register + Profile UIs (no secrets).
 */
export function getLlmCatalogPublic() {
  return {
    providers: listProfileProviders(),
    endpoints: Object.fromEntries(
      Object.entries(LLM_PROVIDER_ENDPOINTS).map(([id, ep]) => [
        id,
        {
          id,
          label: ep.label,
          base_url: resolveProviderBaseUrl(id) || ep.baseUrl || null,
          api: ep.api,
          needs_vault_key: !!ep.needsVaultKey,
          profile_enabled: ep.profileEnabled !== false,
        },
      ])
    ),
  };
}

/**
 * Validate / normalize a CEO-chosen model for a provider.
 * @returns {{ ok: true, model: string|null } | { ok: false, error: string }}
 */
export function normalizeLlmModelForProvider(providerId, modelRaw, { required = false } = {}) {
  const provider = String(providerId || '').trim();
  const catalog = getProviderModelCatalog(provider);
  const raw = modelRaw === undefined || modelRaw === null ? '' : String(modelRaw).trim();

  if (provider === 'platform_decided') {
    return { ok: true, model: null };
  }

  if (!raw) {
    if (required && (provider === 'openai' || provider === 'openrouter')) {
      return {
        ok: false,
        error: `Select a chat model for ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'}.`,
      };
    }
    // Soft default for local / legacy rows without llm_model
    return { ok: true, model: catalog.defaultModel || null };
  }

  const known = (catalog.models || []).some((m) => m.id === raw);
  if (known) return { ok: true, model: raw };
  if (catalog.allowCustom) {
    if (raw.length > 120) {
      return { ok: false, error: 'Model id is too long (max 120 characters).' };
    }
    if (!/^[a-zA-Z0-9_./:-]+$/.test(raw)) {
      return { ok: false, error: 'Model id contains invalid characters.' };
    }
    return { ok: true, model: raw };
  }
  return {
    ok: false,
    error: `Model "${raw}" is not valid for provider ${provider}.`,
  };
}
