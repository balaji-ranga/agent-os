/**
 * Per-user LLM / BYOK settings. User selection takes precedence over platform .env
 * for Agent OS LLM calls and OpenClaw tenant agent model routing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { getDb } from '../db/schema.js';
import { getOpenClawDir, getOpenClawConfigPath } from '../config/openclaw-paths.js';
export const LLM_PROVIDERS = Object.freeze([
  'platform_decided',
  'openai',
  'openrouter',
  'ollama_free',
  'deepseek',
]);

const OPENAI_BASE = 'https://api.openai.com/v1';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEEPSEEK_DIRECT_BASE = 'https://api.deepseek.com/v1';

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
 * Public-safe BYOK view (never returns full key — only masked hint).
 */
export function userLlmPublic(row) {
  if (!row) {
    return {
      llm_provider: 'platform_decided',
      llm_api_key_set: false,
      llm_api_key_hint: null,
    };
  }
  const provider = normalizeLlmProvider(row.llm_provider || 'platform_decided');
  const key = String(row.llm_api_key || '').trim();
  let hint = null;
  if (key) {
    hint = key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`;
  }
  return {
    llm_provider: provider,
    llm_api_key_set: !!key,
    llm_api_key_hint: hint,
  };
}

/**
 * Resolve effective LLM endpoint for a user.
 * Precedence: user BYOK (openai / openrouter / ollama_free) → platform .env (platform_decided / empty).
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
  const userKey = String(row?.llm_api_key || '').trim();

  if (provider === 'openai') {
    if (!userKey) {
      return {
        primary: envPrimary,
        secondary,
        provider,
        using_byok: false,
        fallback_reason: 'openai_selected_but_no_key',
      };
    }
    return {
      primary: {
        baseUrl: OPENAI_BASE,
        apiKey: userKey,
        model: envPrimary.model || 'gpt-4o-mini',
        source: 'user_byok',
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
        fallback_reason: 'openrouter_selected_but_no_key',
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
        source: 'user_byok',
      },
      secondary: null,
      provider,
      using_byok: true,
    };
  }

  if (provider === 'ollama_free') {
    const baseUrl =
      normalizeBaseUrl(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1') ||
      'http://127.0.0.1:11434/v1';
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
    const model = (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim() || 'deepseek-chat';
    if (userKey) {
      return {
        primary: {
          baseUrl: DEEPSEEK_DIRECT_BASE,
          apiKey: userKey,
          model,
          source: 'user_byok',
        },
        secondary: null,
        provider,
        using_byok: true,
      };
    }
    const baseUrl =
      normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || 'http://deepseek:8080/v1') ||
      'http://deepseek:8080/v1';
    return {
      primary: {
        baseUrl,
        apiKey: 'deepseek',
        model,
        source: 'user_deepseek_proxy',
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
 * Sync CEO BYOK into OpenClaw: dedicated models.providers[byok-{ceo}] + tenant agent model.primary.
 * platform_decided clears the override so agents use gateway defaults (.env / openclaw defaults).
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
    writeOpenClawConfig(config);
    return { ok: true, cleared: true, provider: 'platform_decided' };
  }

  const primary = resolved.primary;
  const modelId = String(primary.model || 'gpt-4o-mini').replace(/^[^/]+\//, '');
  config.models.providers[providerKey] = {
    baseUrl: primary.baseUrl,
    apiKey: primary.apiKey,
    api: 'openai-completions',
    // OpenClaw 2026+ requires models[].name (non-empty string)
    models: [{ id: modelId, name: modelId }],
  };

  const modelSlug = openClawModelSlug(providerKey, primary.model);
  for (const entry of config.agents.list) {
    if (!String(entry.id || '').toLowerCase().startsWith(tenantPrefix)) continue;
    entry.model = { primary: modelSlug };
  }

  writeOpenClawConfig(config);
  return {
    ok: true,
    cleared: false,
    provider: resolved.provider,
    providerKey,
    model: modelSlug,
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

/** Ensure provider block exists when provisioning a tenant agent. */
export function ensureByokProviderInConfig(config, ceoUserId) {
  const resolved = resolveLlmConfigForUser(ceoUserId);
  if (!config.models) config.models = {};
  if (!config.models.providers) config.models.providers = {};
  const providerKey = byokProviderId(ceoUserId);
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    delete config.models.providers[providerKey];
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
  let apiKey = row.llm_api_key || null;

  if (clear_llm_api_key) {
    apiKey = null;
  } else if (llm_api_key !== undefined && llm_api_key !== null) {
    const trimmed = String(llm_api_key).trim();
    // Empty string means "leave unchanged" when key already set; explicit clear via clear_llm_api_key
    if (trimmed) apiKey = trimmed;
  }

  if (providerNeedsApiKey(provider) && !apiKey) {
    throw new Error(`API key required for llm_provider=${provider}`);
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
    ...userLlmPublic({ llm_provider: provider, llm_api_key: apiKey }),
    openclaw_sync: openclawSync,
  };
}
