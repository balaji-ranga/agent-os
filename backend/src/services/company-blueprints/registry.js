/**
 * JSON/DB company blueprint registry.
 * System packs: packs/*.json + industries.json
 * Published: company_industry_blueprints table
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/schema.js';
import { buildZipBuffer } from '../zip-store.js';
import { sanitizeBlueprintSecrets, cloneAndSanitizeBlueprint, findResidualLiveSecrets } from './secret-sanitize.js';
import { overlayTestedVideoStudio } from './video-content-pack.js';
import { overlayTestedIbkrWorkflows } from './ibkr-trading-pack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(__dirname, 'packs');
const INDUSTRIES_PATH = join(__dirname, 'industries.json');

let _schemaReady = false;
let _systemCache = null;

export function ensureCompanyBlueprintsSchema() {
  if (_schemaReady) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_industry_blueprints (
      id TEXT PRIMARY KEY,
      industry_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      depth TEXT DEFAULT 'thin',
      is_default INTEGER DEFAULT 0,
      source TEXT DEFAULT 'published',
      payload_json TEXT NOT NULL,
      source_owner_user_id TEXT,
      source_company_name TEXT,
      published_by TEXT,
      published INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cib_industry ON company_industry_blueprints(industry_id);
    CREATE INDEX IF NOT EXISTS idx_cib_published ON company_industry_blueprints(published);
    CREATE TABLE IF NOT EXISTS company_industry_default_blueprints (
      industry_id TEXT PRIMARY KEY,
      blueprint_id TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  _schemaReady = true;
}

function loadJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.warn('[company-blueprints] load failed', path, e?.message || e);
    return null;
  }
}

function normalizePack(raw, fallbacks = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || fallbacks.id || '').trim();
  if (!id) return null;
  const name = String(raw.name || raw.label || id).trim();
  return {
    id,
    industry: String(raw.industry || fallbacks.industry || id).trim(),
    name,
    label: String(raw.label || name).trim(),
    description: String(raw.description || '').trim(),
    depth: raw.depth === 'deep' ? 'deep' : 'thin',
    is_default: raw.is_default !== false && raw.is_default !== 0,
    source: raw.source || fallbacks.source || 'system',
    aliases: Array.isArray(raw.aliases) ? raw.aliases.map(String) : [],
    platforms: Array.isArray(raw.platforms) ? raw.platforms.map(String) : [],
    departments: Array.isArray(raw.departments) ? raw.departments : [],
    agents: Array.isArray(raw.agents) ? raw.agents : [],
    workflows: Array.isArray(raw.workflows) ? raw.workflows : [],
    channels: Array.isArray(raw.channels) ? raw.channels : [],
    knowledge_tables: Array.isArray(raw.knowledge_tables) ? raw.knowledge_tables : [],
    sop_documents: Array.isArray(raw.sop_documents) ? raw.sop_documents : [],
    systems_recommended: Array.isArray(raw.systems_recommended) ? raw.systems_recommended : [],
    policy_templates: raw.policy_templates && typeof raw.policy_templates === 'object' ? raw.policy_templates : {},
    source_owner_user_id: raw.source_owner_user_id || null,
    source_company_name: raw.source_company_name || null,
    published_by: raw.published_by || null,
    operate_model_id: raw.operate_model_id || null,
    operate_model_snapshot: raw.operate_model_snapshot || null,
    browser_autonomy: raw.browser_autonomy && typeof raw.browser_autonomy === 'object' ? raw.browser_autonomy : null,
    publish_quality: raw.publish_quality && typeof raw.publish_quality === 'object' ? raw.publish_quality : null,
    // Day 0+1 artefacts (from admin publish of a working company)
    workflow_templates: Array.isArray(raw.workflow_templates) ? raw.workflow_templates : [],
    companion_packs: Array.isArray(raw.companion_packs) ? raw.companion_packs.map(String) : [],
    standard_prefab: raw.standard_prefab && typeof raw.standard_prefab === 'object' ? raw.standard_prefab : null,
    goal_templates: Array.isArray(raw.goal_templates) ? raw.goal_templates : [],
    agents_md: Array.isArray(raw.agents_md) ? raw.agents_md : [],
    policy_text: typeof raw.policy_text === 'string' ? raw.policy_text : '',
    day0_day1: raw.day0_day1 && typeof raw.day0_day1 === 'object' ? raw.day0_day1 : null,
    // Org map (departments + agent→dept) and connector catalog (no secrets)
    org:
      raw.org && typeof raw.org === 'object'
        ? {
            departments: Array.isArray(raw.org.departments) ? raw.org.departments : [],
            agent_department_map: Array.isArray(raw.org.agent_department_map)
              ? raw.org.agent_department_map
              : [],
          }
        : null,
    connectors:
      raw.connectors && typeof raw.connectors === 'object'
        ? {
            mcp_oauth: Array.isArray(raw.connectors.mcp_oauth) ? raw.connectors.mcp_oauth : [],
            ceo_mcp_servers: Array.isArray(raw.connectors.ceo_mcp_servers)
              ? raw.connectors.ceo_mcp_servers
              : [],
            openconnector:
              raw.connectors.openconnector && typeof raw.connectors.openconnector === 'object'
                ? raw.connectors.openconnector
                : raw.connectors.openconnector === null
                  ? null
                  : null,
            note:
              typeof raw.connectors.note === 'string'
                ? raw.connectors.note
                : 'No OAuth tokens, client secrets, API keys, or vault refs — reconnect on install.',
          }
        : null,
  };
}

function loadSystemPacks() {
  if (_systemCache) return _systemCache;
  const byId = new Map();
  if (existsSync(PACKS_DIR)) {
    for (const name of readdirSync(PACKS_DIR)) {
      if (!name.endsWith('.json')) continue;
      const stem = name.replace(/\.json$/i, '');
      const pack = normalizePack(loadJsonFile(join(PACKS_DIR, name)), {
        source: 'system',
        id: stem,
        industry: stem,
      });
      if (pack) byId.set(pack.id, pack);
    }
  }
  const industries = existsSync(INDUSTRIES_PATH) ? loadJsonFile(INDUSTRIES_PATH) || [] : [];
  _systemCache = { byId, industries: Array.isArray(industries) ? industries : [] };
  return _systemCache;
}

export function invalidateBlueprintCache() {
  _systemCache = null;
}

function loadPublishedPacks() {
  ensureCompanyBlueprintsSchema();
  try {
    const rows = getDb()
      .prepare(
        `SELECT * FROM company_industry_blueprints WHERE published = 1 ORDER BY is_default DESC, updated_at DESC`
      )
      .all();
    return rows
      .map((r) => {
        let payload = {};
        try {
          payload = JSON.parse(r.payload_json || '{}');
        } catch {
          payload = {};
        }
        return normalizePack(
          {
            ...payload,
            id: r.id,
            industry: r.industry_id,
            name: r.name,
            label: r.name,
            description: r.description,
            depth: r.depth,
            is_default: !!r.is_default,
            source: r.source || 'published',
            source_owner_user_id: r.source_owner_user_id,
            source_company_name: r.source_company_name,
            published_by: r.published_by,
          },
          { source: 'published' }
        );
      })
      .filter(Boolean);
  } catch (e) {
    console.warn('[company-blueprints] published load', e?.message || e);
    return [];
  }
}

function allPacksMerged() {
  const { byId, industries } = loadSystemPacks();
  const map = new Map(byId);
  for (const p of loadPublishedPacks()) {
    map.set(p.id, p); // published can override same id
  }
  // Overlay tested video studio from golden standard JSON (graphs + agent id_patterns)
  // onto video_content and any pack that lists companion_packs: ["video_content"].
  for (const [id, bp] of [...map.entries()]) {
    map.set(id, overlayTestedIbkrWorkflows(overlayTestedVideoStudio(bp, byId)));
  }
  return { map, industries };
}

export function listIndustries() {
  const { industries } = loadSystemPacks();
  return industries.map((c) => ({ ...c }));
}

export function resolveCompanyTypeId(raw) {
  const id = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!id) return 'general_ops';
  const { map, industries } = allPacksMerged();
  if (map.has(id)) return map.get(id).industry || id;
  const card = industries.find((c) => c.id === id);
  if (card?.maps_to) return card.maps_to;
  if (card?.default_blueprint_id) {
    const bp = map.get(card.default_blueprint_id);
    if (bp) return bp.industry || bp.id;
  }
  for (const bp of map.values()) {
    if ((bp.aliases || []).includes(id)) return bp.industry || bp.id;
  }
  return 'general_ops';
}

export function getDefaultBlueprintIdForIndustry(industryId) {
  const { map, industries } = allPacksMerged();
  ensureCompanyBlueprintsSchema();
  try {
    const row = getDb()
      .prepare(`SELECT blueprint_id FROM company_industry_default_blueprints WHERE industry_id = ?`)
      .get(industryId);
    if (row?.blueprint_id && map.has(row.blueprint_id)) return row.blueprint_id;
  } catch {
    /* table may not exist yet on very old processes */
  }
  const packs = [...map.values()].filter(
    (p) =>
      p.industry === industryId ||
      p.id === industryId ||
      (Array.isArray(p.aliases) && p.aliases.includes(industryId))
  );
  const publishedDefault = packs.find((p) => p.source === 'published' && p.is_default);
  if (publishedDefault) return publishedDefault.id;
  const ind = industries.find((c) => c.id === industryId) || industries.find((c) => c.maps_to === industryId);
  if (ind?.default_blueprint_id && map.has(ind.default_blueprint_id)) {
    return ind.default_blueprint_id;
  }
  const def = packs.find((p) => p.is_default) || packs[0];
  return def?.id || 'general_ops';
}

/**
 * Resolve blueprint by blueprint id or industry id.
 */
export function getBlueprint(companyTypeOrBlueprintId) {
  const key = String(companyTypeOrBlueprintId || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const { map, industries } = allPacksMerged();
  if (map.has(key)) return map.get(key);
  for (const bp of map.values()) {
    if ((bp.aliases || []).includes(key)) return bp;
  }
  const industry = resolveCompanyTypeId(key);
  const defId = getDefaultBlueprintIdForIndustry(industry);
  if (map.has(defId)) return map.get(defId);
  if (map.has('general_ops')) return map.get('general_ops');
  return {
    id: 'general_ops',
    industry: 'general_ops',
    name: 'General operations',
    label: 'General operations',
    description: '',
    depth: 'thin',
    departments: [],
    agents: [],
    workflows: [],
    channels: [],
    knowledge_tables: [],
    sop_documents: [],
    systems_recommended: [],
    policy_templates: {},
    source: 'fallback',
  };
}

export function listBlueprintsForIndustry(industryId) {
  const industry = resolveCompanyTypeId(industryId) || String(industryId || '');
  const rawId = String(industryId || '').trim();
  const { map } = allPacksMerged();
  const list = [...map.values()].filter(
    (p) =>
      p.industry === industry ||
      p.industry === rawId ||
      p.id === industry ||
      p.id === rawId ||
      (p.aliases || []).includes(rawId)
  );
  const defId = getDefaultBlueprintIdForIndustry(industry);
  return list
    .map((p) => ({
      id: p.id,
      industry: p.industry,
      name: p.name || p.label,
      label: p.label || p.name,
      description: p.description || '',
      depth: p.depth,
      source: p.source,
      is_default: p.id === defId || !!p.is_default,
      platforms: p.platforms || [],
      agent_count: (p.agents || []).length,
      department_count: (p.departments || []).length,
      source_company_name: p.source_company_name || null,
    }))
    .sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return String(a.name).localeCompare(String(b.name));
    });
}

export function listCompanyTypeCards() {
  const { industries } = loadSystemPacks();
  return industries.map((c) => {
    const industryId = c.maps_to || c.id;
    const blueprints = listBlueprintsForIndustry(c.id);
    const defId = c.default_blueprint_id || getDefaultBlueprintIdForIndustry(industryId);
    const def = getBlueprint(defId);
    return {
      id: c.id,
      label: c.label,
      featured: !!c.featured,
      depth: def.depth || (c.featured ? 'deep' : 'thin'),
      maps_to: c.maps_to || null,
      default_blueprint_id: defId,
      blueprint_count: blueprints.length,
      description: c.description || def.description || '',
      platforms: def.platforms || [],
    };
  });
}

/**
 * Resolve industry card + labels for UI (How We Run, Company setup, Knowledge).
 *
 * IMPORTANT: never pick a card solely by maps_to === general_ops — that returns
 * the first thin industry in industries.json (Restaurant) for every education/
 * retail/healthcare company that only stored the resolved blueprint type.
 *
 * Preference: company_type_card id → company_type as card id/label → optional memory → blueprint type label.
 *
 * @param {{ company_type_card?: string, company_type?: string, industry?: string }} strategic
 * @param {{ memoryIndustry?: string|null }} [opts]
 * @returns {{ company_type_card: string|null, company_type: string, company_type_label: string, industry_card: object|null }}
 */
export function resolveCompanyIndustryIdentity(strategic = {}, opts = {}) {
  const cards = listCompanyTypeCards();
  const byId = new Map(cards.map((c) => [String(c.id), c]));
  const byLabel = new Map(cards.map((c) => [String(c.label || '').toLowerCase(), c]));

  const matchCard = (raw) => {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (byId.has(s)) return byId.get(s);
    const slug = s.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    if (byId.has(slug)) return byId.get(slug);
    const byLab = byLabel.get(s.toLowerCase());
    if (byLab) return byLab;
    // Humanize "education" style already covered by id; try partial label
    for (const c of cards) {
      if (String(c.label || '').toLowerCase() === s.toLowerCase()) return c;
    }
    return null;
  };

  let card =
    matchCard(strategic.company_type_card) ||
    matchCard(strategic.company_type) ||
    matchCard(strategic.industry) ||
    matchCard(opts.memoryIndustry) ||
    null;

  // Only if still missing: match exact card whose id equals resolved maps_to pack (general_ops card itself)
  if (!card) {
    const resolved = resolveCompanyTypeId(
      strategic.company_type || strategic.company_type_card || opts.memoryIndustry || 'general_ops'
    );
    card = byId.get(resolved) || null;
  }

  const company_type = resolveCompanyTypeId(
    card?.id || strategic.company_type || strategic.company_type_card || opts.memoryIndustry || 'general_ops'
  );
  const bp = getBlueprint(company_type);
  const company_type_label = card?.label || byId.get(company_type)?.label || bp.label || company_type;

  return {
    company_type_card: card?.id || (matchCard(strategic.company_type_card)?.id ?? null),
    company_type,
    company_type_label,
    industry_card: card,
  };
}

export function inferCompanyTypeFromText(text) {
  const t = String(text || '').toLowerCase();
  // Video studio (Veo / shorts / animated) before generic social content
  if (
    /video\s*content|video\s*studio|animated\s*youtube|veo\b|storyboard|short[\s-]?form\s*video|generate\s*video/.test(
      t
    ) ||
    (/youtube|youtu\.be|shorts/.test(t) &&
      /video|animat|veo|storyboard|film|clip/.test(t) &&
      !/instagram|facebook|linkedin|blog/.test(t))
  ) {
    return 'video_content';
  }
  if (/content|instagram|facebook|linkedin|blog|social|creator|publish|media/.test(t)) {
    if (/youtube|youtu\.be/.test(t) && !/instagram|facebook|linkedin|blog|social/.test(t)) {
      return 'video_content';
    }
    return 'content_creator';
  }
  if (/trad(e|ing)|ibkr|stock|portfolio|equity|crypto|invest/.test(t)) return 'trading_ops';
  if (/hiring|recruit|talent|job|applicant|hr|resume|cv/.test(t)) return 'talent';
  if (/saas|software|startup|product/.test(t)) return 'saas';
  if (/blank|empty|minimal|diy/.test(t)) return 'blank';
  return 'general_ops';
}

export function policyTextForStyle(blueprint, managementStyle) {
  const style = String(managementStyle || 'after_approval').trim();
  const templates = blueprint?.policy_templates || getBlueprint('general_ops').policy_templates || {};
  return templates[style] || templates.after_approval || '';
}

export function hasDedicatedCompanyTemplate(companyType) {
  const bp = getBlueprint(companyType);
  if (bp?.depth === 'deep') return true;
  if (['content_creator', 'video_content', 'saas', 'talent', 'trading_ops'].includes(bp?.id || bp?.industry))
    return true;
  return false;
}

/** Legacy export name */
export const COMPANY_TYPE_CARDS = listCompanyTypeCards();

export function listAllBlueprintsAdmin() {
  const { map } = allPacksMerged();
  return [...map.values()].map((p) => ({
    id: p.id,
    industry: p.industry,
    name: p.name,
    description: p.description,
    depth: p.depth,
    source: p.source,
    is_default: !!p.is_default,
    agent_count: (p.agents || []).length,
    source_owner_user_id: p.source_owner_user_id,
    source_company_name: p.source_company_name,
    published_by: p.published_by,
    downloadable: true,
  }));
}

/**
 * Full blueprint pack for admin JSON / zip export (published DB or system JSON pack).
 * Always returns a clones + secret-scrubbed blueprint (never raw credentials).
 * @returns {object|null}
 */
export function getBlueprintForAdminExport(blueprintId) {
  ensureCompanyBlueprintsSchema();
  const id = String(blueprintId || '').trim();
  if (!id) return null;
  const bp = getBlueprint(id);
  if (!bp?.id || bp.source === 'fallback') return null;

  let meta = null;
  let rawBlueprint = null;

  // Prefer exact DB row when published (then scrub — older rows may still contain secrets)
  try {
    const row = getDb()
      .prepare(
        `SELECT id, industry_id, name, description, depth, is_default, source, payload_json,
                source_owner_user_id, source_company_name, published_by, published, updated_at, created_at
         FROM company_industry_blueprints WHERE id = ?`
      )
      .get(id);
    if (row?.payload_json) {
      let payload = {};
      try {
        payload = JSON.parse(row.payload_json);
      } catch {
        payload = bp;
      }
      meta = {
        id: row.id,
        industry_id: row.industry_id,
        name: row.name,
        description: row.description || '',
        depth: row.depth,
        is_default: !!row.is_default,
        source: row.source || 'published',
        source_owner_user_id: row.source_owner_user_id,
        source_company_name: row.source_company_name,
        published_by: row.published_by,
        published: !!row.published,
        updated_at: row.updated_at,
        created_at: row.created_at,
      };
      rawBlueprint = { ...payload, id: row.id, name: row.name, industry: row.industry_id };
    }
  } catch (e) {
    console.warn('[company-blueprints] export db read', e?.message || e);
  }

  if (!rawBlueprint) {
    meta = {
      id: bp.id,
      industry_id: bp.industry,
      name: bp.name || bp.label,
      description: bp.description || '',
      depth: bp.depth,
      is_default: !!bp.is_default,
      source: bp.source || 'system',
      source_owner_user_id: bp.source_owner_user_id || null,
      source_company_name: bp.source_company_name || null,
      published_by: bp.published_by || null,
      published: bp.source === 'published',
    };
    rawBlueprint = bp;
  }

  const { value: blueprint, stats } = cloneAndSanitizeBlueprint(rawBlueprint);
  // Extra hard pass on connectors note
  if (blueprint?.connectors && typeof blueprint.connectors === 'object') {
    blueprint.connectors.note =
      blueprint.connectors.note ||
      'No OAuth tokens, client secrets, API keys, or vault secrets — reconnect on install.';
  }
  const residual = findResidualLiveSecrets(blueprint);
  if (residual.length) {
    console.warn(
      '[company-blueprints] residual secret patterns after scrub id=%s findings=%s',
      id,
      residual.join(',')
    );
  } else if (stats.cleared || stats.scrubbed) {
    console.info(
      '[company-blueprints] admin export scrubbed id=%s cleared=%s scrubbed=%s',
      id,
      stats.cleared,
      stats.scrubbed
    );
  }
  return {
    meta: {
      ...meta,
      secrets_scrubbed: true,
      secrets_cleared: stats.cleared,
      secrets_substring_scrubbed: stats.scrubbed,
      secrets_residual: residual,
    },
    blueprint,
  };
}

function safePathSegment(name, fallback = 'item') {
  return (
    String(name || fallback)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || fallback
  );
}

/**
 * Expand blueprint payload into foldered files for admin zip review.
 * Secrets intentionally absent from connectors export.
 */
function buildBlueprintZipEntries(blueprint, meta) {
  const bp = blueprint && typeof blueprint === 'object' ? blueprint : {};
  const entries = [];
  const j = (obj) => JSON.stringify(obj, null, 2);

  entries.push({ name: 'blueprint.json', content: j(bp) });
  entries.push({ name: 'manifest.json', content: j(meta) });

  // 1. Knowledge
  entries.push({
    name: 'knowledge/tables.json',
    content: j(bp.knowledge_tables || []),
  });
  for (const t of bp.knowledge_tables || []) {
    const name = safePathSegment(t.name, 'table');
    entries.push({
      name: `knowledge/tables/${name}.json`,
      content: j(t),
    });
  }

  // 2. Policies
  if (bp.policy_text) {
    entries.push({ name: 'policies/policy_text.md', content: String(bp.policy_text) });
  }
  entries.push({
    name: 'policies/policy_templates.json',
    content: j(bp.policy_templates || {}),
  });

  // 3. Org (departments + agent mapping)
  const org = bp.org || {
    departments: bp.departments || [],
    agent_department_map: (bp.agents || []).map((a) => ({
      agent_name: a.name,
      department: a.department || 'Operations',
      is_coo: !!a.is_coo,
    })),
  };
  entries.push({ name: 'org/org.json', content: j(org) });
  entries.push({ name: 'org/departments.json', content: j(org.departments || bp.departments || []) });

  // 4. Agents: definition + tools + workspace MD (incl. ops)
  entries.push({ name: 'agents/agents.json', content: j(bp.agents || []) });
  for (const a of bp.agents || []) {
    const slug = safePathSegment(a.name, 'agent');
    entries.push({
      name: `agents/${slug}/definition.json`,
      content: j({
        name: a.name,
        role: a.role,
        department: a.department,
        tools: a.tools || [],
        is_coo: !!a.is_coo,
        openclaw_agent_id: a.openclaw_agent_id || null,
        agent_id_source: a.agent_id_source || null,
      }),
    });
    if (Array.isArray(a.tools) && a.tools.length) {
      entries.push({ name: `agents/${slug}/tools.json`, content: j(a.tools) });
    }
  }
  for (const md of bp.agents_md || []) {
    const slug = safePathSegment(md.agent_name, 'agent');
    if (Array.isArray(md.tools) && md.tools.length) {
      entries.push({ name: `agents/${slug}/tools.json`, content: j(md.tools) });
    }
    entries.push({
      name: `agents/${slug}/file_keys.json`,
      content: j(md.file_keys || Object.keys(md.files || {})),
    });
    const files = md.files || {};
    const keyToFile = {
      agents: 'AGENTS.md',
      soul: 'SOUL.md',
      tools: 'TOOLS.md',
      memory: 'MEMORY.md',
      identity: 'IDENTITY.md',
      ops: 'AGENT-OS-OPS.md',
      user: 'USER.md',
      org: 'ORG.md',
      policy: 'POLICY.md',
    };
    for (const [key, text] of Object.entries(files)) {
      if (!text || typeof text !== 'string') continue;
      const fname = keyToFile[key] || `${key}.md`;
      entries.push({ name: `agents/${slug}/workspace/${fname}`, content: text });
    }
  }

  // 5. Workflows — full graph JSON definitions
  entries.push({
    name: 'workflows/index.json',
    content: j(
      (bp.workflow_templates || []).map((w) => ({
        template_key: w.template_key,
        name: w.name,
        description: w.description,
        node_count: (w.graph?.nodes || []).length,
        edge_count: (w.graph?.edges || []).length,
        source_definition_id: w.source_definition_id || null,
      }))
    ),
  });
  if (Array.isArray(bp.workflows) && bp.workflows.length) {
    entries.push({ name: 'workflows/summary.json', content: j(bp.workflows) });
  }
  for (const w of bp.workflow_templates || []) {
    const key = safePathSegment(w.template_key || w.name, 'workflow');
    entries.push({ name: `workflows/${key}.json`, content: j(w) });
  }

  // 6. Connectors (structure only — no OAuth/secrets)
  entries.push({
    name: 'connectors/connectors.json',
    content: j(
      bp.connectors || {
        note: 'No connector catalog on this blueprint; reconnect OAuth on install.',
        mcp_oauth: [],
        ceo_mcp_servers: [],
        openconnector: null,
      }
    ),
  });

  // 7. Goal schedule definitions
  entries.push({ name: 'goals/goal_templates.json', content: j(bp.goal_templates || []) });

  // Operate model + SOPs (supporting Day 0/1)
  if (bp.operate_model_snapshot) {
    entries.push({ name: 'operate/operate_model.json', content: j(bp.operate_model_snapshot) });
  }
  entries.push({ name: 'sops/index.json', content: j(bp.sop_documents || []) });
  for (const s of bp.sop_documents || []) {
    const name = safePathSegment(s.filename || s.title, 'sop');
    const body = s.contentText || s.content || '';
    if (body) entries.push({ name: `sops/${name}.md`, content: String(body) });
  }

  if (bp.day0_day1) {
    entries.push({ name: 'day0_day1.json', content: j(bp.day0_day1) });
  }

  return entries;
}

/**
 * Build admin-downloadable zip for a company industry blueprint.
 * Secret-scrubbed: live API keys / tokens never included (Admin export path).
 * @returns {{ zip: Buffer, filename: string, meta: object }}
 */
export function buildCompanyBlueprintExportZip(blueprintId) {
  const pack = getBlueprintForAdminExport(blueprintId);
  if (!pack?.blueprint) {
    const err = new Error(`Blueprint not found: ${blueprintId}`);
    err.status = 404;
    throw err;
  }
  const exportedAt = new Date().toISOString();
  // Second scrub pass for defense-in-depth (in case of future mutations)
  const { value: bp, stats: zipScrub } = cloneAndSanitizeBlueprint(pack.blueprint);
  const residual = findResidualLiveSecrets(bp);
  const coverage = {
    knowledge: Array.isArray(bp.knowledge_tables) && bp.knowledge_tables.length > 0,
    policies: !!(bp.policy_text || Object.keys(bp.policy_templates || {}).length),
    org: !!(bp.org || (bp.departments || []).length),
    agents: Array.isArray(bp.agents) && bp.agents.length > 0,
    agent_tools: Array.isArray(bp.agents) && bp.agents.every((a) => (a.tools || []).length > 0),
    agents_md: Array.isArray(bp.agents_md) && bp.agents_md.length > 0,
    agents_md_ops: Array.isArray(bp.agents_md) && bp.agents_md.some((m) => m.files?.ops),
    workflows: Array.isArray(bp.workflow_templates) && bp.workflow_templates.length > 0,
    workflow_graphs:
      Array.isArray(bp.workflow_templates) &&
      bp.workflow_templates.every((w) => (w.graph?.nodes || []).length > 0),
    connectors: !!(
      bp.connectors &&
      (bp.connectors.mcp_oauth?.length ||
        bp.connectors.ceo_mcp_servers?.length ||
        bp.connectors.openconnector)
    ),
    goals: Array.isArray(bp.goal_templates) && bp.goal_templates.length > 0,
    secrets_scrubbed: true,
  };
  const meta = {
    ...pack.meta,
    exported_at: exportedAt,
    export_format: 'agent-os-company-blueprint-v2',
    secrets_scrubbed: true,
    secrets_cleared: (pack.meta?.secrets_cleared || 0) + zipScrub.cleared,
    secrets_substring_scrubbed: (pack.meta?.secrets_substring_scrubbed || 0) + zipScrub.scrubbed,
    secrets_residual: residual,
    coverage,
    note:
      'Live API keys, tokens, and passwords redacted. Vault *Ref and {{template}} placeholders retained for re-bind.',
  };
  if (residual.length) {
    console.warn(
      '[company-blueprints] zip residual secret patterns id=%s findings=%s',
      meta.id,
      residual.join(',')
    );
  }
  const safe =
    String(meta.id || 'blueprint')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'blueprint';

  const readme = [
    'Agent OS — company industry blueprint export',
    '==========================================',
    '',
    `ID: ${meta.id}`,
    `Name: ${meta.name}`,
    `Industry: ${meta.industry_id}`,
    `Source: ${meta.source}`,
    meta.source_company_name ? `Source company: ${meta.source_company_name}` : null,
    meta.source_owner_user_id ? `Source owner: ${meta.source_owner_user_id}` : null,
    `Exported: ${exportedAt}`,
    `Format: ${meta.export_format}`,
    'Secrets: scrubbed (no live API keys / tokens / bridge secrets)',
    meta.secrets_cleared != null ? `Secret fields cleared: ${meta.secrets_cleared}` : null,
    '',
    'Coverage (source company snapshot):',
    ...Object.entries(coverage).map(([k, v]) => `  - ${k}: ${v ? 'yes' : 'no'}`),
    '',
    'Layout:',
    '  blueprint.json              — full pack (apply-ready, secrets redacted)',
    '  manifest.json               — export metadata + coverage flags',
    '  knowledge/                  — master data table schemas (+ seed samples)',
    '  policies/                   — policy_text.md + templates',
    '  org/                        — departments + agent→department map',
    '  agents/<name>/              — definition.json, tools.json, workspace/*.md',
    '    workspace/AGENT-OS-OPS.md — ops (shared Agent OS operating rules)',
    '  workflows/<key>.json        — full workflow graph definitions (nodes/edges)',
    '  connectors/connectors.json  — MCP/OC catalog ONLY (no OAuth tokens/secrets)',
    '  goals/goal_templates.json   — scheduled goal definitions',
    '  operate/                    — operate model snapshot',
    '  sops/                       — SOP markdown',
    '',
    'Note: Re-publish from Admin after connecting a CEO company to refresh live artefacts',
    '(agents tools, ops MD, workflow graphs, connector stubs, goals).',
    'On install, re-bind vault API keys and connector OAuth (never stored in export).',
    '',
    'Apply path: Admin → Company industry blueprints (publish from a CEO) or company setup industry picker after re-publish.',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const files = [
    ...buildBlueprintZipEntries(bp, meta),
    { name: 'README-EXPORT.txt', content: readme },
  ];
  // Deduplicate paths (later wins for tools.json etc.)
  const byName = new Map();
  for (const f of files) byName.set(f.name, f);
  const zip = buildZipBuffer([...byName.values()]);
  console.info(
    '[company-blueprints] export zip id=%s bytes=%s source=%s files=%s secrets_cleared=%s residual=%s',
    meta.id,
    zip.length,
    meta.source,
    byName.size,
    meta.secrets_cleared,
    residual.join(',') || 'none'
  );
  return {
    zip,
    filename: `${safe}.zip`,
    meta,
  };
}

function slugify(name) {
  return (
    String(name || 'blueprint')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'blueprint'
  );
}

/**
 * Publish a snapshot payload as industry blueprint.
 * Always secret-scrubs before persist (Admin publish and CLI scripts).
 */
export function publishBlueprintFromPayload(
  {
    industry_id,
    name,
    description = '',
    payload,
    source_owner_user_id = null,
    source_company_name = null,
    published_by = null,
    set_default = false,
    id: forcedId = null,
  },
  actor = null
) {
  ensureCompanyBlueprintsSchema();
  const industry = String(industry_id || 'general_ops').trim();
  const title = String(name || '').trim();
  if (!title) {
    const err = new Error('Blueprint name required');
    err.status = 400;
    throw err;
  }

  // Never store live keys from workflow graphs / variables
  const { value: cleanPayload, stats: scrubStats } = cloneAndSanitizeBlueprint(
    payload && typeof payload === 'object' ? payload : {}
  );
  const residualPre = findResidualLiveSecrets(cleanPayload);
  if (scrubStats.cleared || scrubStats.scrubbed) {
    console.info(
      '[company-blueprints] publish scrub cleared=%s scrubbed=%s by=%s',
      scrubStats.cleared,
      scrubStats.scrubbed,
      actor?.id || published_by || 'system'
    );
  }
  if (residualPre.length) {
    console.warn(
      '[company-blueprints] publish residual secret patterns before normalize findings=%s',
      residualPre.join(',')
    );
  }

  const provisionalId =
    forcedId ||
    (cleanPayload && cleanPayload.id) ||
    `${slugify(title)}-${Date.now().toString(36)}`;
  const pack = normalizePack(
    {
      ...cleanPayload,
      id: provisionalId,
      industry,
      name: title,
      label: title,
      description: String(description || cleanPayload?.description || '').trim(),
      source: 'published',
      source_owner_user_id,
      source_company_name,
      published_by: published_by || actor?.id || null,
      is_default: !!set_default,
    },
    { source: 'published', industry, id: provisionalId }
  );
  if (!pack) {
    const err = new Error('Invalid blueprint payload');
    err.status = 400;
    throw err;
  }
  if (!pack.departments?.length || !pack.agents?.length) {
    const err = new Error('Snapshot needs at least one department and one AI employee');
    err.status = 400;
    throw err;
  }
  let id = forcedId || pack.id;
  // Only mint a fresh id when caller did not pin one; allow pack id === industry for
  // system demo packs (e.g. demo_balaji_ranganathan).
  if (!forcedId && (!id || id === industry)) {
    id = `${slugify(title)}-${Date.now().toString(36)}`;
  }
  pack.id = id;
  pack.industry = industry;

  // Final scrub after normalize (normalize merges nested structures)
  const packScrub = { cleared: 0, scrubbed: 0 };
  sanitizeBlueprintSecrets(pack, packScrub);
  const residual = findResidualLiveSecrets(pack);

  const db = getDb();
  if (set_default) {
    db.prepare(`UPDATE company_industry_blueprints SET is_default = 0 WHERE industry_id = ?`).run(industry);
  }
  db.prepare(
    `INSERT INTO company_industry_blueprints
      (id, industry_id, name, description, depth, is_default, source, payload_json, source_owner_user_id, source_company_name, published_by, published, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, 1, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       industry_id = excluded.industry_id,
       name = excluded.name,
       description = excluded.description,
       depth = excluded.depth,
       is_default = excluded.is_default,
       payload_json = excluded.payload_json,
       source_owner_user_id = excluded.source_owner_user_id,
       source_company_name = excluded.source_company_name,
       published_by = excluded.published_by,
       published = 1,
       updated_at = datetime('now')`
  ).run(
    id,
    industry,
    title,
    pack.description,
    pack.depth,
    set_default ? 1 : 0,
    JSON.stringify(pack),
    source_owner_user_id,
    source_company_name,
    published_by || actor?.id || null
  );
  invalidateBlueprintCache();
  console.info(
    '[company-blueprints] published id=%s industry=%s by=%s secrets_cleared=%s residual=%s',
    id,
    industry,
    actor?.id,
    scrubStats.cleared + packScrub.cleared,
    residual.join(',') || 'none'
  );
  const published = getBlueprint(id);
  if (published && typeof published === 'object') {
    published.secrets_scrubbed = true;
    published.secrets_cleared = scrubStats.cleared + packScrub.cleared;
    published.secrets_residual = residual;
  }
  return published;
}

export function unpublishBlueprint(id) {
  ensureCompanyBlueprintsSchema();
  const bp = getBlueprint(id);
  if (bp?.source === 'system') {
    const err = new Error('Cannot unpublish built-in system blueprints');
    err.status = 400;
    throw err;
  }
  getDb().prepare(`UPDATE company_industry_blueprints SET published = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  invalidateBlueprintCache();
  return { ok: true, id };
}

export function setIndustryDefaultBlueprint(industryId, blueprintId) {
  ensureCompanyBlueprintsSchema();
  const industry = String(industryId || '').trim();
  const bpId = String(blueprintId || '').trim();
  if (!industry || !bpId) {
    const err = new Error('industry_id and blueprint_id required');
    err.status = 400;
    throw err;
  }
  const bp = getBlueprint(bpId);
  if (!bp?.id) {
    const err = new Error(`Unknown blueprint: ${bpId}`);
    err.status = 404;
    throw err;
  }
  const db = getDb();
  db.prepare(`UPDATE company_industry_blueprints SET is_default = 0 WHERE industry_id = ?`).run(industry);
  db.prepare(
    `UPDATE company_industry_blueprints SET is_default = 1, updated_at = datetime('now') WHERE id = ?`
  ).run(bpId);
  db.prepare(
    `INSERT INTO company_industry_default_blueprints (industry_id, blueprint_id, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(industry_id) DO UPDATE SET blueprint_id = excluded.blueprint_id, updated_at = datetime('now')`
  ).run(industry, bpId);
  invalidateBlueprintCache();
  console.info('[company-blueprints] default set industry=', industry, 'blueprint=', bpId);
  return { ok: true, industry_id: industry, default_blueprint_id: bpId };
}