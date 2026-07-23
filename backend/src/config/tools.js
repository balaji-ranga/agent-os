/**
 * Content-tools backend config. All values from env.
 * LLM (chat) uses config/llm.js with primary/secondary base URL, API key, model.
 * Image and video each have primary + secondary endpoint and key/model (OpenAI SDK–compatible or Replicate).
 */
import { randomBytes } from 'crypto';
import { getLlmConfig } from './llm.js';

function normalizeBaseUrl(url) {
  if (!url || typeof url !== 'string') return '';
  return url.trim().replace(/\/$/, '');
}

export function getSummarizeUrlConfig() {
  const timeoutMs = parseInt(process.env.TOOLS_SUMMARIZE_TIMEOUT_MS || '10000', 10);
  const maxBytes = parseInt(process.env.TOOLS_SUMMARIZE_MAX_BYTES || '512000', 10);
  const allowedDomainsRaw = process.env.TOOLS_SUMMARIZE_ALLOWED_DOMAINS || '';
  const allowedDomains = allowedDomainsRaw
    ? allowedDomainsRaw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
    : null;
  return {
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 512000,
    allowedDomains,
  };
}

export function getToolsApiKey() {
  return String(process.env.TOOLS_API_KEY || '').trim();
}

/**
 * OpenClaw content-tools plugin auth. Required in production / strict mode
 * (same fail-closed posture as AGENT_OS_INTERNAL_TOKEN).
 */
export function ensureToolsApiKeyConfigured() {
  let key = getToolsApiKey();
  if (key) return key;
  if (process.env.NODE_ENV === 'production' || process.env.AGENT_OS_STRICT_SECRETS === '1') {
    throw new Error(
      'TOOLS_API_KEY is required in production (set a long random secret in deploy/.env; must match OpenClaw content-tools plugin apiKey)'
    );
  }
  // Dev-only ephemeral — OpenClaw plugin will not match until .env is set.
  key = randomBytes(24).toString('hex');
  process.env.TOOLS_API_KEY = key;
  console.warn(
    '[security] TOOLS_API_KEY was unset — generated an ephemeral key for this process. Set it in .env and sync OpenClaw plugin apiKey.'
  );
  return key;
}

/** Summary model override for summarize-url (otherwise LLM primary/secondary from llm.js). */
export function getOpenAiConfig(ownerUserId = null) {
  const llm = getLlmConfig(ownerUserId);
  const summaryModel = (process.env.TOOLS_SUMMARIZE_MODEL || '').trim() || llm.primary.model;
  return {
    summaryModel: summaryModel || undefined,
    primaryModel: llm.primary.model,
    secondaryModel: llm.secondary?.model,
    apiKey: llm.primary.apiKey || llm.secondary?.apiKey || '',
    baseUrl: llm.primary.baseUrl,
    using_byok: !!llm.using_byok,
  };
}

/** GPT-image models (gpt-image-1, gpt-image-1-mini, etc.) replace retired DALL·E for new OpenAI keys. */
export function isGptImageModel(model) {
  return /^gpt-image/i.test(String(model || '').trim());
}

/** Map legacy DALL·E quality env values to GPT-image quality. */
export function mapGptImageQuality(quality) {
  const q = String(quality || '').toLowerCase();
  if (q === 'hd' || q === 'high') return 'high';
  if (q === 'low' || q === 'medium' || q === 'auto') return q;
  return 'medium';
}

function isLocalOllamaUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === 'ollama';
  } catch {
    return false;
  }
}

/**
 * Image generation: primary and secondary providers.
 * When ownerUserId has OpenAI/OpenRouter BYOK, use that key as primary (billing isolation).
 */
export function getImageConfig(ownerUserId = null) {
  const defaultBase = 'https://api.openai.com/v1';
  const size = process.env.TOOLS_IMAGE_SIZE || '1024x1024';
  const quality = process.env.TOOLS_IMAGE_QUALITY || 'standard';
  const style = process.env.TOOLS_IMAGE_STYLE || 'natural';
  const maxPromptChars = Math.min(parseInt(process.env.TOOLS_IMAGE_MAX_PROMPT_CHARS || '1000', 10) || 1000, 4000);
  const primaryModel = (process.env.TOOLS_IMAGE_MODEL || 'gpt-image-1').trim();

  let primaryBase =
    normalizeBaseUrl(process.env.OPENAI_PRIMARY_BASE_URL || process.env.OPENAI_BASE_URL || process.env.OPENAI_API_URL || defaultBase) ||
    defaultBase;
  let primaryKey = (process.env.OPENAI_PRIMARY_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  // BYOK: prefer user OpenAI / OpenRouter key for image gen (not local Ollama — no image API).
  if (ownerUserId) {
    try {
      const llm = getLlmConfig(ownerUserId);
      if (
        llm.using_byok &&
        llm.primary?.apiKey &&
        llm.primary?.baseUrl &&
        !isLocalOllamaUrl(llm.primary.baseUrl) &&
        (llm.provider === 'openai' || llm.provider === 'openrouter')
      ) {
        primaryBase = normalizeBaseUrl(llm.primary.baseUrl) || primaryBase;
        primaryKey = llm.primary.apiKey;
      }
    } catch {
      /* keep platform */
    }
  }

  const secondaryBase = normalizeBaseUrl(process.env.OPENAI_SECONDARY_BASE_URL || '');
  const secondaryKey = (process.env.OPENAI_SECONDARY_API_KEY || '').trim();
  const secondaryModel = (process.env.TOOLS_IMAGE_SECONDARY_MODEL || '').trim();

  const primary = {
    apiUrl: primaryBase,
    apiKey: primaryKey,
    model: primaryModel,
    size: size || '1024x1024',
    quality: quality === 'hd' ? 'hd' : 'standard',
    style: style === 'vivid' ? 'vivid' : 'natural',
    maxPromptChars,
  };

  const secondary =
    secondaryBase && secondaryKey && secondaryModel
      ? {
          apiUrl: secondaryBase,
          apiKey: secondaryKey,
          model: secondaryModel,
          size: primary.size,
          quality: primary.quality,
          style: primary.style,
          maxPromptChars,
        }
      : null;

  return { primary, secondary };
}

// Zeroscope (free/open model on Replicate; you pay Replicate per run). Or use Google Veo on Replicate: e.g. google/veo-2, google/veo-3, google/veo-3-fast — set TOOLS_VIDEO_MODEL_VERSION from Replicate portal.
const DEFAULT_VIDEO_MODEL_VERSION = 'anotherjesse/zeroscope-v2-xl:8ba52bde11300615f65e9591d7afc58816def12c93c870fa583ff67ae17afdda';
const REPLICATE_DEFAULT_BASE = 'https://api.replicate.com/v1';

/**
 * Video generation via Replicate.
 * When owner has BYOK openai/openrouter, still use platform Replicate tokens unless
 * REPLICATE_BYOK_ALLOW=0; optional per-user override via env is not stored — platform keys
 * remain for Replicate. If user BYOK is set we prefer not falling back to shared OpenAI for
 * anything else; video stays Replicate (separate billing).
 *
 * @param {string|null} [ownerUserId] - reserved for future per-user Replicate; currently scopes logging
 */
export function getVideoConfig(ownerUserId = null) {
  void ownerUserId;
  const maxPromptChars = Math.min(parseInt(process.env.TOOLS_VIDEO_MAX_PROMPT_CHARS || '500', 10) || 500, 2000);

  const primaryBase =
    normalizeBaseUrl(process.env.REPLICATE_PRIMARY_BASE_URL || process.env.REPLICATE_BASE_URL || REPLICATE_DEFAULT_BASE) ||
    REPLICATE_DEFAULT_BASE;
  const primaryToken = (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_PRIMARY_API_TOKEN || '').trim();
  const primaryVersion = (process.env.TOOLS_VIDEO_MODEL_VERSION || '').trim() || DEFAULT_VIDEO_MODEL_VERSION;

  const secondaryBase = normalizeBaseUrl(process.env.REPLICATE_SECONDARY_BASE_URL || '');
  const secondaryToken = (process.env.REPLICATE_SECONDARY_API_TOKEN || '').trim();
  const secondaryVersion = (process.env.TOOLS_VIDEO_SECONDARY_MODEL_VERSION || '').trim();

  // Optional: user-scoped Replicate token header from tools request is not used — keys stay env.
  // When CEO has OpenAI BYOK, image uses their key; video remains platform Replicate (different vendor).

  const primary = {
    apiUrl: primaryBase,
    apiToken: primaryToken,
    modelVersion: primaryVersion,
    maxPromptChars,
  };

  const secondary =
    secondaryBase && secondaryToken && secondaryVersion
      ? {
          apiUrl: secondaryBase,
          apiToken: secondaryToken,
          modelVersion: secondaryVersion,
          maxPromptChars,
        }
      : null;

  return { primary, secondary };
}
