import { getPlatformSetting, setPlatformSetting, getEffectivePlatformLlmEndpoints, describeLlmEndpoint } from './platform-llm-settings.js';
import { getDb } from '../db/schema.js';
import { ensureModelRoutingTables } from './model-routing-registry.js';

export const COPILOT_QUALITY_SETTING = 'digital_adoption_maker_checker';
export const DEFAULT_COPILOT_QUALITY = Object.freeze({ enabled: false, checkerMode: 'platform_inactive' });

export function getCopilotQualitySettings() {
  const saved = getPlatformSetting(COPILOT_QUALITY_SETTING);
  if (saved == null) return { ...DEFAULT_COPILOT_QUALITY };
  let value; try { value = JSON.parse(saved); } catch { throw new Error('Copilot review settings are invalid'); }
  if (!value || typeof value.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning'].includes(value.checkerMode)) throw new Error('Copilot review settings are invalid');
  return { enabled: value.enabled, checkerMode: value.checkerMode };
}

export function getCopilotQualityStatus() {
  const settings = getCopilotQualitySettings(), effective = getEffectivePlatformLlmEndpoints();
  let checker;
  try {
    if (settings.checkerMode === 'ollama_reasoning') {
      ensureModelRoutingTables();
      const row = getDb().prepare("SELECT * FROM model_deployments WHERE id='ollama-reasoning' AND enabled=1").get();
      if (row) { const url = new URL(row.base_url); if (['http:', 'https:'].includes(url.protocol) && ['ollama', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !url.username && !url.password && !url.search && !url.hash && !/cloud/i.test(row.model)) checker = { baseUrl: row.base_url, model: row.model, apiKey: 'internal' }; }
    } else checker = effective.secondary;
  } catch { /* Show unavailable without exposing configuration errors or secrets. */ }
  const ready = ep => !!(ep?.baseUrl && ep?.model && ep?.apiKey);
  return { ...settings, scope: 'all_websites', maker: { slot: effective.active, label: describeLlmEndpoint(effective.primary).label },
    checker: { slot: settings.checkerMode === 'ollama_reasoning' ? 'ollama_reasoning' : effective.active === 'primary' ? 'secondary' : 'primary', label: describeLlmEndpoint(checker).label, configured: ready(checker) },
    failureMode: 'stop', maxRevisions: 1 };
}

export function saveCopilotQualitySettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'checkerMode'].includes(key)) || typeof input.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning'].includes(input.checkerMode)) throw Object.assign(new Error('Expected enabled boolean and a supported checkerMode'), { status: 400 });
  setPlatformSetting(COPILOT_QUALITY_SETTING, JSON.stringify({ enabled: input.enabled, checkerMode: input.checkerMode }));
  return getCopilotQualityStatus();
}
