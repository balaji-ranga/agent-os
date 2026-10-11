/** Rank the entire accessible team before applying the Home display limit.
 * Shared agent records are not evidence of activity: every work source is owner-scoped.
 * Do not read chat/delegation content just to determine recency.
 */
export function buildHomeTeamActivity(db, { agents, ownerUserId, ownerFilter, limit = 8 }) {
  if (!agents?.length || !ownerUserId) return [];
  const agentIds = JSON.stringify(agents.map((agent) => agent.id));
  const activeCounts = new Map(db.prepare(`
    SELECT k.assigned_agent_id AS agent_id, COUNT(*) AS n
    FROM kanban_tasks k
    WHERE ${ownerFilter.clause}
      AND k.assigned_agent_id IN (SELECT value FROM json_each(?))
      AND k.status IN ('open','in_progress','awaiting_confirmation')
    GROUP BY k.assigned_agent_id
  `).all(...ownerFilter.params, agentIds).map((row) => [row.agent_id, row.n]));

  const latest = new Map(db.prepare(`
    WITH accessible AS (SELECT value AS agent_id FROM json_each(?)),
    events AS (
      SELECT k.assigned_agent_id AS agent_id, CAST(k.id AS TEXT) AS event_id,
        COALESCE(julianday(k.updated_at), julianday(k.created_at)) AS occurred_at,
        k.title AS activity, 'task' AS source
      FROM kanban_tasks k WHERE ${ownerFilter.clause}
      UNION ALL
      SELECT c.agent_id, CAST(c.id AS TEXT), julianday(c.created_at), 'Recent chat', 'chat'
      FROM chat_turns c WHERE c.owner_user_id = ? AND c.role IN ('user','assistant')
      UNION ALL
      SELECT d.to_agent_id, CAST(d.id AS TEXT),
        COALESCE(julianday(d.completed_at), julianday(d.created_at)), 'Delegated task', 'delegation'
      FROM agent_delegation_tasks d WHERE d.owner_user_id = ?
      UNION ALL
      SELECT g.agent_id, g.id,
        COALESCE(julianday(g.completed_at), julianday(g.updated_at), julianday(g.created_at)),
        g.title, 'goal'
      FROM agent_goal_runs g WHERE g.owner_user_id = ?
    ), ranked AS (
      SELECT e.*, ROW_NUMBER() OVER (
        PARTITION BY e.agent_id ORDER BY e.occurred_at DESC, e.source, e.event_id DESC
      ) AS position
      FROM events e JOIN accessible a ON a.agent_id = e.agent_id
      WHERE e.occurred_at IS NOT NULL
    )
    SELECT agent_id, activity, source,
      strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) AS last_active_at
    FROM ranked WHERE position = 1
  `).all(agentIds, ...ownerFilter.params, ownerUserId, ownerUserId, ownerUserId)
    .map((row) => [row.agent_id, row]));

  return agents.map((agent) => {
    const last = latest.get(agent.id);
    const active = activeCounts.get(agent.id) || 0;
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role || '',
      department: agent.department || '',
      avatar_image: agent.avatar_image || '',
      is_coo: !!agent.is_coo,
      active_tasks: active,
      status: active > 0 ? 'active' : 'idle',
      activity: last?.activity || (agent.role ? String(agent.role).slice(0, 80) : 'Ready'),
      last_active_at: last?.last_active_at || null,
      activity_source: last?.source || null,
    };
  }).sort((a, b) =>
    (Date.parse(b.last_active_at) || 0) - (Date.parse(a.last_active_at) || 0)
      || String(a.name).localeCompare(String(b.name))
      || String(a.id).localeCompare(String(b.id))
  ).slice(0, Math.max(0, Math.trunc(limit)));
}
