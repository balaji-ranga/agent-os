/**
 * Per-company (CEO owner) optional CRM/ERP selection + SoR binds.
 * Entitlements: always keyed by owner_user_id from auth - never body-only tenant ids.
 */
import { getDb } from '../db/schema.js';

/** CRM: twenty | erpnext = platform (embed + tools). hubspot/zoho = select-only placeholders. */
export const CRM_PROVIDERS = new Set(['none', 'twenty', 'erpnext', 'hubspot', 'zoho']);
export const ERP_PROVIDERS = new Set(['none', 'erpnext', 'xero']);
/** Platform stacks that open Flolah-hosted product with SSO. */
export const PLATFORM_CRM_PROVIDERS = new Set(['twenty', 'erpnext']);
export const PLATFORM_ERP_PROVIDERS = new Set(['erpnext']);

export function ensureCompanyBusinessProfileSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_business_profiles (
      owner_user_id TEXT PRIMARY KEY,
      crm_provider TEXT NOT NULL DEFAULT 'none',
      erp_provider TEXT NOT NULL DEFAULT 'none',
      twenty_workspace_id TEXT DEFAULT '',
      twenty_workspace_name TEXT DEFAULT '',
      twenty_api_key_hint TEXT DEFAULT '',
      twenty_bind_json TEXT DEFAULT '{}',
      erpnext_company_id TEXT DEFAULT '',
      erpnext_company_name TEXT DEFAULT '',
      erpnext_bind_json TEXT DEFAULT '{}',
      prefab_crm_agent_ids_json TEXT DEFAULT '[]',
      prefab_erp_agent_ids_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_erpnext_user_map (
      owner_user_id TEXT NOT NULL,
      flolah_user_id TEXT NOT NULL,
      erpnext_user_id TEXT NOT NULL DEFAULT '',
      erpnext_company_id TEXT NOT NULL DEFAULT '',
      roles_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, flolah_user_id, erpnext_company_id)
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_erpnext_user_map_owner ON company_erpnext_user_map(owner_user_id)`
  );
}

function parseJson(text, fallback) {
  try {
    if (text == null || text === '') return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function normalizeCrm(v) {
  const s = String(v || 'none').trim().toLowerCase() || 'none';
  if (!CRM_PROVIDERS.has(s)) {
    const err = new Error(
      `Invalid crm_provider "${s}". Allowed: ${[...CRM_PROVIDERS].join(', ')}`
    );
    err.status = 400;
    throw err;
  }
  return s;
}

function normalizeErp(v) {
  const s = String(v || 'none').trim().toLowerCase() || 'none';
  if (!ERP_PROVIDERS.has(s)) {
    const err = new Error(
      `Invalid erp_provider "${s}". Allowed: ${[...ERP_PROVIDERS].join(', ')}`
    );
    err.status = 400;
    throw err;
  }
  return s;
}

function rowToPublic(row) {
  if (!row) {
    return {
      owner_user_id: null,
      crm_provider: 'none',
      erp_provider: 'none',
      twenty: { workspace_id: null, workspace_name: null, bound: false, bind: {}, subdomain: null },
      erpnext: { company_id: null, company_name: null, bound: false },
      prefab_crm_agent_ids: [],
      prefab_erp_agent_ids: [],
      crm_enabled: false,
      erp_enabled: false,
      platform_crm: false,
      platform_erp: false,
      uses_erpnext: false,
    };
  }
  const crm = normalizeCrm(row.crm_provider);
  const erp = normalizeErp(row.erp_provider);
  return {
    owner_user_id: row.owner_user_id,
    crm_provider: crm,
    erp_provider: erp,
    twenty: {
      workspace_id: row.twenty_workspace_id || null,
      workspace_name: row.twenty_workspace_name || null,
      bound: Boolean(row.twenty_workspace_id),
      api_key_hint: row.twenty_api_key_hint || null,
      bind: parseJson(row.twenty_bind_json, {}),
      subdomain: (() => {
        const b = parseJson(row.twenty_bind_json, {});
        return b && b.subdomain ? String(b.subdomain) : null;
      })(),
    },
    erpnext: {
      company_id: row.erpnext_company_id || null,
      company_name: row.erpnext_company_name || null,
      bound: Boolean(row.erpnext_company_id),
      bind: (() => {
        const b = parseJson(row.erpnext_bind_json, {});
        // Never expose sso_password to API consumers; keep for internal service reads via getErpnextBindSecrets
        if (b && typeof b === 'object') {
          const { sso_password, ...safe } = b;
          return safe;
        }
        return {};
      })(),
    },
    prefab_crm_agent_ids: parseJson(row.prefab_crm_agent_ids_json, []),
    prefab_erp_agent_ids: parseJson(row.prefab_erp_agent_ids_json, []),
    crm_enabled: crm !== 'none',
    erp_enabled: erp !== 'none',
    platform_crm: PLATFORM_CRM_PROVIDERS.has(crm),
    platform_erp: PLATFORM_ERP_PROVIDERS.has(erp),
    /** True when Flolah uses ERPNext for CRM modules and/or ERP stack (company map + tools). */
    uses_erpnext: crm === 'erpnext' || erp === 'erpnext',
    updated_at: row.updated_at || null,
  };
}

export function getBusinessProfile(ownerUserId) {
  ensureCompanyBusinessProfileSchema();
  const id = String(ownerUserId || '').trim();
  if (!id) {
    const err = new Error('owner_user_id required');
    err.status = 400;
    throw err;
  }
  const row = getDb()
    .prepare(`SELECT * FROM company_business_profiles WHERE owner_user_id = ?`)
    .get(id);
  if (!row) {
    return rowToPublic({ owner_user_id: id, crm_provider: 'none', erp_provider: 'none' });
  }
  return rowToPublic(row);
}

export function ensureBusinessProfileRow(ownerUserId) {
  ensureCompanyBusinessProfileSchema();
  const id = String(ownerUserId || '').trim();
  if (!id) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO company_business_profiles (owner_user_id, crm_provider, erp_provider)
     VALUES (?, 'none', 'none')`
  ).run(id);
  return db.prepare(`SELECT * FROM company_business_profiles WHERE owner_user_id = ?`).get(id);
}

export function updateBusinessProviders(ownerUserId, { crm_provider, erp_provider } = {}) {
  const id = String(ownerUserId || '').trim();
  ensureBusinessProfileRow(id);
  const db = getDb();
  const cur = db.prepare(`SELECT * FROM company_business_profiles WHERE owner_user_id = ?`).get(id);
  const nextCrm =
    crm_provider !== undefined ? normalizeCrm(crm_provider) : normalizeCrm(cur.crm_provider);
  const nextErp =
    erp_provider !== undefined ? normalizeErp(erp_provider) : normalizeErp(cur.erp_provider);
  db.prepare(
    `UPDATE company_business_profiles
     SET crm_provider = ?, erp_provider = ?, updated_at = datetime('now')
     WHERE owner_user_id = ?`
  ).run(nextCrm, nextErp, id);
  return getBusinessProfile(id);
}

export function setTwentyBind(
  ownerUserId,
  { workspace_id, workspace_name = '', api_key_hint = '', bind = {} } = {}
) {
  const id = String(ownerUserId || '').trim();
  ensureBusinessProfileRow(id);
  getDb()
    .prepare(
      `UPDATE company_business_profiles
       SET twenty_workspace_id = ?, twenty_workspace_name = ?, twenty_api_key_hint = ?,
           twenty_bind_json = ?, updated_at = datetime('now')
       WHERE owner_user_id = ?`
    )
    .run(
      String(workspace_id || '').trim(),
      String(workspace_name || '').trim(),
      String(api_key_hint || '').trim(),
      JSON.stringify(bind && typeof bind === 'object' ? bind : {}),
      id
    );
  return getBusinessProfile(id);
}

export function setErpnextBind(ownerUserId, { company_id, company_name = '', bind = {} } = {}) {
  const id = String(ownerUserId || '').trim();
  ensureBusinessProfileRow(id);
  const prev = getDb()
    .prepare(`SELECT erpnext_company_id, erpnext_company_name, erpnext_bind_json FROM company_business_profiles WHERE owner_user_id = ?`)
    .get(id);
  const existingBind = parseJson(prev?.erpnext_bind_json, {});
  const merged =
    bind && typeof bind === 'object' ? { ...existingBind, ...bind } : existingBind;
  const coId = String(company_id != null && company_id !== '' ? company_id : prev?.erpnext_company_id || '').trim();
  const coName = String(
    company_name != null && company_name !== '' ? company_name : prev?.erpnext_company_name || ''
  ).trim();
  getDb()
    .prepare(
      `UPDATE company_business_profiles
       SET erpnext_company_id = ?, erpnext_company_name = ?, erpnext_bind_json = ?,
           updated_at = datetime('now')
       WHERE owner_user_id = ?`
    )
    .run(coId, coName, JSON.stringify(merged), id);
  return getBusinessProfile(id);
}

/** Full bind JSON including secrets — internal services only (SSO). */
export function getErpnextBindRaw(ownerUserId) {
  ensureCompanyBusinessProfileSchema();
  const id = String(ownerUserId || '').trim();
  if (!id) return {};
  const row = getDb()
    .prepare(`SELECT erpnext_bind_json FROM company_business_profiles WHERE owner_user_id = ?`)
    .get(id);
  return parseJson(row?.erpnext_bind_json, {});
}

export function setPrefabCrmAgentIds(ownerUserId, ids) {
  const id = String(ownerUserId || '').trim();
  ensureBusinessProfileRow(id);
  const list = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  getDb()
    .prepare(
      `UPDATE company_business_profiles
       SET prefab_crm_agent_ids_json = ?, updated_at = datetime('now')
       WHERE owner_user_id = ?`
    )
    .run(JSON.stringify(list), id);
  return list;
}

export function setPrefabErpAgentIds(ownerUserId, ids) {
  const id = String(ownerUserId || '').trim();
  ensureBusinessProfileRow(id);
  const list = Array.isArray(ids) ? ids.map((x) => String(x)) : [];
  getDb()
    .prepare(
      `UPDATE company_business_profiles
       SET prefab_erp_agent_ids_json = ?, updated_at = datetime('now')
       WHERE owner_user_id = ?`
    )
    .run(JSON.stringify(list), id);
  return list;
}

export function assertCrmEntitled(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  if (!p.crm_enabled) {
    const err = new Error(
      'CRM is not enabled for this company. Select a CRM provider in Profile or Company setup.'
    );
    err.status = 403;
    throw err;
  }
  return p;
}

export function assertErpEntitled(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  // ERPNext CRM-modules path counts as platform ERPNext access for company map / tools / SSO.
  if (p.uses_erpnext) return p;
  if (!p.erp_enabled) {
    const err = new Error(
      'ERP is not enabled for this company. Select an ERP provider in Profile or Company setup.'
    );
    err.status = 403;
    throw err;
  }
  return p;
}

/** Require ERPNext as CRM and/or ERP (not Xero-only). */
export function assertErpnextAccess(ownerUserId) {
  const p = getBusinessProfile(ownerUserId);
  if (!p.uses_erpnext) {
    const err = new Error(
      'ERPNext is not selected for this company (Profile CRM or ERP must be ERPNext).'
    );
    err.status = 403;
    throw err;
  }
  return p;
}


/** True if another CEO company already claims this Twenty workspace UUID. */
export function isTwentyWorkspaceBoundToOtherOwner(workspaceId, ownerUserId) {
  ensureCompanyBusinessProfileSchema();
  const ws = String(workspaceId || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!ws) return false;
  const rows = getDb()
    .prepare(
      `SELECT owner_user_id FROM company_business_profiles
       WHERE twenty_workspace_id = ? AND owner_user_id != ?`
    )
    .all(ws, owner || '__none__');
  return rows.length > 0;
}

export function resolveTwentyWorkspaceForOwner(ownerUserId) {
  const p = assertCrmEntitled(ownerUserId);
  if (p.crm_provider !== 'twenty') {
    const err = new Error(`CRM provider is ${p.crm_provider}, not twenty`);
    err.status = 400;
    throw err;
  }
  if (!p.twenty.workspace_id) {
    const err = new Error('Twenty workspace is not bound for this company yet');
    err.status = 409;
    throw err;
  }
  return {
    workspaceId: p.twenty.workspace_id,
    workspaceName: p.twenty.workspace_name,
    ownerUserId: String(ownerUserId),
  };
}
