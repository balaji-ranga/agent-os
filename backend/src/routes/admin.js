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
import { sendPlatformNotifications } from '../services/platform-notifications.js';
import { createSession } from '../services/auth/session.js';
import { getDb } from '../db/schema.js';
import { initCeoDb } from '../db/ceo-db.js';
import { usesTenantCeoDb } from '../db/ceo-db-config.js';
import {
  offboardUser,
  isProtectedFromOffboard,
  PROTECTED_OFFBOARD_NAMES,
} from '../services/user-offboard.js';

const router = Router();

router.use(attachAuthUser);
router.use(requireRole('admin'));

router.get('/users', (req, res) => {
  try {
    res.json({ users: listUsers() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const {
      email,
      password,
      name,
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
      region,
      mobile,
      db_mode,
      ceo_db_mode,
      mfa_policy,
      mfa_mode,
      industry,
      industry_other,
      business_name,
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
    } = req.body || {};
    const { refreshDefaultAgentsForUsers } = await import('../services/admin-refresh-default-agents.js');
    const result = await refreshDefaultAgentsForUsers({
      allUsers: all_users === true || allUsers === true,
      userIds: user_ids ?? userIds ?? [],
      agentIds: agent_ids ?? agentIds,
      forceIdentityMd: force_identity_md ?? forceIdentityMd,
      syncOrg: sync_org ?? syncOrg,
      regrantDefaults: regrant_defaults ?? regrantDefaults,
    });
    res.status(result.ok ? 200 : 207).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/agents/custom', (req, res) => {
  try {
    const { id, name, role, parent_id, reportingTo, reporting_to, department, workspace_path, openclaw_agent_id, owner_user_id } =
      req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    const parentId = parent_id || reportingTo || reporting_to || null;
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

export default router;
