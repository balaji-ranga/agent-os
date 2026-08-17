/**
 * Company People API — invite employees (sub-users), org placement, roles.
 */
import { Router } from 'express';
import {
  requireAuth,
  requireCeoOrAdmin,
  requireTenantFullAccess,
  resolveAuthenticatedCeoUserId,
} from '../middleware/auth.js';
import { permissionCatalog, isTenantFullAccess } from '../services/org-permissions.js';
import {
  inviteOrgPerson,
  listOrgPeople,
  getOrgPerson,
  updateOrgPerson,
  listOrgRoles,
  createOrgRole,
  setRolePermissions,
  deleteOrgRole,
} from '../services/org-people.js';
import { createAndSendPasswordReset } from '../services/password-reset.js';
import { syncOrgContextForCeo } from '../services/org-context.js';
import { getBusinessProfile } from '../services/company-business-profile.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/catalog', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    let showCrm = true;
    let showErp = true;
    try {
      const profile = getBusinessProfile(owner);
      showCrm = !!(profile?.crm_provider || profile?.crm_enabled);
      showErp = !!(profile?.erp_provider || profile?.erp_enabled);
    } catch (_) {}
    res.json(permissionCatalog({ showCrm, showErp }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json({ people: listOrgPeople(owner) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/', requireTenantFullAccess, async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const out = await inviteOrgPerson(owner, req.body || {}, { invitedBy: req.authUser.id });
    res.status(201).json(out);
  } catch (e) {
    console.warn('[org-people] invite failed', e?.message || e);
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.patch('/:id', requireTenantFullAccess, async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const person = updateOrgPerson(owner, req.params.id, req.body || {});
    try {
      await syncOrgContextForCeo(owner);
    } catch (e) {
      console.warn('[org-people] org sync after patch', e?.message || e);
    }
    res.json({ person });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/:id/resend-invite', requireTenantFullAccess, async (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const person = getOrgPerson(owner, req.params.id);
    if (!person) return res.status(404).json({ error: 'Employee not found' });
    const invite = await createAndSendPasswordReset(person.id, {
      createdBy: req.authUser.id,
      initiatedByInvite: true,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ ok: true, invite: { emailed: invite.emailed, expires_at: invite.expires_at } });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.get('/roles/list', (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    if (!isTenantFullAccess(req.authUser) && req.authUser.role !== 'ceo') {
      return res.status(403).json({ error: 'CEO or CEO Delegate access required' });
    }
    res.json({ roles: listOrgRoles(owner) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/roles', requireTenantFullAccess, (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const role = createOrgRole(owner, req.body || {});
    res.status(201).json({ role });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.put('/roles/:roleId', requireTenantFullAccess, (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.body || {});
    const role = setRolePermissions(owner, req.params.roleId, req.body?.permissions || []);
    res.json({ role });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.delete('/roles/:roleId', requireTenantFullAccess, (req, res) => {
  try {
    const owner = resolveAuthenticatedCeoUserId(req, req.query || {});
    res.json(deleteOrgRole(owner, req.params.roleId));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

export default router;
