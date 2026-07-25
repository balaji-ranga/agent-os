/**
 * Probe: resolve the Balaji Ranganathan CEO tenant, its COO / TechResearcher agents,
 * existing org leaf members, external agents and A2A publications.
 *
 * Read-only. Usage: node backend/scripts/probe-balaji-org.js
 */
import { getDb, initDb } from '../src/db/schema.js';

initDb();
const db = getDb();

const ceos = db
  .prepare(
    `SELECT id, email, name, role, enabled FROM platform_users WHERE role = 'ceo' ORDER BY rowid`
  )
  .all();
console.log('== CEOs ==');
for (const c of ceos) {
  console.log(`${c.enabled ? ' ' : 'x'} ${c.id}\t${c.name}\t${c.email}`);
}

const matches = ceos.filter((c) =>
  /balaji|bala/i.test(`${c.name || ''} ${c.email || ''} ${c.id}`)
);
console.log('\n== Balaji candidates ==');
for (const c of matches) {
  const agents = db
    .prepare(
      `SELECT a.id, a.name, a.role, a.department, a.is_coo, a.parent_id, ua.enabled
       FROM agents a
       INNER JOIN user_agents ua ON ua.agent_id = a.id AND ua.user_id = ?
       ORDER BY a.is_coo DESC, a.id`
    )
    .all(c.id);
  console.log(`\n-- ${c.id} (${c.name}) agents=${agents.length}`);
  for (const a of agents) {
    console.log(
      `   ${a.enabled ? ' ' : 'x'} ${a.id}\tcoo=${a.is_coo}\tdept=${a.department || '-'}\tparent=${a.parent_id || '-'}\t${a.name}`
    );
  }
  const members = db
    .prepare(`SELECT id, kind, department, parent_id, enabled FROM org_agent_members WHERE owner_user_id = ?`)
    .all(c.id);
  console.log(`   org leaf members: ${JSON.stringify(members)}`);
  const ext = db
    .prepare(`SELECT id, name, status FROM external_agents WHERE owner_user_id = ?`)
    .all(c.id);
  console.log(`   external agents: ${JSON.stringify(ext)}`);
  const pubs = db
    .prepare(
      `SELECT id, name, status, visibility, skill_id FROM workflow_a2a_publications WHERE owner_user_id = ?`
    )
    .all(c.id);
  console.log(`   a2a publications: ${JSON.stringify(pubs)}`);
  const wfs = db
    .prepare(`SELECT id, name, status FROM agent_workflow_definitions WHERE owner_user_id = ?`)
    .all(c.id);
  console.log(`   workflows: ${JSON.stringify(wfs)}`);
}

console.log('\n== COO row (global) ==');
console.log(db.prepare(`SELECT id, name, is_coo, department FROM agents WHERE is_coo = 1`).all());

console.log('\n== departments master data note ==');
console.log('(departments live per-tenant in master_data; see Master Data → departments)');
