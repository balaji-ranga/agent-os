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

export const ACTION_FAMILIES = Object.freeze([
  { id: 'read', label: 'Read / research', defaultMode: 'autonomous', defaultTier: 'R0' },
  { id: 'write_internal', label: 'Internal writes', defaultMode: 'autonomous', defaultTier: 'R1' },
  { id: 'communicate_external', label: 'External messages / publish', defaultMode: 'approval_required', defaultTier: 'R2' },
  { id: 'financial_destructive', label: 'Financial / destructive', defaultMode: 'prohibited', defaultTier: 'R3' },
]);

export const POLICY_MODES = Object.freeze(['autonomous', 'approval_required', 'prohibited']);

let _ready = false;

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
    /delete|refund|submit_document|cancel_order|ibkr_.*?(order|execute|trade)|discount|destructive/.test(n)
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
  return true;
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
} = {}) {
  ensureActionPolicyTables();
  const tool = String(toolName || '').trim();
  if (!tool) return { ok: true, skipped: true, reason: 'no_tool' };
  const inferred = resolveRiskForTool(tool);
  const families = getActionFamilyPolicies(ownerUserId);
  const row = families.find((f) => f.family === inferred.action_family) || families[0];
  const mode = row?.mode || 'autonomous';
  const approval = mode === 'approval_required'
    ? consumeActionApprovalGrant(ownerUserId, body?.approval_token, {
        family: inferred.action_family,
        toolName: tool,
        body,
      })
    : { ok: true };

  if (mode === 'prohibited') {
    return deny(ownerUserId, tool, inferred, mode, goalRunId, 'Action family is prohibited for this company.');
  }
  if (mode === 'approval_required' && !approval.ok) {
    return deny(
      ownerUserId,
      tool,
      inferred,
      mode,
      goalRunId,
      `This action family requires a valid CEO approval grant before execution (${approval.reason}).`
    );
  }
  recordSafe(ownerUserId, goalRunId, {
    event_type: 'policy_decision',
    payload: { tool, mode, risk_tier: inferred.risk_tier, family: inferred.action_family, allow: true },
  });
  return {
    ok: true,
    mode,
    risk_tier: inferred.risk_tier,
    action_family: inferred.action_family,
    classification_source: inferred.source,
    approval_grant_id: approval.grant_id || null,
  };
}

function deny(ownerUserId, tool, inferred, mode, goalRunId, error) {
  recordSafe(ownerUserId, goalRunId, {
    event_type: 'policy_decision',
    payload: { tool, mode, risk_tier: inferred.risk_tier, family: inferred.action_family, allow: false, error },
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
  if (path.startsWith('/rate-limits') || path.startsWith('/model-mappings')) return next();

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

  const decision = evaluateActionPolicy({
    ownerUserId,
    toolName,
    body: req.body || {},
    goalRunId: req.body?.goal_run_id || req.body?.goalRunId || null,
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
