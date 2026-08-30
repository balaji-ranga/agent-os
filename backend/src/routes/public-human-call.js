import { Router } from 'express';
import { createGuestHumanCall, getGuestHumanCall, resolveHumanVoiceInvite, updateGuestHumanCall } from '../services/human-communications.js';

const router = Router();
const send = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };
router.get('/:token', (req, res) => send(res, () => ({ invite: resolveHumanVoiceInvite(req.params.token) })));
router.post('/:token/calls', (req, res) => send(res, () => createGuestHumanCall(req.params.token, req.body?.offer)));
router.get('/:token/calls/:callId', (req, res) => send(res, () => ({ call: getGuestHumanCall(req.params.token, req.params.callId) })));
router.patch('/:token/calls/:callId', (req, res) => send(res, () => ({ call: updateGuestHumanCall(req.params.token, req.params.callId, req.body || {}) })));
export default router;
