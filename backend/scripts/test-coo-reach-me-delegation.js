#!/usr/bin/env node
/**
 * Smoke: COO "ask social media expert to reach me" hard path.
 * Deletes smoke notifications afterward so deploy verify does not pollute the CEO bell.
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
import {
  listNotificationsForUser,
  deleteNotificationsBySource,
  markNotificationsRead,
} from '../src/services/platform-notifications.js';

initDb();

const detectorCases = [
  ['ask the social media expert agent to reach me', true],
  ['ask TechResearcher to reach me via notification', true],
  ['Can you ask TechResearcher to reach me via notification', true],
  ['Could you ask the social assistant to notify me', true],
  ['please reach me', false],
  ['you reach me when ready', false],
  ['COO please notify me', false],
];
for (const [phrase, expect] of detectorCases) {
  const got = isAskSpecialistToReachMe(phrase);
  if (got !== expect) {
    throw new Error(`detector: "${phrase}" expected ${expect} got ${got}`);
  }
}
console.log('COO_REACH_ME_DETECTOR_OK', { cases: detectorCases.length });

const msg = 'ask the social media expert agent to reach me';
if (!isAskSpecialistToReachMe(msg)) throw new Error('detector failed');

const owner = getBalaCeoAuthId();
const specialist = resolveReachMeSpecialist(owner, msg);
if (!specialist || !/social/i.test(`${specialist.id} ${specialist.name || ''}`)) {
  throw new Error(`expected a social specialist, got ${specialist?.id}`);
}

const before = Date.now();
const keysToDelete = [];

try {
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
  if (out.notify.source_key) keysToDelete.push(out.notify.source_key);

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
  if (rewritten.source_key) keysToDelete.push(rewritten.source_key);

  const polite = 'Can you ask TechResearcher to reach me via notification';
  if (!isAskSpecialistToReachMe(polite)) throw new Error('polite reach-me detector failed');
  const tech = resolveReachMeSpecialist(owner, polite);
  if (tech && /tech|research/i.test(`${tech.id} ${tech.name || ''}`)) {
    console.log('COO_REACH_ME_POLITE_OK', { specialist: tech.id });
  } else {
    console.warn('COO_REACH_ME_TECH_RESOLVE_WARN', { id: tech?.id, name: tech?.name });
  }

  console.log('COO_REACH_ME_DELEGATION_OK', {
    specialist: specialist.id,
    link: out.notify.link_url,
    rewritten_agent: rewritten.agent_id,
  });
} finally {
  for (const key of [...new Set(keysToDelete.filter(Boolean))]) {
    deleteNotificationsBySource('agent_notify', key, owner);
  }
  const recent = listNotificationsForUser(owner, { limit: 30 }).filter(
    (n) =>
      n.created_by === specialist.id &&
      (String(n.source_key || '').startsWith(`reach-me:${specialist.id}:`) ||
        /ready to chat|asked me to reach you|Please reach the CEO/i.test(`${n.title || ''} ${n.body || ''}`))
  );
  if (recent.length) {
    markNotificationsRead(
      owner,
      recent.map((n) => n.id)
    );
    for (const n of recent) {
      if (n.source && n.source_key) deleteNotificationsBySource(n.source, n.source_key, owner);
    }
    console.log('COO_REACH_ME_DELEGATION_CLEANED', { marked: recent.length });
  }
}
