/**
 * Generic action-family policy: Autonomous / Approval required / Prohibited.
 * Risk tiers R0–R3 inferred from tool names; CEO Control overrides per family.
 * Owner-scoped. Does not trust body ceo_user_id for authorization.
 */
import { createHash, randomBytes, randomUUID } from 'crypto';
import { getDb } from '../db/schema.js';
import { resolveToolOwnerUserIdOrNull, resolveEntitledOwnerUserId } from './tool-owner-scope.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { recordMissionEvent } from './goal-outcome.js';
import { parseTenantOpenClawAgentId } from './openclaw-tenant.js';

export const ACTION_FAMILIES = Object.freeze([
  { id: 'read', label: 'Read / research', defaultMode: 'autonomous', defaultTier: 'R0' },
  { id: 'write_internal', label: 'Internal writes', defaultMode: 'autonomous', defaultTier: 'R1' },
  { id: 'communicate_external', label: 'External messages / publish', defaultMode: 'approval_required', defaultTier: 'R2' },
  { id: 'financial_destructive', label: 'Financial / destructive', defaultMode: 'prohibited', defaultTier: 'R3' },
]);

export const POLICY_MODES = Object.freeze(['autonomous', 'approval_required', 'prohibited']);
export const POLICY_OVERRIDE_SCOPES = Object.freeze(['goal', 'workflow', 'agent', 'tool']);

let _ready = false;
const forwardedPolicyPasses = new Map();
const FORWARDED_POLICY_PASS_TTL_MS = 30_000;

function pruneForwardedPolicyPasses() {
  const now = Date.now();
  for (const [token, row] of forwardedPolicyPasses) {
    if (!row || row.expiresAt <= now) forwardedPolicyPasses.delete(token);
  }
}

/**
 * The generic /tools/invoke proxy evaluates Action Control before forwarding to
 * the concrete tool route. This one-time, in-memory pass lets that trusted
 * internal hop reuse the decision without evaluating or consuming a bounded
 * grant twice. Direct internal calls do not receive a pass and remain governed.
 */
export function issueForwardedActionPolicyPass({ ownerUserId, toolName, decision } = {}) {
  const owner = String(ownerUserId || '').trim();
  const tool = String(toolName || '').trim();
  if (!owner || !tool || decision?.ok !== true) return null;
  pruneForwardedPolicyPasses();
  const token = `afp_${randomBytes(32).toString('base64url')}`;
  forwardedPolicyPasses.set(token, {
    ownerUserId: owner,
    toolName: tool,
    decision: { ...decision },
    expiresAt: Date.now() + FORWARDED_POLICY_PASS_TTL_MS,
  });
  return token;
}

export function consumeForwardedActionPolicyPass(token, { ownerUserId, toolName } = {}) {
  const raw = String(token || '').trim();
  if (!raw) return null;
  pruneForwardedPolicyPasses();
  const row = forwardedPolicyPasses.get(raw);
  forwardedPolicyPasses.delete(raw);
  if (!row || row.expiresAt <= Date.now()) return null;
  if (row.ownerUserId !== String(ownerUserId || '').trim()) return null;
  if (row.toolName !== String(toolName || '').trim()) return null;
  return { ...row.decision, forwarded_policy_pass: true };
}

export function ensureActionPolicyTables() {
  if (_ready) return;
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS action_family_policies (
      owner_user_id TEXT NOT NULL,
      family TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'autonomous',
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, family)
    );
  `);
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS action_approval_grants (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      action_family TEXT NOT NULL,
      tool_name TEXT DEFAULT '',
      constraints_json TEXT DEFAULT '{}',
      remaining_uses INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_action_approval_grants_owner
      ON action_approval_grants(owner_user_id, expires_at DESC);
  `);
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS action_policy_overrides (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      action_family TEXT NOT NULL,
      mode TEXT NOT NULL,
      constraints_json TEXT DEFAULT '{}',
      expires_at TEXT,
      max_uses INTEGER,
      use_count INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(owner_user_id, scope_type, scope_id, action_family)
    );
    CREATE INDEX IF NOT EXISTS idx_action_policy_overrides_owner_scope
      ON action_policy_overrides(owner_user_id, scope_type, scope_id, enabled);
  `);
  try {
    const cols = getDb().prepare('PRAGMA table_info(content_tools_meta)').all().map((c) => c.name);
    if (!cols.includes('risk_tier')) getDb().exec(`ALTER TABLE content_tools_meta ADD COLUMN risk_tier TEXT DEFAULT ''`);
    if (!cols.includes('action_family')) getDb().exec(`ALTER TABLE content_tools_meta ADD COLUMN action_family TEXT DEFAULT ''`);
  } catch (_) {}
  _ready = true;
}

export function inferRiskForTool(toolName) {
  const n = String(toolName || '').toLowerCase();
  if (!n) return { risk_tier: 'R0', action_family: 'read' };
  if (
    n === 'gmail_mailbox_cleanup' ||
    /delete|\btrash\b|refund|submit_document|cancel_order|ibkr_.*?(order|execute|trade)|discount|destructive/.test(n)
  ) {
    return { risk_tier: 'R3', action_family: 'financial_destructive' };
  }
  if (
    /email_send|whatsapp|sms_send|publish|social_.*post|connector_execute|send_approved/.test(n)
  ) {
    return { risk_tier: 'R2', action_family: 'communicate_external' };
  }
  if (/(_list|_get|_status|search|discover|summarize|enquire|history|rag|read)/.test(n)) {
    return { risk_tier: 'R0', action_family: 'read' };
  }
  if (/create|update|upsert|kanban_create|kanban_move|kanban_assign|crm_|erp_/.test(n)) {
    return { risk_tier: 'R1', action_family: 'write_internal' };
  }
  return { risk_tier: 'R0', action_family: 'read' };
}

function explicitRiskForTool(toolName) {
  try {
    const row = getDb().prepare(
      'SELECT risk_tier, action_family FROM content_tools_meta WHERE name = ?'
    ).get(String(toolName || '').trim());
    const family = String(row?.action_family || '').trim();
    const tier = String(row?.risk_tier || '').trim().toUpperCase();
    if (ACTION_FAMILIES.some((item) => item.id === family) && /^R[0-3]$/.test(tier)) {
      return { risk_tier: tier, action_family: family, source: 'tool_metadata' };
    }
  } catch (_) {}
  return null;
}

export function resolveRiskForTool(toolName) {
  return explicitRiskForTool(toolName) || { ...inferRiskForTool(toolName), source: 'inferred' };
}

const approvalHash = (token) => createHash('sha256').update(String(token || '')).digest('hex');

export function createActionApprovalGrant(ownerUserId, {
  family,
  toolName = '',
  constraints = {},
  ttlSeconds = 900,
  uses = 1,
} = {}) {
  ensureActionPolicyTables();
  const owner = String(ownerUserId || '').trim();
  const actionFamily = String(family || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  if (!ACTION_FAMILIES.some((item) => item.id === actionFamily)) {
    throw Object.assign(new Error('Valid action family required'), { status: 400 });
  }
  const token = `fap_${randomBytes(32).toString('base64url')}`;
  const id = `aag-${randomUUID()}`;
  const expiresAt = new Date(Date.now() + Math.min(86400, Math.max(60, Number(ttlSeconds) || 900)) * 1000).toISOString();
  getDb().prepare(
    `INSERT INTO action_approval_grants
      (id, owner_user_id, token_hash, action_family, tool_name, constraints_json, remaining_uses, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, owner, approvalHash(token), actionFamily, String(toolName || '').trim(),
    JSON.stringify(constraints && typeof constraints === 'object' ? constraints : {}),
    Math.min(100, Math.max(1, Number(uses) || 1)), expiresAt);
  return { id, token, action_family: actionFamily, tool_name: String(toolName || '').trim(), expires_at: expiresAt };
}

function constraintsMatch(constraints, body) {
  const c = constraints && typeof constraints === 'object' ? constraints : {};
  const recipient = String(body?.recipient || body?.to || body?.email || body?.phone || '').trim().toLowerCase();
  const allowed = Array.isArray(c.allowed_recipients) ? c.allowed_recipients.map((v) => String(v).trim().toLowerCase()) : [];
  if (allowed.length && (!recipient || !allowed.includes(recipient))) return false;
  if (c.max_amount != null) {
    const amount = Number(body?.amount ?? body?.total ?? body?.value);
    if (!Number.isFinite(amount) || amount > Number(c.max_amount)) return false;
  }
  if (c.campaign_id != null && String(body?.campaign_id || '') !== String(c.campaign_id)) return false;
  const permittedEmails = Array.isArray(c.permitted_email_ids)
    ? c.permitted_email_ids.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
    : [];
  if (permittedEmails.length && (!recipient || !permittedEmails.includes(recipient))) return false;
  const rawUrl = String(body?.url || body?.target_url || body?.targetUrl || body?.website || body?.link_url || '').trim();
  const permittedWebsites = Array.isArray(c.permitted_websites)
    ? c.permitted_websites.map((value) => String(value).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean)
    : [];
  if (permittedWebsites.length) {
    let host = '';
    try { host = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`).hostname.toLowerCase(); } catch (_) {}
    if (!host || !permittedWebsites.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  }
  return true;
}

function parseConstraints(raw) {
  try { return JSON.parse(raw || '{}') || {}; } catch (_) { return {}; }
}

function overrideToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    action_family: row.action_family,
    mode: row.mode,
    constraints: parseConstraints(row.constraints_json),
    expires_at: row.expires_at || null,
    max_uses: row.max_uses == null ? null : Number(row.max_uses),
    use_count: Number(row.use_count || 0),
    enabled: Boolean(row.enabled),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

export function listActionPolicyOverrides(ownerUserId) {
  ensureActionPolicyTables();
  return getDb().prepare(
    `SELECT * FROM action_policy_overrides WHERE owner_user_id = ?
      ORDER BY scope_type, scope_id, action_family`
  ).all(String(ownerUserId || '')).map(overrideToPublic);
}

export function upsertActionPolicyOverride(ownerUserId, input = {}) {
  ensureActionPolicyTables();
  const owner = String(ownerUserId || '').trim();
  const scopeType = String(input.scope_type || input.scopeType || '').trim();
  const scopeId = String(input.scope_id || input.scopeId || '').trim().slice(0, 180);
  const family = String(input.action_family || input.family || '').trim();
  const mode = String(input.mode || '').trim();
  if (!owner) throw Object.assign(new Error('CEO context required'), { status: 403 });
  if (!POLICY_OVERRIDE_SCOPES.includes(scopeType)) throw Object.assign(new Error('Valid scope_type required'), { status: 400 });
  if (!scopeId) throw Object.assign(new Error('scope_id required'), { status: 400 });
  if (!ACTION_FAMILIES.some((item) => item.id === family)) throw Object.assign(new Error('Valid action_family required'), { status: 400 });
  if (!POLICY_MODES.includes(mode)) throw Object.assign(new Error('Valid mode required'), { status: 400 });
  const constraints = input.constraints && typeof input.constraints === 'object' ? input.constraints : {};
  const expiresAt = input.expires_at || input.expiresAt || null;
  if (expiresAt && !Number.isFinite(Date.parse(expiresAt))) throw Object.assign(new Error('expires_at must be a valid date'), { status: 400 });
  const maxUses = input.max_uses == null && input.maxUses == null
    ? null
    : Math.min(100000, Math.max(1, Number(input.max_uses ?? input.maxUses) || 1));
  const id = String(input.id || `apo-${randomUUID()}`);
  getDb().prepare(
    `INSERT INTO action_policy_overrides
      (id, owner_user_id, scope_type, scope_id, action_family, mode, constraints_json, expires_at, max_uses, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, scope_type, scope_id, action_family) DO UPDATE SET
       mode = excluded.mode, constraints_json = excluded.constraints_json,
       expires_at = excluded.expires_at, max_uses = excluded.max_uses,
       use_count = 0, enabled = excluded.enabled, updated_at = datetime('now')`
  ).run(id, owner, scopeType, scopeId, family, mode, JSON.stringify(constraints), expiresAt,
    maxUses, input.enabled === false ? 0 : 1);
  return overrideToPublic(getDb().prepare(
    `SELECT * FROM action_policy_overrides
      WHERE owner_user_id = ? AND scope_type = ? AND scope_id = ? AND action_family = ?`
  ).get(owner, scopeType, scopeId, family));
}

export function deleteActionPolicyOverride(ownerUserId, overrideId) {
  ensureActionPolicyTables();
  return getDb().prepare('DELETE FROM action_policy_overrides WHERE id = ? AND owner_user_id = ?')
    .run(String(overrideId || ''), String(ownerUserId || '')).changes > 0;
}

function policyContext(toolName, body = {}, explicit = {}) {
  return {
    goal: String(explicit.goalId || body.goal_id || body.goal_run_id || body.goalRunId || '').trim(),
    workflow: String(explicit.workflowId || body.workflow_id || body.definition_id || body.workflowId || '').trim(),
    agent: String(explicit.agentId || body.agent_id || body.agentId || '').trim(),
    tool: String(toolName || '').trim(),
  };
}

function resolveActiveOverride(ownerUserId, family, toolName, body, context) {
  const ids = policyContext(toolName, body, context);
  for (const scopeType of POLICY_OVERRIDE_SCOPES) {
    const scopeId = ids[scopeType];
    if (!scopeId) continue;
    const row = getDb().prepare(
      `SELECT * FROM action_policy_overrides
        WHERE owner_user_id = ? AND scope_type = ? AND scope_id = ?
          AND action_family = ? AND enabled = 1`
    ).get(String(ownerUserId || ''), scopeType, scopeId, family);
    if (!row) continue;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) continue;
    if (row.max_uses != null && Number(row.use_count) >= Number(row.max_uses)) continue;
    return { row, public: overrideToPublic(row), constraints_ok: constraintsMatch(parseConstraints(row.constraints_json), body) };
  }
  return null;
}

function consumeOverrideUse(row) {
  if (!row || row.max_uses == null) return true;
  return getDb().prepare(
    `UPDATE action_policy_overrides SET use_count = use_count + 1, updated_at = datetime('now')
      WHERE id = ? AND enabled = 1 AND use_count < max_uses`
  ).run(row.id).changes === 1;
}

export function consumeActionApprovalGrant(ownerUserId, token, { family, toolName, body = {} } = {}) {
  ensureActionPolicyTables();
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };
  const row = getDb().prepare(
    `SELECT * FROM action_approval_grants
      WHERE owner_user_id = ? AND token_hash = ? AND revoked_at IS NULL`
  ).get(String(ownerUserId || ''), approvalHash(raw));
  if (!row || Date.parse(row.expires_at) <= Date.now() || Number(row.remaining_uses) < 1) return { ok: false, reason: 'invalid_or_expired' };
  if (row.action_family !== family || (row.tool_name && row.tool_name !== toolName)) return { ok: false, reason: 'scope_mismatch' };
  let constraints = {};
  try { constraints = JSON.parse(row.constraints_json || '{}'); } catch (_) {}
  if (!constraintsMatch(constraints, body)) return { ok: false, reason: 'context_mismatch' };
  const used = getDb().prepare(
    `UPDATE action_approval_grants
        SET remaining_uses = remaining_uses - 1, used_at = datetime('now')
      WHERE id = ? AND remaining_uses > 0 AND revoked_at IS NULL`
  ).run(row.id);
  return used.changes === 1 ? { ok: true, grant_id: row.id } : { ok: false, reason: 'already_used' };
}

export function getActionFamilyPolicies(ownerUserId) {
  ensureActionPolicyTables();
  const owner = String(ownerUserId || '').trim();
  const rows = owner
    ? getDb()
        .prepare('SELECT family, mode, updated_at FROM action_family_policies WHERE owner_user_id = ?')
        .all(owner)
    : [];
  const byFamily = Object.fromEntries(rows.map((r) => [r.family, r.mode]));
  return ACTION_FAMILIES.map((f) => ({
    family: f.id,
    label: f.label,
    default_tier: f.defaultTier,
    mode: POLICY_MODES.includes(byFamily[f.id]) ? byFamily[f.id] : f.defaultMode,
  }));
}

export function upsertActionFamilyPolicies(ownerUserId, policies) {
  ensureActionPolicyTables();
  const owner = String(ownerUserId || '').trim();
  if (!owner) {
    const err = new Error('CEO context required');
    err.status = 403;
    throw err;
  }
  const allowed = new Set(ACTION_FAMILIES.map((f) => f.id));
  const list = Array.isArray(policies) ? policies : [];
  const stmt = getDb().prepare(
    `INSERT INTO action_family_policies (owner_user_id, family, mode, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(owner_user_id, family) DO UPDATE SET mode = excluded.mode, updated_at = datetime('now')`
  );
  const tx = getDb().transaction(() => {
    for (const p of list) {
      const family = String(p.family || p.id || '').trim();
      const mode = String(p.mode || '').trim();
      if (!allowed.has(family) || !POLICY_MODES.includes(mode)) continue;
      stmt.run(owner, family, mode);
    }
  });
  tx();
  console.info('[action-policy] saved', { owner: owner.slice(0, 12), n: list.length });
  return getActionFamilyPolicies(owner);
}

export function evaluateActionPolicy({
  ownerUserId,
  toolName,
  body = {},
  goalRunId = null,
  context = {},
} = {}) {
  ensureActionPolicyTables();
  const tool = String(toolName || '').trim();
  if (!tool) return { ok: true, skipped: true, reason: 'no_tool' };
  const inferred = resolveRiskForTool(tool);
  const families = getActionFamilyPolicies(ownerUserId);
  const companyRow = families.find((f) => f.family === inferred.action_family) || families[0];
  const override = resolveActiveOverride(ownerUserId, inferred.action_family, tool, body, context);
  if (override && !override.constraints_ok) {
    return deny(ownerUserId, tool, inferred, override.public.mode, goalRunId,
      'Action does not match the permitted recipients, websites, amount, or campaign for this override.', override.public);
  }
  const mode = override?.public?.mode || companyRow?.mode || 'autonomous';
  const approval = mode === 'approval_required'
    ? consumeActionApprovalGrant(ownerUserId, body?.approval_token, {
        family: inferred.action_family,
        toolName: tool,
        body,
      })
    : { ok: true };

  if (mode === 'prohibited') {
    return deny(ownerUserId, tool, inferred, mode, goalRunId, 'Action family is prohibited by the effective policy.', override?.public || null);
  }
  if (mode === 'approval_required' && !approval.ok) {
    return deny(
      ownerUserId,
      tool,
      inferred,
      mode,
      goalRunId,
      `This action family requires a valid CEO approval grant before execution (${approval.reason}).`,
      override?.public || null
    );
  }
  if (override && !consumeOverrideUse(override.row)) {
    return deny(ownerUserId, tool, inferred, mode, goalRunId, 'The bounded override has exhausted its permitted uses.', override.public);
  }
  recordSafe(ownerUserId, goalRunId, {
    event_type: 'policy_decision',
    payload: { tool, mode, risk_tier: inferred.risk_tier, family: inferred.action_family, allow: true,
      policy_scope: override?.public?.scope_type || 'company', policy_scope_id: override?.public?.scope_id || null },
  });
  return {
    ok: true,
    mode,
    risk_tier: inferred.risk_tier,
    action_family: inferred.action_family,
    classification_source: inferred.source,
    approval_grant_id: approval.grant_id || null,
    policy_scope: override?.public?.scope_type || 'company',
    policy_scope_id: override?.public?.scope_id || null,
    override_id: override?.public?.id || null,
  };
}

function deny(ownerUserId, tool, inferred, mode, goalRunId, error, override = null) {
  recordSafe(ownerUserId, goalRunId, {
    event_type: 'policy_decision',
    payload: { tool, mode, risk_tier: inferred.risk_tier, family: inferred.action_family, allow: false, error,
      policy_scope: override?.scope_type || 'company', policy_scope_id: override?.scope_id || null },
  });
  console.info('[action-policy] deny', { tool, mode, owner: String(ownerUserId || '').slice(0, 12) });
  return {
    ok: false,
    status: 403,
    error,
    mode,
    risk_tier: inferred.risk_tier,
    action_family: inferred.action_family,
    failure_class: 'policy_denial',
    needs_approval: mode === 'approval_required',
    policy_scope: override?.scope_type || 'company',
    policy_scope_id: override?.scope_id || null,
    override_id: override?.id || null,
  };
}

function recordSafe(ownerUserId, goalRunId, ev) {
  try {
    if (!ownerUserId) return;
    recordMissionEvent({ ownerUserId, goalRunId, ...ev });
  } catch (_) {}
}

export function actionPolicyMiddleware(req, res, next) {
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  const path = String(req.path || '');
  if (path.startsWith('/rate-limits') || path.startsWith('/model-mappings') || path.startsWith('/execution-behaviour')) return next();

  let toolName = String(req.body?.tool_name || req.body?.toolName || '').trim();
  if (!toolName) {
    try {
      const { resolveToolNameFromRequest } = requireToolNameResolver();
      toolName = resolveToolNameFromRequest(req) || '';
    } catch {
      toolName = '';
    }
  }
  if (!toolName) return next();

  let ownerUserId = null;
  try {
    ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
  } catch (_) {
    ownerUserId = null;
  }
  if (!ownerUserId) {
    try {
      ownerUserId = resolveEntitledOwnerUserId(req, { fallbackToBala: false }) || null;
    } catch (_) {
      ownerUserId = null;
    }
  }
  if (!ownerUserId) return next();

  const forwardedPass = req.isInternalService
    ? String(req.headers['x-flolah-action-policy-pass'] || '').trim()
    : '';
  if (forwardedPass) {
    const reused = consumeForwardedActionPolicyPass(forwardedPass, { ownerUserId, toolName });
    if (!reused) {
      return res.status(403).json({
        ok: false,
        status: 403,
        error: 'Invalid or expired internal Action Control pass.',
        failure_class: 'policy_denial',
      });
    }
    req.actionPolicy = reused;
    return next();
  }

  const decision = evaluateActionPolicy({
    ownerUserId,
    toolName,
    body: req.body || {},
    goalRunId: req.body?.goal_run_id || req.body?.goalRunId || null,
    context: {
      goalId: req.headers['x-flolah-goal-id'] || req.body?.goal_id || req.body?.goal_run_id || req.body?.goalRunId,
      workflowId: req.headers['x-flolah-workflow-id'] || req.body?.workflow_id || req.body?.definition_id || req.body?.workflowId,
      agentId: (() => {
        const raw = req.headers['x-openclaw-agent-id'] || req.headers['x-agent-id'] || req.body?.agent_id;
        return parseTenantOpenClawAgentId(raw)?.baseOpenClawId || raw;
      })(),
    },
  });
  if (decision?.ok === false) {
    return res.status(Number(decision.status) || 403).json(decision);
  }
  req.actionPolicy = decision;
  return next();
}

function requireToolNameResolver() {
  // Lazy to avoid circular import at module load.
  return {
    resolveToolNameFromRequest: (req) => {
      const bodyName = String(req.body?.tool_name || req.body?.toolName || '').trim();
      if (bodyName) return bodyName;
      const path = String(req.path || '').replace(/^\//, '').replace(/-/g, '_');
      return path || null;
    },
  };
}
