/**
 * Session-token Voice tool bridge and hangup (CEO Call + public widget).
 * Auth is the short-lived session token — never trust body ceo_user_id.
 */
import { Router } from 'express';
import { invokeVoiceSessionTool, endVoiceSession } from '../services/agent-voice-sessions.js';

const router = Router();

const hits = new Map();
function rateLimitOk(key, limit = 60, windowMs = 60_000) {
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

router.post('/tools', async (req, res) => {
  try {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'ip').slice(0, 80);
    if (!rateLimitOk(`tools:${ip}`)) {
      return res.status(429).json({ error: 'Too many voice tool calls' });
    }
    const out = await invokeVoiceSessionTool({
      sessionToken: req.body?.session_token || req.body?.sessionToken,
      toolName: req.body?.tool_name || req.body?.name,
      args: req.body?.arguments || req.body?.args || req.body?.params || {},
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Voice tool failed' });
  }
});

router.post('/end', async (req, res) => {
  try {
    const ip = String(req.ip || req.headers['x-forwarded-for'] || 'ip').slice(0, 80);
    if (!rateLimitOk(`end:${ip}`, 20)) {
      return res.status(429).json({ error: 'Too many hangups' });
    }
    const out = await endVoiceSession({
      sessionToken: req.body?.session_token || req.body?.sessionToken,
      transcript: req.body?.transcript || [],
    });
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Voice hangup failed' });
  }
});

export default router;
