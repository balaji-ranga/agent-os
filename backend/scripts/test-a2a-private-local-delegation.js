#!/usr/bin/env node
/**
 * Smoke: COO delegation to a *private* A2A publication registered as an External Agent.
 *
 * Regression for "A2A HTTP 403 … This A2A agent is private": the endpoint points back at this
 * backend, so the public door refused the loopback hop even though the COO is entitled. The org
 * path must resolve the local publication and invoke it in-process instead.
 *
 * Creates and removes its own publication / external agent / org member rows.
 * Usage: node scripts/test-a2a-private-local-delegation.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import { getOrgAgentMember } from '../src/services/org-agent-members.js';
import { canCallerInvokeOrgMember } from '../src/services/org-member-delegation.js';
import { invokeExternalAgent } from '../src/services/external-agents.js';
import { resolveLocalA2ABypass, parseLocalA2APublishId } from '../src/services/a2a-local-invoke.js';

initDb();
const db = getDb();
const owner = getBalaCeoAuthId();
const coo = db.prepare(`SELECT id FROM agents WHERE is_coo = 1 ORDER BY rowid LIMIT 1`).get();
if (!coo) throw new Error('no COO agent configured');

const suffix = Date.now();
const publishId = `wf-a2a-private-probe-${suffix}`;
const definitionId = `wf-def-private-probe-${suffix}`;
const externalId = `a2a-private-probe-${suffix}`;
const memberKey = `ext:${externalId}`;
const endpoint = `http://127.0.0.1:${process.env.PORT || 3001}/api/a2a/${publishId}`;

function cleanup() {
  try {
    db.prepare(`DELETE FROM org_agent_members WHERE id = ? AND owner_user_id = ?`).run(memberKey, owner);
    db.prepare(`DELETE FROM external_agents WHERE id = ?`).run(externalId);
    db.prepare(`DELETE FROM workflow_a2a_publications WHERE id = ?`).run(publishId);
    db.prepare(`DELETE FROM agent_workflow_definitions WHERE id = ?`).run(definitionId);
  } catch (e) {
    console.warn('cleanup failed:', e?.message || e);
  }
}

// Draft (not published) on purpose: a successful bypass then fails inside the handler with
// "workflow is not published" instead of the private 403, without running anything real.
db.prepare(
  `INSERT INTO agent_workflow_definitions (id, name, description, owner_user_id, status)
   VALUES (?, 'Private probe workflow', 'temporary smoke fixture', ?, 'draft')`
).run(definitionId, owner);

db.prepare(
  `INSERT INTO workflow_a2a_publications
     (id, workflow_definition_id, owner_user_id, name, description, skill_id, status,
      auth_mode, access_policy, visibility, invoke_mode, published_at)
   VALUES (?, ?, ?, ?, '', 'default', 'published', 'public', 'deny_all', 'private', 'sync', datetime('now'))`
).run(publishId, definitionId, owner, 'Private Probe Service');

db.prepare(
  `INSERT INTO external_agents (id, name, description, endpoint_url, skill_id, owner_user_id, owner_role, status)
   VALUES (?, ?, '', ?, 'default', ?, 'ceo', 'healthy')`
).run(externalId, 'Private Probe Service', endpoint, owner);

db.prepare(
  `INSERT INTO org_agent_members (id, owner_user_id, kind, ref_id, display_name, department, parent_id, enabled)
   VALUES (?, ?, 'external', ?, 'Private Probe Service', 'Operations', ?, 1)`
).run(memberKey, owner, externalId, coo.id);

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) console.log(`  OK   ${label}`);
  else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  check('endpoint is recognised as a local publication', parseLocalA2APublishId(endpoint) === publishId);

  const bypass = resolveLocalA2ABypass(endpoint, owner);
  check('private local publication needs the in-process path', !!bypass, JSON.stringify(bypass));
  check('bypass reports private visibility', bypass?.visibility === 'private', bypass?.visibility);

  const foreign = resolveLocalA2ABypass(endpoint, 'ceo-someone-else');
  check('cross-tenant endpoint keeps the public path', foreign === null);

  const member = getOrgAgentMember(owner, memberKey);
  check('org member resolves', !!member, memberKey);

  const cooAcl = canCallerInvokeOrgMember(owner, member, coo.id);
  check('COO may invoke the private leaf', cooAcl.ok === true, cooAcl.reason);

  const strangerAcl = canCallerInvokeOrgMember(owner, member, 'not-the-coo-or-parent');
  check('non-entitled caller is blocked', strangerAcl.ok === false, JSON.stringify(strangerAcl));

  // The probe publication has no real workflow behind it, so a successful bypass must fail with
  // "workflow is not published" (-32002) rather than the private 403 (-32005).
  const out = await invokeExternalAgent(externalId, owner, {
    message: 'private delegation probe',
    waitForCompletion: true,
    allowLocalBypass: true,
  });
  check('invoke used the in-process path', out.local_bypass === true, JSON.stringify(out).slice(0, 200));
  check('no 403 / private denial', !/403|is private/i.test(out.text || ''), out.text);
  check('reached the publication handler', /not published/i.test(out.text || ''), out.text);

  // Public publications must keep using the untouched HTTP path.
  db.prepare(
    `UPDATE workflow_a2a_publications SET visibility = 'public', access_policy = 'allow_all' WHERE id = ?`
  ).run(publishId);
  check('publicly reachable publication stays on HTTP', resolveLocalA2ABypass(endpoint, owner) === null);
} finally {
  cleanup();
}

if (failures) {
  console.error(`private A2A delegation smoke FAILED (${failures})`);
  process.exit(1);
}
console.log('private A2A delegation smoke OK');
