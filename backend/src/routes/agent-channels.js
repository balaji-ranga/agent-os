/**
 * Per-CEO agent Slack / WhatsApp channel APIs.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getDb } from '../db/schema.js';
import { syncOrgContextForCeo } from '../services/org-context.js';
import { ensureTenantOpenClawAgent } from '../services/openclaw-tenant.js';
import { invalidateOpenClawMainSession } from '../services/openclaw-capability-session.js';
import {
  listAgentChannels,
  getAgentChannelForOwner,
  createAgentChannel,
  updateAgentChannel,
  deleteAgentChannel,
  applyAgentChannel,
  disableAgentChannel,
  testAgentChannel,
  getWhatsAppQrStatus,
  startWhatsAppQrLogin,
  waitWhatsAppQrLogin,
} from '../services/ceo-agent-channels.js';

const router = Router();

async function refreshAgentCapabilityContext(ownerUserId, agentId) {
  const result = { workspace_synced: false, session_invalidated: false, warnings: [] };
  try {
    await syncOrgContextForCeo(ownerUserId);
    result.workspace_synced = true;
  } catch (error) {
    result.warnings.push(`workspace_sync_failed: ${error?.message || error}`);
  }
  try {
    const agent = getDb().prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      result.warnings.push('agent_not_found_for_session_refresh');
      return result;
    }
    const runtime = ensureTenantOpenClawAgent(agent, ownerUserId);
    const reset = invalidateOpenClawMainSession(runtime.openclawAgentId);
    result.session_invalidated = reset.invalidated === true;
    result.session_refresh = reset;
  } catch (error) {
    result.warnings.push(`session_refresh_failed: ${error?.message || error}`);
  }
  return result;
}

function ownerOr403(req, res) {
  const ownerUserId = resolveAuthenticatedCeoUserId(req);
  if (!ownerUserId) {
    res.status(403).json({ error: 'CEO context required' });
    return null;
  }
  return ownerUserId;
}

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const agentId = req.query.agentId || req.query.agent_id || null;
    res.json({ channels: listAgentChannels(owner, { agentId }) });
  } catch (e) {
    console.error('[agent-channels] list failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'List failed' });
  }
});

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const channel = createAgentChannel(owner, req.body || {});
    res.status(201).json({ channel });
  } catch (e) {
    console.error('[agent-channels] create failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Create failed' });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const channel = getAgentChannelForOwner(owner, req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    res.json({ channel });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Lookup failed' });
  }
});

router.patch('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const channel = updateAgentChannel(owner, req.params.id, req.body || {});
    res.json({ channel });
  } catch (e) {
    console.error('[agent-channels] update failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Update failed' });
  }
});

router.delete('/:id', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const existing = getAgentChannelForOwner(owner, req.params.id);
    const out = deleteAgentChannel(owner, req.params.id);
    const capability_refresh = existing ? await refreshAgentCapabilityContext(owner, existing.agent_id) : null;
    res.json({ ...out, capability_refresh });
  } catch (e) {
    console.error('[agent-channels] delete failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Delete failed' });
  }
});

router.post('/:id/apply', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const out = applyAgentChannel(owner, req.params.id);
    const capability_refresh = await refreshAgentCapabilityContext(owner, out.channel.agent_id);
    res.json({ ...out, capability_refresh });
  } catch (e) {
    console.error('[agent-channels] apply failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Apply failed' });
  }
});

router.post('/:id/disable', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const channel = disableAgentChannel(owner, req.params.id);
    const capability_refresh = await refreshAgentCapabilityContext(owner, channel.agent_id);
    res.json({ channel, capability_refresh });
  } catch (e) {
    console.error('[agent-channels] disable failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Disable failed' });
  }
});

router.post('/:id/test', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const out = await testAgentChannel(owner, req.params.id);
    res.json(out);
  } catch (e) {
    console.error('[agent-channels] test failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Test failed' });
  }
});

router.get('/:id/whatsapp-qr', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const out = getWhatsAppQrStatus(owner, req.params.id);
    res.json(out);
  } catch (e) {
    console.error('[agent-channels] whatsapp-qr failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'QR status failed' });
  }
});

router.post('/:id/whatsapp-qr/start', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const force = req.body?.force === true;
    const out = await startWhatsAppQrLogin(owner, req.params.id, { force });
    res.json(out);
  } catch (e) {
    console.error('[agent-channels] whatsapp-qr start failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'QR start failed' });
  }
});

router.post('/:id/whatsapp-qr/wait', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = ownerOr403(req, res);
    if (!owner) return;
    const out = await waitWhatsAppQrLogin(owner, req.params.id, {
      timeoutMs: req.body?.timeoutMs,
      currentQrDataUrl: req.body?.currentQrDataUrl || req.body?.current_qr_data_url,
    });
    res.json(out);
  } catch (e) {
    console.error('[agent-channels] whatsapp-qr wait failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'QR wait failed' });
  }
});

export default router;
