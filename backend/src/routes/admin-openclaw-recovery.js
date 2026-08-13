/**
 * Admin AgentSystem recovery — diagnose / drain queues / restart gateway / repair workspaces.
 * Read status: platform admin. Mutations: privileged OTP session (30 min).
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  PRIVILEGED_PURPOSE,
  requirePrivilegedSessionMw,
  logPrivilegedAction,
} from '../services/admin-privileged-session.js';
import {
  getRecoveryStatus,
  drainCeoLane,
  restartOpenClawGateway,
  repairGatewayConfig,
  healCeoWorkspaces,
  clearCeoAgentSession,
  resetNativeSessionStore,
  listGatewayCrons,
  removeGatewayCron,
  setFailureKanbanKillSwitch,
  listCeoAgents,
} from '../services/openclaw-admin-recovery.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

function assertPureAdmin(req) {
  if (req.authUser?.role !== 'admin' || req.authUser?.impersonation) {
    const err = new Error('Platform admin session required (exit impersonation first)');
    err.status = 403;
    throw err;
  }
}

const requirePriv = requirePrivilegedSessionMw({
  purpose: PRIVILEGED_PURPOSE.OPENCLAW_RECOVERY,
  acceptShared: true,
});

function ceoFrom(req) {
  return String(req.body?.ceo_user_id || req.query?.ceo_user_id || '').trim();
}

function audit(req, action, detail) {
  logPrivilegedAction({
    userId: req.authUser.id,
    purpose: PRIVILEGED_PURPOSE.OPENCLAW_RECOVERY,
    action,
    detail,
  });
}

router.get('/status', async (req, res) => {
  try {
    assertPureAdmin(req);
    const ceoUserId = String(req.query?.ceo_user_id || '').trim() || null;
    res.json(await getRecoveryStatus({ ceoUserId }));
  } catch (e) {
    console.warn('[openclaw-recovery] status failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/agents', (req, res) => {
  try {
    assertPureAdmin(req);
    const ceo = String(req.query?.ceo_user_id || '').trim();
    if (!ceo) return res.status(400).json({ error: 'ceo_user_id required' });
    res.json({ agents: listCeoAgents(ceo) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/gateway-crons', async (req, res) => {
  try {
    assertPureAdmin(req);
    res.json(await listGatewayCrons());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/drain', requirePriv, (req, res) => {
  try {
    const ceo = ceoFrom(req);
    const out = drainCeoLane(ceo, {
      includeScheduled: req.body?.pause_scheduled !== false,
      includeGoals: req.body?.fail_goals !== false,
      includeBrowser: req.body?.cancel_browser !== false,
    });
    audit(req, 'drain', { ceo_user_id: ceo, ...out });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] drain failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/restart-gateway', requirePriv, async (req, res) => {
  try {
    const out = await restartOpenClawGateway();
    audit(req, 'restart_gateway', out);
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] restart failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/repair-config', requirePriv, async (req, res) => {
  try {
    const out = await repairGatewayConfig();
    audit(req, 'repair_config', {
      ensure_ok: out.ensure?.ok,
      channels_ok: out.channels?.ok,
      chat: out.config?.chat_completions_enabled,
    });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] repair-config failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/heal-workspaces', requirePriv, (req, res) => {
  try {
    const ceo = ceoFrom(req);
    const out = healCeoWorkspaces(ceo);
    audit(req, 'heal_workspaces', { ceo_user_id: ceo, healed: out.healed, failed: out.failed });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] heal failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/clear-session', requirePriv, async (req, res) => {
  try {
    const ceo = ceoFrom(req);
    const agentId = String(req.body?.agent_id || '').trim();
    const out = await clearCeoAgentSession(ceo, agentId);
    audit(req, 'clear_session', { ceo_user_id: ceo, agent_id: agentId });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] clear-session failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/reset-session-store', requirePriv, (req, res) => {
  try {
    const ceo = ceoFrom(req);
    const agentId = String(req.body?.agent_id || '').trim();
    const out = resetNativeSessionStore(ceo, agentId);
    audit(req, 'reset_session_store', { ceo_user_id: ceo, agent_id: agentId });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] reset-session-store failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/gateway-crons/remove', requirePriv, async (req, res) => {
  try {
    const id = String(req.body?.id || req.body?.cron_id || '').trim();
    const out = await removeGatewayCron(id);
    audit(req, 'remove_gateway_cron', { id });
    res.json(out);
  } catch (e) {
    console.warn('[openclaw-recovery] remove cron failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/failure-kanban', requirePriv, (req, res) => {
  try {
    const enabled = req.body?.enabled;
    if (enabled !== true && enabled !== false && enabled !== 0 && enabled !== 1 && enabled !== '0' && enabled !== '1') {
      return res.status(400).json({ error: 'enabled boolean required' });
    }
    const on = enabled === true || enabled === 1 || enabled === '1';
    const out = setFailureKanbanKillSwitch(on);
    audit(req, 'failure_kanban', out);
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/unblock', requirePriv, async (req, res) => {
  try {
    const ceo = ceoFrom(req);
    const drain = drainCeoLane(ceo, {
      includeScheduled: req.body?.pause_scheduled !== false,
      includeGoals: req.body?.fail_goals !== false,
      includeBrowser: req.body?.cancel_browser !== false,
    });
    let restart = { skipped: true };
    if (req.body?.restart_gateway !== false) {
      try {
        restart = await restartOpenClawGateway();
      } catch (e) {
        restart = { ok: false, error: e.message || String(e) };
      }
    }
    audit(req, 'unblock', { ceo_user_id: ceo, drain, restart_ok: restart.ok !== false && !restart.skipped });
    res.json({ drain, restart });
  } catch (e) {
    console.warn('[openclaw-recovery] unblock failed:', e.message);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
