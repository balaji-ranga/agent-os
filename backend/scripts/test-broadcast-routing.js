#!/usr/bin/env node
/**
 * Unit smoke: broadcast specialty routing (no OpenClaw / LLM).
 * Usage: node scripts/test-broadcast-routing.js
 */
import {
  selectBroadcastRecipients,
  isReachMeRequest,
  isStatusNotifyBroadcast,
  buildBroadcastToolHint,
} from '../src/services/broadcast-routing.js';

const agents = [
  { id: 'balserve', name: 'COO', is_coo: 1, department: 'Executive', role: 'COO' },
  { id: 'socialasstant', name: 'SocialAssistant', department: 'Social', role: 'Social' },
  { id: 'techresearcher', name: 'TechResearcher', department: 'Research', role: 'Research' },
  { id: 'expensemanager', name: 'ExpenseManager', department: 'Finance', role: 'Finance' },
];

const msg = 'ask the social media expert agent to reach me';
if (!isReachMeRequest(msg)) throw new Error('expected reach-me detection');
const routed = selectBroadcastRecipients(agents, msg);
if (!routed.filtered) throw new Error('expected specialty filter');
if (routed.agents.length !== 1 || routed.agents[0].id !== 'socialasstant') {
  throw new Error(`expected only socialasstant, got ${JSON.stringify(routed.agents.map((a) => a.id))}`);
}
const hint = buildBroadcastToolHint({
  ownerUserId: 'ceo-bala',
  agent: routed.agents[0],
  reachMe: true,
  specialtyFiltered: true,
});
if (!/notify_ceo/.test(hint) || !/socialasstant\/chat/.test(hint)) {
  throw new Error('hint missing notify_ceo chat link');
}

const allStatus = selectBroadcastRecipients(agents, 'What is your current status?');
if (allStatus.filtered) throw new Error('status should not specialty-filter');
if (allStatus.agents.some((a) => a.is_coo)) throw new Error('default broadcast must exclude COO');
if (allStatus.agents.length !== 3) throw new Error('status should keep all non-COO agents');

const statusNotifyMsg = 'getback on their status summary and send notification once ready';
if (!isReachMeRequest(statusNotifyMsg)) throw new Error('expected reach-me for getback/notification phrasing');
if (!isStatusNotifyBroadcast(statusNotifyMsg)) throw new Error('expected status-notify broadcast');
const statusRouted = selectBroadcastRecipients(agents, statusNotifyMsg);
if (statusRouted.matchedSpecialty !== 'status_notify_all') {
  throw new Error(`expected status_notify_all, got ${statusRouted.matchedSpecialty}`);
}
if (statusRouted.agents.length !== 3 || statusRouted.agents.some((a) => a.is_coo)) {
  throw new Error('status-notify should fan to all non-COO');
}
const statusHint = buildBroadcastToolHint({
  ownerUserId: 'ceo-bala',
  agent: statusRouted.agents[0],
  reachMe: true,
  specialtyFiltered: false,
  statusNotifyAll: true,
});
if (!/MUST call \*\*notify_ceo\*\*/.test(statusHint)) {
  throw new Error('status-notify hint must require notify_ceo');
}

console.log('BROADCAST_ROUTING_OK', {
  specialty: routed.matchedSpecialty,
  recipients: routed.agents.map((a) => a.id),
  status_notify: statusRouted.agents.map((a) => a.id),
});
