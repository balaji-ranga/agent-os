/**
 * Standard platform prefabs — source of truth beside industry company blueprints.
 * Layout: company-blueprints/standard/
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STANDARD_DIR = join(__dirname, 'standard');

/** Hardcoded fallback if platform-agents.json is missing/corrupt. */
export const FALLBACK_PLATFORM_LEAN_AGENT_IDS = Object.freeze([
  'balserve',
  'workflowbuilder',
  'platformhelp',
]);

function loadJson(rel) {
  const path = join(STANDARD_DIR, rel);
  if (!existsSync(path)) {
    console.warn('[standard-prefabs] missing', path);
    return null;
  }
  try {
    let raw = readFileSync(path);
    // Tolerate accidental UTF-16 saves (common on Windows tooling)
    if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      raw = Buffer.from(raw.toString('utf16le').replace(/^\uFEFF/, ''), 'utf8');
    } else if (raw.length >= 4 && raw[1] === 0 && raw[3] === 0 && raw[0] !== 0) {
      raw = Buffer.from(raw.toString('utf16le'), 'utf8');
    }
    return JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.warn('[standard-prefabs] load failed', path, e?.message || e);
    return null;
  }
}

let _catalog = null;
export function getStandardCatalog() {
  if (!_catalog) _catalog = loadJson('catalog.json') || {};
  return _catalog;
}

export function invalidateStandardPrefabCache() {
  _catalog = null;
}

export function ownerSlug(ownerUserId) {
  return (
    String(ownerUserId || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 12) || 'ceo'
  );
}

export function ownerWorkflowSlug(ownerUserId) {
  return (
    String(ownerUserId || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'ceo'
  );
}

function resolveTools(pack, agentDef) {
  if (Array.isArray(agentDef.tools) && agentDef.tools.length) return agentDef.tools;
  const ref = agentDef.tools_ref;
  const shared = pack.shared_tools || {};
  if (ref && Array.isArray(shared[ref])) return [...shared[ref]];
  return [];
}

export function materializeAgentDefs(pack, ownerUserId) {
  if (!pack || !Array.isArray(pack.agents)) return [];
  const s = ownerSlug(ownerUserId);
  const prefixes = pack.id_prefix || {};
  return pack.agents.map((a) => {
    const prefix = prefixes[a.key] || `${pack.kind || 'prefab'}-${a.key}-`;
    const id = String(prefix + s).slice(0, 40);
    return {
      id,
      key: a.key,
      name: a.name,
      role: a.role || a.name,
      role_key: a.role_key || a.key,
      department: a.department || 'Operations',
      tools: resolveTools(pack, a),
    };
  });
}

export function loadCrmAgentPack(provider) {
  const p = String(provider || '').toLowerCase();
  if (p === 'erpnext') return loadJson('business-core/agents-crm-erpnext.json');
  if (p === 'twenty') return loadJson('business-core/agents-crm-twenty.json');
  return null;
}

export function loadErpAgentPack() {
  return loadJson('business-core/agents-erp-erpnext.json');
}

export function getCrmAgentDefs(ownerUserId, provider) {
  return materializeAgentDefs(loadCrmAgentPack(provider), ownerUserId);
}

export function getErpAgentDefs(ownerUserId) {
  return materializeAgentDefs(loadErpAgentPack(), ownerUserId);
}

export function loadMakerCheckerWorkflowTemplate(kind) {
  const k = String(kind || '').toLowerCase();
  if (k === 'erp') return loadJson('business-core/workflow-erp-maker-checker.json');
  if (k === 'crm') return loadJson('business-core/workflow-crm-maker-checker.json');
  return null;
}

/**
 * Template folder basename under openclaw-workspace-templates/
 * e.g. "openclaw-workspace-templates/balserve/" → "balserve"
 */
export function workspaceTemplateBaseId(workspaceTemplate) {
  const raw = String(workspaceTemplate || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '');
  if (!raw) return null;
  const base = basename(raw);
  return base && base !== '.' ? base : null;
}

export function getPlatformLeanAgents() {
  const pack = loadJson('platform-agents.json');
  return Array.isArray(pack?.agents) ? pack.agents : [];
}

/** Agent ids from company-blueprints/standard/platform-agents.json (lean default onboard). */
export function getPlatformLeanAgentIds() {
  const ids = getPlatformLeanAgents()
    .map((a) => String(a?.id || '').trim().toLowerCase())
    .filter(Boolean);
  return ids.length ? ids : [...FALLBACK_PLATFORM_LEAN_AGENT_IDS];
}

/** Tool grant list from platform-agents.json for a lean agent id. */
export function getPlatformLeanAgentTools(agentId) {
  const id = String(agentId || '').toLowerCase();
  const hit = getPlatformLeanAgents().find((a) => String(a.id || '').toLowerCase() === id);
  return Array.isArray(hit?.tools) ? [...hit.tools] : [];
}

/**
 * Lean platform defs for Admin refresh / catalog sync.
 * @returns {Array<{ id: string, name: string, role: string, department?: string, workspace_template?: string, template_base_id: string, is_coo: boolean }>}
 */
export function getPlatformLeanAgentDefs() {
  const list = getPlatformLeanAgents();
  if (!list.length) {
    return FALLBACK_PLATFORM_LEAN_AGENT_IDS.map((id) => ({
      id,
      name: id === 'balserve' ? 'COO / BalServe' : id === 'workflowbuilder' ? 'Workflow Builder' : 'Platform Help',
      role:
        id === 'balserve'
          ? 'Chief Operating Officer'
          : id === 'workflowbuilder'
            ? 'Design, mutate, certify agent workflows'
            : 'Product how-to via platform-help RAG',
      department: id === 'balserve' ? 'Executive' : id === 'workflowbuilder' ? 'Engineering' : 'Operations',
      workspace_template: `openclaw-workspace-templates/${id}/`,
      template_base_id: id,
      is_coo: id === 'balserve',
    }));
  }
  return list.map((a) => {
    const id = String(a.id || '').trim().toLowerCase();
    const templateBase = workspaceTemplateBaseId(a.workspace_template) || id || 'balserve';
    return {
      id,
      name: a.name || id,
      role: a.role || a.name || id,
      department: a.department || null,
      workspace_template: a.workspace_template || `openclaw-workspace-templates/${templateBase}/`,
      template_base_id: templateBase,
      is_coo: id === 'balserve' || !!a.is_coo,
      notes: a.notes || '',
      help_corpus: a.help_corpus || null,
      seed: a.seed || null,
      tools: Array.isArray(a.tools) ? [...a.tools] : [],
    };
  });
}

export function getIbkrWorkflowManifest() {
  return loadJson('trading/ibkr-workflows-manifest.json');
}

export function listStandardPrefabInventory() {
  const cat = getStandardCatalog();
  return {
    catalog_id: cat.id,
    version: cat.version,
    platform_agents: getPlatformLeanAgents().map((a) => ({
      id: a.id,
      name: a.name,
      workspace_template: a.workspace_template,
      tools: Array.isArray(a.tools) ? a.tools.length : 0,
    })),
    platform_lean_ids: getPlatformLeanAgentIds(),
    business_core: {
      crm_twenty: !!(loadCrmAgentPack('twenty')?.agents || []).length,
      crm_erpnext: !!(loadCrmAgentPack('erpnext')?.agents || []).length,
      erp_erpnext: !!(loadErpAgentPack()?.agents || []).length,
      workflow_crm: !!loadMakerCheckerWorkflowTemplate('crm'),
      workflow_erp: !!loadMakerCheckerWorkflowTemplate('erp'),
    },
    trading: getIbkrWorkflowManifest(),
    industry_packs_dir: 'packs/',
    standard_dir: 'company-blueprints/standard/',
  };
}
