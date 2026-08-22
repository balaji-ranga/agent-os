/**
 * Central LLM config: primary and secondary OpenAPI-compliant endpoints (base URL + API key + model).
 * Precedence: per-user BYOK (openai / openrouter / ollama_free) → platform .env when platform_decided or unset.
 * Uses the same .env vars as AgentSystem gateway when falling back:
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

function endpointHost(baseUrl) {
  try {
    return new URL(String(baseUrl || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Official OpenAI must not receive DeepSeek / local-only model ids (causes "model does not exist"). */
export function modelFitsChatEndpoint(baseUrl, model) {
  const m = String(model || '').trim();
  if (!m || !baseUrl) return false;
  const host = endpointHost(baseUrl);
  const lower = m.toLowerCase();
  if (host === 'api.openai.com' || host.endsWith('.openai.com')) {
    return !/deepseek|llama|qwen|mistral|mixtral|phi-|gemma|codellama|ollama/.test(lower);
  }
  return true;
}

/**
 * Primary keeps the requested model when it fits that host; secondary keeps its own model
 * unless the requested id also fits (never copy deepseek-v4-flash onto api.openai.com).
 */
export function buildChatCompletionEndpoints(cfg, effectiveModel) {
  const wanted = String(effectiveModel || cfg?.primary?.model || '').trim();
  const list = [];
  if (cfg?.primary?.baseUrl) {
    const model = modelFitsChatEndpoint(cfg.primary.baseUrl, wanted)
      ? wanted
      : String(cfg.primary.model || '').trim();
    list.push({ ...cfg.primary, model });
  }
  if (cfg?.secondary?.baseUrl) {
    const secWanted = modelFitsChatEndpoint(cfg.secondary.baseUrl, wanted)
      ? wanted
      : String(cfg.secondary.model || '').trim();
    if (secWanted) list.push({ ...cfg.secondary, model: secWanted });
  }
  return list;
}

/**
 * @param {string} [ownerUserId] - CEO user id; when set, user BYOK takes precedence over .env
 */
export function getLlmConfig(ownerUserId = null) {
  const resolved = resolveLlmConfigForUser(ownerUserId || null);
  // Platform-decided: honor admin primary/secondary switch
  if (!resolved.using_byok || resolved.provider === 'platform_decided') {
    const effective = getEffectivePlatformLlmEndpoints();
    const primary = { ...effective.primary };
    if (primary.baseUrl && primary.model && !modelFitsChatEndpoint(primary.baseUrl, primary.model)) {
      const fallback =
        (effective.secondary?.model && modelFitsChatEndpoint(primary.baseUrl, effective.secondary.model)
          ? effective.secondary.model
          : '') || 'gpt-4o-mini';
      console.warn('[llm] platform primary model does not fit host; using compatible model', {
        host: (() => {
          try {
            return new URL(primary.baseUrl).hostname;
          } catch {
            return '';
          }
        })(),
        from: primary.model,
        to: fallback,
      });
      primary.model = fallback;
    }
    return {
      primary: {
        baseUrl: primary.baseUrl,
        apiKey: primary.apiKey,
        model: primary.model,
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
 * @param {{ messages: Array<{ role: string, content: string }>, modelOverride?: string, maxTokens?: number, ownerUserId?: string, toolName?: string, memberKey?: string, source?: string, sessionId?: string, runId?: string, traceId?: string }}
 * @returns {Promise<{ content: string, modelUsed: string, usage?: object|null }>}
 */
export async function chatCompletions({
  messages,
  modelOverride,
  maxTokens = 1024,
  ownerUserId = null,
  toolName = null,
  temperature = null,
  responseFormat = null,
  memberKey = null,
  source = null,
  sessionId = null,
  runId = null,
  traceId = null,
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
  const endpoints = buildChatCompletionEndpoints(cfg, effectiveModel);

  const primary = endpoints[0];
  if (!primary?.baseUrl) throw new Error('OPENAI_PRIMARY_BASE_URL not set');
  if (!primary?.apiKey && !isLocalOllama(primary.baseUrl)) {
    throw new Error(
      cfg.using_byok
        ? 'User BYOK API key missing or invalid'
        : 'OPENAI_API_KEY or OPENAI_PRIMARY_API_KEY not set in backend/.env (same key used by AgentSystem gateway), or set BYOK on your profile'
    );
  }

  let lastErr;
  for (const ep of endpoints) {
    if (!ep.apiKey && !isLocalOllama(ep.baseUrl)) continue;
    console.info('[llm] chatCompletions try', {
      host: endpointHost(ep.baseUrl),
      model: ep.model,
      provider: cfg.provider,
      byok: !!cfg.using_byok,
      tool: toolName || null,
    });
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
        const text =
          typeof content === 'string' ? content : String(content ?? '');
        let usage = null;
        try {
          const { normalizeProviderUsage, meterChatCompletionsUsage } = await import(
            '../services/token-usage.js'
          );
          usage = normalizeProviderUsage(data?.usage);
          const promptText = (messages || [])
            .map((m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? '')))
            .join('\n');
          meterChatCompletionsUsage(ownerUserId, {
            usage: data?.usage || null,
            promptText,
            replyText: text,
            modelId: ep.model,
            toolName,
            memberKey,
            source,
            sessionId,
            runId,
            traceId,
          });
        } catch (meterErr) {
          console.warn('[llm] token meter skipped: %s', meterErr?.message || meterErr);
        }
        return { content: text, modelUsed: ep.model, usage };
      }

      const errText = await res.text();
      let errJson;
      try {
        errJson = JSON.parse(errText);
      } catch (_) {}
      const msg = errJson?.error?.message || errText || res.statusText;
      console.warn('[llm] chatCompletions failed', {
        host: endpointHost(ep.baseUrl),
        model: ep.model,
        status: res.status,
        message: String(msg || '').slice(0, 240),
      });
      lastErr = new Error(msg);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  throw lastErr || new Error('No model available');
}
