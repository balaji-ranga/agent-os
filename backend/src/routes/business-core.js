/**
 * Company business profile + CRM/ERP enablement + embed launchers (Phase 2).
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import {
  getBusinessProfile,
  updateBusinessProviders,
  CRM_PROVIDERS,
  ERP_PROVIDERS,
} from '../services/company-business-profile.js';
import { ensureTwentyWorkspaceForCompany } from '../services/twenty-crm.js';
import { ensurePrefabCrmAgents } from '../services/prefab-crm-agents.js';
import { ensurePrefabErpAgents } from '../services/prefab-erp-agents.js';
import { ensureErpnextCompanyForOwner } from '../services/erpnext-erp.js';
import {
  getCrmEmbedForOwner,
  getErpEmbedForOwner,
  getBusinessMenuFlags,
  getBusinessCoreStackStatus,
} from '../services/business-embed.js';
import { getUserById } from '../services/users.js';
import { syncFlolahOrgToBusinessCore, listFlolahOrgSnapshot } from '../services/business-core-org-sync.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

function ownerOf(req) {
  return resolveAuthenticatedCeoUserId(req, req.body || req.query || {});
}

router.get('/profile', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json({
      profile: getBusinessProfile(ownerUserId),
      menus: getBusinessMenuFlags(ownerUserId),
      options: {
        crm_providers: [...CRM_PROVIDERS],
        erp_providers: [...ERP_PROVIDERS],
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** Lightweight flags for nav (auth + owner scope). */
router.get('/menus', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json(getBusinessMenuFlags(ownerUserId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/embed/crm — Twenty iframe config (platform CRM only).
 */
router.get('/embed/crm', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const embed = getCrmEmbedForOwner(ownerUserId);
    let stack_status = null;
    try {
      stack_status = (await getBusinessCoreStackStatus()).crm;
    } catch (e) {
      console.warn('[business-core] stack probe crm', e?.message || e);
    }
    res.json({ ...embed, stack_status });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * GET /api/business-core/embed/erp — ERPNext iframe config (platform ERP only).
 */
router.get('/embed/erp', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const flolahUserId = req.authUser?.id || ownerUserId;
    const embed = getErpEmbedForOwner(ownerUserId, { flolahUserId });
    let stack_status = null;
    try {
      stack_status = (await getBusinessCoreStackStatus()).erp;
    } catch (e) {
      console.warn('[business-core] stack probe erp', e?.message || e);
    }
    res.json({ ...embed, stack_status });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/business-core/stack-status — Twenty/ERPNext reachability (CEO scope not required for secrets; auth only). */
router.get('/stack-status', async (req, res) => {
  try {
    ownerOf(req);
    res.json({ ok: true, ...(await getBusinessCoreStackStatus()) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/** GET /api/business-core/org-snapshot — departments + AI employees for sync review. */
router.get('/org-snapshot', (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    res.json({ ok: true, ...listFlolahOrgSnapshot(ownerUserId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

/**
 * POST /api/business-core/sync-org
 * Body: { targets?: ['crm'|'erp'] } — defaults to all enabled platform providers.
 * Pushes Flolah departments + AI employees into Twenty / ERPNext (owner-scoped).
 */
router.post('/sync-org', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const targets = Array.isArray(req.body?.targets) ? req.body.targets : undefined;
    const result = await syncFlolahOrgToBusinessCore(ownerUserId, { targets });
    res.json(result);
  } catch (e) {
    console.warn('[business-core] sync-org', e?.message || e);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

/**
 * PATCH body: { crm_provider?, erp_provider?, provision?: true }
 */
router.patch('/profile', async (req, res) => {
  try {
    const ownerUserId = ownerOf(req);
    const body = req.body || {};
    let profile = updateBusinessProviders(ownerUserId, {
      crm_provider: body.crm_provider,
      erp_provider: body.erp_provider,
    });

    const wantProvision = body.provision !== false;
    let twenty = null;
    let prefab = null;
    let erpnext = null;
    let prefabErp = null;

    const user = getUserById(ownerUserId);
    const displayName = user?.business_name || user?.name || undefined;

    if (wantProvision && profile.crm_provider === 'twenty') {
      twenty = await ensureTwentyWorkspaceForCompany(ownerUserId, {
        displayName: profile.twenty.workspace_name || displayName,
      });
      prefab = await ensurePrefabCrmAgents(ownerUserId);
      profile = getBusinessProfile(ownerUserId);
    }

    if (wantProvision && profile.erp_provider === 'erpnext') {
      erpnext = await ensureErpnextCompanyForOwner(ownerUserId, {
        displayName: displayName || profile.erpnext.company_name,
      });
      prefabErp = await ensurePrefabErpAgents(ownerUserId);
      profile = getBusinessProfile(ownerUserId);
    }

    res.json({
      profile,
      menus: getBusinessMenuFlags(ownerUserId),
      twenty,
      prefab,
      erpnext,
      prefab_erp: prefabErp,
      embed: {
        crm: profile.platform_crm ? getCrmEmbedForOwner(ownerUserId) : null,
        erp: profile.platform_erp
          ? getErpEmbedForOwner(ownerUserId, { flolahUserId: req.authUser?.id })
          : null,
      },
    });
  } catch (e) {
    console.warn('[business-core] patch profile', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
