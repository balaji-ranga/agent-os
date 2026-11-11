/**
 * Session-token Voice tool bridge and hangup (CEO Call + public widget).
 * Auth is the short-lived session token — never trust body ceo_user_id.
 */
import { Router, text } from 'express';
import { connectVoiceRealtime, invokeVoiceSessionTool, endVoiceSession } from '../services/agent-voice-sessions.js';

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

router.post('/realtime/calls',text({type:'application/sdp',limit:'64kb'}),async(req,res)=>{
  try{
    if(!rateLimitOk(`sdp:${req.ip}`,10))return res.status(429).json({error:'Too many voice connection attempts'});
    const response=await connectVoiceRealtime({sessionToken:req.headers['x-flolah-voice-session'],authorization:req.headers.authorization,sdp:req.body});
    res.status(response.status).type(response.headers.get('content-type')||'application/sdp').send(await response.text());
  }catch(error){res.status(error.status||502).json({error:error.status?error.message:'Voice gateway connection failed'});}
});

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
