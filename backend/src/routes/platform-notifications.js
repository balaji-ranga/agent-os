import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  listNotificationsForUser,
  markNotificationsRead,
  markAllNotificationsRead,
} from '../services/platform-notifications.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    res.json(listNotificationsForUser(req.authUser.id, { limit: req.query.limit, offset: req.query.offset }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Mark specific notifications as read. Body: { ids: number[] } */
router.post('/read', (req, res) => {
  try {
    const ids = req.body?.ids || req.body?.notification_ids || [];
    const out = markNotificationsRead(req.authUser.id, ids);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Mark all recent unread notifications as read. */
router.post('/read-all', (req, res) => {
  try {
    const out = markAllNotificationsRead(req.authUser.id);
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
