/**
 * Overlay the tested video_content studio (standard/video-content + pack JSON)
 * onto industry / demo blueprints at read time so Company setup and Operate
 * install the same agents + graphs Balaji Ranganathan validated.
 *
 * Golden graphs stay in standard/video-content/; this module does not copy them
 * into demo_balaji_ranganathan.json.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  loadVideoContentAgentPack,
  listVideoContentWorkflowTemplates,
  loadVideoContentWorkflowsManifest,
} from './standard-prefabs.js';

const VIDEO_PACK_ID = 'video_content';
const PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'packs');

function loadVideoIndustryPackRaw() {
  const path = join(PACKS_DIR, `${VIDEO_PACK_ID}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn('[video-content-pack] load industry pack failed', e?.message || e);
    return null;
  }
}

function videoPackAliases() {
  return new Set((loadVideoIndustryPackRaw()?.aliases || []).map((a) => String(a)));
}

function videoWorkflowTemplateKeys() {
  const manifest = loadVideoContentWorkflowsManifest();
  return new Set(
    (manifest?.workflows || [])
      .map((w) => String(w.template_key || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function nameKey(item) {
  return String(item?.name || item?.title || item?.filename || '')
    .trim()
    .toLowerCase();
}

function workflowKey(t) {
  return String(t?.template_key || t?.id || t?.name || '')
    .trim()
    .toLowerCase();
}

export function isVideoWorkflowTemplate(t) {
  if (!t || typeof t !== 'object') return false;
  if (String(t.kind || '').toLowerCase() === VIDEO_PACK_ID) return true;
  const key = workflowKey(t);
  const keys = videoWorkflowTemplateKeys();
  if (keys.has(key)) return true;
  for (const k of keys) {
    if (k && (key === k || key.startsWith(`${k}-`))) return true;
  }
  return false;
}

function portableVideoAgents() {
  const pack = loadVideoContentAgentPack();
  return Array.isArray(pack?.agents) ? pack.agents.map((a) => ({ ...a })) : [];
}

function portableVideoWorkflowTemplates() {
  const manifest = loadVideoContentWorkflowsManifest();
  const byKey = new Map((manifest?.workflows || []).map((w) => [String(w.template_key || ''), w]));
  return listVideoContentWorkflowTemplates({ includeStubs: false }).map((tpl) => {
    const meta = byKey.get(String(tpl.template_key || '')) || {};
    return {
      template_key: tpl.template_key,
      name: tpl.name,
      description: tpl.description,
      chat_trigger_phrase: tpl.chat_trigger_phrase,
      trigger_modes: tpl.trigger_modes || ['manual', 'chat'],
      workflow_id_pattern: tpl.workflow_id_pattern || meta.workflow_id_pattern,
      kind: tpl.kind || VIDEO_PACK_ID,
      phase: tpl.phase || meta.phase,
      status: tpl.status || meta.status || 'ready',
      standard_path: meta.file ? `standard/video-content/${meta.file}` : undefined,
      graph: tpl.graph,
    };
  });
}

function mergeByName(base = [], extra = []) {
  const by = new Map();
  for (const item of base || []) {
    const k = nameKey(item);
    if (k) by.set(k, item);
    else by.set(`anon:${by.size}`, item);
  }
  for (const item of extra || []) {
    const k = nameKey(item);
    if (k && !by.has(k)) by.set(k, item);
  }
  return [...by.values()];
}

function mergeAgents(base = [], extra = []) {
  const by = new Map();
  for (const a of base || []) {
    const k = nameKey(a);
    if (k) by.set(k, { ...a });
  }
  for (const a of extra || []) {
    const k = nameKey(a);
    if (!k) continue;
    const prev = by.get(k);
    if (!prev) {
      by.set(k, { ...a });
      continue;
    }
    by.set(k, {
      ...prev,
      ...a,
      tools: Array.isArray(a.tools) && a.tools.length ? a.tools : prev.tools,
      id_pattern: a.id_pattern || prev.id_pattern,
      workspace_template: a.workspace_template || prev.workspace_template,
      workspace_template_base: a.workspace_template_base || prev.workspace_template_base,
    });
  }
  return [...by.values()];
}

function mergeWorkflowTemplates(base = [], extra = []) {
  const by = new Map();
  for (const t of base || []) {
    const k = workflowKey(t);
    if (k) by.set(k, t);
  }
  for (const t of extra || []) {
    const k = workflowKey(t);
    if (!k) continue;
    const prev = by.get(k);
    const extraHasGraph = (t.graph?.nodes || []).length > 0;
    const prevHasGraph = (prev?.graph?.nodes || []).length > 0;
    if (!prev || (extraHasGraph && !prevHasGraph) || (extraHasGraph && isVideoWorkflowTemplate(t))) {
      by.set(k, t);
    }
  }
  return [...by.values()];
}

function mergeSops(base = [], extra = []) {
  const by = new Map();
  for (const s of base || []) {
    const k = String(s.filename || s.title || '').toLowerCase();
    if (k) by.set(k, s);
  }
  for (const s of extra || []) {
    const k = String(s.filename || s.title || '').toLowerCase();
    if (k && !by.has(k)) by.set(k, s);
  }
  return [...by.values()];
}

/** Fill video_content pack agents + workflow graphs from golden standard JSON. */
export function hydrateVideoContentPack(bp) {
  if (!bp || typeof bp !== 'object') return bp;
  const agents = mergeAgents(bp.agents || [], portableVideoAgents());
  const workflow_templates = mergeWorkflowTemplates(bp.workflow_templates || [], portableVideoWorkflowTemplates());
  return {
    ...bp,
    agents,
    workflow_templates,
    depth: bp.depth || 'deep',
  };
}

function companionIds(bp, systemById) {
  const ids = new Set();
  for (const id of bp?.companion_packs || []) {
    if (id) ids.add(String(id));
  }
  const sys = systemById?.get?.(bp?.id);
  for (const id of sys?.companion_packs || []) {
    if (id) ids.add(String(id));
  }
  return [...ids];
}

function mergePackInto(base, extra) {
  if (!extra) return base;
  const companion_packs = [...new Set([...(base.companion_packs || []), ...(extra.companion_packs || []), extra.id].filter(Boolean))];
  return {
    ...base,
    companion_packs,
    departments: mergeByName(base.departments, extra.departments),
    agents: mergeAgents(base.agents, extra.agents),
    knowledge_tables: mergeByName(base.knowledge_tables, extra.knowledge_tables),
    sop_documents: mergeSops(base.sop_documents, extra.sop_documents),
    workflow_templates: mergeWorkflowTemplates(base.workflow_templates, extra.workflow_templates),
    workflows: [...new Set([...(base.workflows || []), ...(extra.workflows || [])])],
    channels: [...new Set([...(base.channels || []), ...(extra.channels || [])])],
  };
}

export function blueprintWantsVideoContent(bp) {
  if (!bp) return false;
  const id = String(bp.id || bp.industry || '').toLowerCase();
  const aliases = videoPackAliases();
  if (id === VIDEO_PACK_ID || aliases.has(id)) return true;
  if ((bp.aliases || []).some((a) => aliases.has(String(a)))) return true;
  if ((bp.companion_packs || []).includes(VIDEO_PACK_ID)) return true;
  if ((bp.workflow_templates || []).some((t) => isVideoWorkflowTemplate(t))) return true;
  return false;
}

/**
 * Ensure video_content pack graphs are complete, and companion packs
 * (e.g. demo_balaji_ranganathan → video_content) receive the tested studio.
 * @param {object} bp
 * @param {Map<string, object>} systemById system JSON packs only (not published overlay)
 */
export function overlayTestedVideoStudio(bp, systemById) {
  if (!bp || typeof bp !== 'object') return bp;
  const id = String(bp.id || bp.industry || '').toLowerCase();
  const aliases = videoPackAliases();
  let next = { ...bp };
  if (id === VIDEO_PACK_ID || aliases.has(id) || (next.aliases || []).some((a) => aliases.has(String(a)))) {
    next = hydrateVideoContentPack(next);
  }
  for (const cid of companionIds(next, systemById)) {
    if (!cid || cid === next.id) continue;
    let companion = systemById?.get?.(cid);
    if (!companion) continue;
    if (String(companion.id || cid) === VIDEO_PACK_ID) {
      companion = hydrateVideoContentPack(companion);
    }
    next = mergePackInto(next, companion);
  }
  return next;
}
