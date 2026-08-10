/**
 * From SOURCE_OWNER_USER_ID (BrightBox demo CEO by default):
 *  1) Publish company blueprint pack + export zip (scrubbed)
 *  2) Regenerate standard/platform-agents.json from live lean agents
 *  3) Regenerate business-core agent packs + MC workflow graphs
 *
 * Usage (backend container):
 *   node scripts/publish-brightbox-and-regenerate-standard.js
 * Env:
 *   SOURCE_OWNER_USER_ID=ceo-demo-brightbox-744921
 *   BLUEPRINT_ID=demo_brightbox_gifts
 *   OUT_DIR=/tmp/brightbox-demo-bp
 *   WRITE_STANDARD=1  (default) write under company-blueprints/standard
 *   DRY_RUN=1
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { initDb, getDb } from '../src/db/schema.js';
import { getAgentToolGrants } from '../src/services/openclaw-agent-tools.js';
import {
  snapshotOwnerAsBlueprintPayloadAsync,
  sanitizeBlueprintSecrets,
  portableWorkflowGraph,
} from '../src/services/company-blueprint-publish.js';
import {
  publishBlueprintFromPayload,
  buildCompanyBlueprintExportZip,
  invalidateBlueprintCache,
  findResidualLiveSecrets,
  cloneAndSanitizeBlueprint,
} from '../src/services/company-blueprints/index.js';
import { ownerSlug } from '../src/services/company-blueprints/standard-prefabs.js';

const OWNER = process.env.SOURCE_OWNER_USER_ID || 'ceo-demo-brightbox-744921';
const BLUEPRINT_ID = process.env.BLUEPRINT_ID || 'demo_brightbox_gifts';
const INDUSTRY = process.env.INDUSTRY_ID || 'demo_brightbox_gifts';
const OUT_DIR = process.env.OUT_DIR || '/tmp/brightbox-demo-bp';
const WRITE_STANDARD = process.env.WRITE_STANDARD !== '0';
const DRY = process.env.DRY_RUN === '1';
const SOURCE_ROOT =
  process.env.SOURCE_BLUEPRINT_ROOT || join(process.cwd(), 'src/services/company-blueprints');
const STANDARD_ROOT = process.env.STANDARD_DIR || join(SOURCE_ROOT, 'standard');
const SLUG = ownerSlug(OWNER);

function writeJson(path, obj) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function agentRow(id) {
  return getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(id);
}

function loadMcDefinition(ownerUserId, kind) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, name, description, chat_trigger_phrase, trigger_modes, published_graph_json, draft_graph_json, variables_json
       FROM agent_workflow_definitions
       WHERE owner_user_id = ? AND status = 'published'
       ORDER BY updated_at DESC`
    )
    .all(ownerUserId);
  const needle = kind === 'erp' ? /^erp-mc-/i : /^crm-mc-/i;
  const hit =
    rows.find((r) => needle.test(String(r.id || ''))) ||
    rows.find((r) => new RegExp(kind, 'i').test(String(r.name || '')) && /maker|checker/i.test(String(r.name || '')));
  if (!hit) return null;
  let graph = null;
  try {
    graph = JSON.parse(hit.published_graph_json || hit.draft_graph_json || '{}');
  } catch {
    graph = { nodes: [], edges: [] };
  }
  let variables = {};
  try {
    variables = JSON.parse(hit.variables_json || '{}') || {};
  } catch {
    variables = {};
  }
  sanitizeBlueprintSecrets(variables);
  return { row: hit, graph, variables };
}

function keepWorkflow(w) {
  const key = String(w.template_key || w.id || w.name || '').toLowerCase();
  if (/smoke|sse-|chatops|certify|hello-world|brain-mcp|agent-exchange|live-org|testtool/.test(key)) {
    if (/^(erp-mc|crm-mc)/.test(key) || /summarize-inbound|maker|checker/.test(key)) return true;
    return false;
  }
  return (
    /^(erp-mc|crm-mc)/.test(key) ||
    /inbound-media|summarize-inbound|maker|checker|job-applicant|demoemail|brave-byok/.test(key)
  );
}

function portableAgent(a) {
  return {
    name: a.name,
    role: a.role || a.name,
    department: a.department || 'Operations',
    tools: Array.isArray(a.tools) ? a.tools : [],
  };
}

function buildPlatformAgentsPack() {
  const agents = [];
  const meta = {
    balserve: {
      name: 'COO / BalServe',
      workspace_template: 'openclaw-workspace-templates/balserve/',
      seed: 'backend/scripts/seed-default-agents.js',
      notes:
        'Also receives company-scoped read-only crm_* / erp_* when Business Core is entitled. Always include prior conversation / Kanban / chat context when creating specialty work.',
    },
    workflowbuilder: {
      name: 'Workflow Builder',
      workspace_template: 'openclaw-workspace-templates/workflowbuilder/',
      seed: 'backend/scripts/seed-workflow-builder-agent.js',
    },
    platformhelp: {
      name: 'Platform Help',
      workspace_template: 'openclaw-workspace-templates/platformhelp/',
      seed: 'backend/scripts/seed-platform-help-agent.js',
      help_corpus: 'knowledgebase/platform-help/',
    },
  };
  for (const id of ['balserve', 'workflowbuilder', 'platformhelp']) {
    const row = agentRow(id);
    if (!row) {
      console.warn('[standard] missing platform agent', id);
      continue;
    }
    const tools = getAgentToolGrants(id);
    agents.push({
      id,
      name: meta[id]?.name || row.name,
      role: row.role || row.name,
      department: row.department || 'Operations',
      workspace_template: meta[id]?.workspace_template,
      seed: meta[id]?.seed,
      help_corpus: meta[id]?.help_corpus,
      notes: meta[id]?.notes,
      standard: true,
      tools,
    });
  }
  return {
    id: 'platform-lean-agents',
    name: 'Lean platform AI employees',
    description:
      'Source of truth for COO / Workflow Builder / Platform Help. Admin Refresh default agents and CEO onboard use this pack (DEFAULT_ONBOARD_AGENT_IDS). Tools mirror live grants from the regenerating CEO (BrightBox demo). Workspaces under openclaw-workspace-templates/.',
    regenerated_from_owner: OWNER,
    regenerated_at: new Date().toISOString(),
    agents,
  };
}

function buildBcAgentPack({ kind, provider, packId, name, description, prefixes, defs }) {
  // Group identical tool arrays into shared_tools when possible
  const shared = {};
  const agents = defs.map((d) => {
    const key = d.key;
    const tools = [...(d.tools || [])].sort();
    // Shared refs by key family
    let tools_ref = key.startsWith('maker') ? 'maker' : key.includes('checker') ? 'checker' : key;
    if (key === 'maker_a' || key === 'maker_b') tools_ref = 'maker';
    if (key === 'pnl') tools_ref = 'pnl';
    if (key === 'invoice') tools_ref = 'invoice';
    if (key === 'project') tools_ref = 'project';
    if (!shared[tools_ref]) shared[tools_ref] = tools;
    // If this role's tools differ from first maker, keep inline tools
    const same =
      shared[tools_ref] &&
      shared[tools_ref].length === tools.length &&
      shared[tools_ref].every((t, i) => t === tools[i]);
    const agent = {
      key,
      name: d.name,
      role_key: d.role_key || key,
      department: d.department || 'Operations',
      role: d.role || d.name,
    };
    if (same) agent.tools_ref = tools_ref;
    else agent.tools = tools;
    return agent;
  });
  return {
    id: packId,
    provider,
    kind,
    name,
    description,
    regenerated_from_owner: OWNER,
    regenerated_at: new Date().toISOString(),
    id_prefix: prefixes,
    shared_tools: shared,
    agents,
  };
}

function agentById(id) {
  const row = agentRow(id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    department: row.department,
    tools: getAgentToolGrants(id),
  };
}

function regenerateBusinessCoreFromOwner() {
  const out = {};
  const slug = SLUG;

  // CRM Twenty agents (BrightBox profile crm=twenty)
  const crmTwentyDefs = [
    {
      key: 'maker_a',
      id: `crm-s1-${slug}`.slice(0, 40),
      fallbackName: 'CRM Maker A',
    },
    {
      key: 'maker_b',
      id: `crm-s2-${slug}`.slice(0, 40),
      fallbackName: 'CRM Maker B',
    },
    {
      key: 'checker',
      id: `crm-ap-${slug}`.slice(0, 40),
      fallbackName: 'CRM Checker',
    },
  ].map((spec) => {
    const a = agentById(spec.id);
    return {
      key: spec.key,
      name: a?.name || spec.fallbackName,
      role: a?.role || a?.name || spec.fallbackName,
      role_key: spec.key === 'checker' ? 'crm_checker' : 'crm_maker',
      department: a?.department || 'Sales',
      tools: a?.tools || [],
    };
  });

  out['business-core/agents-crm-twenty.json'] = buildBcAgentPack({
    kind: 'crm',
    provider: 'twenty',
    packId: 'crm-twenty-prefab',
    name: 'CRM Maker/Checker (Twenty)',
    description:
      'Provisioned when Profile CRM = twenty. Owner-scoped custom agents + user_agents grant. Regenerated from BrightBox Demo CEO tools/roles.',
    prefixes: { maker_a: 'crm-s1-', maker_b: 'crm-s2-', checker: 'crm-ap-' },
    defs: crmTwentyDefs,
  });

  // Keep erpnext CRM pack: clone twenty maker pattern but use existing file's structure —
  // BrightBox uses Twenty for CRM; for erpnext CRM we keep prior pack roles with tools
  // only if agents exist — otherwise preserve maker tools as erp_* mirror from erp makers sales tools.
  // Prefer regenerating from crm-s1 if only twenty exists: inventory exists with erp_ for sales path historically.
  // Read current erpnext CRM pack keys and map tools from live ERP sales-ish agents where possible.
  const crmErpDefs = [
    { key: 'maker_a', id: `erp-s1-${slug}`.slice(0, 40), name: 'CRM Maker A (ERPNext)', dept: 'Sales' },
    { key: 'maker_b', id: `erp-s2-${slug}`.slice(0, 40), name: 'CRM Maker B (ERPNext)', dept: 'Sales' },
    { key: 'checker', id: `erp-ap-${slug}`.slice(0, 40), name: 'CRM Checker (ERPNext)', dept: 'Sales' },
  ].map((spec) => {
    // ERPNext CRM pack historically uses erp_* sales tools — use maker A subset as sales-facing
    const a = agentById(spec.id);
    const tools = (a?.tools || []).filter(
      (t) =>
        t.startsWith('erp_') ||
        t.startsWith('kanban_') ||
        ['notify_ceo', 'ceo_profile', 'master_data_list_tables', 'master_data_list_rows', 'master_data_rag', 'learnings_summary', 'email_send', 'analyze_image', 'list_inbound_attachments'].includes(t)
    );
    return {
      key: spec.key,
      name: a?.name?.includes('ERP') ? spec.name : a?.name || spec.name,
      role: a?.role || spec.name,
      role_key: spec.key === 'checker' ? 'crm_checker' : 'crm_maker',
      department: a?.department || spec.dept,
      tools,
    };
  });
  // If checker tools missing, use ERP Checker tools read-only + notify
  if (!crmErpDefs[2].tools.length) {
    const c = agentById(`erp-ap-${slug}`.slice(0, 40));
    crmErpDefs[2].tools = (c?.tools || []).filter((t) => !t.includes('submit') && !t.includes('cancel') || t.startsWith('erp_list') || t.startsWith('erp_get') || t.startsWith('erp_status') || t.startsWith('kanban_') || t === 'notify_ceo');
  }

  out['business-core/agents-crm-erpnext.json'] = buildBcAgentPack({
    kind: 'crm',
    provider: 'erpnext',
    packId: 'crm-erpnext-prefab',
    name: 'CRM Maker/Checker (ERPNext Sales)',
    description:
      'Provisioned when Profile CRM = erpnext (sales path). Regenerated from BrightBox ERP desk agents (sales-facing tools).',
    prefixes: { maker_a: 'erp-s1-', maker_b: 'erp-s2-', checker: 'erp-ap-' },
    defs: crmErpDefs,
  });

  // ERP full pack
  const erpSpecs = [
    { key: 'maker_a', id: `erp-s1-${slug}`.slice(0, 40), name: 'ERP Maker A', role_key: 'erp_maker', dept: 'Finance' },
    { key: 'maker_b', id: `erp-s2-${slug}`.slice(0, 40), name: 'ERP Maker B', role_key: 'erp_maker', dept: 'Operations' },
    { key: 'checker', id: `erp-ap-${slug}`.slice(0, 40), name: 'ERP Checker', role_key: 'erp_checker', dept: 'Finance' },
    { key: 'pnl', id: `erp-pnl-${slug}`.slice(0, 40), name: 'ERP P&L Agent', role_key: 'erp_pnl', dept: 'Finance' },
    { key: 'invoice', id: `erp-inv-${slug}`.slice(0, 40), name: 'ERP Invoice Agent', role_key: 'erp_invoice', dept: 'Finance' },
    { key: 'project', id: `erp-pm-${slug}`.slice(0, 40), name: 'ERP Project Manager', role_key: 'erp_project', dept: 'Operations' },
  ].map((spec) => {
    const a = agentById(spec.id);
    return {
      key: spec.key,
      name: a?.name || spec.name,
      role: a?.role || a?.name || spec.name,
      role_key: spec.role_key,
      department: a?.department || spec.dept,
      tools: a?.tools || [],
    };
  });

  out['business-core/agents-erp-erpnext.json'] = buildBcAgentPack({
    kind: 'erp',
    provider: 'erpnext',
    packId: 'erp-erpnext-prefab',
    name: 'ERP Maker/Checker + specialists (ERPNext)',
    description:
      'Provisioned when Profile ERP = erpnext. Regenerated from BrightBox Demo CEO prefab tools/roles.',
    prefixes: {
      maker_a: 'erp-s1-',
      maker_b: 'erp-s2-',
      checker: 'erp-ap-',
      pnl: 'erp-pnl-',
      invoice: 'erp-inv-',
      project: 'erp-pm-',
    },
    defs: erpSpecs,
  });

  // MC workflow portable templates
  const agentsForPortable = getDb()
    .prepare(
      `SELECT a.id, a.name, a.role FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id
       WHERE ua.user_id = ?`
    )
    .all(OWNER);

  for (const kind of ['crm', 'erp']) {
    const mc = loadMcDefinition(OWNER, kind);
    if (!mc?.graph?.nodes?.length) {
      console.warn('[standard] no MC workflow for', kind);
      continue;
    }
    const portable = portableWorkflowGraph(mc.graph, agentsForPortable);
    sanitizeBlueprintSecrets(portable);
    const residual = findResidualLiveSecrets(portable);
    if (residual.length) console.warn('[standard] residual in', kind, residual);
    out[`business-core/workflow-${kind}-maker-checker.json`] = {
      template_key: `${kind}-maker-checker`,
      name: mc.row.name,
      description: mc.row.description || '',
      chat_trigger_phrase: mc.row.chat_trigger_phrase || `run ${kind} maker checker`,
      trigger_modes: (() => {
        try {
          const t = JSON.parse(mc.row.trigger_modes || '["manual","chat"]');
          return Array.isArray(t) ? t : ['manual', 'chat'];
        } catch {
          return ['manual', 'chat'];
        }
      })(),
      workflow_id_pattern: `${kind}-mc-{ownerSlug}`,
      kind,
      agent_roles: {
        maker: kind === 'erp' ? ['ERP Maker A', 'ERP Maker B'] : ['CRM Maker A', 'CRM Maker B'],
        checker: kind === 'erp' ? ['ERP Checker'] : ['CRM Checker'],
      },
      regenerated_from_owner: OWNER,
      regenerated_at: new Date().toISOString(),
      graph: portable,
      variables: mc.variables || {},
    };
  }

  return out;
}

// ── run ──────────────────────────────────────────────────────────────
initDb();
invalidateBlueprintCache();

console.info('[brightbox] owner=%s publish+regenerate standard', OWNER);
const platformPack = buildPlatformAgentsPack();
const bcFiles = regenerateBusinessCoreFromOwner();

if (WRITE_STANDARD && !DRY) {
  writeJson(join(STANDARD_ROOT, 'platform-agents.json'), platformPack);
  for (const [rel, obj] of Object.entries(bcFiles)) {
    writeJson(join(STANDARD_ROOT, rel), obj);
  }
  writeJson(join(STANDARD_ROOT, 'regeneration-manifest.json'), {
    owner: OWNER,
    at: new Date().toISOString(),
    platform_agents: platformPack.agents.map((a) => ({ id: a.id, tools: (a.tools || []).length })),
    business_core_files: Object.keys(bcFiles),
  });
  console.info('[brightbox] wrote standard packs under', STANDARD_ROOT);
}

// Publish company blueprint
const snap = await snapshotOwnerAsBlueprintPayloadAsync(OWNER);
const company = snap.company_name || 'BrightBox Gifts';
const payload = { ...(snap.payload || {}) };
const scrubSnap = { cleared: 0, scrubbed: 0 };
sanitizeBlueprintSecrets(payload, scrubSnap);
payload.workflow_templates = (payload.workflow_templates || []).filter(keepWorkflow);
payload.agents = (payload.agents || []).map(portableAgent);
payload.id = BLUEPRINT_ID;
payload.industry = INDUSTRY;
payload.name = process.env.BLUEPRINT_NAME || `Flolah demo — ${company} (BrightBox)`;
payload.label = payload.name;
payload.description =
  process.env.BLUEPRINT_DESCRIPTION ||
  'Demo company snapshot from BrightBox Demo CEO / BrightBox Gifts: CRM (Twenty) + ERP (ERPNext) Maker–Checker, specialty agents, goals, connector stubs (secrets scrubbed). Source for platform-agents + business-core standard packs.';
payload.depth = 'deep';
payload.source = 'system';
payload.is_default = false;
payload.aliases = ['brightbox_demo', 'brightbox_gifts', 'demo_brightbox', 'flolah_brightbox'];
payload.source_owner_user_id = OWNER;
payload.source_company_name = company;
payload.demo = true;
payload.demo_owner_name = 'BrightBox Demo CEO';
payload.systems_recommended = payload.systems_recommended || [
  { id: 'workspace', label: 'AI Employees', path: '/workspace' },
  { id: 'workflows', label: 'Workflows', path: '/agent-workflows' },
  { id: 'crm', label: 'CRM (Business Core)', path: '/work' },
  { id: 'erp', label: 'ERP (Business Core)', path: '/work' },
  { id: 'knowledge', label: 'Knowledge', path: '/master-data' },
];

const { value: cleanPayload, stats: scrubStats } = cloneAndSanitizeBlueprint(payload);
Object.assign(payload, cleanPayload);
const residual = findResidualLiveSecrets(payload);
if (residual.length) {
  console.error('REJECTED residual secrets', residual.join(','));
  process.exit(3);
}

console.info(
  '[brightbox] snapshot secrets cleared=%s final_cleared=%s residual=none',
  scrubSnap.cleared,
  scrubStats.cleared
);
console.info(
  'SUMMARY',
  JSON.stringify(
    {
      owner: OWNER,
      company,
      agents: payload.agents.map((a) => a.name),
      workflows: (payload.workflow_templates || []).map((w) => w.template_key),
      platform_tools: Object.fromEntries(platformPack.agents.map((a) => [a.id, (a.tools || []).length])),
      standard_files: Object.keys(bcFiles),
    },
    null,
    2
  )
);

if (DRY) {
  console.log('DRY_RUN=1 — not publishing');
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
const published = publishBlueprintFromPayload(
  {
    industry_id: INDUSTRY,
    name: payload.name,
    description: payload.description,
    payload,
    source_owner_user_id: OWNER,
    source_company_name: company,
    published_by: process.env.PUBLISHED_BY || 'publish-brightbox-demo',
    set_default: process.env.SET_DEFAULT === '1',
    id: BLUEPRINT_ID,
  },
  { id: 'admin-script', name: 'publish-brightbox-demo' }
);

const pack = { ...payload, id: BLUEPRINT_ID, industry: INDUSTRY, source: 'system', is_default: false, depth: 'deep' };
writeJson(join(OUT_DIR, `${BLUEPRINT_ID}.json`), pack);
const { zip, filename, meta } = buildCompanyBlueprintExportZip(BLUEPRINT_ID);
writeFileSync(join(OUT_DIR, filename), zip);

// Write into source packs/exports
try {
  writeJson(join(SOURCE_ROOT, 'packs', `${BLUEPRINT_ID}.json`), pack);
  mkdirSync(join(SOURCE_ROOT, 'exports'), { recursive: true });
  writeFileSync(join(SOURCE_ROOT, 'exports', filename), zip);
  writeJson(join(SOURCE_ROOT, 'exports', `${BLUEPRINT_ID}.manifest.json`), {
    published_id: published?.id,
    secrets_scrubbed: true,
    secrets_cleared: scrubSnap.cleared + scrubStats.cleared,
    zip_bytes: zip.length,
    coverage: meta.coverage,
    source_owner: OWNER,
    source_company: company,
    refreshed_at: new Date().toISOString(),
  });
  console.info('[brightbox] wrote source packs+exports');
} catch (e) {
  console.warn('[brightbox] source write skipped', e?.message || e);
}

console.log(
  'PUBLISHED',
  JSON.stringify(
    {
      published_id: published?.id,
      zip_bytes: zip.length,
      secrets_scrubbed: true,
      standard_root: STANDARD_ROOT,
    },
    null,
    2
  )
);
process.exit(0);
