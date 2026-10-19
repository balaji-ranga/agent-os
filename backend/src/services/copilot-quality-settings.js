import { getPlatformSetting, setPlatformSetting, getEffectivePlatformLlmEndpoints, describeLlmEndpoint } from './platform-llm-settings.js';
import { getDb } from '../db/schema.js';
import { ensureModelRoutingTables } from './model-routing-registry.js';
import {privateCopilotModel} from './copilot-local-models.js';

export const COPILOT_QUALITY_SETTING = 'digital_adoption_maker_checker';
export const DEFAULT_COPILOT_QUALITY = Object.freeze({ enabled: false, checkerMode: 'platform_inactive' });

export function getCopilotQualitySettings() {
  const saved = getPlatformSetting(COPILOT_QUALITY_SETTING);
  if (saved == null) return { ...DEFAULT_COPILOT_QUALITY };
  let value; try { value = JSON.parse(saved); } catch { throw new Error('Copilot review settings are invalid'); }
  if (!value || typeof value.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning','ollama_local'].includes(value.checkerMode)) throw new Error('Copilot review settings are invalid');
  if(value.checkerMode==='ollama_local'&&(typeof value.checkerDeploymentId!=='string'||!/^[a-zA-Z0-9_.-]{1,100}$/.test(value.checkerDeploymentId)||typeof value.localThinking!=='boolean'))throw new Error('Copilot local checker settings are invalid');
  if(value.checkerMaxTokens!==undefined&&(!Number.isInteger(value.checkerMaxTokens)||value.checkerMaxTokens<128||value.checkerMaxTokens>2048))throw new Error('Copilot token budget is invalid');
  return { enabled: value.enabled, checkerMode: value.checkerMode,...(value.checkerMaxTokens!==undefined?{checkerMaxTokens:value.checkerMaxTokens}:{}),...(value.checkerMode==='ollama_local'?{checkerDeploymentId:value.checkerDeploymentId,localThinking:value.localThinking}:{}) };
}

export function getCopilotQualityStatus() {
  const settings = getCopilotQualitySettings(), effective = getEffectivePlatformLlmEndpoints();
  let checker;
  try {
    if (['ollama_reasoning','ollama_local'].includes(settings.checkerMode)) {
      ensureModelRoutingTables();
      const row = getDb().prepare('SELECT * FROM model_deployments WHERE id=? AND enabled=1').get(settings.checkerMode==='ollama_local'?settings.checkerDeploymentId:'ollama-reasoning');
      if (privateCopilotModel(row)) checker = { baseUrl: row.base_url, model: row.model, apiKey: 'internal' };
    } else checker = effective.secondary;
  } catch { /* Show unavailable without exposing configuration errors or secrets. */ }
  const ready = ep => !!(ep?.baseUrl && ep?.model && ep?.apiKey);
  ensureModelRoutingTables();const localModels=getDb().prepare('SELECT id,name,model,base_url,enabled FROM model_deployments WHERE enabled=1').all().filter(privateCopilotModel).map(({id,name,model})=>({id,name,model}));
  return { ...settings, scope: 'all_websites',localModels, maker: { slot: effective.active, label: describeLlmEndpoint(effective.primary).label },
    checker: { slot: ['ollama_reasoning','ollama_local'].includes(settings.checkerMode) ? settings.checkerMode : effective.active === 'primary' ? 'secondary' : 'primary', label: describeLlmEndpoint(checker).label, configured: ready(checker) },
    failureMode: 'stop', maxRevisions: 1 };
}

export function saveCopilotQualitySettings(input) {
  const bad=()=>Object.assign(new Error('Expected enabled boolean, supported checker route and registered private local model selection'),{status:400});
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['enabled', 'checkerMode','checkerDeploymentId','localThinking','checkerMaxTokens'].includes(key)) || typeof input.enabled !== 'boolean' || !['platform_inactive', 'ollama_reasoning','ollama_local'].includes(input.checkerMode)) throw bad();
  const saved={enabled:input.enabled,checkerMode:input.checkerMode};
  if(input.checkerMaxTokens!==undefined){if(!Number.isInteger(input.checkerMaxTokens)||input.checkerMaxTokens<128||input.checkerMaxTokens>2048)throw bad();saved.checkerMaxTokens=input.checkerMaxTokens;}
  else {try{const previous=getCopilotQualitySettings();if(previous.checkerMaxTokens!==undefined)saved.checkerMaxTokens=previous.checkerMaxTokens;}catch{/* Explicit valid saves can repair corrupt configuration. */}}
  if(input.checkerMode==='ollama_local'){
    if(typeof input.checkerDeploymentId!=='string'||!/^[a-zA-Z0-9_.-]{1,100}$/.test(input.checkerDeploymentId)||typeof input.localThinking!=='boolean')throw bad();
    ensureModelRoutingTables();if(!privateCopilotModel(getDb().prepare('SELECT * FROM model_deployments WHERE id=? AND enabled=1').get(input.checkerDeploymentId)))throw bad();
    Object.assign(saved,{checkerDeploymentId:input.checkerDeploymentId,localThinking:input.localThinking});
  }else if(input.checkerDeploymentId!==undefined||input.localThinking!==undefined)throw bad();
  setPlatformSetting(COPILOT_QUALITY_SETTING, JSON.stringify(saved));
  return getCopilotQualityStatus();
}
