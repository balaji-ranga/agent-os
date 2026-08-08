/**
 * Daily operating Workspace snapshot (not Home executive view, not AI Employees).
 * Owner + agent entitlements only.
 */
import { Router } from 'express';
import { requireAuth, requireCeoOrAdmin, resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { listAgentsForUser } from '../services/users.js';
import { kanbanOwnerSqlFilter } from '../services/kanban-user-scope.js';
import { getBusinessProfile } from '../services/company-business-profile.js';
import { getTwentyStatusForOwner } from '../services/twenty-crm.js';

const router = Router();
router.use(requireAuth, requireCeoOrAdmin);

router.get('/snapshot', (req, res) => {
  try {
    const ownerUserId = resolveAuthenticatedCeoUserId(req, req.query || {});
    // kanbanOwnerSqlFilter expects auth-like { id, role }, not a bare userId string
    const ownerFilter = kanbanOwnerSqlFilter({ id: ownerUserId, role: 'ceo' });
    const ceoDb = getDbForCeo(ownerUserId);

    let tasks = [];
    let openCount = 0;
    try {
      tasks = ceoDb
        .prepare(
          `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date,
                  k.created_at, k.updated_at
           FROM kanban_tasks k
           WHERE ${ownerFilter.clause}
           ORDER BY COALESCE(k.updated_at, k.created_at) DESC
           LIMIT 40`
        )
        .all(...ownerFilter.params);

      openCount =
        ceoDb
          .prepare(
            `SELECT COUNT(*) AS n FROM kanban_tasks k
             WHERE ${ownerFilter.clause}
               AND lower(COALESCE(k.status,'')) NOT IN ('done','completed','cancelled','archived','failed')`
          )
          .get(...ownerFilter.params)?.n || 0;
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

    let activity = [];
    try {
      activity = getDb()
        .prepare(
          `SELECT id, agent_id, source, rating, created_at,
                  substr(COALESCE(message_content, ''), 1, 160) AS snippet
           FROM agent_response_feedback
           WHERE owner_user_id = ?
           ORDER BY created_at DESC
           LIMIT 20`
        )
        .all(ownerUserId);
    } catch {
      activity = [];
    }

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
