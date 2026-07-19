/**
 * Central LLM config: primary and secondary OpenAPI-compliant endpoints (base URL + API key + model).
 * Precedence: per-user BYOK (openai / openrouter / ollama_free) → platform .env when platform_decided or unset.
 * Uses the same .env vars as OpenClaw gateway when falling back:
 * OPENAI_API_KEY, OPENAI_BASE_URL, OPENCLAW_MODEL_PRIMARY — with OPENAI_PRIMARY_* as aliases.
 */
import { resolveLlmConfigForUser } from '../services/user-llm-settings.js';

function isLocalOllama(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return false;
  try {
    const u = new URL(baseUrl);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch (_) {
    return false;
  }
}

/**
 * @param {string} [ownerUserId] - CEO user id; when set, user BYOK takes precedence over .env
 * @returns {{
 *   primary: { baseUrl: string, apiKey: string, model: string },
 *   secondary: { baseUrl: string, apiKey: string, model: string } | null,
 *   provider?: string,
 *   using_byok?: boolean
 * }}
 */
export function getLlmConfig(ownerUserId = null) {
  const resolved = resolveLlmConfigForUser(ownerUserId || null);
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
 * @param {{ messages: Array<{ role: string, content: string }>, modelOverride?: string, maxTokens?: number, ownerUserId?: string }}
 * @returns {Promise<{ content: string, modelUsed: string }>}
 */
export async function chatCompletions({ messages, modelOverride, maxTokens = 1024, ownerUserId = null }) {
  const cfg = getLlmConfig(ownerUserId);
  const endpoints = [
    { ...cfg.primary, model: modelOverride || cfg.primary.model },
    cfg.secondary ? { ...cfg.secondary, model: modelOverride || cfg.secondary.model } : null,
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
      const res = await fetch(chatUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: ep.model,
          max_tokens: maxTokens,
          messages,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content ?? '';
        return { content: typeof content === 'string' ? content : String(content), modelUsed: ep.model };
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
