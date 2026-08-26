import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { addReviewFeedback, createImprovement, decideImprovement, generateReviewOpinions, getCompanyReview, listCompanyReviews, prepareCompanyReview, setReviewStatus } from '../services/company-reviews.js';

const router = Router();
const owner = (req) => resolveAuthenticatedCeoUserId(req, req.query || {});
const wrap = (fn) => (req, res) => { try { fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
const wrapAsync = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } };
router.use(requireAuth, requireCeoOrAdmin);
router.get('/', wrap((req, res) => res.json({ items: listCompanyReviews(owner(req), Math.min(50, Number(req.query.limit) || 20)) })));
router.post('/prepare', wrap((req, res) => res.json(prepareCompanyReview({ ownerUserId: owner(req), cadence: req.body?.cadence, periodStart: req.body?.period_start, periodEnd: req.body?.period_end, preparedByAgentId: req.body?.prepared_by_agent_id }))));
router.get('/:id', wrap((req, res) => { const row = getCompanyReview(owner(req), req.params.id); if (!row) return res.status(404).json({ error: 'Review not found' }); res.json(row); }));
router.post('/:id/status', wrap((req, res) => res.json(setReviewStatus(owner(req), req.params.id, req.body?.status))));
router.post('/:id/feedback', wrap((req, res) => res.json(addReviewFeedback({ ownerUserId: owner(req), reviewId: req.params.id, evidenceType: req.body?.evidence_type, evidenceId: req.body?.evidence_id, agentId: req.body?.agent_id, rating: req.body?.rating, feedback: req.body?.feedback, classification: req.body?.classification, scope: req.body?.scope }))));
router.post('/:id/opinions/generate', wrapAsync(async (req, res) => res.json(await generateReviewOpinions({ ownerUserId: owner(req), reviewId: req.params.id, evidenceId: req.body?.evidence_id }))));
router.post('/:id/improvements', wrap((req, res) => res.json(createImprovement({ ownerUserId: owner(req), reviewId: req.params.id, title: req.body?.title, problem: req.body?.problem, proposedChange: req.body?.proposed_change, destination: req.body?.destination, scope: req.body?.scope, evidence: req.body?.evidence, ownerAgentId: req.body?.owner_agent_id, successMetric: req.body?.success_metric, evaluationDate: req.body?.evaluation_date, validationTest: req.body?.validation_test }))));
router.post('/improvements/:id/decision', wrap((req, res) => res.json(decideImprovement({ ownerUserId: owner(req), improvementId: req.params.id, decision: req.body?.decision, userId: req.user?.id }))));
export default router;
