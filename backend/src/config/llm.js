/**
 * Central LLM config: primary and secondary OpenAPI-compliant endpoints (base URL + API key + model).
 * Precedence: per-user BYOK (openai / openrouter / ollama_free) → platform .env when platform_decided or unset.
 * Uses the same .env vars as OpenClaw gateway when falling back:
 * OPENAI_API_KEY, OPENAI_BASE_URL, OPENCLAW_MODEL_PRIMARY — with OPENAI_PRIMARY_* as aliases.
 */
import { resolveLlmConfigForUser } from '../services/user-llm-settings.js';
import { getEffectivePlatformLlmEndpoints } from '../services/platform-llm-settings.js';

function isLocalOllama(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return false;
  try {
    const u = new URL(baseUrl);
    return (
      u.hostname === 'localhost' ||
      u.hostname === '127.0.0.1' ||
      u.hostname === 'ollama'
    );
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} [ownerUserId] - CEO user id; when set, user BYOK takes precedence over .env
 */
export function getLlmConfig(ownerUserId = null) {
  const resolved = resolveLlmConfigForUser(ownerUserId || null);
  // Platform-decided: honor admin primary/secondary switch
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    const effective = getEffectivePlatformLlmEndpoints();
    return {
      primary: {
        baseUrl: effective.primary.baseUrl,
        apiKey: effective.primary.apiKey,
        model: effective.primary.model,
      },
      secondary: effective.secondary
        ? {
            baseUrl: effective.secondary.baseUrl,
            apiKey: effective.secondary.apiKey,
            model: effective.secondary.model,
          }
        : null,
      provider: 'platform_decided',
      using_byok: false,
      platform_endpoint: effective.active,
    };
  }
  return {
    primary: {
      baseUrl: resolved.primary.baseUrl,
      apiKey: resolved.primary.apiKey,
      model: resolved.primary.model,
    },
    secondary: resolved.secondary,
    provider: resolved.provider,
    using_byok: !!resolved.using_byok,
  };
}

/**
 * Call OpenAPI-compliant chat/completions with optional model override. Tries primary then secondary endpoint.
 * Optional toolName applies CEO Tools-menu model mapping (overrides modelOverride / profile primary).
 * @param {{ messages: Array<{ role: string, content: string }>, modelOverride?: string, maxTokens?: number, ownerUserId?: string, toolName?: string }}
 * @returns {Promise<{ content: string, modelUsed: string }>}
 */
export async function chatCompletions({
  messages,
  modelOverride,
  maxTokens = 1024,
  ownerUserId = null,
  toolName = null,
  temperature = null,
  responseFormat = null,
}) {
  const cfg = getLlmConfig(ownerUserId);
  let effectiveModel = modelOverride || cfg.primary.model;
  if (toolName && ownerUserId) {
    try {
      const { getToolModelOverride } = await import('../services/tool-model-overrides.js');
      const toolOv = getToolModelOverride(ownerUserId, toolName);
      if (toolOv) effectiveModel = toolOv;
    } catch (e) {
      console.warn('[llm] tool model override skipped: %s', e?.message || e);
    }
  }
  const endpoints = [
    { ...cfg.primary, model: effectiveModel },
    cfg.secondary ? { ...cfg.secondary, model: effectiveModel || cfg.secondary.model } : null,
  ].filter(Boolean);

  const primary = endpoints[0];
  if (!primary?.baseUrl) throw new Error('OPENAI_PRIMARY_BASE_URL not set');
  if (!primary?.apiKey && !isLocalOllama(primary.baseUrl)) {
    throw new Error(
      cfg.using_byok
        ? 'User BYOK API key missing or invalid'
        : 'OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY not set in backend/.env (same key used by OpenClaw gateway), or set BYOK on your profile'
    );
  }

  let lastErr;
  for (const ep of endpoints) {
    if (!ep.apiKey && !isLocalOllama(ep.baseUrl)) continue;
    const chatUrl = `${ep.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (ep.apiKey) headers.Authorization = `Bearer ${ep.apiKey}`;
    try {
      const body = {
        model: ep.model,
        max_tokens: maxTokens,
        messages,
      };
      if (temperature != null && Number.isFinite(Number(temperature))) {
        body.temperature = Number(temperature);
      }
      // Prefer structured JSON when caller asks (OpenAI-compatible servers; ignored if unsupported).
      if (responseFormat === 'json_object' || responseFormat === 'json') {
        body.response_format = { type: 'json_object' };
      }
      let res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.LLM_CHAT_TIMEOUT_MS) || 120000),
      });
      // Some providers reject response_format; retry without it.
      if (!res.ok && body.response_format) {
        const errPeek = await res.text();
        if (/response_format|json_object|unsupported/i.test(errPeek) || res.status === 400) {
          delete body.response_format;
          res = await fetch(chatUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(Number(process.env.LLM_CHAT_TIMEOUT_MS) || 120000),
          });
        } else {
          // re-wrap for status handling below
          res = new Response(errPeek, { status: res.status, statusText: res.statusText });
        }
      }

      if (res.ok) {
        const data = await res.json();
        const msg = data?.choices?.[0]?.message || {};
        let content = msg.content ?? '';
        if (Array.isArray(content)) {
          content = content
            .map((p) => (typeof p === 'string' ? p : p?.text || p?.content || ''))
            .join('\n');
        }
        // Prefer visible content; only fall back to reasoning when content is empty.
        // (Reasoning models often put JSON only in content after long thoughts.)
        if (!String(content || '').trim() && msg.reasoning_content) {
          content = msg.reasoning_content;
        }
        if (!String(content || '').trim() && msg.reasoning) {
          content = msg.reasoning;
        }
        return { content: typeof content === 'string' ? content : String(content ?? ''), modelUsed: ep.model };
      }

      const errText = await res.text();
      let errJson;
      try {
        errJson = JSON.parse(errText);
      } catch (_) {}
      lastErr = new Error(errJson?.error?.message || errText || res.statusText);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastErr || new Error('No model available');
}
