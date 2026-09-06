import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { bootstrapNorthstarDemo, createObjective, createObjectiveApproval, decideObjectiveApproval, deleteMeasurementRegistryEntry, ensureObjectiveOperatingModel, getObjective, ideateInitiativeGoals, ideateObjective, linkGoalRun, listObjectives, listObjectiveVersions, listRevenueEvidence, measureKeyResult, measurementRegistry, objectiveDigest, updateObjective, upsertMeasurementRegistryEntry, upsertRevenueEvidence } from '../services/company-objectives.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);
const owner = (req) => resolveAuthenticatedCeoUserId(req, req.query || {});
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) { res.status(error.status || 500).json({ error: error.message }); } };

router.get('/', wrap(async (req, res) => res.json(listObjectives(owner(req), { limit: req.query.limit, offset: req.query.offset, periodType: req.query.period_type, status: req.query.status }))));
router.get('/digest', wrap(async (req, res) => res.json(objectiveDigest(owner(req), { from: req.query.from, to: req.query.to, limit: req.query.limit }))));
router.get('/measurement-registry', wrap(async (req, res) => res.json(measurementRegistry(owner(req)))));
router.put('/measurement-registry', wrap(async (req, res) => res.json(upsertMeasurementRegistryEntry(owner(req), req.body || {}))));
router.delete('/measurement-registry/:kind/:entryId', wrap(async (req, res) => res.json(deleteMeasurementRegistryEntry(owner(req), req.params.kind, req.params.entryId))));
router.post('/ideate', wrap(async (req, res) => res.json(await ideateObjective(owner(req), req.body || {}))));
router.post('/ideate-goals', wrap(async (req, res) => res.json(await ideateInitiativeGoals(owner(req), req.body || {}))));
router.post('/demo/northstar', wrap(async (req, res) => res.status(201).json(bootstrapNorthstarDemo(owner(req), req.user?.id))));
router.post('/', wrap(async (req, res) => res.status(201).json({ objective: createObjective(owner(req), req.body || {}, req.user?.id) })));
router.get('/:id', wrap(async (req, res) => { const objective = getObjective(owner(req), req.params.id); if (!objective) return res.status(404).json({ error: 'Objective not found' }); res.json({ objective }); }));
router.patch('/:id', wrap(async (req, res) => res.json({ objective: updateObjective(owner(req), req.params.id, req.body || {}, req.user?.id) })));
router.post('/:id/operating-model', wrap(async (req, res) => res.json({ objective: ensureObjectiveOperatingModel(owner(req), req.params.id) })));
router.get('/:id/versions', wrap(async (req, res) => res.json({ versions: listObjectiveVersions(owner(req), req.params.id) })));
router.post('/:id/key-results/:keyResultId/measurements', wrap(async (req, res) => res.status(201).json({ objective: measureKeyResult(owner(req), req.params.id, req.params.keyResultId, req.body || {}) })));
router.post('/:id/goal-runs', wrap(async (req, res) => res.status(201).json({ objective: linkGoalRun(owner(req), req.params.id, req.body || {}) })));
router.post('/:id/revenue-evidence', wrap(async (req, res) => res.status(201).json({ objective: upsertRevenueEvidence(owner(req), req.params.id, req.body || {}) })));
router.get('/:id/revenue-evidence', wrap(async (req, res) => res.json(listRevenueEvidence(owner(req), req.params.id, { limit: req.query.limit, offset: req.query.offset, recordType: req.query.record_type }))));
router.post('/:id/approvals', wrap(async (req, res) => res.status(201).json({ approval: createObjectiveApproval(owner(req), req.params.id, req.body || {}) })));
router.post('/:id/approvals/:approvalId/decision', wrap(async (req, res) => res.json({ approval: decideObjectiveApproval(owner(req), req.params.id, req.params.approvalId, req.body?.decision, req.user?.id) })));

export default router;
