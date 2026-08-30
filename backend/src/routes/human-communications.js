import { Router } from 'express';
import { requireAuth, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  archiveHumanConversation, createHumanCall, createHumanVoiceInvite,
  getHumanCall, getOrCreateDirectConversation, listHumanConversations,
  listHumanDirectory, listHumanMessages, listIncomingHumanCalls,
  markHumanConversationRead, sendHumanMessage, updateHumanCall, updateHumanChannels,
} from '../services/human-communications.js';

const router = Router();
router.use(requireAuth);
const ctx = (req) => ({ owner: resolveAuthenticatedCeoUserId(req, req.body || req.query || {}), userId: req.authUser.id });
const handle = (res, fn) => { try { res.json(fn()); } catch (e) { res.status(e.status || 400).json({ error: e.message }); } };

router.get('/directory', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { people: listHumanDirectory(owner, userId) }; }));
router.put('/directory/:userId/channels', (req, res) => handle(res, () => {
  const { owner, userId } = ctx(req);
  if (req.authUser.role !== 'ceo' && req.authUser.role !== 'admin' && userId !== req.params.userId) throw Object.assign(new Error('Not permitted'), { status: 403 });
  return { person: updateHumanChannels(owner, req.params.userId, req.body || {}) };
}));
router.post('/conversations/direct', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { conversation: getOrCreateDirectConversation(owner, userId, req.body?.user_id) }; }));
router.get('/conversations', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { conversations: listHumanConversations(owner, userId, req.query) }; }));
router.get('/conversations/:id/messages', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { messages: listHumanMessages(owner, userId, req.params.id, req.query) }; }));
router.post('/conversations/:id/messages', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { message: sendHumanMessage(owner, userId, req.params.id, req.body?.body, req.body?.metadata) }; }));
router.post('/conversations/:id/read', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return markHumanConversationRead(owner, userId, req.params.id, req.body?.message_id); }));
router.post('/conversations/:id/archive', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return archiveHumanConversation(owner, userId, req.params.id, req.body?.archived !== false); }));

router.get('/calls/incoming', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { calls: listIncomingHumanCalls(owner, userId) }; }));
router.post('/calls', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { call: createHumanCall(owner, userId, { calleeUserId: req.body?.callee_user_id, conversationId: req.body?.conversation_id, offer: req.body?.offer }) }; }));
router.get('/calls/:id', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { call: getHumanCall(owner, userId, req.params.id) }; }));
router.patch('/calls/:id', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return { call: updateHumanCall(owner, userId, req.params.id, req.body || {}) }; }));
router.post('/voice-invites', (req, res) => handle(res, () => { const { owner, userId } = ctx(req); return createHumanVoiceInvite(owner, userId, req.body?.target_user_id, { ttlSeconds: req.body?.ttl_seconds }); }));

export default router;
