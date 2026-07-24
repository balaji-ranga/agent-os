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
} from './openclaw-byok-auth.js';
import {
  PLATFORM_BYOK_KEY_NAME,
  tryResolveUserApiKey,
  getUserApiKeyRow,
  assertPlatformByokPresent,
  resolvePlatformByokSecret,
} from './user-api-keys.js';
export const LLM_PROVIDERS = Object.freeze([
  'platform_decided',
  'openai',
  'openrouter',
  'ollama_free',
  'deepseek',
]);

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function ollamaOpenAiBaseUrl() {
  const raw =
    normalizeBaseUrl(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434') ||
    'http://127.0.0.1:11434';
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
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
  if (raw === 'ollama' || raw === 'ollama_free' || raw === 'ollamafree') return 'ollama_free';
  if (raw === 'deepseek' || raw === 'deepseek_v3' || raw === 'deepseekv3') return 'deepseek';
  if (LLM_PROVIDERS.includes(raw)) return raw;
  throw new Error(
    `llm_provider must be one of: platform_decided, openai, openrouter, ollama_free, deepseek`
  );
}

export function providerNeedsApiKey(provider) {
  const p = normalizeLlmProvider(provider);
  return p === 'openai' || p === 'openrouter';
}

export function byokProviderId(userId) {
  return `byok-${sanitizeIdPart(userId)}`;
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
          `SELECT id, llm_provider, llm_api_key FROM platform_users WHERE id = ?`
        )
        .get(String(userId).trim()) || null
    );
  } catch {
    return null;
  }
}

/**
 * Public-safe BYOK view — key lives in API Keys vault as Platform_BYOK (never return full key).
 */
export function userLlmPublic(row) {
  if (!row) {
    return {
      llm_provider: 'platform_decided',
      llm_api_key_set: false,
      llm_api_key_hint: null,
      platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
    };
  }
  const provider = normalizeLlmProvider(row.llm_provider || 'platform_decided');
  const vault = row.id ? getUserApiKeyRow(row.id, PLATFORM_BYOK_KEY_NAME) : null;
  return {
    llm_provider: provider,
    llm_api_key_set: !!vault,
    llm_api_key_hint: vault?.key_hint || null,
    platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
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
    return {
      primary: {
        baseUrl: OPENAI_BASE,
        apiKey: userKey,
        model: envPrimary.model || 'gpt-4o-mini',
        source: 'user_byok_vault',
      },
      secondary: null,
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
    const model =
      (process.env.OPENROUTER_MODEL || '').trim() ||
      envPrimary.model ||
      'openai/gpt-4o-mini';
    return {
      primary: {
        baseUrl: OPENROUTER_BASE,
        apiKey: userKey,
        model,
        source: 'user_byok_vault',
      },
      secondary: null,
      provider,
      using_byok: true,
    };
  }

  if (provider === 'ollama_free') {
    const baseUrl = ollamaOpenAiBaseUrl();
    const model =
      (process.env.OLLAMA_MODEL || '').trim() ||
      envPrimary.model ||
      'llama3.2';
    return {
      primary: {
        baseUrl,
        apiKey: (process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
        model,
        source: 'user_ollama',
      },
      secondary: null,
      provider,
      using_byok: true,
    };
  }

  if (provider === 'deepseek') {
    // Local Ollama deepseek-v3 — no cloud API key
    const baseUrl =
      normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || '') || ollamaOpenAiBaseUrl();
    const model = (process.env.DEEPSEEK_MODEL || 'deepseek-v3').trim() || 'deepseek-v3';
    return {
      primary: {
        baseUrl: baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`,
        apiKey: (process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
        model,
        source: 'user_ollama_deepseek',
      },
      secondary: null,
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
  const path = getOpenClawConfigPath();
  if (!existsSync(path)) return { agents: { list: [] }, models: { providers: {} } };
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { agents: { list: [] }, models: { providers: {} } };
  }
}

function writeOpenClawConfig(config) {
  const dir = getOpenClawDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getOpenClawConfigPath(), JSON.stringify(config, null, 2), 'utf8');
}

function openClawModelSlug(providerKey, modelId) {
  const m = String(modelId || 'gpt-4o-mini').trim();
  if (m.includes('/')) return m.startsWith(`${providerKey}/`) ? m : `${providerKey}/${m.split('/').pop()}`;
  return `${providerKey}/${m}`;
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
  const tenantPrefix = `t-${sanitizeIdPart(id)}--`;

  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    delete config.models.providers[providerKey];
    for (const entry of config.agents.list) {
      if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
      if (entry.model) delete entry.model;
    }
    const authSync = syncByokAuthProfiles(id, { config, clear: true });
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
    Number(process.env.OLLAMA_CONTEXT_WINDOW || process.env.OPENCLAW_OLLAMA_CONTEXT_WINDOW || 32768) || 32768
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

  const modelSlug = openClawModelSlug(providerKey, primary.model);
  for (const entry of config.agents.list) {
    if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
    entry.model = { primary: modelSlug };
  }

  const authSync = syncByokAuthProfiles(id, {
    config,
    apiKey: primary.apiKey,
    clear: false,
  });
  writeOpenClawConfig(config);
  return {
    ok: true,
    cleared: false,
    provider: resolved.provider,
    providerKey,
    model: modelSlug,
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
  entry.model = { primary: openClawModelSlug(providerKey, resolved.primary.model) };
  return entry;
}

/**
 * After a tenant agent is provisioned, write its OpenClaw auth profile for CEO BYOK.
 * Safe no-op when platform_decided.
 */
export function applyByokAuthToProvisionedAgent(openclawAgentId, ceoUserId) {
  const resolved = resolveLlmConfigForUser(ceoUserId);
  const providerKey = byokProviderId(ceoUserId);
  const config = readOpenClawConfig();

  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    scrubOpenClawAuthProfileMetadata(config, providerKey);
    writeOpenClawConfig(config);
    clearAgentByokAuthProfile(openclawAgentId, providerKey);
    return { ok: true, skipped: true, cleared: true };
  }

  if (!config.auth) config.auth = {};
  if (!config.auth.profiles) config.auth.profiles = {};
  scrubOpenClawAuthProfileMetadata(config, providerKey);
  const profileId = `${providerKey}:manual`;
  config.auth.profiles[profileId] = { provider: providerKey, mode: 'api_key' };
  writeOpenClawConfig(config);
  return ensureAgentByokAuthFromUser(openclawAgentId, ceoUserId, resolved.primary.apiKey);
}

/** Ensure provider block exists when provisioning a tenant agent. */
export function ensureByokProviderInConfig(config, ceoUserId) {
  const resolved = resolveLlmConfigForUser(ceoUserId);
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const providerKey = byokProviderId(ceoUserId);
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    delete config.models.providers[providerKey];
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
  if (!config.auth) config.auth = {};
  if (!config.auth.profiles) config.auth.profiles = {};
  scrubOpenClawAuthProfileMetadata(config, providerKey);
  config.auth.profiles[`${providerKey}:manual`] = { provider: providerKey, mode: 'api_key' };
  return config;
}

export function updateUserLlmSettings(userId, { llm_provider, llm_api_key, clear_llm_api_key } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM platform_users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found');

  let provider =
    llm_provider !== undefined
      ? normalizeLlmProvider(llm_provider)
      : normalizeLlmProvider(row.llm_provider || 'platform_decided');

  // API keys are managed only via Management → API Keys (Platform_BYOK). Ignore pasted keys.
  if (llm_api_key !== undefined && llm_api_key !== null && String(llm_api_key).trim()) {
    throw Object.assign(
      new Error(
        `Do not send llm_api_key here. Create "${PLATFORM_BYOK_KEY_NAME}" under Management → API Keys, then select ${provider}.`
      ),
      { status: 400 }
    );
  }

  // Clear legacy column when switching providers / explicit clear
  let apiKey = row.llm_api_key || null;
  if (clear_llm_api_key || providerNeedsApiKey(provider)) {
    apiKey = null;
  }

  if (providerNeedsApiKey(provider)) {
    assertPlatformByokPresent(userId, provider);
  }

  db.prepare(
    `UPDATE platform_users SET llm_provider = ?, llm_api_key = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(provider, apiKey, userId);

  let openclawSync = null;
  try {
    openclawSync = syncUserLlmToOpenClaw(userId);
  } catch (e) {
    openclawSync = { ok: false, error: e.message };
  }

  return {
    ...userLlmPublic({ id: userId, llm_provider: provider }),
    openclaw_sync: openclawSync,
  };
}
