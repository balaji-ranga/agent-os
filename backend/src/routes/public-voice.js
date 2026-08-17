/**
 * Public (unauthenticated) Voice widget: published slug → Realtime session.
 * Tools still run as the CEO owner via the session token.
 */
import { Router } from 'express';
import {
  createVoiceSession,
  publicVoicePagePayload,
  getPublishedVoiceBySlug,
} from '../services/agent-voice-sessions.js';

const router = Router();

const hits = new Map();
function rateLimitOk(key, limit = 12, windowMs = 60_000) {
  const now = Date.now();
  const row = hits.get(key) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  hits.set(key, row);
  return row.n <= limit;
}

router.get('/:slug', (req, res) => {
  try {
    const payload = publicVoicePagePayload(req.params.slug);
    if (!payload) return res.status(404).json({ error: 'Not found or unpublished' });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Lookup failed' });
  }
});

router.post('/:slug/session', async (req, res) => {
  try {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'ip').slice(0, 80);
    if (!rateLimitOk(`sess:${ip}:${req.params.slug}`)) {
      return res.status(429).json({ error: 'Too many call attempts' });
    }
    const pub = getPublishedVoiceBySlug(req.params.slug);
    if (!pub) return res.status(404).json({ error: 'Not found or unpublished' });
    const out = await createVoiceSession({
      ownerUserId: pub.row.owner_user_id,
      agentId: pub.row.agent_id,
      channelId: pub.row.id,
      publicSlug: String(req.params.slug || '').toLowerCase(),
      guest: true,
    });
    res.json(out);
  } catch (e) {
    console.warn('[voice] public session failed: %s', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Voice session failed' });
  }
});

export default router;
