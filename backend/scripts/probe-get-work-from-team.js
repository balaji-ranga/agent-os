/**
 * Diagnose standup get_work_from_team vs agents-under-COO.
 * Usage: node scripts/probe-get-work-from-team.js [ownerUserId]
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getAgentsUnderCooForCeo, getCooAgentRow } from '../src/services/org-context.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';

initDb();
const owner = process.argv[2] || getBalaCeoAuthId();
const coo = getCooAgentRow();
const under = getAgentsUnderCooForCeo(owner);
const grants = getDb()
  .prepare('SELECT COUNT(*) AS c FROM user_agents WHERE user_id = ? AND enabled = 1')
  .get(owner);
const parented = getDb()
  .prepare(
    `SELECT a.id, a.parent_id, a.is_coo
     FROM agents a
     JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ? AND ua.enabled = 1
     WHERE a.is_coo = 0
     ORDER BY a.name
     LIMIT 30`
  )
  .all(owner);

console.log(
  JSON.stringify(
    {
      owner,
      coo: coo ? { id: coo.id, name: coo.name } : null,
      under_coo_count: under.length,
      under_coo_ids: under.map((a) => a.id),
      user_agents_enabled: grants.c,
      parent_sample: parented.map((r) => ({ id: r.id, parent_id: r.parent_id })),
    },
    null,
    2
  )
);
