/**
 * Content-tools backend config. All values from env.
 * LLM (chat) uses config/llm.js with primary/secondary base URL, API key, model.
 * Image and video each have primary + secondary endpoint and key/model (OpenAI SDK–compatible or Replicate).
 */
import { randomBytes } from 'crypto';
import { getLlmConfig } from './llm.js';
import {
  PLATFORM_BYOK_KEY_NAME,
  REPLICATE_BYOK_KEY_NAME,
  BRAVE_SEARCH_BYOK_KEY_NAME,
  GOOGLE_PLACES_BYOK_KEY_NAME,
  tryResolveUserApiKey,
} from '../services/user-api-keys.js';
import { getToolModelOverride } from '../services/tool-model-overrides.js';
export {
  PLATFORM_BYOK_KEY_NAME,
  REPLICATE_BYOK_KEY_NAME,
  BRAVE_SEARCH_BYOK_KEY_NAME,
  GOOGLE_PLACES_BYOK_KEY_NAME,
};

const BRAVE_WEB_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

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
export function getOpenAiConfig(ownerUserId = null, toolName = 'summarize_url') {
  const llm = getLlmConfig(ownerUserId);
  let summaryModel = (process.env.TOOLS_SUMMARIZE_MODEL || '').trim() || llm.primary.model;
  if (ownerUserId && toolName) {
    const ov = getToolModelOverride(ownerUserId, toolName);
    if (ov) summaryModel = ov;
  }
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
 * Image generation: OpenAI-compatible (GPT-image / DALL·E).
 *
 * - Profile **Platform default** (or no owner): platform `OPENAI_*` keys.
 * - Any other Profile LLM: vault **`Platform_BYOK` only** (OpenAI/OpenRouter-compatible key) —
 *   never the platform key. Local Ollama Profiles still need Platform_BYOK for image APIs.
 *
 * @param {string|null} [ownerUserId]
 * @param {string|null} [toolName] - Tools-menu model mapping (default generate_image)
 */
export function getImageConfig(ownerUserId = null, toolName = 'generate_image') {
  const defaultBase = 'https://api.openai.com/v1';
  const size = process.env.TOOLS_IMAGE_SIZE || '1024x1024';
  const quality = process.env.TOOLS_IMAGE_QUALITY || 'standard';
  const style = process.env.TOOLS_IMAGE_STYLE || 'natural';
  const maxPromptChars = Math.min(parseInt(process.env.TOOLS_IMAGE_MAX_PROMPT_CHARS || '1000', 10) || 1000, 4000);
  let primaryModel = (process.env.TOOLS_IMAGE_MODEL || 'gpt-image-1').trim();
  if (ownerUserId && toolName) {
    const ov = getToolModelOverride(ownerUserId, toolName);
    if (ov) primaryModel = ov;
  }

  const platformBase =
    normalizeBaseUrl(
      process.env.OPENAI_PRIMARY_BASE_URL ||
        process.env.OPENAI_BASE_URL ||
        process.env.OPENAI_API_URL ||
        defaultBase
    ) || defaultBase;
  const platformKey = (process.env.OPENAI_PRIMARY_API_KEY || process.env.OPENAI_API_KEY || '').trim();

  let provider = 'platform_decided';
  if (ownerUserId) {
    try {
      const llm = getLlmConfig(ownerUserId);
      provider = String(llm?.provider || 'platform_decided').trim() || 'platform_decided';
    } catch {
      provider = 'platform_decided';
    }
  }

  const usePlatformKey = !ownerUserId || provider === 'platform_decided';
  let primaryBase = platformBase;
  let primaryKey = platformKey;
  let using_byok = false;
  let source = 'platform_env';
  let error = null;
  let error_code = null;

  if (!usePlatformKey) {
    using_byok = true;
    source = 'user_byok_vault';
    const vault = tryResolveUserApiKey(ownerUserId, PLATFORM_BYOK_KEY_NAME);
    const byokKey = String(vault?.value || '').trim();
    if (!byokKey) {
      console.info(
        '[tools] generate_image blocked owner=%s provider=%s missing vault=%s',
        ownerUserId,
        provider,
        PLATFORM_BYOK_KEY_NAME
      );
      primaryKey = '';
      error = `Create API key "${PLATFORM_BYOK_KEY_NAME}" under Settings → API Keys for image generation, or switch Profile LLM to Platform default.`;
      error_code = 'platform_byok_required';
    } else {
      // Prefer OpenRouter base when Profile is openrouter; otherwise OpenAI.
      if (provider === 'openrouter') {
        primaryBase =
          normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1') ||
          'https://openrouter.ai/api/v1';
      } else {
        primaryBase = defaultBase;
        try {
          const llm = getLlmConfig(ownerUserId);
          if (llm?.primary?.baseUrl && !isLocalOllamaUrl(llm.primary.baseUrl)) {
            primaryBase = normalizeBaseUrl(llm.primary.baseUrl) || primaryBase;
          }
        } catch {
          /* keep OpenAI default */
        }
      }
      primaryKey = byokKey;
      console.info(
        '[tools] generate_image using vault %s owner=%s provider=%s',
        PLATFORM_BYOK_KEY_NAME,
        ownerUserId,
        provider
      );
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

  // Secondary only for platform Profile (BYOK users must not fall back to platform secondary).
  const secondary =
    usePlatformKey && secondaryBase && secondaryKey && secondaryModel
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

  return {
    primary,
    secondary,
    using_byok,
    provider,
    source,
    platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
    error,
    error_code,
  };
}

const DEFAULT_VISION_MODEL = 'gpt-4o-mini';
const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

/**
 * Vision / OCR for analyze_image: multimodal chat/completions (image_url parts).
 *
 * Resolution:
 * 1. Optional ops override: TOOLS_VISION_BASE_URL + TOOLS_VISION_API_KEY (+ TOOLS_VISION_MODEL)
 * 2. CEO BYOK Profile (provider ≠ platform_decided) → vault **Platform_BYOK** + Profile primary
 *    base/model only (never platform keys). Missing vault → error.
 * 3. Platform default → **effective** platform primary (same as chat; honors Admin
 *    primary/secondary switch). No extra silent fallback. If that model cannot do vision,
 *    the upstream call fails.
 *
 * @param {string|null} [ownerUserId]
 * @param {string|null} [toolName] - Tools-menu model mapping (default analyze_image)
 */
export function getVisionConfig(ownerUserId = null, toolName = 'analyze_image') {
  const visionModelOverride = (process.env.TOOLS_VISION_MODEL || '').trim();
  const toolModel =
    ownerUserId && toolName ? getToolModelOverride(ownerUserId, toolName) : null;
  const maxTokens = Math.min(
    parseInt(process.env.TOOLS_VISION_MAX_TOKENS || '1200', 10) || 1200,
    4096
  );
  const maxBytesMb = Math.min(
    parseInt(process.env.TOOLS_VISION_MAX_MB || '15', 10) || 15,
    40
  );
  const timeoutMs = Math.min(
    parseInt(process.env.TOOLS_VISION_TIMEOUT_MS || '90000', 10) || 90000,
    180000
  );

  const pickModel = (...fallbacks) => {
    for (const m of fallbacks) {
      const s = String(m || '').trim();
      if (s) return s;
    }
    return DEFAULT_VISION_MODEL;
  };

  const explicitBase = normalizeBaseUrl(process.env.TOOLS_VISION_BASE_URL || '');
  const explicitKey = (process.env.TOOLS_VISION_API_KEY || '').trim();
  if (explicitBase && explicitKey) {
    return {
      baseUrl: explicitBase,
      apiKey: explicitKey,
      model: pickModel(toolModel, visionModelOverride, DEFAULT_VISION_MODEL),
      maxTokens,
      maxBytesMb,
      timeoutMs,
      using_byok: false,
      provider: 'tools_vision_env',
      source: 'tools_vision_env',
      error: null,
      error_code: null,
    };
  }

  let provider = 'platform_decided';
  let llm = null;
  if (ownerUserId) {
    try {
      llm = getLlmConfig(ownerUserId);
      provider = String(llm?.provider || 'platform_decided').trim() || 'platform_decided';
    } catch {
      provider = 'platform_decided';
    }
  }

  const usePlatformKey = !ownerUserId || provider === 'platform_decided';

  // BYOK Profiles: vault Platform_BYOK only — never platform OPENAI_* keys.
  if (!usePlatformKey && ownerUserId) {
    const vault = tryResolveUserApiKey(ownerUserId, PLATFORM_BYOK_KEY_NAME);
    const byokKey = String(vault?.value || '').trim();
    if (!byokKey) {
      console.info(
        '[tools] analyze_image blocked owner=%s provider=%s missing vault=%s',
        ownerUserId,
        provider,
        PLATFORM_BYOK_KEY_NAME
      );
      return {
        baseUrl: '',
        apiKey: '',
        model: pickModel(toolModel, visionModelOverride, llm?.primary?.model, DEFAULT_VISION_MODEL),
        maxTokens,
        maxBytesMb,
        timeoutMs,
        using_byok: true,
        provider,
        source: 'user_byok_vault',
        platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
        error: `Create API key "${PLATFORM_BYOK_KEY_NAME}" under Settings → API Keys for image analysis, or switch Profile LLM to Platform default.`,
        error_code: 'platform_byok_required',
      };
    }
    let baseUrl = OPENAI_DEFAULT_BASE;
    if (provider === 'openrouter') {
      baseUrl =
        normalizeBaseUrl(process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1') ||
        'https://openrouter.ai/api/v1';
    } else if (llm?.primary?.baseUrl && !isLocalOllamaUrl(llm.primary.baseUrl)) {
      baseUrl = normalizeBaseUrl(llm.primary.baseUrl) || baseUrl;
    } else if (provider === 'openai') {
      baseUrl = OPENAI_DEFAULT_BASE;
    }
    // Profile primary (or TOOLS_VISION_MODEL) unless Tools-menu tool mapping is set.
    const byokModel = pickModel(
      toolModel,
      visionModelOverride,
      llm?.primary?.model,
      DEFAULT_VISION_MODEL
    );
    console.info(
      '[tools] analyze_image using vault %s owner=%s provider=%s model=%s',
      PLATFORM_BYOK_KEY_NAME,
      ownerUserId,
      provider,
      byokModel
    );
    return {
      baseUrl,
      apiKey: byokKey,
      model: byokModel,
      maxTokens,
      maxBytesMb,
      timeoutMs,
      using_byok: true,
      provider,
      source: 'user_byok_vault',
      platform_byok_key_name: PLATFORM_BYOK_KEY_NAME,
      error: null,
      error_code: null,
    };
  }

  // Platform default: same effective primary as chat (honors Admin primary/secondary switch).
  // Do not read raw OPENAI_PRIMARY_* when secondary is active — that ignored the switch and
  // kept calling DeepSeek while chat used gpt-4o-mini.
  if (!llm) {
    try {
      llm = getLlmConfig(ownerUserId || null);
    } catch {
      llm = null;
    }
  }
  const primaryBase = normalizeBaseUrl(llm?.primary?.baseUrl || '') || '';
  const primaryKey = String(llm?.primary?.apiKey || '').trim();
  const primaryModel = String(llm?.primary?.model || '').trim();

  if (primaryBase && primaryKey) {
    const model = pickModel(toolModel, visionModelOverride, primaryModel, DEFAULT_VISION_MODEL);
    return {
      baseUrl: primaryBase,
      apiKey: primaryKey,
      model,
      maxTokens,
      maxBytesMb,
      timeoutMs,
      using_byok: false,
      provider: 'platform_decided',
      source: llm?.platform_endpoint === 'secondary' ? 'platform_effective_secondary' : 'platform_primary',
      platform_endpoint: llm?.platform_endpoint || 'primary',
      error: null,
      error_code: null,
    };
  }

  return {
    baseUrl: '',
    apiKey: '',
    model: pickModel(toolModel, visionModelOverride, primaryModel, DEFAULT_VISION_MODEL),
    maxTokens,
    maxBytesMb,
    timeoutMs,
    using_byok: false,
    provider: 'platform_decided',
    source: 'unconfigured',
    error:
      'Image analysis not configured. Set platform OPENAI_* (or TOOLS_VISION_BASE_URL + TOOLS_VISION_API_KEY). For BYOK Profiles, create vault API key "Platform_BYOK".',
    error_code: 'vision_not_configured',
  };
}

// Zeroscope (free/open model on Replicate; you pay Replicate per run). Or use Google Veo on Replicate: e.g. google/veo-2, google/veo-3, google/veo-3-fast — set TOOLS_VIDEO_MODEL_VERSION from Replicate portal.
const DEFAULT_VIDEO_MODEL_VERSION = 'anotherjesse/zeroscope-v2-xl:8ba52bde11300615f65e9591d7afc58816def12c93c870fa583ff67ae17afdda';
const REPLICATE_DEFAULT_BASE = 'https://api.replicate.com/v1';

/**
 * Video generation via Replicate.
 *
 * - Profile **Platform default** (or no owner): platform `REPLICATE_API_TOKEN` (+ optional secondary).
 * - Any other Profile LLM preference: vault **`Replicate_BYOK` only** — never the platform token.
 *
 * @param {string|null} [ownerUserId]
 * @param {string|null} [toolName] - Tools-menu model mapping (default generate_video); overrides Replicate model version
 */
export function getVideoConfig(ownerUserId = null, toolName = 'generate_video') {
  const maxPromptChars = Math.min(parseInt(process.env.TOOLS_VIDEO_MAX_PROMPT_CHARS || '500', 10) || 500, 2000);

  const primaryBase =
    normalizeBaseUrl(process.env.REPLICATE_PRIMARY_BASE_URL || process.env.REPLICATE_BASE_URL || REPLICATE_DEFAULT_BASE) ||
    REPLICATE_DEFAULT_BASE;
  const primaryToken = (process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_PRIMARY_API_TOKEN || '').trim();
  let primaryVersion = (process.env.TOOLS_VIDEO_MODEL_VERSION || '').trim() || DEFAULT_VIDEO_MODEL_VERSION;
  if (ownerUserId && toolName) {
    const ov = getToolModelOverride(ownerUserId, toolName);
    if (ov) primaryVersion = ov;
  }

  const secondaryBase = normalizeBaseUrl(process.env.REPLICATE_SECONDARY_BASE_URL || '');
  const secondaryToken = (process.env.REPLICATE_SECONDARY_API_TOKEN || '').trim();
  const secondaryVersion = (process.env.TOOLS_VIDEO_SECONDARY_MODEL_VERSION || '').trim();

  let provider = 'platform_decided';
  if (ownerUserId) {
    try {
      const llm = getLlmConfig(ownerUserId);
      provider = String(llm?.provider || 'platform_decided').trim() || 'platform_decided';
    } catch {
      provider = 'platform_decided';
    }
  }

  const usePlatformToken = !ownerUserId || provider === 'platform_decided';

  if (usePlatformToken) {
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
    return {
      primary,
      secondary,
      using_byok: false,
      provider,
      source: 'platform_env',
      replicate_byok_key_name: REPLICATE_BYOK_KEY_NAME,
    };
  }

  const vault = tryResolveUserApiKey(ownerUserId, REPLICATE_BYOK_KEY_NAME);
  const byokToken = String(vault?.value || '').trim();
  if (!byokToken) {
    console.info(
      '[tools] generate_video blocked owner=%s provider=%s missing vault=%s',
      ownerUserId,
      provider,
      REPLICATE_BYOK_KEY_NAME
    );
    return {
      primary: {
        apiUrl: primaryBase,
        apiToken: '',
        modelVersion: primaryVersion,
        maxPromptChars,
      },
      secondary: null,
      using_byok: true,
      provider,
      source: 'user_byok_vault',
      replicate_byok_key_name: REPLICATE_BYOK_KEY_NAME,
      error: `Create API key "${REPLICATE_BYOK_KEY_NAME}" under Settings → API Keys for video generation, or switch Profile LLM to Platform default.`,
      error_code: 'replicate_byok_required',
    };
  }

  console.info(
    '[tools] generate_video using vault %s owner=%s provider=%s',
    REPLICATE_BYOK_KEY_NAME,
    ownerUserId,
    provider
  );
  return {
    primary: {
      apiUrl: primaryBase,
      apiToken: byokToken,
      modelVersion: primaryVersion,
      maxPromptChars,
    },
    secondary: null,
    using_byok: true,
    provider,
    source: 'user_byok_vault',
    replicate_byok_key_name: REPLICATE_BYOK_KEY_NAME,
  };
}

/**
 * Brave web search key resolution (same Profile rule as Replicate video).
 *
 * - Profile **Platform default** (or no owner): platform `BRAVE_API_KEY`.
 * - Any other Profile LLM preference: vault **`BRAVE_SEARCH_BYOK` only** — never the platform key.
 *
 * @param {string|null} [ownerUserId]
 */
export function getBraveSearchConfig(ownerUserId = null) {
  let provider = 'platform_decided';
  if (ownerUserId) {
    try {
      const llm = getLlmConfig(ownerUserId);
      provider = String(llm?.provider || 'platform_decided').trim() || 'platform_decided';
    } catch {
      provider = 'platform_decided';
    }
  }

  const usePlatformKey = !ownerUserId || provider === 'platform_decided';
  const apiUrl = BRAVE_WEB_SEARCH_URL;

  if (usePlatformKey) {
    const apiKey = String(process.env.BRAVE_API_KEY || '').trim();
    return {
      apiUrl,
      apiKey,
      using_byok: false,
      provider,
      source: 'platform_env',
      brave_search_byok_key_name: BRAVE_SEARCH_BYOK_KEY_NAME,
      error: apiKey
        ? null
        : 'Brave Search not configured. Set platform BRAVE_API_KEY in deploy/.env, or switch Profile LLM and add vault BRAVE_SEARCH_BYOK.',
      error_code: apiKey ? null : 'brave_platform_key_missing',
    };
  }

  const vault = tryResolveUserApiKey(ownerUserId, BRAVE_SEARCH_BYOK_KEY_NAME);
  const byokKey = String(vault?.value || '').trim();
  if (!byokKey) {
    console.info(
      '[tools] brave_web_search blocked owner=%s provider=%s missing vault=%s',
      ownerUserId,
      provider,
      BRAVE_SEARCH_BYOK_KEY_NAME
    );
    return {
      apiUrl,
      apiKey: '',
      using_byok: true,
      provider,
      source: 'user_byok_vault',
      brave_search_byok_key_name: BRAVE_SEARCH_BYOK_KEY_NAME,
      error: `Create API key "${BRAVE_SEARCH_BYOK_KEY_NAME}" under Settings → API Keys for Brave Search, or switch Profile LLM to Platform default.`,
      error_code: 'brave_search_byok_required',
    };
  }

  console.info(
    '[tools] brave_web_search using vault %s owner=%s provider=%s',
    BRAVE_SEARCH_BYOK_KEY_NAME,
    ownerUserId,
    provider
  );
  return {
    apiUrl,
    apiKey: byokKey,
    using_byok: true,
    provider,
    source: 'user_byok_vault',
    brave_search_byok_key_name: BRAVE_SEARCH_BYOK_KEY_NAME,
    error: null,
    error_code: null,
  };
}

const PLACES_API_NEW_BASE = 'https://places.googleapis.com/v1';

/**
 * Google Places API (New) key resolution (same Profile rule as Brave Search).
 *
 * - Profile **Platform default** (or no owner): platform `GOOGLE_PLACES_API_KEY`.
 * - Any other Profile LLM preference: vault **`GOOGLE_PLACES_BYOK` only** — never the platform key.
 *
 * @param {string|null} [ownerUserId]
 */
export function getGooglePlacesConfig(ownerUserId = null) {
  let provider = 'platform_decided';
  if (ownerUserId) {
    try {
      const llm = getLlmConfig(ownerUserId);
      provider = String(llm?.provider || 'platform_decided').trim() || 'platform_decided';
    } catch {
      provider = 'platform_decided';
    }
  }

  const usePlatformKey = !ownerUserId || provider === 'platform_decided';
  const apiUrl = PLACES_API_NEW_BASE;

  if (usePlatformKey) {
    const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || '').trim();
    return {
      apiUrl,
      apiKey,
      using_byok: false,
      provider,
      source: 'platform_env',
      google_places_byok_key_name: GOOGLE_PLACES_BYOK_KEY_NAME,
      error: apiKey
        ? null
        : 'Google Places not configured. Set platform GOOGLE_PLACES_API_KEY in deploy/.env (Places API New), or switch Profile LLM and add vault GOOGLE_PLACES_BYOK.',
      error_code: apiKey ? null : 'google_places_platform_key_missing',
    };
  }

  const vault = tryResolveUserApiKey(ownerUserId, GOOGLE_PLACES_BYOK_KEY_NAME);
  const byokKey = String(vault?.value || '').trim();
  if (!byokKey) {
    console.info(
      '[tools] google_places blocked owner=%s provider=%s missing vault=%s',
      ownerUserId,
      provider,
      GOOGLE_PLACES_BYOK_KEY_NAME
    );
    return {
      apiUrl,
      apiKey: '',
      using_byok: true,
      provider,
      source: 'user_byok_vault',
      google_places_byok_key_name: GOOGLE_PLACES_BYOK_KEY_NAME,
      error: `Create API key "${GOOGLE_PLACES_BYOK_KEY_NAME}" under Settings → API Keys for Google Places API (New), or switch Profile LLM to Platform default.`,
      error_code: 'google_places_byok_required',
    };
  }

  console.info(
    '[tools] google_places using vault %s owner=%s provider=%s',
    GOOGLE_PLACES_BYOK_KEY_NAME,
    ownerUserId,
    provider
  );
  return {
    apiUrl,
    apiKey: byokKey,
    using_byok: true,
    provider,
    source: 'user_byok_vault',
    google_places_byok_key_name: GOOGLE_PLACES_BYOK_KEY_NAME,
    error: null,
    error_code: null,
  };
}
