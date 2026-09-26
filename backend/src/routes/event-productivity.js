import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  acknowledgeProductivityEvent,
  createEventSubscription,
  deleteEventSubscription,
  deleteProductivityBinding,
  getProductivityEvent,
  getProductivitySummary,
  listEventSubscriptions,
  listProductivityBindings,
  listProductivityCapabilities,
  listProductivityEvents,
  listProductivityReceipts,
  processProductivityEvent,
  rotateEventSubscriptionSecret,
  updateEventSubscription,
  upsertProductivityBinding,
} from '../services/event-productivity.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

function owner(req) {
  const value = resolveAuthenticatedCeoUserId(req);
  if (!value) throw Object.assign(new Error('CEO context required'), { status: 403 });
  return value;
}
async function run(res, fn) {
  try { res.json(await fn()); }
  catch (error) { res.status(error.status || 500).json({ error: error.message || String(error), code: error.code }); }
}

router.get('/summary', (req, res) => run(res, () => getProductivitySummary(owner(req))));
router.get('/capabilities', (req, res) => run(res, () => listProductivityCapabilities()));
router.get('/subscriptions', (req, res) => run(res, () => ({ subscriptions: listEventSubscriptions(owner(req)) })));
router.post('/subscriptions', (req, res) => run(res, () => createEventSubscription(owner(req), req.body || {})));
router.patch('/subscriptions/:id', (req, res) => run(res, () => ({ subscription: updateEventSubscription(owner(req), req.params.id, req.body || {}) })));
router.delete('/subscriptions/:id', (req, res) => run(res, () => deleteEventSubscription(owner(req), req.params.id)));
router.post('/subscriptions/:id/rotate-secret', (req, res) => run(res, () => rotateEventSubscriptionSecret(owner(req), req.params.id)));

router.get('/events', (req, res) => run(res, () => ({ events: listProductivityEvents(owner(req), req.query || {}) })));
router.get('/events/:id', (req, res) => run(res, () => ({ event: getProductivityEvent(owner(req), req.params.id) })));
router.post('/events/:id/acknowledge', (req, res) => run(res, () => ({ event: acknowledgeProductivityEvent(owner(req), req.params.id) })));
router.post('/events/:id/replay', (req, res) => run(res, () => processProductivityEvent(owner(req), req.params.id)));

router.get('/bindings', (req, res) => run(res, () => ({ bindings: listProductivityBindings(owner(req)) })));
router.put('/bindings', (req, res) => run(res, () => ({ binding: upsertProductivityBinding(owner(req), req.body || {}) })));
router.delete('/bindings/:id', (req, res) => run(res, () => deleteProductivityBinding(owner(req), req.params.id)));
router.get('/receipts', (req, res) => run(res, () => ({ receipts: listProductivityReceipts(owner(req), req.query.limit) })));

export default router;
