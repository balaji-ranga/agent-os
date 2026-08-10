/**
 * Standard platform prefabs — source of truth beside industry company blueprints.
 * Layout: company-blueprints/standard/
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STANDARD_DIR = join(__dirname, 'standard');

function loadJson(rel) {
  const path = join(STANDARD_DIR, rel);
  if (!existsSync(path)) {
    console.warn('[standard-prefabs] missing', path);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
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

export function getPlatformLeanAgents() {
  const pack = loadJson('platform-agents.json');
  return pack?.agents || [];
}

export function getIbkrWorkflowManifest() {
  return loadJson('trading/ibkr-workflows-manifest.json');
}

export function listStandardPrefabInventory() {
  const cat = getStandardCatalog();
  return {
    catalog_id: cat.id,
    version: cat.version,
    platform_agents: getPlatformLeanAgents().map((a) => ({ id: a.id, name: a.name })),
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