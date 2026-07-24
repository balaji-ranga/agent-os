/**
 * Brain node LLM provider presets (OpenAI-compatible, Anthropic, Ollama, OpenRouter, DeepSeek-via-Ollama).
 */

import { resolveLiteralOrKeyRef, tryResolveUserApiKey } from './user-api-keys.js';

function ollamaOpenAiBase() {
  const raw = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim().replace(/\/$/, '');
  if (!raw) return 'http://127.0.0.1:11434/v1';
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

export const BRAIN_PROVIDERS = {
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    envApiKey: ['OPENAI_API_KEY', 'OPENAI_PRIMARY_API_KEY'],
    envBaseUrl: ['OPENAI_BASE_URL', 'OPENAI_PRIMARY_BASE_URL'],
    envModel: ['OPENAI_DEFAULT_MODEL', 'OPENAI_PRIMARY_MODEL'],
    protocol: 'openai',
    requiresKey: true,
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    envApiKey: ['ANTHROPIC_API_KEY'],
    envBaseUrl: ['ANTHROPIC_BASE_URL'],
    envModel: ['ANTHROPIC_MODEL'],
    protocol: 'anthropic',
    requiresKey: true,
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'llama3.2',
    envApiKey: [],
    envBaseUrl: ['OLLAMA_BASE_URL'],
    envModel: ['OLLAMA_MODEL'],
    protocol: 'openai',
    requiresKey: false,
    placeholderApiKey: 'ollama',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    envApiKey: ['OPENROUTER_API_KEY'],
    envBaseUrl: ['OPENROUTER_BASE_URL'],
    envModel: ['OPENROUTER_MODEL'],
    protocol: 'openai',
    requiresKey: true,
    extraHeadersFromEnv: {
      'HTTP-Referer': 'OPENROUTER_HTTP_REFERER',
      'X-Title': 'OPENROUTER_SITE_TITLE',
    },
  },
  /** DeepSeek cloud (V4) by default; override apiEndpoint to local Ollama if needed. */
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    envApiKey: ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'OPENAI_PRIMARY_API_KEY'],
    envBaseUrl: ['DEEPSEEK_BASE_URL'],
    envModel: ['DEEPSEEK_MODEL'],
    protocol: 'openai',
    requiresKey: true,
    placeholderApiKey: 'ollama',
  },
};

function firstEnv(keys = []) {
  for (const key of keys) {
    const v = (process.env[key] || '').trim();
    if (v) return v;
  }
  return '';
}

function normalizeOpenAiCompatBase(url) {
  if (!url) return '';
  const u = String(url).trim().replace(/\/$/, '');
  if (!u) return '';
  if (u.endsWith('/v1')) return u;
  if (u.endsWith('/chat/completions')) return u.replace(/\/chat\/completions$/, '');
  // Ollama host without /v1
  try {
    const parsed = new URL(u);
    if (parsed.hostname === 'ollama' || parsed.port === '11434') {
      return `${u}/v1`;
    }
  } catch {
    /* ignore */
  }
  return u;
}

function isLocalOllamaBaseUrl(baseUrl) {
  if (!baseUrl) return false;
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

/** Local Ollama OpenAI-compat endpoint (Docker service or loopback) — no API key. */
export function isOllamaServiceBaseUrl(baseUrl) {
  return isLocalOllamaBaseUrl(baseUrl);
}

/** @deprecated use isOllamaServiceBaseUrl — kept for callers that imported the old name */
export function isDeepSeekProxyBaseUrl(baseUrl) {
  return isOllamaServiceBaseUrl(baseUrl);
}

function brainAllowsMissingKey(source, baseUrl) {
  if (source === 'ollama') return true;
  // DeepSeek cloud needs a key; local Ollama DeepSeek does not.
  if (source === 'deepseek') return isLocalOllamaBaseUrl(baseUrl);
  if (isLocalOllamaBaseUrl(baseUrl)) return true;
  return false;
}

function nodeApiKey(cfg = {}) {
  return String(cfg.apiKey || cfg.api_key || '').trim();
}

function buildOpenRouterHeaders(cfg = {}) {
  const extraHeaders = {};
  const referer = String(cfg.httpReferer || '').trim();
  const title = String(cfg.siteTitle || '').trim() || 'Agent OS';
  if (referer) extraHeaders['HTTP-Referer'] = referer;
  if (title) extraHeaders['X-Title'] = title;
  return extraHeaders;
}

/**
 * Workflow Brain — credentials come only from the node's taskConfig (never platform .env).
 * Optional ownerUserId resolves cfg.apiKeyRef from the per-CEO API key vault.
 */
export function resolveWorkflowBrainProviderConfig(modelSource, cfg = {}, ownerUserId = null) {
  const source = (modelSource || 'openai').toLowerCase();
  const preset = BRAIN_PROVIDERS[source] || BRAIN_PROVIDERS.openai;

  let baseUrl = (cfg.apiEndpoint || '').trim() || firstEnv(preset.envBaseUrl) || preset.baseUrl;
  if (source === 'deepseek' && !cfg.apiEndpoint) {
    // Prefer node/env DeepSeek URL; default to cloud V4 (not Ollama) unless DEEPSEEK_BASE_URL is set.
    baseUrl = firstEnv(['DEEPSEEK_BASE_URL']) || preset.baseUrl;
  }
  if (source === 'ollama' && !cfg.apiEndpoint) {
    baseUrl = ollamaOpenAiBase() || preset.baseUrl;
  }
  baseUrl = normalizeOpenAiCompatBase(baseUrl) || baseUrl;

  const configuredKey = resolveLiteralOrKeyRef(ownerUserId, {
    literal: nodeApiKey(cfg),
    keyRef: cfg.apiKeyRef || cfg.api_key_ref,
  });
  let apiKey = configuredKey;
  const model = (cfg.model || '').trim() || firstEnv(preset.envModel) || preset.model;

  if (!apiKey && preset.placeholderApiKey) apiKey = preset.placeholderApiKey;

  const extraHeaders = source === 'openrouter' ? buildOpenRouterHeaders(cfg) : {};

  return {
    source,
    preset,
    baseUrl,
    apiKey,
    configuredKey,
    model,
    protocol: preset.protocol,
    requiresKey: preset.requiresKey,
    extraHeaders,
  };
}

/** Validate Brain nodes have per-node API keys before publish/run (no platform .env fallback). */
export function validateWorkflowBrainCredentials(graph, ownerUserId = null) {
  const errors = [];
  for (const node of graph?.nodes || []) {
    if (node.type !== 'brain') continue;
    const cfg = node.data?.taskConfig || node.data?.config || {};
    // Resolve base/source without keyRef so missing vault keys don't throw during validation.
    const { source, requiresKey, baseUrl } = resolveWorkflowBrainProviderConfig(
      cfg.modelSource,
      { ...cfg, apiKeyRef: '', api_key_ref: '' },
      null
    );
    const literal = nodeApiKey(cfg);
    const keyRef = String(cfg.apiKeyRef || cfg.api_key_ref || '').trim();
    let configuredKey = literal;
    if (!configuredKey && keyRef) {
      configuredKey =
        (ownerUserId && tryResolveUserApiKey(ownerUserId, keyRef)?.value) || '';
    }
    if (requiresKey && !configuredKey && !brainAllowsMissingKey(source, baseUrl)) {
      const label = node.data?.label || node.id;
      errors.push(
        keyRef
          ? `Brain "${label}" (${node.id}): API key ref "${keyRef}" could not be resolved — set ${source} API key or a valid vault key on the Brain node`
          : `Brain "${label}" (${node.id}): set ${source} API key on the Brain node — platform .env keys are not used for workflows`
      );
    }
  }
  return errors;
}

/** Resolve base URL, API key, model — includes .env fallback (platform services / dev scripts only). */
export function resolveBrainProviderConfig(modelSource, cfg = {}) {
  const source = (modelSource || 'openai').toLowerCase();
  const preset = BRAIN_PROVIDERS[source] || BRAIN_PROVIDERS.openai;

  let baseUrl = (cfg.apiEndpoint || '').trim() || firstEnv(preset.envBaseUrl) || preset.baseUrl;
  if (source === 'deepseek' || source === 'ollama') {
    baseUrl = normalizeOpenAiCompatBase(baseUrl) || ollamaOpenAiBase();
  }
  let apiKey = nodeApiKey(cfg) || firstEnv(preset.envApiKey);
  let model = (cfg.model || '').trim() || firstEnv(preset.envModel) || preset.model;

  if (!apiKey && preset.placeholderApiKey) apiKey = preset.placeholderApiKey;

  const extraHeaders = {};
  if (preset.extraHeadersFromEnv) {
    for (const [header, envKey] of Object.entries(preset.extraHeadersFromEnv)) {
      const fromCfg = cfg[header === 'HTTP-Referer' ? 'httpReferer' : header === 'X-Title' ? 'siteTitle' : ''] || '';
      const value = String(fromCfg || process.env[envKey] || '').trim();
      if (value) extraHeaders[header] = value;
    }
  }
  if (source === 'openrouter' && !extraHeaders['X-Title']) {
    extraHeaders['X-Title'] = 'Agent OS';
  }

  return {
    source,
    preset,
    baseUrl,
    apiKey,
    model,
    protocol: preset.protocol,
    requiresKey: preset.requiresKey,
    extraHeaders,
  };
}
