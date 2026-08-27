/**
 * Profile "Efficiency mode": short platform LLM jobs use local Ollama
 * instead of Platform_BYOK / platform primary. Agent Chat is unchanged.
 */
import {
  resolveProviderBaseUrl,
  getProviderModelCatalog,
} from '../config/llm-provider-registry.js';
import { getDb } from '../db/schema.js';

/** Wave-1 utility jobs eligible for local Ollama when efficiency mode is Yes. */
export const EFFICIENCY_MODE_TOOLS = Object.freeze([
  'learnings_summary',
  'chat_archive_title',
  'brain_history',
  'ibkr_order_learnings',
  'broadcast_notify_intent',
  'coo_tool_ownership',
  'goal_plan_tool_args',
  'ceo_guardrails_enrich',
  'summarize_url',
  'master_data_rag',
]);

const TOOL_SET = new Set(EFFICIENCY_MODE_TOOLS);

export function parseEfficiencyModeFlag(value) {
  if (value === true || value === 1) return true;
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on' || raw === 'y';
}

export function isEfficiencyModeTool(toolName) {
  return TOOL_SET.has(String(toolName || '').trim());
}

export function getUserEfficiencyMode(userId) {
  const id = String(userId || '').trim();
  if (!id) return false;
  try {
    const row = getDb()
      .prepare('SELECT llm_efficiency_mode FROM platform_users WHERE id = ?')
      .get(id);
    return parseEfficiencyModeFlag(row?.llm_efficiency_mode);
  } catch (e) {
    console.warn('[llm-efficiency] read failed user=%s: %s', id, e?.message || e);
    return false;
  }
}

export function shouldUseEfficiencyOllama(ownerUserId, toolName) {
  if (!isEfficiencyModeTool(toolName)) return false;
  return getUserEfficiencyMode(ownerUserId);
}

function normalizeOllamaBaseUrl(url) {
  const raw = String(url || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  if (raw.endsWith('/v1')) return raw;
  if (raw.endsWith('/chat/completions')) return raw.replace(/\/chat\/completions$/, '');
  return `${raw}/v1`;
}

/** OpenAI-compatible local Ollama endpoint (ops env / catalog). No paid key. */
export function getEfficiencyOllamaLlmConfig() {
  const catalog = getProviderModelCatalog('ollama_free');
  const model =
    String(process.env.OLLAMA_MODEL || '').trim() ||
    String(catalog?.defaultModel || '').trim() ||
    'llama3.2';
  const baseUrl =
    normalizeOllamaBaseUrl(resolveProviderBaseUrl('ollama_free')) ||
    'http://127.0.0.1:11434/v1';
  return {
    primary: {
      baseUrl,
      apiKey: String(process.env.OLLAMA_API_KEY || '').trim() || 'ollama',
      model,
      source: 'efficiency_ollama',
    },
    secondary: null,
    provider: 'ollama_free',
    using_byok: false,
    platform_endpoint: 'efficiency_ollama',
  };
}
