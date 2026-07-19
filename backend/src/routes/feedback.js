/**
 * User feedback on agent responses (UI) — strict user tenancy.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin } from '../middleware/auth.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { storeFeedback, listFeedback, getFeedbackById } from '../services/agent-feedback.js';

const router = Router();

router.post('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    if (!ownerUserId) return res.status(403).json({ error: 'CEO context required' });
    const {
      agent_id,
      agentId,
      source,
      message_id,
      messageId,
      message_role,
      messageRole,
      message_content,
      messageContent,
      rating,
      comment,
      context,
    } = req.body || {};
    const row = storeFeedback({
      ownerUserId,
      agentId: agent_id || agentId,
      source,
      messageId: message_id ?? messageId,
      messageRole: message_role || messageRole || 'assistant',
      messageContent: message_content ?? messageContent ?? '',
      rating,
      comment,
      context,
    });
    res.status(201).json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    if (!ownerUserId) return res.status(403).json({ error: 'CEO context required' });
    const agentId = req.query.agent_id || req.query.agentId || null;
    const days = req.query.days != null ? Number(req.query.days) : null;
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    const rating = req.query.rating || null;
    const rows = listFeedback({ ownerUserId, agentId, days, limit, rating });
    res.json({ owner_user_id: ownerUserId, feedback: rows });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id', requireAuth, requireCeoOrAdmin, (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req);
    if (!ownerUserId) return res.status(403).json({ error: 'CEO context required' });
    const row = getFeedbackById(ownerUserId, req.params.id);
    if (!row) return res.status(404).json({ error: 'Feedback not found' });
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
