import { Router } from 'express';
import { attachAuthUser, requireRole } from '../middleware/auth.js';
import {
  listUsers,
  getUserById,
  setUserEnabled,
  registerCeoUser,
  listUserAgents,
  grantUserAgent,
  revokeUserAgent,
  listAllAgentsGrouped,
  grantStandardAgents,
} from '../services/users.js';
import { getAdminUserInsights } from '../services/admin-user-insights.js';
import {
  listAllBlueprintsAdmin,
  listIndustries,
  publishBlueprintFromPayload,
  unpublishBlueprint,
  setIndustryDefaultBlueprint,
  getBlueprintForAdminExport,
  buildCompanyBlueprintExportZip,
} from '../services/company-blueprints/index.js';
import {
  listCompanyBlueprintCandidates,
  snapshotOwnerAsBlueprintPayload,
  snapshotOwnerAsBlueprintPayloadAsync,
  validateContentBlueprintPayload,
} from '../services/company-blueprint-publish.js';
import { sendPlatformNotifications } from '../services/platform-notifications.js';
import { createSession } from '../services/auth/session.js';
import { getDb } from '../db/schema.js';
import { clearAgentTombstone } from '../services/agent-delete.js';
import { initCeoDb } from '../db/ceo-db.js';
import { usesTenantCeoDb } from '../db/ceo-db-config.js';
import {
  offboardUser,
  isProtectedFromOffboard,
  PROTECTED_OFFBOARD_NAMES,
} from '../services/user-offboard.js';
import { createAndSendPasswordReset } from '../services/password-reset.js';
import {
  listPlatformFeedback,
  updatePlatformFeedbackStatus,
  ensurePlatformFeedbackTables,
} from '../services/platform-feedback.js';
import {
  getPlatformLlmStatusPublic,
  setPlatformLlmActiveEndpoint,
  ensurePlatformSettingsTable,
} from '../services/platform-llm-settings.js';
import {
  ensureModelRoutingTables,
  getModelRoutingSnapshot,
  saveModelDeployment,
  saveModelRoute,
  probeModelDeployment,
} from '../services/model-routing-registry.js';
import {
  listAllTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  seedPlatformStandardWorkspaceTemplate,
  TEMPLATE_FILE_KEYS,
} from '../services/platform-agent-workspace-templates.js';
import { listA2AInvocations } from '../services/workflow-a2a-invocation-log.js';
import {
  listPlatformCrons,
  getPlatformCron,
  pausePlatformCron,
  resumePlatformCron,
  runPlatformCron,
} from '../services/platform-cron-registry.js';
import {
  OPENCLAW_SESSION_CLEANUP_CRON_ID,
  getOpenClawSessionCleanupPolicy,
  setOpenClawSessionCleanupPolicy,
} from '../services/openclaw-session-cleanup.js';
import { listPlatformTimeouts, updatePlatformTimeouts } from '../services/platform-timeout-settings.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';

const router = Router();

router.use(attachAuthUser);
router.use(requireRole('admin'));
ensurePlatformSettingsTable();
ensureModelRoutingTables();

/** Platform LLM primary/secondary switch (OpenAI ↔ Ollama/secondary). */
router.get('/platform-llm', (req, res) => {
  try {
    res.json(getPlatformLlmStatusPublic());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/platform-llm', (req, res) => {
  try {
    const endpoint = req.body?.llm_active_endpoint || req.body?.endpoint || req.body?.active;
    const result = setPlatformLlmActiveEndpoint(endpoint);
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/platform-timeouts', (req, res) => {
  try {
    res.json({ timeouts: listPlatformTimeouts() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/platform-timeouts', (req, res) => {
  try {
    const timeouts = updatePlatformTimeouts(req.body?.timeouts);
    writeOpenClawToolsList();
    res.json({ timeouts });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/** Admin-only model control plane. Secret values are never accepted or returned. */
router.get('/models', (req, res) => {
  try {
    res.json(getModelRoutingSnapshot({
      eventPage: req.query.event_page,
      eventPageSize: req.query.event_page_size,
    }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/models/deployments/:id', (req, res) => {
  try {
    res.json({ deployment: saveModelDeployment(req.params.id, req.body || {}) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put('/models/routes/:alias', (req, res) => {
  try {
    res.json({ route: saveModelRoute(req.params.alias, req.body || {}) });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/models/deployments/:id/probe', async (req, res) => {
  try {
    res.json(await probeModelDeployment(req.params.id));
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message, ...(e.result || {}) });
  }
});

router.get('/users', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json(listUsers({ limit, offset }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Platform adoption: registrations, inactivity, CRM/ERP/setup highlights. Admin only. */
router.get('/user-insights', (req, res) => {
  try {
    res.json(getAdminUserInsights());
  } catch (e) {
    console.warn('[admin] user-insights failed: %s', e?.message || e);
    res.status(500).json({ error: e.message || 'Failed to load user insights' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      country,
      region,
      mobile,
      role = 'ceo',
      db_mode,
      ceo_db_mode,
      mfa_policy,
      mfa_mode,
      industry = 'personal',
      industry_other = '',
      business_name = '',
    } = req.body || {};
    if (role === 'admin') {
      return res.status(400).json({ error: 'Use platform seed for admin accounts' });
    }
    const user = await registerCeoUser({
      email,
      password,
      name,
      country,
      region,
      mobile,
      db_mode,
      ceo_db_mode,
      mfa_policy,
      mfa_mode,
      industry,
      industry_other,
      business_name,
      // Admin-created accounts: legal accept not required (CEO can re-accept later via product).
      require_terms_accept: false,
    });
    res.status(201).json({ user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/users/:userId', (req, res) => {
  try {
    const user = getUserById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const agents = listUserAgents(req.params.userId);
    res.json({ user, agents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/users/:userId/enabled', (req, res) => {
  try {
    const enabled = req.body?.enabled !== false && req.body?.enabled !== 0;
    const user = setUserEnabled(req.params.userId, enabled);
    res.json({ user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Full offboard: purge schedules/workflows/standups/grants/tenant data and delete the user.
 * Body: { confirm_email: string } must match the target user's email.
 */
router.post('/users/:userId/offboard', (req, res) => {
  try {
    const target = getUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (isProtectedFromOffboard(target)) {
      return res.status(400).json({
        error: `Protected user — cannot offboard. Protected names: ${PROTECTED_OFFBOARD_NAMES.join(', ')} (plus all admins).`,
        protected: true,
      });
    }
    const result = offboardUser(req.params.userId, {
      confirmEmail: req.body?.confirm_email || req.body?.confirmEmail,
      actor: req.authUser,
      dryRun: req.body?.dry_run === true,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Offboard failed' });
  }
});

router.post('/users/:userId/impersonate', (req, res) => {
  try {
    const target = getUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (!target.enabled) return res.status(400).json({ error: 'Cannot impersonate a disabled user' });
    if (target.id === req.authUser.id) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }
    const session = createSession(target.id, { impersonatorUserId: req.authUser.id });
    res.json({
      user: { ...target, impersonation: { admin_id: req.authUser.id, admin_name: req.authUser.name, admin_email: req.authUser.email } },
      session,
      impersonation: {
        admin_id: req.authUser.id,
        admin_name: req.authUser.name,
        admin_email: req.authUser.email,
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/users/:userId/agents/grant-standard', (req, res) => {
  try {
    if (usesTenantCeoDb(req.params.userId)) initCeoDb(req.params.userId);
    const agents = grantStandardAgents(req.params.userId);
    res.json({ user_id: req.params.userId, granted: agents });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/users/:userId/agents/:agentId/enable', (req, res) => {
  try {
    res.json(grantUserAgent(req.params.userId, req.params.agentId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/users/:userId/agents/:agentId/disable', (req, res) => {
  try {
    res.json(revokeUserAgent(req.params.userId, req.params.agentId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/agents', (req, res) => {
  try {
    res.json(listAllAgentsGrouped());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/notifications', (req, res) => {
  try {
    const { title, body, message, link_url, linkUrl, user_ids, userIds, all_users, allUsers } = req.body || {};
    const result = sendPlatformNotifications({
      title,
      body: body ?? message ?? '',
      linkUrl: link_url ?? linkUrl ?? '',
      userIds: user_ids ?? userIds ?? [],
      allUsers: all_users === true || allUsers === true,
      createdBy: req.authUser.id,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * Push default-agent template MD + tool allowlists to all CEOs or selected user_ids.
 * Body: { all_users?, user_ids?, agent_ids?, force_identity_md?, sync_org?, regrant_defaults? }
 */
router.post('/default-agents/refresh', async (req, res) => {
  try {
    const {
      all_users,
      allUsers,
      user_ids,
      userIds,
      agent_ids,
      agentIds,
      force_identity_md,
      forceIdentityMd,
      sync_org,
      syncOrg,
      regrant_defaults,
      regrantDefaults,
      include_business_core,
      includeBusinessCore,
    } = req.body || {};
    const { refreshDefaultAgentsForUsers } = await import('../services/admin-refresh-default-agents.js');
    const result = await refreshDefaultAgentsForUsers({
      allUsers: all_users === true || allUsers === true,
      userIds: user_ids ?? userIds ?? [],
      agentIds: agent_ids ?? agentIds,
      forceIdentityMd: force_identity_md ?? forceIdentityMd,
      syncOrg: sync_org ?? syncOrg,
      regrantDefaults: regrant_defaults ?? regrantDefaults,
      // Default true: re-ensure CRM/ERP from company-blueprints/standard/business-core when Profile has them
      includeBusinessCore:
        include_business_core === false || includeBusinessCore === false ? false : true,
    });
    console.info(
      '[admin] default-agents/refresh by=%s ok=%s users=%s/%s lean=%s bc=%s',
      req.authUser?.id,
      result.ok,
      result.users_ok,
      result.users_targeted,
      (result.default_agent_ids || []).join(','),
      result.include_business_core
    );
    res.status(result.ok ? 200 : 207).json(result);
  } catch (e) {
    console.warn('[admin] default-agents/refresh', e?.message || e);
    res.status(400).json({ error: e.message });
  }
});

router.post('/agents/custom', (req, res) => {
  try {
    const { id, name, role, parent_id, reportingTo, reporting_to, department, workspace_path, openclaw_agent_id, owner_user_id } =
      req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    const parentId = parent_id || reportingTo || reporting_to || null;
    clearAgentTombstone(getDb(), id);
    getDb()
      .prepare(
        `INSERT INTO agents (id, name, role, parent_id, workspace_path, openclaw_agent_id, is_coo, agent_type, owner_user_id, department)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'custom', ?, ?)`
      )
      .run(
        id,
        name,
        role || '',
        parentId,
        workspace_path || null,
        openclaw_agent_id || id,
        owner_user_id || null,
        department != null ? String(department).trim() : ''
      );
    const agent = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(id);
    res.status(201).json({ agent });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Platform agent workspace MD templates (shared catalog). */
router.get('/workspace-templates', (req, res) => {
  try {
    seedPlatformStandardWorkspaceTemplate();
    res.json({ templates: listAllTemplates(), file_keys: TEMPLATE_FILE_KEYS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/workspace-templates/:id', (req, res) => {
  try {
    const tpl = getTemplate(req.params.id, { includeFiles: true });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json(tpl);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/workspace-templates', (req, res) => {
  try {
    const { name, description, files, status } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
    const tpl = createTemplate({
      name,
      description,
      files,
      status: status === 'published' ? 'published' : 'draft',
      actor: req.authUser,
    });
    res.status(201).json(tpl);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put('/workspace-templates/:id', (req, res) => {
  try {
    const tpl = updateTemplate(req.params.id, req.body || {}, req.authUser);
    res.json(tpl);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/workspace-templates/:id/publish', (req, res) => {
  try {
    const tpl = updateTemplate(req.params.id, { status: 'published' }, req.authUser);
    res.json(tpl);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/workspace-templates/:id/unpublish', (req, res) => {
  try {
    const existing = getTemplate(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Template not found' });
    if (existing.is_default) return res.status(400).json({ error: 'Cannot unpublish Platform standard template' });
    const tpl = updateTemplate(req.params.id, { status: 'draft' }, req.authUser);
    res.json(tpl);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/workspace-templates/:id', (req, res) => {
  try {
    res.json(deleteTemplate(req.params.id));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

/**
 * Platform-wide A2A invocation audit (card / OAuth / invoke), including denials
 * that never start a workflow run.
 * GET /admin/a2a-invocations?outcome=&endpoint=&publish_id=&owner_user_id=&client_ip=&source=&q=&limit=&offset=
 */
router.get('/a2a-invocations', (req, res) => {
  try {
    const result = listA2AInvocations({
      publishId: req.query.publish_id || req.query.publishId || '',
      ownerUserId: req.query.owner_user_id || req.query.ownerUserId || '',
      outcome: req.query.outcome || '',
      endpoint: req.query.endpoint || '',
      clientIp: req.query.client_ip || req.query.clientIp || '',
      source: req.query.source || '',
      q: req.query.q || req.query.search || '',
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Platform-level cron jobs — list / pause / resume / ad-hoc trigger (Admin only). */
router.get('/crons', (_req, res) => {
  try {
    res.json({ crons: listPlatformCrons() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/crons/:id', (req, res) => {
  try {
    const job = getPlatformCron(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown cron' });
    res.json({ cron: job });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/crons/:id/config', (req, res) => {
  if (req.params.id !== OPENCLAW_SESSION_CLEANUP_CRON_ID) {
    return res.status(404).json({ error: 'This cron has no editable policy' });
  }
  res.json({ policy: getOpenClawSessionCleanupPolicy() });
});

router.put('/crons/:id/config', (req, res) => {
  try {
    if (req.params.id !== OPENCLAW_SESSION_CLEANUP_CRON_ID) {
      return res.status(404).json({ error: 'This cron has no editable policy' });
    }
    const policy = setOpenClawSessionCleanupPolicy(req.body || {});
    console.log(
      `[admin] OpenClaw cleanup policy updated by=${req.authUser?.id || 'admin'} dry_run=${policy.dry_run}`
    );
    res.json({ ok: true, policy });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Invalid cleanup policy' });
  }
});

router.post('/crons/:id/pause', (req, res) => {
  try {
    const cron = pausePlatformCron(req.params.id);
    console.log(`[admin] cron paused id=${cron.id} by=${req.authUser?.id || 'admin'}`);
    res.json({ ok: true, cron });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/crons/:id/resume', (req, res) => {
  try {
    const cron = resumePlatformCron(req.params.id);
    console.log(`[admin] cron resumed id=${cron.id} by=${req.authUser?.id || 'admin'}`);
    res.json({ ok: true, cron });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/crons/:id/run', async (req, res) => {
  try {
    console.log(`[admin] cron adhoc trigger id=${req.params.id} by=${req.authUser?.id || 'admin'}`);
    const out = await runPlatformCron(req.params.id, { source: 'admin' });
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


router.post('/users/:userId/reset-password', async (req, res) => {
  try {
    const target = getUserById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (String(target.role || '').toLowerCase() === 'admin') {
      return res.status(400).json({ error: 'Cannot reset password for admin accounts via this endpoint' });
    }
    const result = await createAndSendPasswordReset(target.id, {
      createdBy: req.authUser?.id || 'admin',
      initiatedByAdmin: true,
      includeUrl: req.body?.include_url === true,
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Reset email failed' });
  }
});

router.get('/platform-feedback', (req, res) => {
  try {
    ensurePlatformFeedbackTables();
    const items = listPlatformFeedback({
      status: req.query.status,
      category: req.query.category,
      q: req.query.q,
      id: req.query.id,
      limit: req.query.limit,
    });
    res.json({ items, count: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/platform-feedback/:id', (req, res) => {
  try {
    const row = updatePlatformFeedbackStatus(req.params.id, {
      status: req.body?.status,
      status_reason: req.body?.status_reason || req.body?.reason,
      actor: req.authUser,
    });
    res.json({ feedback: row });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/company-blueprints', (_req, res) => {
  try {
    res.json({ blueprints: listAllBlueprintsAdmin(), industries: listIndustries() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/company-blueprints/candidates', (req, res) => {
  try {
    res.json({ candidates: listCompanyBlueprintCandidates({ limit: Number(req.query.limit) || 40 }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/company-blueprints/snapshot/:ownerUserId', async (req, res) => {
  try {
    const snap = await snapshotOwnerAsBlueprintPayloadAsync(req.params.ownerUserId);
    // Snapshot path already scrubs in company-blueprint-publish; surface flags for Admin UI
    res.json({
      ...snap,
      secrets_scrubbed: true,
      secrets_cleared: snap.payload?._secrets_cleared ?? snap.secrets_cleared ?? null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/company-blueprints/publish', async (req, res) => {
  try {
    const body = req.body || {};
    const ownerId = body.owner_user_id || body.ownerUserId;
    if (!ownerId) return res.status(400).json({ error: 'owner_user_id required' });
    const snap = await snapshotOwnerAsBlueprintPayloadAsync(ownerId);
    const industry = body.industry_id || body.industry || snap.industry;
    const published = publishBlueprintFromPayload(
      {
        industry_id: industry,
        name: body.name,
        description: body.description || snap.payload?.description || '',
        payload: snap.payload,
        source_owner_user_id: ownerId,
        source_company_name: snap.company_name,
        published_by: req.authUser?.id,
        set_default: body.set_default !== false, // day0+day1 blueprints become industry default unless opted out
        id: body.id || null,
      },
      req.authUser
    );
    const validation = validateContentBlueprintPayload(published || snap.payload, {
      expectedCompanyHint: snap.company_name,
    });
    console.info(
      '[admin] blueprint published id=%s validation_ok=%s issues=%s day1_workflows=%s goals=%s secrets_cleared=%s residual=%s',
      published?.id,
      validation.ok,
      validation.issues?.length || 0,
      snap.payload?.workflow_templates?.length || 0,
      snap.payload?.goal_templates?.length || 0,
      published?.secrets_cleared ?? 0,
      (published?.secrets_residual || []).join(',') || 'none'
    );
    res.json({
      ok: true,
      blueprint: published,
      validation,
      day0_day1: snap.payload?.day0_day1,
      secrets_scrubbed: true,
      secrets_cleared: published?.secrets_cleared ?? 0,
      secrets_residual: published?.secrets_residual || [],
    });
  } catch (e) {
    console.warn('[admin] publish blueprint', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/company-blueprints/validate-snapshot', async (req, res) => {
  try {
    const ownerId = req.body?.owner_user_id || req.body?.ownerUserId;
    if (!ownerId) return res.status(400).json({ error: 'owner_user_id required' });
    const snap = await snapshotOwnerAsBlueprintPayloadAsync(ownerId);
    const validation = validateContentBlueprintPayload(snap.payload, {
      expectedCompanyHint: snap.company_name,
    });
    res.json({
      ok: validation.ok,
      snapshot: snap,
      validation,
      secrets_scrubbed: true,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/company-blueprints/set-default', (req, res) => {
  try {
    const industry = req.body?.industry_id || req.body?.industry;
    const blueprintId = req.body?.blueprint_id || req.body?.id;
    res.json(setIndustryDefaultBlueprint(industry, blueprintId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Download blueprint pack as zip (secret-scrubbed; never includes live keys). Admin only. */
router.get('/company-blueprints/:id/export.zip', (req, res) => {
  try {
    const { zip, filename, meta } = buildCompanyBlueprintExportZip(req.params.id);
    console.info(
      '[admin] blueprint zip download id=%s by=%s bytes=%s secrets_cleared=%s residual=%s',
      meta.id,
      req.authUser?.id,
      zip.length,
      meta.secrets_cleared ?? 0,
      (meta.secrets_residual || []).join(',') || 'none'
    );
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(zip.length));
    res.setHeader('X-Agent-OS-Secrets-Scrubbed', '1');
    if (meta.secrets_cleared != null) {
      res.setHeader('X-Agent-OS-Secrets-Cleared', String(meta.secrets_cleared));
    }
    res.send(zip);
  } catch (e) {
    console.warn('[admin] blueprint zip download', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/company-blueprints/:id/unpublish', (req, res) => {
  try {
    res.json(unpublishBlueprint(req.params.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Full blueprint JSON + meta (admin inspection). Keep after static /candidates routes. */
router.get('/company-blueprints/:id', (req, res) => {
  try {
    const pack = getBlueprintForAdminExport(req.params.id);
    if (!pack) return res.status(404).json({ error: 'Blueprint not found' });
    res.json(pack);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


export default router;
