import { Router } from 'express';
import { attachAuthUser, requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listSteeringTargets, queueWorkSteering, listWorkSteering } from '../services/work-steering.js';
const router = Router();
router.use(attachAuthUser, requireAuth, requireCeoOrAdmin);
router.get('/targets', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'Owner session required' });
    res.json({ targets: listSteeringTargets(owner, req.query.agent_id || null) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.get('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'Owner session required' });
    res.json({ notes: listWorkSteering(owner, req.query.target_kind, req.query.target_id) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
router.post('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req);
    if (!owner) return res.status(403).json({ error: 'Owner session required' });
    const note = queueWorkSteering(owner, req.authUser.id, req.body || {});
    res.status(202).json({ note, message: 'Guidance queued for the next safe checkpoint. Current work continues; no task, schedule or goal was restarted.' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
export default router;
