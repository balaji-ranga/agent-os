#!/usr/bin/env node
/**
 * Smoke: COO "ask social media expert to reach me" hard path.
 * Usage: node scripts/test-coo-reach-me-delegation.js
 */
import { initDb, getDb } from '../src/db/schema.js';
import { getBalaCeoAuthId } from '../src/services/job-applicant-ceo.js';
import {
  isAskSpecialistToReachMe,
  resolveReachMeSpecialist,
  executeReachMeViaSpecialist,
  tryRewriteCooNotifyAsSpecialist,
} from '../src/services/reach-me-delegation.js';
import { listNotificationsForUser } from '../src/services/platform-notifications.js';

initDb();

const msg = 'ask the social media expert agent to reach me';
if (!isAskSpecialistToReachMe(msg)) throw new Error('detector failed');

const owner = getBalaCeoAuthId();
const specialist = resolveReachMeSpecialist(owner, msg);
if (!specialist || !/social/i.test(`${specialist.id} ${specialist.name || ''}`)) {
  throw new Error(`expected a social specialist, got ${specialist?.id}`);
}

const before = Date.now();
const out = await executeReachMeViaSpecialist({
  ownerUserId: owner,
  ceoMessage: msg,
  specialist,
  pingSpecialist: false,
});
if (!out.ok || !out.notify?.sent) throw new Error(`notify failed: ${JSON.stringify(out)}`);
if (out.notify.agent_id !== specialist.id) {
  throw new Error(`notify attributed to ${out.notify.agent_id}, expected ${specialist.id}`);
}
if (!String(out.notify.link_url || '').includes(`/agents/${specialist.id}/chat`)) {
  throw new Error(`bad link ${out.notify.link_url}`);
}

const listed = listNotificationsForUser(owner, { limit: 10 });
const hit = listed.find(
  (n) =>
    n.source_key === out.notify.source_key ||
    (n.created_by === specialist.id && new Date(n.created_at).getTime() >= before - 2000)
);
if (!hit) throw new Error('notification not listed for CEO');
if (hit.created_by !== specialist.id) throw new Error(`listed created_by=${hit.created_by}`);

const coo = getDb().prepare(`SELECT * FROM agents WHERE is_coo = 1 LIMIT 1`).get();
const rewritten = tryRewriteCooNotifyAsSpecialist(
  owner,
  { title: 'Request for Social Media Expert Agent', body: 'Please reach the CEO' },
  coo
);
if (!rewritten?.sent || rewritten.agent_id !== specialist.id) {
  throw new Error(`COO rewrite failed: ${JSON.stringify(rewritten)}`);
}

console.log('COO_REACH_ME_DELEGATION_OK', {
  specialist: specialist.id,
  link: out.notify.link_url,
  rewritten_agent: rewritten.agent_id,
});
