/**
 * Snapshot a CEO company into a blueprint payload for admin publish.
 */
import { getDb } from '../db/schema.js';
import {
  ensureStrategyRow,
  parseJson,
  defaultJourney,
} from './onboarding-helper.js';
import { listAgentsForUser } from './users.js';
import { getBlueprint } from './company-blueprints/index.js';

function getStrategic(row) {
  return parseJson(row?.strategic_profile_json, {});
}

export function listCompanyBlueprintCandidates({ limit = 40 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.enabled, s.status, s.strategic_profile_json, s.updated_at
       FROM platform_users u
       LEFT JOIN ceo_org_strategy s ON s.owner_user_id = u.id
       WHERE u.role = 'ceo'
       ORDER BY u.created_at DESC
       LIMIT ?`
    )
    .all(limit);
  // NULLS LAST may not work on all sqlite — fallback silently
  let list = rows;
  if (!list?.length) {
    list = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.enabled, s.status, s.strategic_profile_json, s.updated_at
         FROM platform_users u
         LEFT JOIN ceo_org_strategy s ON s.owner_user_id = u.id
         WHERE u.role = 'ceo'
         ORDER BY u.created_at DESC
         LIMIT ?`
      )
      .all(limit);
  }

  return list.map((u) => {
    const strategic = parseJson(u.strategic_profile_json, {});
    let customAgents = 0;
    try {
      customAgents =
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM user_agents ua
             JOIN agents a ON a.id = ua.agent_id
             WHERE ua.user_id = ? AND ua.enabled = 1 AND (a.agent_type = 'custom' OR a.owner_user_id = ?)`
          )
          .get(u.id, u.id)?.n || 0;
    } catch {
      customAgents = 0;
    }
    const formed =
      u.status === 'applied' ||
      strategic.setup_gate === 'completed' ||
      customAgents > 0 ||
      strategic.operate_gate === 'day1_applied';
    return {
      owner_user_id: u.id,
      email: u.email,
      name: u.name,
      enabled: !!u.enabled,
      company_name: strategic.company_name || null,
      company_type: strategic.company_type || strategic.company_type_card || null,
      blueprint_id: strategic.blueprint_id || null,
      setup_gate: strategic.setup_gate || null,
      operate_gate: strategic.operate_gate || null,
      strategy_status: u.status || null,
      custom_agents: customAgents,
      successful: !!formed,
      mission: strategic.mission ? String(strategic.mission).slice(0, 160) : null,
    };
  }).filter((c) => c.successful);
}

export function snapshotOwnerAsBlueprintPayload(ownerUserId) {
  const row = ensureStrategyRow(ownerUserId);
  const strategic = getStrategic(row);
  const journey = parseJson(row.draft_journey_json, defaultJourney());
  const answers = journey.answers || {};

  let departments = Array.isArray(answers.departments) ? answers.departments : [];
  let agents = Array.isArray(answers.agents) ? answers.agents : [];

  if (!agents.length) {
    const live = listAgentsForUser(ownerUserId).filter(
      (a) => a.agent_type === 'custom' || a.owner_user_id === ownerUserId || /coordinator|analyst|manager|strategist|publisher|editor/i.test(a.name || '')
    );
    // Prefer custom only
    const custom = listAgentsForUser(ownerUserId).filter(
      (a) => a.agent_type === 'custom' || (a.owner_user_id && a.owner_user_id === ownerUserId)
    );
    const use = custom.length ? custom : live.slice(0, 8);
    agents = use.map((a) => ({
      name: a.name,
      role: a.role || a.name,
      department: 'Operations',
      tools: ['learnings_summary', 'master_data_rag', 'notify_ceo', 'kanban_create_task'],
    }));
  }

  const base = getBlueprint(strategic.blueprint_id || strategic.company_type || 'general_ops') || {};
  if (!agents.length && Array.isArray(base.agents) && base.agents.length) {
    agents = base.agents.map((a) => ({
      name: a.name,
      role: a.role || a.name,
      department: a.department || 'Operations',
      tools: Array.isArray(a.tools) ? a.tools : ['learnings_summary', 'master_data_rag', 'notify_ceo'],
    }));
  }

  if (!departments.length && agents.length) {
    const depts = new Set(agents.map((a) => a.department || 'Operations'));
    departments = [...depts].map((name) => ({ name, purpose: `${name} team` }));
  }
  if (!departments.length && Array.isArray(base.departments) && base.departments.length) {
    departments = base.departments;
  }

  return {
    industry: resolveIndustry(strategic),
    company_name: strategic.company_name || null,
    mission: strategic.mission || null,
    payload: {
      depth: base.depth === 'deep' || agents.length >= 4 ? 'deep' : 'thin',
      platforms: base.platforms || [],
      departments: departments || [],
      agents: agents || [],
      workflows: answers.workflows || base.workflows || [],
      channels: answers.channels || base.channels || [],
      knowledge_tables: answers.knowledge_tables || [],
      sop_documents: [],
      systems_recommended: base.systems_recommended || [],
      policy_templates: base.policy_templates || {},
      description: strategic.mission
        ? `Published from ${strategic.company_name || ownerUserId}. Mission: ${String(strategic.mission).slice(0, 240)}`
        : `Published from company ${strategic.company_name || ownerUserId}`,
    },
  };
}

function resolveIndustry(strategic) {
  return String(strategic.company_type || strategic.company_type_card || 'general_ops')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}