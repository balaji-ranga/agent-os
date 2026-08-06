/**
 * JSON/DB company blueprint registry.
 * System packs: packs/*.json + industries.json
 * Published: company_industry_blueprints table
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/schema.js';

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
    goal_templates: Array.isArray(raw.goal_templates) ? raw.goal_templates : [],
    agents_md: Array.isArray(raw.agents_md) ? raw.agents_md : [],
    policy_text: typeof raw.policy_text === 'string' ? raw.policy_text : '',
    day0_day1: raw.day0_day1 && typeof raw.day0_day1 === 'object' ? raw.day0_day1 : null,
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

export function inferCompanyTypeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/content|instagram|facebook|linkedin|blog|social|creator|shorts|publish|media/.test(t)) {
    // youtube alone no longer maps to content_creator if only youtube - still social
    if (/youtube|youtu\.be/.test(t) && !/instagram|facebook|linkedin|blog|social/.test(t)) {
      return 'general_ops'; // YouTube-only deferred to future pack
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
  if (['content_creator', 'saas', 'talent', 'trading_ops'].includes(bp?.id || bp?.industry)) return true;
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
  }));
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
  const provisionalId =
    forcedId ||
    (payload && payload.id) ||
    `${slugify(title)}-${Date.now().toString(36)}`;
  const pack = normalizePack(
    {
      ...(payload && typeof payload === 'object' ? payload : {}),
      id: provisionalId,
      industry,
      name: title,
      label: title,
      description: String(description || payload?.description || '').trim(),
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
  if (!id || id === industry) {
    id = `${slugify(title)}-${Date.now().toString(36)}`;
  }
  pack.id = id;
  pack.industry = industry;

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
  console.info('[company-blueprints] published', id, 'industry=', industry, 'by=', actor?.id);
  return getBlueprint(id);
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