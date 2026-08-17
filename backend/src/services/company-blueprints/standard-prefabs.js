/**
 * Standard platform prefabs — source of truth beside industry company blueprints.
 * Layout: company-blueprints/standard/
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { listHireableRoleTemplates } from '../hireable-role-templates.js';

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

/**
 * Map runtime/prefab agent id → openclaw-workspace-templates/<folder>.
 * Prefab agents are owner-scoped (crm-s1-{slug}); templates are role-stable.
 */
export function resolveWorkspaceTemplateBaseId(agentOrId) {
  const raw =
    typeof agentOrId === 'string'
      ? agentOrId
      : agentOrId?.template_base_id ||
        agentOrId?.workspace_template ||
        agentOrId?.openclaw_agent_id ||
        agentOrId?.id ||
        '';
  let id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
  if (id.includes('openclaw-workspace-templates/')) {
    id = id.split('openclaw-workspace-templates/').pop() || id;
  }
  id = id.replace(/\/+$/, '');
  if (id.includes('--')) id = id.split('--').pop() || id;
  if (id.includes('/')) id = id.split('/').filter(Boolean).pop() || id;

  if (!id) return 'balserve';
  if (['balserve', 'workflowbuilder', 'platformhelp'].includes(id)) return id;
  if (id === 'crm-maker-a' || id.startsWith('crm-s1-')) return 'crm-maker-a';
  if (id === 'crm-maker-b' || id.startsWith('crm-s2-')) return 'crm-maker-b';
  if (id === 'crm-checker' || id.startsWith('crm-ap-')) return 'crm-checker';
  if (id === 'erp-maker-a' || id.startsWith('erp-s1-')) return 'erp-maker-a';
  if (id === 'erp-maker-b' || id.startsWith('erp-s2-')) return 'erp-maker-b';
  if (id === 'erp-checker' || id.startsWith('erp-ap-')) return 'erp-checker';
  if (id === 'erp-pnl' || id.startsWith('erp-pnl-')) return 'erp-pnl';
  if (id === 'erp-invoice' || id.startsWith('erp-inv-')) return 'erp-invoice';
  if (id === 'erp-project' || id.startsWith('erp-pm-')) return 'erp-project';
  if (id === 'video-orchestrator' || id.startsWith('video-orch-')) return 'video-orchestrator';
  if (id === 'video-story' || id.startsWith('video-story-')) return 'video-story';
  if (id === 'video-scene' || id.startsWith('video-scene-')) return 'video-scene';
  if (id === 'video-prompt' || id.startsWith('video-prompt-')) return 'video-prompt';
  const hire = listHireableRoleTemplates().find((r) => id === r.id || id.startsWith(`${r.id}-`));
  if (hire) return hire.id;
  return id;
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
    const kind = String(pack.kind || '').toLowerCase();
    const roleKey = a.role_key || a.key;
    let templateBase =
      a.workspace_template_base ||
      a.template_base_id ||
      (kind === 'crm' && a.key === 'maker_a'
        ? 'crm-maker-a'
        : kind === 'crm' && a.key === 'maker_b'
          ? 'crm-maker-b'
          : kind === 'crm' && a.key === 'checker'
            ? 'crm-checker'
            : kind === 'erp' && a.key === 'maker_a'
              ? 'erp-maker-a'
              : kind === 'erp' && a.key === 'maker_b'
                ? 'erp-maker-b'
                : kind === 'erp' && a.key === 'checker'
                  ? 'erp-checker'
                  : kind === 'erp' && a.key === 'pnl'
                    ? 'erp-pnl'
                    : kind === 'erp' && a.key === 'invoice'
                      ? 'erp-invoice'
                      : kind === 'erp' && a.key === 'project'
                        ? 'erp-project'
                        : null);
    if (!templateBase) templateBase = resolveWorkspaceTemplateBaseId(id);
    return {
      id,
      key: a.key,
      name: a.name,
      role: a.role || a.name,
      role_key: roleKey,
      department: a.department || 'Operations',
      tools: resolveTools(pack, a),
      template_base_id: templateBase,
      workspace_template: `openclaw-workspace-templates/${templateBase}/`,
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

/** Video content studio — agents.json under standard/video-content/ */
export function loadVideoContentAgentPack() {
  return loadJson('video-content/agents.json');
}

/**
 * Materialize video_content prefab agents (id_pattern: video-orch-{ownerSlug}, …).
 * Golden templates: openclaw-workspace-templates/video-*
 */
export function getVideoAgentDefs(ownerUserId) {
  const pack = loadVideoContentAgentPack();
  if (!pack || !Array.isArray(pack.agents)) return [];
  const s = ownerSlug(ownerUserId);
  const wf = ownerWorkflowSlug(ownerUserId);
  return pack.agents.map((a) => {
    const pattern = String(a.id_pattern || `video-${a.role_key || 'agent'}-{ownerSlug}`);
    const id = pattern
      .replace(/\{ownerSlug\}/gi, s)
      .replace(/\{ownerWorkflowSlug\}/gi, wf)
      .replace(/[^a-zA-Z0-9-_]/g, '-')
      .slice(0, 40);
    const templateBase =
      a.workspace_template_base ||
      a.template_base_id ||
      workspaceTemplateBaseId(a.workspace_template) ||
      resolveWorkspaceTemplateBaseId(id);
    return {
      id,
      key: a.role_key || a.key,
      role_key: a.role_key || a.key,
      name: a.name,
      role: a.role || a.name,
      department: a.department || 'Creative',
      user_facing: a.user_facing !== false,
      tools: Array.isArray(a.tools) ? [...a.tools] : [],
      template_base_id: templateBase,
      workspace_template:
        a.workspace_template || `openclaw-workspace-templates/${templateBase}/`,
    };
  });
}

export function loadVideoContentWorkflowsManifest() {
  return loadJson('video-content/workflows-manifest.json');
}

/** Load one video workflow template from standard/video-content/ (golden source). */
export function loadVideoContentWorkflowTemplate(templateKeyOrFile) {
  const key = String(templateKeyOrFile || '')
    .trim()
    .toLowerCase()
    .replace(/\.json$/i, '');
  const manifest = loadVideoContentWorkflowsManifest();
  const hit = (manifest?.workflows || []).find(
    (w) =>
      String(w.template_key || '').toLowerCase() === key ||
      String(w.file || '')
        .toLowerCase()
        .replace(/\.json$/i, '') === key
  );
  const file = hit?.file || (key.startsWith('workflow-') ? `${key}.json` : `workflow-${key.replace(/^video-/, '')}.json`);
  const tpl = loadJson(`video-content/${file}`);
  if (tpl && hit?.status) tpl.status = hit.status;
  return tpl;
}

export function listVideoContentWorkflowTemplates(opts = {}) {
  const includeStubs = opts.includeStubs === true;
  const manifest = loadVideoContentWorkflowsManifest();
  const out = [];
  for (const w of manifest?.workflows || []) {
    if (!includeStubs && String(w.status || '') === 'stub') continue;
    const tpl = loadVideoContentWorkflowTemplate(w.template_key || w.file);
    if (tpl?.graph?.nodes?.length) out.push(tpl);
  }
  return out;
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

/** Load one IBKR monthly workflow template from standard/trading/ (golden source). */
export function loadIbkrWorkflowTemplate(templateKeyOrFile) {
  const key = String(templateKeyOrFile || '')
    .trim()
    .toLowerCase()
    .replace(/\.json$/i, '');
  const manifest = getIbkrWorkflowManifest();
  const hit = (manifest?.workflows || []).find(
    (w) =>
      String(w.template_key || w.id || '').toLowerCase() === key ||
      String(w.file || '')
        .toLowerCase()
        .replace(/\.json$/i, '') === key
  );
  if (!hit?.file) return null;
  const tpl = loadJson(`trading/${hit.file}`);
  if (tpl && hit?.status) tpl.status = hit.status;
  return tpl;
}

export function listIbkrWorkflowTemplates() {
  const manifest = getIbkrWorkflowManifest();
  const out = [];
  for (const w of manifest?.workflows || []) {
    if (!w.file) continue;
    const tpl = loadIbkrWorkflowTemplate(w.template_key || w.id);
    if (tpl?.graph?.nodes?.length) out.push(tpl);
  }
  return out;
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
    trading: {
      workflows: (getIbkrWorkflowManifest()?.workflows || []).map((w) => ({
        id: w.id,
        file: w.file || null,
        seed_script: w.seed_script,
      })),
    },
    video_content: {
      agents: getVideoAgentDefs('ceo-preview').map((a) => ({
        id_pattern: a.id,
        name: a.name,
        workspace_template: a.workspace_template,
      })),
      workflows: (loadVideoContentWorkflowsManifest()?.workflows || []).map((w) => ({
        template_key: w.template_key,
        status: w.status,
        file: w.file,
      })),
    },
    industry_packs_dir: 'packs/',
    standard_dir: 'company-blueprints/standard/',
  };
}
