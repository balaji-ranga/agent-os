#!/usr/bin/env node
/**
 * LIVE check on the VPS tenant: COO delegates to the Ops Echo Service leaf while its backing
 * A2A publication is **private**. Reproduces the reported `A2A HTTP 403` and asserts it is gone.
 *
 * Restores the original visibility and removes the Kanban card it creates.
 * Usage (inside the backend container): node scripts/vps-test-private-ops-echo-delegation.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { delegateToOrgMembers } from '../src/services/org-member-delegation.js';
import { findLocalA2APublication } from '../src/services/a2a-local-invoke.js';

const OWNER = process.env.LIVE_OWNER || 'ceo-bala';
const COO_ID = process.env.LIVE_COO || 'balserve';
const MEMBER_KEY = process.env.LIVE_MEMBER || 'ext:a2a-live-ops-echo';

initDb();
const db = getDb();

const member = db
  .prepare(`SELECT * FROM org_agent_members WHERE id = ? AND owner_user_id = ?`)
  .get(MEMBER_KEY, OWNER);
if (!member) throw new Error(`org member ${MEMBER_KEY} not found for ${OWNER}`);

const external = db.prepare(`SELECT * FROM external_agents WHERE id = ?`).get(member.ref_id);
if (!external) throw new Error(`external agent ${member.ref_id} not found`);

const pub = findLocalA2APublication(external.endpoint_url, OWNER);
if (!pub) throw new Error(`endpoint ${external.endpoint_url} does not resolve to a local publication`);

const priorVisibility = pub.visibility || 'public';
let failures = 0;
function check(label, ok, extra = '') {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
}

console.log(`endpoint=${external.endpoint_url} publish=${pub.id} visibility(before)=${priorVisibility}`);
db.prepare(`UPDATE workflow_a2a_publications SET visibility = 'private' WHERE id = ?`).run(pub.id);

let cardId = null;
try {
  const outcome = await delegateToOrgMembers(
    OWNER,
    { [MEMBER_KEY]: 'Run an operations status desk check and reply with the current status line.' },
    { callerAgentId: COO_ID }
  );
  cardId = outcome.delegated[0]?.taskId ?? outcome.failed[0]?.taskId ?? null;
  const errorText = outcome.failed[0]?.error || '';
  check(
    'COO delegation to the private leaf succeeded',
    outcome.delegated.length === 1 && outcome.failed.length === 0,
    `delegated=${outcome.delegated.length} failed=${outcome.failed.length} blocked=${outcome.blocked.length} err=${errorText || '-'}`
  );
  check('no A2A 403 / private denial', !/403|is private/i.test(errorText), errorText);

  const card = cardId ? db.prepare(`SELECT * FROM kanban_tasks WHERE id = ?`).get(cardId) : null;
  check('Kanban card is not failed', card && card.status !== 'failed', `status=${card?.status} card=${cardId}`);
  console.log(`  reply: ${String(outcome.delegated[0]?.text || errorText).slice(0, 200)}`);
} finally {
  db.prepare(`UPDATE workflow_a2a_publications SET visibility = ? WHERE id = ?`).run(priorVisibility, pub.id);
  if (cardId) {
    db.prepare(`DELETE FROM kanban_tasks WHERE id = ?`).run(cardId);
    console.log(`  cleaned up probe Kanban card ${cardId}; visibility restored to ${priorVisibility}`);
  }
}

if (failures) {
  console.error(`private ops-echo delegation LIVE check FAILED (${failures})`);
  process.exit(1);
}
console.log('private ops-echo delegation LIVE check OK');
