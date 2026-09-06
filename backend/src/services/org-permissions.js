/**
 * Company People RBAC — permission catalog, built-in roles, tenant root (CEO) resolution.
 *
 * Terminology: CEO = root / company owner. Invited humans = employees / sub-users (role org_user).
 * Entitlements (agents, BYOK, CRM/ERP binds, files) stay on the CEO; sub-users inherit via owner_user_id.
 */
import { randomBytes } from 'crypto';
import { getDb } from '../db/schema.js';

function listAgentsForOwner(ownerUserId) {
  if (!ownerUserId) return [];
  return getDb()
    .prepare(
      `SELECT a.*, ua.enabled AS user_enabled
       FROM user_agents ua
       JOIN agents a ON a.id = ua.agent_id
       WHERE ua.user_id = ? AND ua.enabled = 1
       ORDER BY a.name`
    )
    .all(ownerUserId);
}

/** Nav/feature keys aligned with frontend/src/utils/ceoNavCatalog.js plus people.manage. */
export const PLATFORM_PERMISSION_KEYS = [
  'home',
  'this-week',
  'work',
  'org',
  'kanban',
  'crm',
  'erp',
  'scheduled-goals',
  'broadcast',
  'master-data',
  'content-explorer',
  'policies',
  'ai-snipper',
  'efficiency',
  'job-profiles',
  'browser-session',
  'job-workflows',
  'ibkr-summary',
  'ibkrnew-event-trader',
  'workflows',
  'avatars',
  'published-scenes',
  'ai-employees',
  'content-tools',
  'connectors',
  'mcp',
  'custom-scripts',
  'agent-exchange',
  'external-ai',
  'workspace-designer',
  'nav-menus',
  'ip-whitelists',
  'tokens-management',
  'api-keys',
  'people.manage',
  'agent-chat',
];

/** Always available to every company employee (sub-user). */
export const ALWAYS_ON_PERMISSIONS = ['home', 'kanban', 'profile'];

// New company members can collaborate with the COO and same-department AI employees.
// The CEO can remove this grant from a custom/member role in People → Roles.
const MEMBER_EXTRA = ['agent-chat'];

export function permissionCatalog({ showCrm = true, showErp = true } = {}) {
  const groups = [
    {
      id: 'platform',
      label: 'Platform',
      keys: PLATFORM_PERMISSION_KEYS.filter((k) => k !== 'crm' && k !== 'erp' && k !== 'people.manage'),
    },
    {
      id: 'business',
      label: 'CRM / ERP',
      keys: [showCrm ? 'crm' : null, showErp ? 'erp' : null].filter(Boolean),
    },
  ];
  return {
    always_on: ALWAYS_ON_PERMISSIONS,
    people_manage_locked: true,
    groups,
    keys: PLATFORM_PERMISSION_KEYS,
  };
}

export function isOrgUser(user) {
  return String(user?.role || '').toLowerCase() === 'org_user';
}

export function isCeoRoot(user) {
  return String(user?.role || '').toLowerCase() === 'ceo';
}

/** CEO root user id for entitlements, OpenClaw tenant, files, BYOK. */
export function resolveRootOwnerUserId(user) {
  if (!user) return null;
  if (isOrgUser(user)) {
    const owner = String(user.owner_user_id || '').trim();
    return owner || null;
  }
  if (isCeoRoot(user)) return String(user.id);
  return null;
}

export function isCeoDelegate(user) {
  if (!user) return false;
  if (isCeoRoot(user)) return true;
  if (!isOrgUser(user)) return false;
  if (user.is_ceo_delegate) return true;
  const roleId = user.org_role_id;
  if (!roleId) return false;
  try {
    const row = getDb().prepare('SELECT is_ceo_delegate FROM org_roles WHERE id = ?').get(roleId);
    return !!row?.is_ceo_delegate;
  } catch {
    return false;
  }
}

export function isTenantFullAccess(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isCeoDelegate(user);
}

export function listRolePermissionKeys(roleId) {
  if (!roleId) return [];
  return getDb()
    .prepare('SELECT permission_key FROM org_role_permissions WHERE role_id = ?')
    .all(roleId)
    .map((r) => String(r.permission_key));
}

export function getUserPermissionKeys(user) {
  if (!user) return [];
  if (isTenantFullAccess(user)) return [...PLATFORM_PERMISSION_KEYS];
  const extra = listRolePermissionKeys(user.org_role_id);
  return [...new Set([...ALWAYS_ON_PERMISSIONS, ...extra])];
}

export function hasPermission(user, key) {
  if (!key) return true;
  if (isTenantFullAccess(user)) return true;
  if (ALWAYS_ON_PERMISSIONS.includes(key)) return true;
  return getUserPermissionKeys(user).includes(key);
}

function slugRoleId(ownerUserId, slug) {
  const owner = String(ownerUserId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 24);
  return `orole-${slug}-${owner || 'ceo'}`;
}

export function ensureBuiltInRoles(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return { delegate: null, member: null };
  const db = getDb();
  const delegateId = slugRoleId(owner, 'ceo-delegate');
  const memberId = slugRoleId(owner, 'member');
  db.prepare(
    `INSERT OR IGNORE INTO org_roles (id, owner_user_id, name, slug, is_ceo_delegate, is_builtin)
     VALUES (?, ?, 'CEO Delegate', 'ceo-delegate', 1, 1)`
  ).run(delegateId, owner);
  db.prepare(
    `INSERT OR IGNORE INTO org_roles (id, owner_user_id, name, slug, is_ceo_delegate, is_builtin)
     VALUES (?, ?, 'Member', 'member', 0, 1)`
  ).run(memberId, owner);

  const insertPerm = db.prepare(
    `INSERT OR IGNORE INTO org_role_permissions (role_id, permission_key) VALUES (?, ?)`
  );
  for (const key of PLATFORM_PERMISSION_KEYS) {
    insertPerm.run(delegateId, key);
  }
  for (const key of MEMBER_EXTRA) {
    insertPerm.run(memberId, key);
  }
  return { delegate: delegateId, member: memberId };
}

export function hydrateOrgFields(user, row) {
  if (!user || !row) return user;
  if (row.role === 'ceo') user.owner_user_id = row.id;
  else user.owner_user_id = row.owner_user_id || null;
  user.org_role_id = row.org_role_id || null;
  user.department = row.department || '';
  user.parent_id = row.parent_id || '';
  user.is_ceo_delegate = row.role === 'ceo' ? true : false;
  if (row.role === 'org_user' && row.org_role_id) {
    try {
      const role = getDb().prepare('SELECT is_ceo_delegate FROM org_roles WHERE id = ?').get(row.org_role_id);
      user.is_ceo_delegate = !!role?.is_ceo_delegate;
    } catch {
      user.is_ceo_delegate = false;
    }
  }
  user.permissions = getUserPermissionKeys(user);
  return user;
}

export function loadUserOrgRow(userId) {
  return getDb()
    .prepare(
      `SELECT id, role, owner_user_id, org_role_id, department, parent_id, enabled FROM platform_users WHERE id = ?`
    )
    .get(userId);
}

export function attachOrgFieldsToAuthUser(user) {
  if (!user?.id) return user;
  const row = loadUserOrgRow(user.id);
  if (!row) return user;
  return hydrateOrgFields(user, row);
}

export function normalizeDept(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

export function getCooAgentId() {
  const row = getDb().prepare('SELECT id FROM agents WHERE is_coo = 1 LIMIT 1').get();
  return row?.id || null;
}

/**
 * AI employees a company actor may chat with / delegate to.
 * CEO and CEO Delegate: full entitled roster. Department employees: COO + same department.
 */
export function filterAgentsForActor(authUser, agents) {
  const list = Array.isArray(agents) ? agents : [];
  if (isTenantFullAccess(authUser) || isCeoRoot(authUser)) return list;
  const dept = normalizeDept(authUser?.department);
  const cooId = getCooAgentId();
  return list.filter((a) => {
    if (cooId && a.id === cooId) return true;
    if (a.is_coo) return true;
    if (!dept) return false;
    return normalizeDept(a.department) === dept;
  });
}

export function listEntitledAgentsForActor(authUser) {
  const owner = resolveRootOwnerUserId(authUser);
  if (!owner) return [];
  return filterAgentsForActor(authUser, listAgentsForOwner(owner));
}

export function actorCanAccessAgent(authUser, agentId) {
  if (!authUser || !agentId) return false;
  return listEntitledAgentsForActor(authUser).some((a) => a.id === agentId);
}

export function newOrgUserId(email) {
  const base = String(email || '')
    .split('@')[0]
    .replace(/[^a-z0-9]+/gi, '-')
    .slice(0, 24)
    .toLowerCase();
  return `usr-${base || 'user'}-${randomBytes(3).toString('hex')}`;
}

/**
 * Map API path (after /api) to a permission key, true (always), or '__full__' (CEO/delegate).
 * Unmatched paths deny org_user (secure default).
 */
export function matchApiPermission(method, path) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  const rules = [
    { prefix: '/auth', allow: true },
    { prefix: '/kanban', allow: true },
    { prefix: '/human-communications', allow: true },
    { prefix: '/platform-notifications', allow: true },
    { prefix: '/home', allow: true },
    { prefix: '/feedback', allow: true },
    { prefix: '/operational-effectiveness', allow: true },
    { prefix: '/video-tours', allow: true },
    { prefix: '/media', allow: true },
    { prefix: '/openclaw', allow: true },
    { prefix: '/standups', allow: true },
    { prefix: '/speech', permission: 'avatars' },
    { prefix: '/org-people/catalog', allow: true },
    { prefix: '/org-people', methods: ['GET'], allow: true },
    { prefix: '/org-people', permission: 'people.manage' },
    { prefix: '/org-members', methods: ['GET'], permission: 'org' },
    { prefix: '/org-members', fullAccess: true },
    // Dynamic chat/session endpoints must precede the broad agent mutation rule.
    // Otherwise an employee POST to /agents/:id/chat is incorrectly classified as
    // an agent-administration write and rejected as "CEO or CEO Delegate".
    { pattern: /^\/agents\/[^/]+\/(?:chat(?:\/|$)|sessions(?:\/|$))/, permission: 'agent-chat' },
    { prefix: '/agents', methods: ['POST', 'PATCH', 'PUT', 'DELETE'], fullAccess: true },
    { prefix: '/agents', allow: true },
    { prefix: '/master-data', permission: 'master-data' },
    { prefix: '/workspace-boards', permission: 'work' },
    { prefix: '/this-week-digest', permission: 'this-week' },
    { prefix: '/agent-goal-runs', permission: 'this-week' },
    { prefix: '/company-objectives', permission: 'this-week' },
    { prefix: '/ui-prefs', permission: 'nav-menus' },
    { prefix: '/user-api-keys', permission: 'api-keys' },
    { prefix: '/ceo-guardrails', permission: 'policies' },
    { prefix: '/company-setup', fullAccess: true },
    { prefix: '/company-operate', fullAccess: true },
    { prefix: '/onboarding', fullAccess: true },
    { prefix: '/business-core/embed/crm', permission: 'crm' },
    { prefix: '/business-core/embed/erp', permission: 'erp' },
    { prefix: '/business-core/sync-org', fullAccess: true },
    { prefix: '/business-core/menus', allow: true },
    { prefix: '/business-core', permissionAny: ['crm', 'erp'] },
    { prefix: '/company-workspace', permission: 'work' },
    { prefix: '/scheduled-goals', permission: 'scheduled-goals' },
    { prefix: '/agent-workflows', permission: 'workflows' },
    { prefix: '/job-applicant', permission: 'job-profiles' },
    { prefix: '/browser-session', permission: 'browser-session' },
    { prefix: '/broadcast', permission: 'broadcast' },
    { prefix: '/ai-snipper', permission: 'ai-snipper' },
    { prefix: '/efficiency/usage', methods: ['POST'], fullAccess: true },
    { prefix: '/efficiency/agents', methods: ['PUT'], fullAccess: true },
    { prefix: '/efficiency', permission: 'efficiency' },
    { prefix: '/avatars', permission: 'avatars' },
    { prefix: '/vr-', permission: 'avatars' },
    { prefix: '/integrations/mcp', permission: 'mcp' },
    { prefix: '/integrations/custom-scripts', permission: 'custom-scripts' },
    { prefix: '/integrations/external-agents', permission: 'external-ai' },
    { prefix: '/agent-exchange', permission: 'agent-exchange' },
    { prefix: '/integrations/openconnector', permission: 'connectors' },
    { prefix: '/integrations/email-inbound', permission: 'connectors' },
    { prefix: '/integrations/ibkr-bridge', permission: 'ibkr-summary' },
    { prefix: '/integrations/browser-worker', permission: 'browser-session' },
    { prefix: '/integrations/opensearch', permission: 'master-data' },
    { prefix: '/settings/ip-whitelists', permission: 'ip-whitelists' },
    { prefix: '/settings/external-tokens', permission: 'tokens-management' },
    { prefix: '/ibkr-trading', permission: 'ibkr-summary' },
    { prefix: '/ibkrnew-event-trader', permission: 'ibkrnew-event-trader' },
    { prefix: '/market-data', permission: 'ibkr-summary' },
    { prefix: '/agent-channels', permission: 'ai-employees' },
    { prefix: '/workspace', permission: 'content-explorer' },
    { prefix: '/content-explorer', permission: 'content-explorer' },
    { prefix: '/tools/meta', permission: 'content-tools' },
    { prefix: '/tools/model-mappings', permission: 'content-tools' },
    { prefix: '/tools/rate-limits', permission: 'content-tools' },
    { prefix: '/tools', allow: true },
    { prefix: '/cron', fullAccess: true },
    { prefix: '/admin', deny: true },
  ];

  for (const rule of rules) {
    if (rule.methods && !rule.methods.includes(m)) continue;
    if ((rule.pattern && rule.pattern.test(p)) || (!rule.pattern && (p === rule.prefix || p.startsWith(`${rule.prefix}/`)))) {
      if (rule.deny) return false;
      if (rule.allow) return true;
      if (rule.fullAccess) return '__full__';
      if (rule.permissionAny) return { any: rule.permissionAny };
      if (rule.permission) return rule.permission;
    }
  }
  return false;
}
