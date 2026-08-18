/**
 * Authenticated Voice channel session mint (CEO Call button).
 * Tool/hangup use session token via /api/voice/* so guests and CEOs share one bridge.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { assertUserAgentAccess } from '../services/agent-chat-scope.js';
import {
  createVoiceSession,
  getVoiceChannelForAgent,
  voicePublicUrl,
} from '../services/agent-voice-sessions.js';

const router = Router({ mergeParams: true });

function parseConfig(raw) {
  try {
    return JSON.parse(raw || '{}') || {};
  } catch {
    return {};
  }
}

router.post('/session', requireAuth, requireCeoOrAdmin, async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'CEO context required' });
    const agentId = String(req.params.id || '').trim();
    assertUserAgentAccess(req.authUser, agentId);
    const ch = getVoiceChannelForAgent(owner, agentId);
    if (!ch || String(ch.status).toLowerCase() !== 'enabled') {
      console.info('[voice] call refused agent=%s owner=%s reason=no_enabled_voice_channel', agentId, owner);
      return res.status(400).json({
        error:
          'Live Call needs an enabled Voice channel on this employee (Realtime Caller). Slow Caller uses the microphone icon — speak, pause 3 seconds, and the message sends.',
      });
    }
    const config = parseConfig(ch.config_json);
    const out = await createVoiceSession({
      ownerUserId: owner,
      agentId,
      channelId: ch?.id || null,
      publicSlug: config.public_slug || null,
      guest: false,
    });
    res.json(out);
  } catch (e) {
    console.warn('[voice] auth session failed: %s', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Voice session failed' });
  }
});

router.get('/status', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'CEO context required' });
    const agentId = String(req.params.id || '').trim();
    assertUserAgentAccess(req.authUser, agentId);
    const ch = getVoiceChannelForAgent(owner, agentId);
    const config = ch ? parseConfig(ch.config_json) : {};
    const slug = config.public_slug || null;
    const enabled = ch && String(ch.status).toLowerCase() === 'enabled';
    res.json({
      channel: ch
        ? {
            id: ch.id,
            status: ch.status,
            public_slug: slug,
            published: !!config.published,
            public_url: slug && enabled ? voicePublicUrl(slug) : null,
          }
        : null,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Voice status failed' });
  }
});

export default router;
