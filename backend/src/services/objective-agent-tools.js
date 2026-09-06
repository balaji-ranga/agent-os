import { getDb } from '../db/schema.js';
import { listObjectives, linkGoalRun } from './company-objectives.js';
import { createTable, ensureTableColumns, findTableByName, insertRow, listRows } from './master-data.js';

export const OBJECTIVE_DEVIATION_TABLE = 'Objective_deviation';
export const OBJECTIVE_DEVIATION_COLUMNS = [
  'request', 'rationale', 'user_id', 'agent_id', 'goal_run_id',
  'objective_ids', 'initiative_ids', 'channel', 'recorded_at',
];

export function queryCompanyObjectives(ownerUserId, input = {}) {
  const page = listObjectives(ownerUserId, {
    limit: input.limit || 50,
    offset: input.offset || 0,
    periodType: input.period_type || null,
    status: input.status || null,
  });
  return {
    ...page,
    scope: 'owner_company',
    includes: ['objectives', 'key_results', 'initiatives', 'initiative_goals', 'scheduled_goals', 'goal_plan_runs'],
  };
}

export function linkCompanyGoal(ownerUserId, input = {}) {
  const objectiveId = String(input.objective_id || '').trim();
  const goalRunId = String(input.goal_run_id || '').trim();
  if (!objectiveId || !goalRunId) throw Object.assign(new Error('objective_id and goal_run_id are required'), { status: 400 });
  return linkGoalRun(ownerUserId, objectiveId, {
    ...input,
    goal_run_id: goalRunId,
  });
}

export function ensureObjectiveDeviationKnowledge(ownerUserId) {
  let table = findTableByName(ownerUserId, OBJECTIVE_DEVIATION_TABLE);
  if (!table) {
    table = createTable(ownerUserId, {
      name: OBJECTIVE_DEVIATION_TABLE,
      description: 'Non-blocking audit of user requests that materially depart from active company objectives or initiatives.',
      columns: OBJECTIVE_DEVIATION_COLUMNS,
    });
  } else {
    table = ensureTableColumns(ownerUserId, table.id, OBJECTIVE_DEVIATION_COLUMNS).table;
  }
  return table;
}

export function recordObjectiveDeviation(ownerUserId, input = {}, actor = {}) {
  const request = String(input.request || input.prompt || '').trim();
  const rationale = String(input.rationale || '').trim();
  if (!request || !rationale) throw Object.assign(new Error('request and rationale are required'), { status: 400 });
  const table = ensureObjectiveDeviationKnowledge(ownerUserId);
  const recordedAt = new Date().toISOString();
  const result = insertRow(ownerUserId, table.id, {
    request: request.slice(0, 12000),
    rationale: rationale.slice(0, 4000),
    user_id: String(actor.user_id || ownerUserId),
    agent_id: String(actor.agent_id || input.agent_id || ''),
    goal_run_id: String(input.goal_run_id || ''),
    objective_ids: JSON.stringify(Array.isArray(input.objective_ids) ? input.objective_ids : []),
    initiative_ids: JSON.stringify(Array.isArray(input.initiative_ids) ? input.initiative_ids : []),
    channel: String(input.channel || actor.channel || 'agent_tool'),
    recorded_at: recordedAt,
  });
  return { ok: true, non_blocking: true, table: result.table, row: result.row, recorded_at: recordedAt };
}

export function getObjectiveDeviationSummary(ownerUserId, { limit = 10, since = null } = {}) {
  const table = findTableByName(ownerUserId, OBJECTIVE_DEVIATION_TABLE);
  if (!table) return { count: 0, recent: [], table_name: OBJECTIVE_DEVIATION_TABLE };
  const page = listRows(ownerUserId, table.id, { limit: Math.min(50, Math.max(1, Number(limit) || 10)), offset: 0 });
  const recent = page.rows
    .filter((row) => !since || String(row.data?.recorded_at || row.created_at) >= String(since))
    .sort((a, b) => String(b.data?.recorded_at || b.created_at).localeCompare(String(a.data?.recorded_at || a.created_at)));
  return { count: recent.length, total: page.total, recent, table_id: table.id, table_name: table.name };
}

export function grantObjectiveAgentTools() {
  const db = getDb();
  const agents = db.prepare('SELECT id,is_coo,is_orchestrator,name FROM agents').all();
  const insert = db.prepare('INSERT OR IGNORE INTO agent_tool_grants(agent_id,tool_name) VALUES(?,?)');
  let changes = 0;
  for (const agent of agents) {
    changes += insert.run(agent.id, 'company_objectives_query').changes || 0;
    changes += insert.run(agent.id, 'objective_deviation_record').changes || 0;
    const orchestrator = Boolean(agent.is_coo || agent.is_orchestrator) || /orchestrator/i.test(String(agent.name || ''));
    if (orchestrator) changes += insert.run(agent.id, 'company_goal_link_objective').changes || 0;
  }
  return changes;
}
