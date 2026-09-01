import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, requireTenantFullAccess, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { approveAuthorization, authenticateBridge, acknowledgeCommand, claimCommands, ensureIbkrNewDefaults, getDashboard, ingestBridgeEvent, publishConfig, registerBridge, revokeBridge } from '../services/ibkrnew-event-trader.js';

const router = Router();
const bridgeRate = new Map();
function owner(req) { return resolveAuthenticatedCeoUserId(req, req.body || {}); }
function bridge(req, res, next) {
  const match = authenticateBridge(req.headers['x-ibkrnew-bridge-id'], req.headers['x-ibkrnew-bridge-token']);
  if (!match) return res.status(401).json({ error: 'Invalid IBKRNew bridge credentials' });
  const minute = Math.floor(Date.now() / 60000); const prior = bridgeRate.get(match.bridge_id); const count = prior?.minute === minute ? prior.count + 1 : 1;
  bridgeRate.set(match.bridge_id, { minute, count });
  if (count > 1200) return res.status(429).json({ error: 'IBKRNew bridge rate limit exceeded' });
  req.ibkrNewBridge = match; next();
}
function handle(res, fn) { try { return fn(); } catch (e) { return res.status(e.status || 500).json({ error: e.message || String(e) }); } }

router.get('/dashboard', requireAuth, requireCeoOrAdmin, (req, res) => handle(res, () => res.json(getDashboard(owner(req)))));
router.post('/initialize', requireAuth, requireTenantFullAccess, (req, res) => handle(res, () => res.status(201).json(ensureIbkrNewDefaults(owner(req)))));
router.post('/configs/:kind/publish', requireAuth, requireTenantFullAccess, (req, res) => handle(res, () => res.status(201).json(publishConfig(owner(req), req.params.kind, req.body?.document, { confirmRiskLoosening: req.body?.confirm_risk_loosening === true }))));
router.post('/bridges', requireAuth, requireTenantFullAccess, (req, res) => handle(res, () => res.status(201).json(registerBridge(owner(req), req.body?.account_id))));
router.delete('/bridges/:bridgeId', requireAuth, requireTenantFullAccess, (req, res) => handle(res, () => res.json(revokeBridge(owner(req), req.params.bridgeId))));
router.post('/authorizations/:authorizationId/approve', requireAuth, requireTenantFullAccess, (req, res) => handle(res, () => res.json(approveAuthorization(owner(req), req.params.authorizationId))));
router.post('/bridge/events', bridge, (req, res) => handle(res, () => res.status(202).json(ingestBridgeEvent(req.ibkrNewBridge, req.body || {}))));
router.get('/bridge/bootstrap', bridge, (req, res) => handle(res, () => res.json({ environment: 'paper', bridge_id: req.ibkrNewBridge.bridge_id, account_id: req.ibkrNewBridge.account_id, configs: ensureIbkrNewDefaults(req.ibkrNewBridge.owner_user_id) })));
router.post('/bridge/commands/claim', bridge, (req, res) => handle(res, () => res.json({ commands: claimCommands(req.ibkrNewBridge, req.body?.limit) })));
router.post('/bridge/commands/:commandId/ack', bridge, (req, res) => handle(res, () => res.json(acknowledgeCommand(req.ibkrNewBridge, req.params.commandId, req.body?.status, req.body?.detail))));

export default router;
