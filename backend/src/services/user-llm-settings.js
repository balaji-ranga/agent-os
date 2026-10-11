/**
 * Per-user LLM / BYOK settings. User selection takes precedence over platform .env
 * for Agent OS LLM calls and OpenClaw tenant agent model routing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getDb } from '../db/schema.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
import {
  syncByokAuthProfiles,
  ensureAgentByokAuthFromUser,
  scrubOpenClawAuthProfileMetadata,
  clearAgentByokAuthProfile,
  upsertAgentByokAuthProfile,
} from './openclaw-byok-auth.js';
import { readOpenClawConfigSafe, writeOpenClawConfigSafe } from './openclaw-config-safe.js';
import {
  PLATFORM_BYOK_KEY_NAME,
  PLATFORM_BYOK_SECONDARY_KEY_NAME,
  tryResolveUserApiKey,
  getUserApiKeyRow,
  assertPlatformByokPresent,
  resolvePlatformByokSecret,
  ensureByokVaultSlots,
  isUnsetApiKeyRow,
} from './user-api-keys.js';
import {
  resolveProviderBaseUrl,
  normalizeLlmModelForProvider,
  getProviderModelCatalog,
  getLlmCatalogPublic,
} from '../config/llm-provider-registry.js';
import { parseEfficiencyModeFlag } from './llm-efficiency-mode.js';
export { getLlmCatalogPublic } from '../config/llm-provider-registry.js';
export const LLM_PROVIDERS = Object.freeze([
  'platform_decided',
  'openai',
  'openrouter',
  'deepseek_cloud',
  'ollama_free',
  'deepseek',
]);

const OPENAI_BASE = resolveProviderBaseUrl('openai') || 'https://api.openai.com/v1';
const OPENROUTER_BASE = resolveProviderBaseUrl('openrouter') || 'https://openrouter.ai/api/v1';
const DEFAULT_OPENAI_BYOK_MODEL = getProviderModelCatalog('openai').defaultModel || 'gpt-4o-mini';
const DEFAULT_OPENROUTER_BYOK_MODEL =
  getProviderModelCatalog('openrouter').defaultModel || 'openai/gpt-4o-mini';

/** Models that belong on DeepSeek / Ollama — never send these to api.openai.com. */
function isNonOpenAiCloudModel(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return false;
  return (
    /^(deepseek|llama|qwen|mistral|mixtral|phi|gemma|codellama|command-r|ollama)\b/.test(m) ||
    m.includes('deepseek')
  );
}

/**
 * Fallback when CEO has not yet chosen llm_model (legacy rows).
 * Prefer env OpenAI-shaped models — never inherit platform DeepSeek primary.
 */
function resolveOpenAiByokModelFallback() {
  const explicit = (process.env.OPENAI_BYOK_MODEL || '').trim();
  if (explicit && !isNonOpenAiCloudModel(explicit)) return explicit;

  const secondaryModel = (process.env.OPENAI_SECONDARY_MODEL || '').trim();
  const secondaryBase = normalizeBaseUrl(process.env.OPENAI_SECONDARY_BASE_URL || '');
  if (secondaryModel && !isNonOpenAiCloudModel(secondaryModel)) {
    if (!secondaryBase || /openai\.com/i.test(secondaryBase)) return secondaryModel;
  }

  const coo = (process.env.OPENAI_COO_MODEL || '').trim();
  if (coo && !isNonOpenAiCloudModel(coo)) return coo;

  return DEFAULT_OPENAI_BYOK_MODEL;
}

function resolveOpenRouterByokModelFallback() {
  const explicit = (process.env.OPENROUTER_MODEL || process.env.OPENAI_BYOK_MODEL || '').trim();
  if (explicit && !isNonOpenAiCloudModel(explicit)) return explicit;
  return DEFAULT_OPENROUTER_BYOK_MODEL;
}

function pickUserModel(provider, row) {
  const chosen = row?.llm_model != null ? String(row.llm_model).trim() : '';
  if (chosen) {
    const norm = normalizeLlmModelForProvider(provider, chosen, { required: false });
    if (norm.ok && norm.model) {
      if (provider === 'openai' && isNonOpenAiCloudModel(norm.model)) {
        // leftover platform DeepSeek / Ollama id on an OpenAI BYOK profile
      } else {
        return norm.model;
      }
    }
  }
  if (provider === 'openai') return resolveOpenAiByokModelFallback();
  if (provider === 'openrouter') return resolveOpenRouterByokModelFallback();
  if (provider === 'deepseek_cloud') {
    return getProviderModelCatalog('deepseek_cloud').defaultModel || 'deepseek-chat';
  }
  if (provider === 'ollama_free') {
    return (
      (process.env.OLLAMA_MODEL || '').trim() ||
      getProviderModelCatalog('ollama_free').defaultModel ||
      'llama3.2'
    );
  }
  if (provider === 'deepseek') {
    return (process.env.DEEPSEEK_MODEL || '').trim() || getProviderModelCatalog('deepseek').defaultModel || 'deepseek-v3';
  }
  return null;
}

function ollamaOpenAiBaseUrl() {
  return resolveProviderBaseUrl('ollama_free') || 'http://127.0.0.1:11434/v1';
}

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

export function normalizeLlmProvider(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!raw || raw === 'platformdecided' || raw === 'platform_default' || raw === 'default') {
    return 'platform_decided';
  }
  if (raw === 'openai_byok' || raw === 'openai') return 'openai';
  if (raw === 'openrouter_byok' || raw === 'openrouter') return 'openrouter';
  if (raw === 'deepseek_cloud' || raw === 'deepseek_api' || raw === 'deepseek_byok') return 'deepseek_cloud';
  if (raw === 'ollama' || raw === 'ollama_free' || raw === 'ollamafree') return 'ollama_free';
  if (raw === 'deepseek' || raw === 'deepseek_v3' || raw === 'deepseekv3') return 'deepseek';
  if (LLM_PROVIDERS.includes(raw)) return raw;
  throw new Error(
    `llm_provider must be one of: platform_decided, openai, openrouter, deepseek_cloud, ollama_free, deepseek`
  );
}

export function providerNeedsApiKey(provider) {
  const p = normalizeLlmProvider(provider);
  return p === 'openai' || p === 'openrouter' || p === 'deepseek_cloud';
}

export function byokProviderId(userId) {
  return `byok-${sanitizeIdPart(userId)}`;
}

export function secondaryByokProviderId(userId) {
  return `${byokProviderId(userId)}-secondary`;
}

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const u = url.trim().replace(/\/$/, '');
  if (u.endsWith('/chat/completions')) return u.replace(/\/chat\/completions$/, '');
  return u;
}

function isLocalOllama(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return false;
  try {
    const u = new URL(baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function modelFromOpenClawPrimary() {
  const raw = (process.env.OPENCLAW_MODEL_PRIMARY || '').trim();
  if (!raw) return '';
  const slash = raw.indexOf('/');
  return slash >= 0 ? raw.slice(slash + 1).trim() : raw;
}

function envLlmPrimary() {
  const defaultBase = OPENAI_BASE;
  const primaryBase =
    normalizeBaseUrl(
      process.env.OPENAI_BASE_URL ||
        process.env.OPENAI_API_URL ||
        process.env.OPENAI_PRIMARY_BASE_URL ||
        defaultBase
    ) || defaultBase;
  let primaryKey = (process.env.OPENAI_API_KEY || process.env.OPENAI_PRIMARY_API_KEY || '').trim();
  const primaryModel =
    modelFromOpenClawPrimary() ||
    (process.env.OPENAI_PRIMARY_MODEL || process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini').trim() ||
    'gpt-4o-mini';
  if (!primaryKey && isLocalOllama(primaryBase)) primaryKey = 'ollama';
  return { baseUrl: primaryBase, apiKey: primaryKey, model: primaryModel, source: 'env' };
}

/** Read raw BYOK row from platform_users (shared DB). */
export function getUserLlmRow(userId) {
  if (!userId) return null;
  try {
    return (
      getDb()
        .prepare(
          `SELECT id, llm_provider, llm_model, llm_secondary_provider, llm_secondary_model, llm_api_key FROM platform_users WHERE id = ?`
        )
        .get(String(userId).trim()) || null
    );
  } catch {
    // Older DBs may lack llm_model until migration runs
    try {
      return (
        getDb()
          .prepare(`SELECT id, llm_provider, llm_api_key FROM platform_users WHERE id = ?`)
          .get(String(userId).trim()) || null
      );
    } catch {
      return null;
    }
  }
}

/**
 * Public-safe BYOK view — key lives in API Keys vault as Platform_BYOK (never return full key).
 */
export function userLlmPublic(row) {
  if (!row) {
    return {
      llm_provider: 'platform_decided',
      llm_model: null,
      llm_secondary_provider: null,
      llm_secondary_model: null,
      llm_api_key_set: false,
      llm_api_key_hint: null,
      platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
      llm_secondary_api_key_set: false,
      llm_secondary_api_key_hint: null,
      platform_byok_secondary_key_name: PLATFORM_BYOK_SECONDARY_KEY_NAME,
      llm_efficiency_mode: false,
    };
  }
  const provider = normalizeLlmProvider(row.llm_provider || 'platform_decided');
  const vaultRow = row.id ? getUserApiKeyRow(row.id, PLATFORM_BYOK_KEY_NAME) : null;
  const secondaryVaultRow = row.id ? getUserApiKeyRow(row.id, PLATFORM_BYOK_SECONDARY_KEY_NAME) : null;
  const vaultSet = !!(vaultRow && !isUnsetApiKeyRow(vaultRow));
  const modelRaw = row.llm_model != null ? String(row.llm_model).trim() : '';
  return {
    llm_provider: provider,
    llm_model: modelRaw || null,
    llm_secondary_provider: row.llm_secondary_provider || null,
    llm_secondary_model: row.llm_secondary_model || null,
    llm_api_key_set: vaultSet,
    llm_api_key_hint: vaultSet ? vaultRow.key_hint || null : vaultRow ? 'unset' : null,
    platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
    llm_secondary_api_key_set: !!(secondaryVaultRow && !isUnsetApiKeyRow(secondaryVaultRow)),
    llm_secondary_api_key_hint: secondaryVaultRow && !isUnsetApiKeyRow(secondaryVaultRow) ? secondaryVaultRow.key_hint || null : secondaryVaultRow ? 'unset' : null,
    platform_byok_secondary_key_name: PLATFORM_BYOK_SECONDARY_KEY_NAME,
    llm_efficiency_mode: parseEfficiencyModeFlag(row.llm_efficiency_mode),
  };
}

/**
 * Resolve effective LLM endpoint for a user.
 * OpenAI/OpenRouter BYOK keys come from vault Platform_BYOK (not platform_users.llm_api_key).
 */
export function resolveLlmConfigForUser(userId) {
  const envPrimary = envLlmPrimary();
  const secondaryBase = normalizeBaseUrl(process.env.OPENAI_SECONDARY_BASE_URL || '');
  let secondaryKey = (process.env.OPENAI_SECONDARY_API_KEY || '').trim();
  const secondaryModel = (process.env.OPENAI_SECONDARY_MODEL || '').trim();
  if (!secondaryKey && isLocalOllama(secondaryBase)) secondaryKey = 'ollama';
  let secondary = null;
  if (secondaryModel && secondaryBase && secondaryKey) {
    secondary = { baseUrl: secondaryBase, apiKey: secondaryKey, model: secondaryModel };
  } else if (secondaryModel && envPrimary.apiKey) {
    secondary = { baseUrl: envPrimary.baseUrl, apiKey: envPrimary.apiKey, model: secondaryModel };
  }

  const row = userId ? getUserLlmRow(userId) : null;
  const provider = normalizeLlmProvider(row?.llm_provider || 'platform_decided');
  const vault = userId ? tryResolveUserApiKey(userId, PLATFORM_BYOK_KEY_NAME) : null;
  const userKey = vault?.value || '';
  const secondaryVault = userId ? tryResolveUserApiKey(userId, PLATFORM_BYOK_SECONDARY_KEY_NAME) : null;
  const secondaryUserKey = secondaryVault?.value || '';

  const resolveSecondaryByok = (primaryEndpoint) => {
    const secondaryProviderRaw = String(row?.llm_secondary_provider || '').trim();
    const secondaryProvider = secondaryProviderRaw ? normalizeLlmProvider(secondaryProviderRaw) : '';
    if (!secondaryProvider || secondaryProvider === 'platform_decided') {
      return primaryEndpoint ? { ...primaryEndpoint, source: 'user_byok_primary_as_secondary' } : null;
    }
    const secondaryRow = { ...row, llm_model: row?.llm_secondary_model || '' };
    if (secondaryProvider === 'openai' || secondaryProvider === 'openrouter' || secondaryProvider === 'deepseek_cloud') {
      if (!secondaryUserKey) return primaryEndpoint ? { ...primaryEndpoint, source: 'user_byok_primary_as_secondary_missing_key' } : null;
      return {
        baseUrl: resolveProviderBaseUrl(secondaryProvider),
        apiKey: secondaryUserKey,
        model: pickUserModel(secondaryProvider, secondaryRow),
        source: 'user_byok_secondary_vault',
      };
    }
    if (secondaryProvider === 'ollama_free' || secondaryProvider === 'deepseek') {
      return {
        baseUrl: resolveProviderBaseUrl(secondaryProvider) || ollamaOpenAiBaseUrl(),
        apiKey: (process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
        model: pickUserModel(secondaryProvider, secondaryRow),
        source: 'user_byok_secondary_local',
      };
    }
    return primaryEndpoint ? { ...primaryEndpoint, source: 'user_byok_primary_as_secondary' } : null;
  };

  if (provider === 'openai') {
    if (!userKey) {
      return {
        primary: envPrimary,
        secondary,
        provider,
        using_byok: false,
        fallback_reason: 'openai_selected_but_no_platform_byok_key',
      };
    }
    const primary = {
        baseUrl: resolveProviderBaseUrl('openai') || OPENAI_BASE,
        apiKey: userKey,
        model: pickUserModel('openai', row),
        source: 'user_byok_vault',
      };
    return {
      primary,
      secondary: resolveSecondaryByok(primary),
      provider,
      using_byok: true,
    };
  }

  if (provider === 'openrouter') {
    if (!userKey) {
      return {
        primary: envPrimary,
        secondary,
        provider,
        using_byok: false,
        fallback_reason: 'openrouter_selected_but_no_platform_byok_key',
      };
    }
    const primary = {
        baseUrl: resolveProviderBaseUrl('openrouter') || OPENROUTER_BASE,
        apiKey: userKey,
        model: pickUserModel('openrouter', row),
        source: 'user_byok_vault',
      };
    return {
      primary,
      secondary: resolveSecondaryByok(primary),
      provider,
      using_byok: true,
    };
  }

  if (provider === 'deepseek_cloud') {
    if (!userKey) {
      return {
        primary: envPrimary,
        secondary,
        provider,
        using_byok: false,
        fallback_reason: 'deepseek_cloud_selected_but_no_platform_byok_key',
      };
    }
    const primary = {
      baseUrl: resolveProviderBaseUrl('deepseek_cloud'),
      apiKey: userKey,
      model: pickUserModel('deepseek_cloud', row),
      source: 'user_byok_vault',
    };
    return { primary, secondary: resolveSecondaryByok(primary), provider, using_byok: true };
  }

  if (provider === 'ollama_free') {
    const baseUrl = ollamaOpenAiBaseUrl();
    const primary = {
        baseUrl,
        apiKey: (process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
        model: pickUserModel('ollama_free', row),
        source: 'user_ollama',
      };
    return {
      primary,
      secondary: resolveSecondaryByok(primary),
      provider,
      using_byok: true,
    };
  }

  if (provider === 'deepseek') {
    const baseUrl = resolveProviderBaseUrl('deepseek') || ollamaOpenAiBaseUrl();
    const primary = {
        baseUrl,
        apiKey: (process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
        model: pickUserModel('deepseek', row),
        source: 'user_ollama_deepseek',
      };
    return {
      primary,
      secondary: resolveSecondaryByok(primary),
      provider,
      using_byok: true,
    };
  }

  return {
    primary: envPrimary,
    secondary,
    provider: 'platform_decided',
    using_byok: false,
  };
}

function readOpenClawConfig() {
  const c = readOpenClawConfigSafe();
  if (!c.agents) c.agents = { list: [] };
  if (!c.models) c.models = { providers: {} };
  return c;
}

function writeOpenClawConfig(config) {
  writeOpenClawConfigSafe(config);
}

function openClawModelSlug(providerKey, modelId) {
  const m = String(modelId || 'gpt-4o-mini').trim();
  if (m.includes('/')) return m.startsWith(`${providerKey}/`) ? m : `${providerKey}/${m.split('/').pop()}`;
  return `${providerKey}/${m}`;
}

function platformDefaultModelSlug(config) {
  return String(config?.agents?.defaults?.model?.primary || '').trim();
}

function assignByokModelOnEntry(entry, byokSlug, config, secondarySlug = '') {
  if (secondarySlug && secondarySlug !== byokSlug) {
    entry.model = { primary: byokSlug, fallbacks: [secondarySlug] };
  } else {
    entry.model = { primary: byokSlug };
  }
  return entry;
}

/**
 * Sync CEO BYOK into OpenClaw: models.providers[byok-{ceo}] + tenant model.primary
 * + per-agent auth profiles (SQLite). platform_decided clears overrides.
 */
export function syncUserLlmToOpenClaw(ceoUserId) {
  const id = String(ceoUserId || '').trim();
  if (!id) return { ok: false, reason: 'missing_user' };

  const resolved = resolveLlmConfigForUser(id);
  const config = readOpenClawConfig();
  if (!config.models) config.models = {};
  if (!config.models.providers || typeof config.models.providers !== 'object') {
    config.models.providers = {};
  }
  if (!Array.isArray(config.agents?.list)) config.agents = { list: [] };

  const providerKey = byokProviderId(id);
  const secondaryProviderKey = secondaryByokProviderId(id);
  const tenantPrefix = `t-${sanitizeIdPart(id)}--`;

  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    delete config.models.providers[providerKey];
    delete config.models.providers[secondaryProviderKey];
    for (const entry of config.agents.list) {
      if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
      if (entry.model) delete entry.model;
    }
    const authSync = syncByokAuthProfiles(id, { config, clear: true });
    scrubOpenClawAuthProfileMetadata(config, secondaryProviderKey);
    writeOpenClawConfig(config);
    return { ok: true, cleared: true, provider: 'platform_decided', auth: authSync };
  }

  const primary = resolved.primary;
  const modelId = String(primary.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
  const isLocalOllamaByok =
    resolved.provider === 'ollama_free' ||
    resolved.provider === 'deepseek' ||
    /ollama|127\.0\.0\.1|localhost/i.test(String(primary.baseUrl || ''));
  const ollamaCtx = Math.max(
    8192,
    Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 65536) || 65536
  );
  const ollamaMaxTok = Math.max(
    1024,
    Number(process.env.OLLAMA_MAX_TOKENS || process.env.OPENCLAW_OLLAMA_MAX_TOKENS || 4096) || 4096
  );
  config.models.providers[providerKey] = {
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    api: 'openai-completions',
    // OpenClaw 2026+ requires models[].name (non-empty string)
    models: [
      isLocalOllamaByok
        ? {
            id: modelId,
            name: modelId,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: ollamaCtx,
            maxTokens: ollamaMaxTok,
          }
        : { id: modelId, name: modelId },
    ],
  };

  const secondary = resolved.secondary;
  const distinctSecondary = !!(
    secondary &&
    (secondary.baseUrl !== primary.baseUrl || secondary.apiKey !== primary.apiKey || secondary.model !== primary.model)
  );
  if (distinctSecondary) {
    const secondaryModelId = String(secondary.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
    config.models.providers[secondaryProviderKey] = {
      baseUrl: secondary.baseUrl,
      apiKey: secondary.apiKey,
      api: 'openai-completions',
      models: [{ id: secondaryModelId, name: secondaryModelId }],
    };
  } else {
    delete config.models.providers[secondaryProviderKey];
    scrubOpenClawAuthProfileMetadata(config, secondaryProviderKey);
  }

  const modelSlug = openClawModelSlug(providerKey, primary.model);
  const secondaryModelSlug = distinctSecondary
    ? openClawModelSlug(secondaryProviderKey, secondary.model)
    : '';
  for (const entry of config.agents.list) {
    if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
    assignByokModelOnEntry(entry, modelSlug, config, secondaryModelSlug);
  }

  const authSync = syncByokAuthProfiles(id, {
    config,
    apiKey: primary.apiKey,
    clear: false,
  });
  if (distinctSecondary) {
    config.auth.profiles[`${secondaryProviderKey}:manual`] = { provider: secondaryProviderKey, mode: 'api_key' };
    for (const entry of config.agents.list) {
      if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
      upsertAgentByokAuthProfile(entry.id, secondaryProviderKey, secondary.apiKey);
    }
  }
  writeOpenClawConfig(config);
  return {
    ok: true,
    cleared: false,
    provider: resolved.provider,
    providerKey,
    model: modelSlug,
    secondaryModel: secondaryModelSlug || null,
    auth: authSync,
  };
}

/** Apply BYOK model override onto a single OpenClaw agent list entry (in-memory). */
export function applyByokModelToAgentEntry(entry, ceoUserId) {
  if (!entry || !ceoUserId) return entry;
  const resolved = resolveLlmConfigForUser(ceoUserId);
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    if (entry.model) delete entry.model;
    return entry;
  }
  const providerKey = byokProviderId(ceoUserId);
  const secondaryProviderKey = secondaryByokProviderId(ceoUserId);
  const config = readOpenClawConfig();
  const distinctSecondary = resolved.secondary &&
    (resolved.secondary.baseUrl !== resolved.primary.baseUrl || resolved.secondary.apiKey !== resolved.primary.apiKey || resolved.secondary.model !== resolved.primary.model);
  return assignByokModelOnEntry(
    entry,
    openClawModelSlug(providerKey, resolved.primary.model),
    config,
    distinctSecondary ? openClawModelSlug(secondaryProviderKey, resolved.secondary.model) : ''
  );
}

/**
 * After a tenant agent is provisioned, write its OpenClaw auth profile for CEO BYOK.
 * Safe no-op when platform_decided.
 */
export function applyByokAuthToProvisionedAgent(openclawAgentId, ceoUserId) {
  const resolved = resolveLlmConfigForUser(ceoUserId);
  const providerKey = byokProviderId(ceoUserId);
  const secondaryProviderKey = secondaryByokProviderId(ceoUserId);
  const config = readOpenClawConfig();

  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    scrubOpenClawAuthProfileMetadata(config, providerKey);
    writeOpenClawConfig(config);
    clearAgentByokAuthProfile(openclawAgentId, providerKey);
    clearAgentByokAuthProfile(openclawAgentId, secondaryProviderKey);
    return { ok: true, skipped: true, cleared: true };
  }

  if (!config.auth) config.auth = {};
  if (!config.auth.profiles) config.auth.profiles = {};
  scrubOpenClawAuthProfileMetadata(config, providerKey);
  const profileId = `${providerKey}:manual`;
  config.auth.profiles[profileId] = { provider: providerKey, mode: 'api_key' };
  writeOpenClawConfig(config);
  const primaryResult = ensureAgentByokAuthFromUser(openclawAgentId, ceoUserId, resolved.primary.apiKey);
  const distinctSecondary = resolved.secondary &&
    (resolved.secondary.baseUrl !== resolved.primary.baseUrl || resolved.secondary.apiKey !== resolved.primary.apiKey || resolved.secondary.model !== resolved.primary.model);
  if (distinctSecondary) {
    config.auth.profiles[`${secondaryProviderKey}:manual`] = { provider: secondaryProviderKey, mode: 'api_key' };
    writeOpenClawConfig(config);
    upsertAgentByokAuthProfile(openclawAgentId, secondaryProviderKey, resolved.secondary.apiKey);
  }
  return primaryResult;
}

/** Ensure provider block exists when provisioning a tenant agent. */
export function ensureByokProviderInConfig(config, ceoUserId) {
  const resolved = resolveLlmConfigForUser(ceoUserId);
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const providerKey = byokProviderId(ceoUserId);
  const secondaryProviderKey = secondaryByokProviderId(ceoUserId);
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    delete config.models.providers[providerKey];
    delete config.models.providers[secondaryProviderKey];
    scrubOpenClawAuthProfileMetadata(config, providerKey);
    return config;
  }
  const primary = resolved.primary;
  const modelId = String(primary.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
  config.models.providers[providerKey] = {
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    api: 'openai-completions',
    models: [{ id: modelId, name: modelId }],
  };
  const secondary = resolved.secondary;
  if (secondary && (secondary.baseUrl !== primary.baseUrl || secondary.apiKey !== primary.apiKey || secondary.model !== primary.model)) {
    const secondaryModelId = String(secondary.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
    config.models.providers[secondaryProviderKey] = {
      baseUrl: secondary.baseUrl,
      apiKey: secondary.apiKey,
      api: 'openai-completions',
      models: [{ id: secondaryModelId, name: secondaryModelId }],
    };
    config.auth ||= {};
    config.auth.profiles ||= {};
    config.auth.profiles[`${secondaryProviderKey}:manual`] = { provider: secondaryProviderKey, mode: 'api_key' };
  } else {
    delete config.models.providers[secondaryProviderKey];
    scrubOpenClawAuthProfileMetadata(config, secondaryProviderKey);
  }
  if (!config.auth) config.auth = {};
  if (!config.auth.profiles) config.auth.profiles = {};
  scrubOpenClawAuthProfileMetadata(config, providerKey);
  config.auth.profiles[`${providerKey}:manual`] = { provider: providerKey, mode: 'api_key' };
  return config;
}

export function updateUserLlmSettings(
  userId,
  { llm_provider, llm_model, llm_secondary_provider, llm_secondary_model, llm_api_key, clear_llm_api_key } = {}
) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM platform_users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found');

  let provider =
    llm_provider !== undefined
      ? normalizeLlmProvider(llm_provider)
      : normalizeLlmProvider(row.llm_provider || 'platform_decided');

  // API keys are managed only via Settings → API Keys (Platform_BYOK). Ignore pasted keys.
  if (llm_api_key !== undefined && llm_api_key !== null && String(llm_api_key).trim()) {
    throw Object.assign(
      new Error(
        `Do not send llm_api_key here. Create "${PLATFORM_BYOK_KEY_NAME}" under Settings → API Keys, then select ${provider}.`
      ),
      { status: 400 }
    );
  }

  // Clear legacy column when switching providers / explicit clear
  let apiKey = row.llm_api_key || null;
  if (clear_llm_api_key || providerNeedsApiKey(provider)) {
    apiKey = null;
  }

  // Seed recommended vault slots for non-platform Profiles (placeholders until CEO pastes secrets).
  try {
    ensureByokVaultSlots(userId, provider);
  } catch (e) {
    console.warn('[updateUserLlmSettings] ensureByokVaultSlots:', e.message);
  }

  if (providerNeedsApiKey(provider)) {
    assertPlatformByokPresent(userId, provider);
  }

  let secondaryProvider = String(
    llm_secondary_provider !== undefined ? llm_secondary_provider || '' : row.llm_secondary_provider || ''
  ).trim();
  if (secondaryProvider === 'same_as_primary' || secondaryProvider === 'mirror_primary') secondaryProvider = '';
  if (secondaryProvider) secondaryProvider = normalizeLlmProvider(secondaryProvider);
  if (secondaryProvider === 'platform_decided') secondaryProvider = '';
  if (provider === 'platform_decided') secondaryProvider = '';

  if (secondaryProvider && providerNeedsApiKey(secondaryProvider)) {
    const secondaryKeyRow = getUserApiKeyRow(userId, PLATFORM_BYOK_SECONDARY_KEY_NAME);
    if (!secondaryKeyRow || isUnsetApiKeyRow(secondaryKeyRow)) {
      throw Object.assign(
        new Error(`Create "${PLATFORM_BYOK_SECONDARY_KEY_NAME}" under Settings → API Keys before enabling the secondary ${secondaryProvider} model.`),
        { status: 400 }
      );
    }
  }

  const modelInput =
    llm_model !== undefined ? llm_model : row.llm_model != null ? row.llm_model : '';
  const modelNorm = normalizeLlmModelForProvider(provider, modelInput, {
    // Soft-default from catalog when unset; Profile UI asks the CEO to confirm/change.
    required: false,
  });
  if (!modelNorm.ok) {
    throw Object.assign(new Error(modelNorm.error), { status: 400 });
  }
  if (
    (provider === 'openai' || provider === 'openrouter' || provider === 'deepseek_cloud') &&
    llm_model !== undefined &&
    !String(llm_model || '').trim()
  ) {
    throw Object.assign(
      new Error(`Select a chat model for ${provider === 'openai' ? 'OpenAI' : 'OpenRouter'}.`),
      { status: 400 }
    );
  }
  // When switching away from BYOK cloud, clear stored model unless explicitly set
  let modelToStore = modelNorm.model;
  if (provider === 'platform_decided') {
    modelToStore = null;
  } else if (llm_model === undefined && !String(row.llm_model || '').trim() && modelToStore) {
    // Persist soft default so OpenClaw + UI show what is in use
    modelToStore = modelNorm.model;
  }

  let secondaryModelToStore = null;
  if (secondaryProvider) {
    const secondaryInput = llm_secondary_model !== undefined
      ? llm_secondary_model
      : row.llm_secondary_model != null ? row.llm_secondary_model : '';
    const secondaryNorm = normalizeLlmModelForProvider(secondaryProvider, secondaryInput, { required: false });
    if (!secondaryNorm.ok) throw Object.assign(new Error(secondaryNorm.error), { status: 400 });
    secondaryModelToStore = secondaryNorm.model;
    if (providerNeedsApiKey(secondaryProvider) && !String(secondaryModelToStore || '').trim()) {
      throw Object.assign(new Error(`Select a secondary chat model for ${secondaryProvider}.`), { status: 400 });
    }
  }

  db.prepare(
    `UPDATE platform_users SET llm_provider = ?, llm_model = ?, llm_secondary_provider = ?, llm_secondary_model = ?, llm_api_key = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(provider, modelToStore, secondaryProvider || null, secondaryModelToStore, apiKey, userId);

  console.info(
    '[user-llm] updated provider=%s model=%s secondary=%s/%s user=%s',
    provider,
    modelToStore || '(platform)',
    secondaryProvider || '(mirror-primary)',
    secondaryModelToStore || '(same)',
    userId
  );

  let openclawSync = null;
  try {
    openclawSync = syncUserLlmToOpenClaw(userId);
  } catch (e) {
    openclawSync = { ok: false, error: e.message };
  }

  return {
    ...userLlmPublic({
      id: userId,
      llm_provider: provider,
      llm_model: modelToStore,
      llm_secondary_provider: secondaryProvider || null,
      llm_secondary_model: secondaryModelToStore,
      llm_efficiency_mode: row.llm_efficiency_mode,
    }),
    openclaw_sync: openclawSync,
  };
}
