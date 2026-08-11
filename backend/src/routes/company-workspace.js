/**
 * Daily operating Workspace snapshot (not Home executive view, not AI Employees).
 * Owner + agent entitlements only.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { listAgentsForUser } from '../services/users.js';
import {
  listKanbanTasksForOwner,
  countOpenKanbanTasksForOwner,
} from '../services/kanban-user-scope.js';
import { getBusinessProfile } from '../services/company-business-profile.js';
import { getTwentyStatusForOwner } from '../services/twenty-crm.js';
import { buildWorkspaceRecentActivity } from '../services/workspace-activity.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/snapshot', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});

    let tasks = [];
    let openCount = 0;
    try {
      // Same merge as Workspace boards / Kanban (platform DB is primary for open work).
      tasks = listKanbanTasksForOwner(ownerUserId, { limit: 40, openOnly: true });
      openCount = countOpenKanbanTasksForOwner(ownerUserId);
    } catch (e) {
      console.warn('[company-workspace] tasks query', e?.message || e);
    }

    let agentRows = [];
    try {
      const agents = listAgentsForUser(ownerUserId) || [];
      agentRows = (Array.isArray(agents) ? agents : []).map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        department: a.department || '',
        is_coo: !!a.is_coo,
      }));
    } catch (e) {
      console.warn('[company-workspace] agents list', e?.message || e);
    }

    // Kanban + goal plans (agr-…) + workflows + light feedback.
    const activity = buildWorkspaceRecentActivity(ownerUserId, { limit: 30 });

    const business = getBusinessProfile(ownerUserId);
    const twenty = getTwentyStatusForOwner(ownerUserId);

    res.json({
      owner_user_id: ownerUserId,
      metrics: {
        tasks_open: openCount,
        tasks_listed: tasks.length,
        agents_active: agentRows.length,
        crm_enabled: business.crm_enabled,
        erp_enabled: business.erp_enabled,
      },
      tasks,
      agents: agentRows,
      activity,
      business,
      twenty,
      links: {
        kanban: '/kanban',
        ai_employees: '/workspace',
        goal_plans: '/goal-plans',
        workflows: '/workflows',
        home: '/',
        profile_business: '/profile',
      },
    });
  } catch (e) {
    console.warn('[company-workspace] snapshot', e?.message || e);
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
