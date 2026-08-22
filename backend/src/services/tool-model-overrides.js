/**
 * Per-CEO tool -> LLM model overrides (Tools menu mapping).
 * Overrides profile/platform primary model for that tool only; keys/base stay from getLlmConfig.
 * Excludes non-BYOK paths: custom-script review, master_data embeddings, local speech.
 */
import { getDb } from '../db/schema.js';
import { getLlmConfig } from '../config/llm.js';
import { getUserLlmRow, getLlmCatalogPublic } from './user-llm-settings.js';
import {
  normalizeLlmModelForProvider,
  getProviderModelCatalog,
} from '../config/llm-provider-registry.js';
import { listToolsMeta } from './content-tools-meta.js';

/** Tools that use owner-aware BYOK/platform chat, vision, image, or video models. */
export const TOOL_MODEL_MAPPABLE = Object.freeze([
  { name: 'summarize_url', label: 'Summarize URL', kind: 'chat', description: 'Page fetch + LLM summary' },
  { name: 'analyze_image', label: 'Analyze image', kind: 'vision', description: 'Vision / describe / OCR' },
  { name: 'generate_image', label: 'Generate image', kind: 'image', description: 'Text-to-image (GPT-image / OpenAI-compatible)' },
  { name: 'generate_video', label: 'Generate video', kind: 'video', description: 'Short video (Replicate)' },
  { name: 'learnings_summary', label: 'Learnings summary', kind: 'chat', description: 'Kanban / feedback learnings' },
  { name: 'brain_history', label: 'Brain history', kind: 'chat', description: 'Workflow Brain I/O summary' },
  { name: 'master_data_rag', label: 'Master Data RAG (summarize)', kind: 'chat', description: 'Optional LLM answer on RAG (not embeddings)' },
  { name: 'intent_classify_and_delegate', label: 'Intent classify & delegate', kind: 'chat', description: 'COO intent classification' },
  { name: 'agent_workflow_certify_start', label: 'Workflow certify (Maker)', kind: 'chat', description: 'Autonomous certify Maker LLM' },
  { name: 'workflow_builder_chat', label: 'Workflow Builder chat', kind: 'chat', description: 'Visual workflow designer (create/edit graphs)' },
  { name: 'browse_task_start', label: 'Browser task (autonomous)', kind: 'chat', description: 'Autonomous browser agent decisions' },
  { name: 'ibkr_order_learnings', label: 'IBKR order learnings', kind: 'chat', description: 'Order history LLM summary' },
  { name: 'job_fit_score', label: 'Job fit score', kind: 'chat', description: 'Job vs profile scoring' },
  { name: 'job_tailor_resume', label: 'Job tailor resume', kind: 'chat', description: 'Cover letter / tailoring' },
  { name: 'job_phase1_submit_ceo_review', label: 'Job phase-1 CEO review', kind: 'chat', description: 'Job pipeline LLM steps' },
  { name: 'job_ceo_review_include', label: 'Job CEO review include', kind: 'chat', description: 'Job review LLM steps' },
  { name: 'job_run_workflow_now', label: 'Job run workflow now', kind: 'chat', description: 'Job pipeline orchestration LLM' },
]);

const MAPPABLE_SET = new Set(TOOL_MODEL_MAPPABLE.map((t) => t.name));

export function isToolModelMappable(toolName) {
  return MAPPABLE_SET.has(String(toolName || '').trim());
}

export function getToolModelOverride(ownerUserId, toolName) {
  const owner = String(ownerUserId || '').trim();
  const name = String(toolName || '').trim();
  if (!owner || !name || !isToolModelMappable(name)) return null;
  try {
    const row = getDb()
      .prepare(
        'SELECT llm_model FROM tool_model_overrides WHERE owner_user_id = ? AND tool_name = ?'
      )
      .get(owner, name);
    const m = String(row?.llm_model || '').trim();
    return m || null;
  } catch (e) {
    console.warn('[tool-model-overrides] read failed tool=%s: %s', name, e?.message || e);
    return null;
  }
}

export function resolveToolModel(ownerUserId, toolName, fallbackModel = null) {
  const ov = getToolModelOverride(ownerUserId, toolName);
  if (ov) return ov;
  const fb = String(fallbackModel || '').trim();
  if (fb) return fb;
  try {
    const cfg = getLlmConfig(ownerUserId || null);
    return String(cfg?.primary?.model || '').trim() || null;
  } catch {
    return null;
  }
}

export function listToolModelMappings(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');

  let cfg;
  try {
    cfg = getLlmConfig(owner);
  } catch (e) {
    cfg = { primary: { model: '' }, using_byok: false, provider: 'platform_decided' };
  }
  const profileModel = String(cfg?.primary?.model || '').trim();
  const llmRow = getUserLlmRow(owner);
  const provider = String(llmRow?.llm_provider || cfg?.provider || 'platform_decided').trim();

  let overrides = [];
  try {
    overrides = getDb()
      .prepare('SELECT tool_name, llm_model, updated_at FROM tool_model_overrides WHERE owner_user_id = ?')
      .all(owner);
  } catch (_) {
    overrides = [];
  }
  const byName = new Map(overrides.map((r) => [r.tool_name, r]));

  let metaByName = new Map();
  try {
    for (const t of listToolsMeta() || []) {
      metaByName.set(t.name, t);
    }
  } catch (_) {}

  const tools = TOOL_MODEL_MAPPABLE.map((def) => {
    const stored = byName.get(def.name);
    const override = String(stored?.llm_model || '').trim() || null;
    const meta = metaByName.get(def.name);
    return {
      name: def.name,
      label: def.label || meta?.display_name || def.name,
      kind: def.kind,
      description: def.description || meta?.purpose || '',
      llm_model: override,
      effective_model: override || profileModel || null,
      uses_profile_default: !override,
      catalog_model_used: meta?.model_used || '',
      updated_at: stored?.updated_at || null,
    };
  });

  const catalog = getLlmCatalogPublic();
  const providerCatalog = getProviderModelCatalog(provider);
  // For platform_decided, offer OpenAI chat suggestions as free-form still allowed for image/video ids.
  const modelOptions =
    provider && provider !== 'platform_decided' && (providerCatalog.models || []).length
      ? providerCatalog.models
      : getProviderModelCatalog('openai').models || [];
  return {
    owner_user_id: owner,
    provider,
    using_byok: !!cfg?.using_byok,
    profile_model: profileModel || null,
    platform_endpoint: cfg?.platform_endpoint || null,
    catalog,
    model_options: modelOptions,
    allow_custom_model: true,
    tools,
  };
}

export function putToolModelMappings(ownerUserId, mappings) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  if (!Array.isArray(mappings)) throw new Error('mappings must be an array');

  const llmRow = getUserLlmRow(owner);
  const provider = String(llmRow?.llm_provider || 'platform_decided').trim() || 'platform_decided';
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO tool_model_overrides (owner_user_id, tool_name, llm_model, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, tool_name) DO UPDATE SET
       llm_model = excluded.llm_model,
       updated_at = datetime('now')`
  );
  const del = db.prepare(
    'DELETE FROM tool_model_overrides WHERE owner_user_id = ? AND tool_name = ?'
  );

  const run = db.transaction(() => {
    for (const item of mappings) {
      const name = String(item?.tool_name || item?.name || '').trim();
      if (!name) throw new Error('tool_name required');
      if (!isToolModelMappable(name)) {
        throw new Error('Tool not mappable for BYOK models: ' + name);
      }
      let modelRaw = item?.llm_model;
      if (modelRaw != null && typeof modelRaw !== 'string') {
        modelRaw = String(modelRaw);
      }
      const model = String(modelRaw || '').trim();
      if (!model) {
        del.run(owner, name);
        continue;
      }
      let normalized = model;
      if (model.length > 200) {
        throw new Error(name + ': model id is too long (max 200 characters)');
      }
      // Chat-provider catalog when provider is BYOK; still allow custom ids for image/video versions.
      if (provider && provider !== 'platform_decided') {
        const norm = normalizeLlmModelForProvider(provider, model, { required: false });
        if (norm?.ok === false && norm?.error) {
          // allowCustom providers already accept custom; reject only hard failures
          if (!String(norm.error).includes('not valid')) {
            throw new Error(name + ': ' + norm.error);
          }
          // Replicate/image version style: accept if safe character class only
          if (!/^[a-zA-Z0-9_./:-]+$/.test(model)) {
            throw new Error(name + ': model id contains invalid characters');
          }
        } else if (norm?.model) {
          normalized = norm.model;
        }
      } else if (!/^[a-zA-Z0-9_./:-]+$/.test(model)) {
        throw new Error(name + ': model id contains invalid characters');
      }
      upsert.run(owner, name, normalized);
    }
  });
  run();
  console.info('[tool-model-overrides] saved owner=%s count=%s', owner, mappings.length);
  return listToolModelMappings(owner);
}
