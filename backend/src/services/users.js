/**
 * Platform users, sessions, and per-user agent grants.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';
import { hashPassword, verifyPassword } from './auth/password.js';
import { initCeoDb } from '../db/ceo-db.js';
import { getBalaCeoAuthId, isPlatformLegacyCeo } from './job-applicant-ceo.js';
import {
  defaultCeoDbMode,
  getCeoDbModeForUser,
  resolveRegisterCeoDbMode,
} from '../db/ceo-db-config.js';
import { ensureMfaTables, normalizeMfaPolicy, normalizeMfaMode, updateUserMfaSettings } from './auth/mfa.js';
import {
  normalizeLlmProvider,
  updateUserLlmSettings,
  userLlmPublic,
  syncUserLlmToOpenClaw,
} from './user-llm-settings.js';
import { normalizeLlmModelForProvider } from '../config/llm-provider-registry.js';
import { ensureCeoDefaultMasterData } from './ceo-default-master-data.js';
import { removeWorkflowSchedulesForOwner, syncWorkflowScheduleRegistry } from './agent-workflow-store.js';
import { PLATFORM_BYOK_KEY_NAME, ensureByokVaultSlots } from './user-api-keys.js';
import { isAgentTombstoned } from './agent-delete.js';
import { normalizeRetentionDays } from './data-retention.js';
import { assertTermsAcceptedAtRegister } from './legal-terms.js';

export { isUserEnabled } from './user-enabled.js';

/** Default agents granted on CEO register/onboard (user-scoped grants; tenant OpenClaw runtimes). */
export const DEFAULT_ONBOARD_AGENT_IDS = ['balserve', 'workflowbuilder', 'platformhelp'];

function slugId(prefix, email) {
  const base = String(email || '')
    .split('@')[0]
    .replace(/[^a-z0-9]+/gi, '-')
    .slice(0, 24)
    .toLowerCase();
  return `${prefix}-${base || 'user'}-${randomBytes(3).toString('hex')}`;
}

/**
 * Privileged CEOs keep the full standard catalog grants (legacy shared roster).
 * Everyone else gets only DEFAULT_ONBOARD_AGENT_IDS.
 */
export function isPrivilegedFullAgentGrantUser(userOrId) {
  const db = getDb();
  let row = null;
  if (userOrId && typeof userOrId === 'object') {
    row = userOrId;
  } else if (userOrId) {
    row = db.prepare('SELECT id, email, name, role FROM platform_users WHERE id = ?').get(String(userOrId));
  }
  if (!row) return false;
  if (row.role === 'admin') return true;
  const id = String(row.id || '');
  const name = String(row.name || '').trim().toLowerCase();
  const email = String(row.email || '').trim().toLowerCase();
  const balaId = getBalaCeoAuthId();
  if (id === balaId || id === 'ceo-bala') return true;
  if (name === 'balaji ranganathan' || name.includes('balaji ranganathan')) return true;
  if (name === 'balanew' || name === 'bala new' || /^bala\s*new$/i.test(String(row.name || ''))) return true;
  if (email.includes('balanew')) return true;
  const extra = String(process.env.AGENT_OS_FULL_AGENT_GRANT_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.includes(id)) return true;
  return false;
}

export function listStandardAgentIds() {
  const db = getDb();
  const rows = db
    .prepare(`SELECT id FROM agents WHERE agent_type = 'standard' OR agent_type IS NULL OR agent_type = ''`)
    .all();
  // Privileged CEOs are re-granted the whole catalog on every boot, which used to
  // undo a deliberate delete if a seed script recreated the row. Tombstones win.
  return rows.map((r) => r.id).filter((id) => !isAgentTombstoned(db, id));
}

export function listDefaultOnboardAgentIds() {
  const db = getDb();
  const existing = new Set(
    db
      .prepare(`SELECT id FROM agents WHERE agent_type = 'standard' OR agent_type IS NULL OR agent_type = ''`)
      .all()
      .map((r) => r.id)
  );
  return DEFAULT_ONBOARD_AGENT_IDS.filter((id) => existing.has(id));
}

/**
 * Grant standard agents for a CEO. Lean defaults for normal users; full catalog for privileged.
 * Grants are per-user (user_agents); OpenClaw runtimes remain tenant-scoped.
 */
export function grantStandardAgents(userId) {
  const db = getDb();
  const ids = isPrivilegedFullAgentGrantUser(userId)
    ? listStandardAgentIds()
    : listDefaultOnboardAgentIds();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, 1)`
  );
  for (const agentId of ids) {
    insert.run(userId, agentId);
  }
  return ids;
}

/**
 * Remove non-default standard agent grants from non-privileged CEOs.
 * Keeps custom (owner-scoped) agents and lean defaults.
 */
export function pruneSharedStandardAgentGrants() {
  const db = getDb();
  const lean = new Set(listDefaultOnboardAgentIds());
  const ceos = db.prepare(`SELECT id, email, name, role FROM platform_users WHERE role = 'ceo'`).all();
  let revoked = 0;
  const del = db.prepare(`DELETE FROM user_agents WHERE user_id = ? AND agent_id = ?`);
  for (const ceo of ceos) {
    if (isPrivilegedFullAgentGrantUser(ceo)) continue;
    const grants = db
      .prepare(
        `SELECT ua.agent_id, a.agent_type, a.owner_user_id
         FROM user_agents ua
         JOIN agents a ON a.id = ua.agent_id
         WHERE ua.user_id = ?`
      )
      .all(ceo.id);
    for (const g of grants) {
      const isCustom = g.agent_type === 'custom' || (g.owner_user_id && g.owner_user_id === ceo.id);
      if (isCustom) continue;
      if (lean.has(g.agent_id)) continue;
      // Revoke shared/standard catalog agents outside the lean default set
      del.run(ceo.id, g.agent_id);
      revoked += 1;
    }
  }
  return { revoked, leanDefaults: [...lean] };
}

export function listIndustries() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, label, sort_order FROM platform_industries WHERE enabled = 1 ORDER BY sort_order ASC, label ASC`
    )
    .all();
}

function normalizeIndustryFields({ industry, industry_other, business_name } = {}) {
  const ind = String(industry || '').trim().toLowerCase();
  const other = String(industry_other || '').trim();
  const biz = String(business_name || '').trim();
  if (ind && ind !== 'personal' && ind !== 'others' && !biz) {
    // business name required when not Personal (and not empty industry)
  }
  return {
    industry: ind,
    industry_other: ind === 'others' ? other : '',
    business_name: ind === 'personal' ? '' : biz,
  };
}

function assertIndustryValid(fields) {
  const { industry, industry_other, business_name } = fields;
  if (!industry) return fields;
  const row = getDb().prepare(`SELECT id FROM platform_industries WHERE id = ? AND enabled = 1`).get(industry);
  if (!row) throw new Error(`Unknown industry: ${industry}`);
  if (industry === 'others' && !industry_other) {
    throw new Error('industry_other is required when industry is Others');
  }
  if (industry !== 'personal' && !business_name) {
    throw new Error('business_name is required when industry is not Personal');
  }
  return fields;
}

export async function registerCeoUser({
  email,
  password,
  name,
  region = '',
  mobile = '',
  db_mode,
  ceo_db_mode,
  mfa_policy = 'inherit',
  mfa_mode = null,
  llm_provider = 'platform_decided',
  llm_model = null,
  llm_api_key = null,
  industry = '',
  industry_other = '',
  business_name = '',
  accept_terms,
  terms_version,
  privacy_version,
  /** When false (admin-created users), legal accept is optional and may be null. */
  require_terms_accept = true,
} = {}) {
  ensureMfaTables();
  const db = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password || !name) {
    throw new Error('email, password, and name are required');
  }
  const existing = db.prepare('SELECT id FROM platform_users WHERE email = ?').get(normalizedEmail);
  if (existing) throw new Error('Email already registered');

  const legal = assertTermsAcceptedAtRegister(
    { accept_terms, terms_version, privacy_version },
    { requireAccept: require_terms_accept !== false }
  );

  const industryFields = assertIndustryValid(
    normalizeIndustryFields({
      industry: industry || 'personal',
      industry_other,
      business_name,
    })
  );

  const id = slugId('ceo', normalizedEmail);
  const mode = resolveRegisterCeoDbMode(ceo_db_mode ?? db_mode ?? defaultCeoDbMode());
  const policy = normalizeMfaPolicy(mfa_policy);
  const userMode =
    mfa_mode == null || String(mfa_mode).trim() === '' || String(mfa_mode).toLowerCase() === 'inherit'
      ? null
      : normalizeMfaMode(mfa_mode);
  if (mfa_mode && String(mfa_mode).toLowerCase() !== 'inherit' && !userMode) {
    throw new Error('mfa_mode must be EMAIL, TOTP, or inherit');
  }
  const enabledFlag = policy === 'on' ? 1 : 0;
  const provider = normalizeLlmProvider(llm_provider);
  // BYOK secrets live in Management → API Keys (Platform_BYOK). Never accept pasted keys at register.
  if (llm_api_key != null && String(llm_api_key).trim()) {
    throw new Error(
      `Do not send llm_api_key during registration. Choose provider + default model here, then create "${PLATFORM_BYOK_KEY_NAME}" under Management → API Keys after login.`
    );
  }
  // OpenAI/OpenRouter may be selected without a vault key yet — seed slots; key is filled post-login.
  const apiKey = null;
  const modelNorm = normalizeLlmModelForProvider(provider, llm_model, {
    // Soft-default from catalog when model omitted (including BYOK defaults).
    required: false,
  });
  if (!modelNorm.ok) throw Object.assign(new Error(modelNorm.error), { status: 400 });
  const modelToStore = provider === 'platform_decided' ? null : modelNorm.model;

  db.prepare(
    `INSERT INTO platform_users
      (id, email, password_hash, name, region, mobile, role, enabled, ceo_db_mode, mfa_policy, mfa_mode, mfa_enabled, llm_provider, llm_model, llm_api_key, industry, industry_other, business_name, terms_accepted_at, terms_version, privacy_version)
     VALUES (?, ?, ?, ?, ?, ?, 'ceo', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    normalizedEmail,
    hashPassword(password),
    String(name).trim(),
    String(region).trim(),
    String(mobile).trim(),
    mode,
    policy,
    userMode,
    enabledFlag,
    provider,
    modelToStore,
    apiKey,
    industryFields.industry,
    industryFields.industry_other,
    industryFields.business_name,
    legal.terms_accepted_at,
    legal.terms_version,
    legal.privacy_version
  );
  if (legal.terms_accepted_at) {
    console.info(
      '[registerCeoUser] terms accepted user=%s terms_version=%s privacy_version=%s',
      id,
      legal.terms_version,
      legal.privacy_version
    );
  }

  if (mode === 'tenant' && !isPlatformLegacyCeo(id)) initCeoDb(id);
  const agents = grantStandardAgents(id);

  try {
    ensureByokVaultSlots(id, provider);
  } catch (e) {
    console.warn(`[registerCeoUser] ensureByokVaultSlots for ${id}:`, e.message);
  }

  let default_master_data = null;
  try {
    default_master_data = await ensureCeoDefaultMasterData(id, { refresh: true });
  } catch (e) {
    console.warn(`[registerCeoUser] default master data for ${id}:`, e.message);
  }

  try {
    syncUserLlmToOpenClaw(id);
  } catch (_) {}

  return {
    id,
    email: normalizedEmail,
    name: String(name).trim(),
    region: String(region).trim(),
    mobile: String(mobile).trim(),
    role: 'ceo',
    enabled: true,
    ceo_db_mode: mode,
    mfa_policy: policy,
    mfa_mode: userMode,
    industry: industryFields.industry,
    industry_other: industryFields.industry_other,
    business_name: industryFields.business_name,
    standard_agents_granted: agents,
    default_master_data,
    terms_accepted_at: legal.terms_accepted_at,
    terms_version: legal.terms_version,
    privacy_version: legal.privacy_version,
    ...userLlmPublic({ id, llm_provider: provider, llm_model: modelToStore, llm_api_key: apiKey }),
  };
}

export function registerAdminUser({ email, password, name, region = '', mobile = '' }) {
  const db = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password || !name) {
    throw new Error('email, password, and name are required');
  }
  const existing = db.prepare('SELECT id FROM platform_users WHERE email = ?').get(normalizedEmail);
  if (existing) throw new Error('Email already registered');

  const id = slugId('admin', normalizedEmail);
  db.prepare(
    `INSERT INTO platform_users (id, email, password_hash, name, region, mobile, role, enabled)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', 1)`
  ).run(id, normalizedEmail, hashPassword(password), String(name).trim(), String(region).trim(), String(mobile).trim());

  return {
    id,
    email: normalizedEmail,
    name: String(name).trim(),
    role: 'admin',
    enabled: true,
  };
}

export function authenticateUser(email, password) {
  const db = getDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM platform_users WHERE email = ?').get(normalizedEmail);
  if (!row || !row.enabled) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return userPublic(row);
}

export function userPublic(row) {
  if (!row) return null;
  const llm = userLlmPublic(row);
  const out = {
    id: row.id,
    email: row.email,
    name: row.name,
    region: row.region || '',
    mobile: row.mobile || '',
    role: row.role,
    role_title: String(row.role_title || '').trim(),
    display_timezone: String(row.display_timezone || '').trim(),
    ui_nav_hidden: (() => {
      try {
        const v = JSON.parse(row.ui_nav_hidden || '[]');
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    })(),
    enabled: !!row.enabled,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    industry: row.industry || '',
    industry_other: row.industry_other || '',
    business_name: row.business_name || '',
    profile_image: row.profile_image || '',
    mfa_policy: row.mfa_policy || 'inherit',
    mfa_mode: row.mfa_mode || null,
    mfa_enabled: !!row.mfa_enabled,
    llm_provider: llm.llm_provider,
    llm_model: llm.llm_model,
    llm_api_key_set: llm.llm_api_key_set,
    llm_api_key_hint: llm.llm_api_key_hint,
    terms_accepted_at: row.terms_accepted_at || null,
    terms_version: row.terms_version || null,
    privacy_version: row.privacy_version || null,
  };
  if (row.role === 'ceo') {
    out.ceo_db_mode = getCeoDbModeForUser(row.id);
    out.data_retention_days = Number(row.data_retention_days) || 90;
  }
  return out;
}

export function getUserById(id) {
  const row = getDb().prepare('SELECT * FROM platform_users WHERE id = ?').get(id);
  return userPublic(row);
}

export function listUsers({ limit = null, offset = 0 } = {}) {
  const baseSql = `SELECT id, email, name, region, mobile, role, enabled, ceo_db_mode, industry, industry_other, business_name, last_login_at, created_at, updated_at, terms_accepted_at, terms_version, privacy_version
       FROM platform_users`;
  const mapRow = (row) => ({
    ...row,
    enabled: !!row.enabled,
    ceo_db_mode: row.role === 'ceo' ? row.ceo_db_mode || defaultCeoDbMode() : null,
  });
  if (limit == null) {
    return getDb()
      .prepare(`${baseSql} ORDER BY created_at DESC`)
      .all()
      .map(mapRow);
  }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const total = getDb().prepare('SELECT COUNT(*) AS n FROM platform_users').get()?.n ?? 0;
  const users = getDb()
    .prepare(`${baseSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(lim, off)
    .map(mapRow);
  return {
    users,
    total,
    limit: lim,
    offset: off,
    has_more: off + users.length < total,
  };
}

/**
 * Enable/disable a platform user. When disabling, stop that user's scheduled work
 * (workflow cron registry, sessions). When re-enabling, rebuild workflow schedules.
 */
export function setUserEnabled(userId, enabled) {
  getDb()
    .prepare(`UPDATE platform_users SET enabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(enabled ? 1 : 0, userId);

  try {
    if (!enabled) {
      const removed = removeWorkflowSchedulesForOwner(userId);
      if (removed) console.log(`[users] disabled ${userId}: removed ${removed} workflow schedule(s)`);
      try {
        getDb().prepare(`DELETE FROM platform_sessions WHERE user_id = ?`).run(userId);
      } catch (_) {
        /* ignore */
      }
    } else {
      syncWorkflowScheduleRegistry();
    }
  } catch (e) {
    console.warn('[users] schedule cleanup on enable/disable failed:', e?.message || e);
  }

  return getUserById(userId);
}

export function listUserAgents(userId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT ua.user_id, ua.agent_id, ua.enabled, ua.granted_at,
              a.name, a.role, a.agent_type, a.owner_user_id
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = ?
       ORDER BY a.agent_type, a.name`
    )
    .all(userId);
}

export function listAgentsForUser(userId) {
  const db = getDb();
  return db
    .prepare(
      `SELECT a.*, ua.enabled AS user_enabled
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = ? AND ua.enabled = 1
       ORDER BY a.name`
    )
    .all(userId);
}

export function setUserAgentEnabled(userId, agentId, enabled) {
  const db = getDb();
  const agent = db.prepare('SELECT id, agent_type FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error('Agent not found');
  db.prepare(
    `INSERT INTO user_agents (user_id, agent_id, enabled) VALUES (?, ?, ?)
     ON CONFLICT(user_id, agent_id) DO UPDATE SET enabled = excluded.enabled`
  ).run(userId, agentId, enabled ? 1 : 0);
  return { user_id: userId, agent_id: agentId, enabled: !!enabled };
}

export function grantUserAgent(userId, agentId) {
  return setUserAgentEnabled(userId, agentId, true);
}

export function revokeUserAgent(userId, agentId) {
  return setUserAgentEnabled(userId, agentId, false);
}

const MAX_PROFILE_IMAGE_CHARS = 900_000; // ~0.9MB data-URL

function normalizeProfileImage(value, { clear = false } = {}) {
  if (clear) return '';
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (!s) return '';
  if (s.length > MAX_PROFILE_IMAGE_CHARS) {
    throw Object.assign(new Error('Profile image is too large (max ~650KB)'), { status: 400 });
  }
  if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s) && !/^https?:\/\//i.test(s)) {
    throw Object.assign(
      new Error('Profile image must be a data URL (png/jpeg/webp/gif) or https URL'),
      { status: 400 }
    );
  }
  return s;
}

function normalizeDisplayTimezone(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s });
    return s.slice(0, 64);
  } catch {
    throw Object.assign(new Error(`Invalid IANA timezone: ${s}`), { status: 400 });
  }
}

export function updateUserProfile(
  userId,
  {
    name,
    email,
    region,
    mobile,
    role_title,
    display_timezone,
    current_password,
    new_password,
    mfa_policy,
    mfa_mode,
    llm_provider,
    llm_model,
    llm_api_key,
    clear_llm_api_key,
    industry,
    industry_other,
    business_name,
    data_retention_days,
    profile_image,
    clear_profile_image,
  } = {}
) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM platform_users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found');

  const updates = {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed) throw new Error('name cannot be empty');
    updates.name = trimmed;
  }
  if (region !== undefined) updates.region = String(region).trim();
  if (mobile !== undefined) updates.mobile = String(mobile).trim();
  if (role_title !== undefined) {
    const title = String(role_title).trim().slice(0, 64);
    updates.role_title = title;
  }
  if (display_timezone !== undefined) {
    updates.display_timezone = normalizeDisplayTimezone(display_timezone);
  }
  if (clear_profile_image || profile_image !== undefined) {
    const next = normalizeProfileImage(profile_image, { clear: !!clear_profile_image });
    if (next !== undefined) updates.profile_image = next;
  }

  if (email !== undefined) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail) throw new Error('email cannot be empty');
    const existing = db.prepare('SELECT id FROM platform_users WHERE email = ? AND id != ?').get(normalizedEmail, userId);
    if (existing) throw new Error('Email already in use');
    updates.email = normalizedEmail;
  }

  if (data_retention_days !== undefined) {
    updates.data_retention_days = normalizeRetentionDays(data_retention_days);
  }

  if (industry !== undefined || industry_other !== undefined || business_name !== undefined) {
    const fields = assertIndustryValid(
      normalizeIndustryFields({
        industry: industry !== undefined ? industry : row.industry,
        industry_other: industry_other !== undefined ? industry_other : row.industry_other,
        business_name: business_name !== undefined ? business_name : row.business_name,
      })
    );
    if (!fields.industry) throw new Error('industry is required');
    updates.industry = fields.industry;
    updates.industry_other = fields.industry_other;
    updates.business_name = fields.business_name;
  }

  if (new_password !== undefined && String(new_password).length > 0) {
    if (!current_password) throw new Error('current_password required to change password');
    if (!verifyPassword(current_password, row.password_hash)) throw new Error('Current password is incorrect');
    if (String(new_password).length < 8) throw new Error('new_password must be at least 8 characters');
    updates.password_hash = hashPassword(new_password);
  }

  const keys = Object.keys(updates);
  if (keys.length) {
    const set = keys.map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE platform_users SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(
      ...keys.map((k) => updates[k]),
      userId
    );
  }

  if (mfa_policy !== undefined || mfa_mode !== undefined) {
    updateUserMfaSettings(userId, { mfa_policy, mfa_mode });
  }

  if (
    llm_provider !== undefined ||
    llm_model !== undefined ||
    llm_api_key !== undefined ||
    clear_llm_api_key
  ) {
    updateUserLlmSettings(userId, { llm_provider, llm_model, llm_api_key, clear_llm_api_key });
  }

  return getUserById(userId);
}

export function listAllAgentsGrouped() {
  const db = getDb();
  const standard = db
    .prepare(`SELECT * FROM agents WHERE agent_type = 'standard' OR agent_type IS NULL ORDER BY name`)
    .all();
  const custom = db
    .prepare(`SELECT * FROM agents WHERE agent_type = 'custom' ORDER BY name`)
    .all();
  return { standard, custom };
}

function assertNonDefaultPassword(password, label, defaultValue) {
  const strict =
    process.env.NODE_ENV === 'production' ||
    process.env.AGENT_OS_STRICT_SECRETS === '1' ||
    process.env.AGENT_OS_STRICT_SECRETS === 'true';
  if (!password || password === defaultValue) {
    if (strict) {
      throw new Error(
        `${label} must be set to a non-default value when NODE_ENV=production or AGENT_OS_STRICT_SECRETS=1`
      );
    }
    console.warn(`[security] ${label} is using a default/placeholder password — set a strong secret before exposing the API`);
  }
}

export function ensureDefaultAdmin() {
  const email = (process.env.AGENT_OS_ADMIN_EMAIL || 'admin@agent-os.local').trim().toLowerCase();
  const password = process.env.AGENT_OS_ADMIN_PASSWORD || 'admin-change-me';
  const db = getDb();
  const existing = db.prepare('SELECT id FROM platform_users WHERE role = ? LIMIT 1').get('admin');
  if (existing) return null;
  assertNonDefaultPassword(password, 'AGENT_OS_ADMIN_PASSWORD', 'admin-change-me');
  const user = registerAdminUser({ email, password, name: 'Platform Admin', region: 'global' });
  console.log(`Agent OS: seeded admin user ${user.email} (change AGENT_OS_ADMIN_PASSWORD)`);
  return user;
}

/**
 * Bala CEO — fixed auth id `ceo-bala`, uses existing platform DB (ceo_user_id `default`).
 * Does not create a tenant ceo.db.
 */
export function ensureBalaCeoUser() {
  const db = getDb();
  const id = getBalaCeoAuthId();
  const email = (process.env.AGENT_OS_BALA_EMAIL || 'bala@agent-os.local').trim().toLowerCase();
  const password = process.env.AGENT_OS_BALA_PASSWORD || 'bala-change-me';
  const name = process.env.AGENT_OS_BALA_NAME || 'Balaji Muthukrishnan';
  const region = process.env.AGENT_OS_BALA_REGION || 'Singapore';
  const mobile = process.env.AGENT_OS_BALA_MOBILE || '';

  let row = db.prepare('SELECT id FROM platform_users WHERE id = ?').get(id);
  if (!row) {
    const byEmail = db.prepare('SELECT id FROM platform_users WHERE email = ?').get(email);
    if (byEmail) {
      console.log(`Agent OS: Bala CEO email ${email} already used by ${byEmail.id}`);
      row = byEmail;
    }
  }

  if (!row) {
    assertNonDefaultPassword(password, 'AGENT_OS_BALA_PASSWORD', 'bala-change-me');
    db.prepare(
      `INSERT INTO platform_users (id, email, password_hash, name, region, mobile, role, enabled, ceo_db_mode)
       VALUES (?, ?, ?, ?, ?, ?, 'ceo', 1, 'shared')`
    ).run(id, email, hashPassword(password), name, region, mobile);
    console.log(`Agent OS: seeded Bala CEO ${email} (id=${id}) — uses existing platform DB`);
    grantStandardAgents(id);
    return { id, email, name, created: true };
  }

  grantStandardAgents(row.id);
  return { id: row.id, email, name, created: false };
}
