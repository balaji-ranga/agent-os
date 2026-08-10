/**
 * Platform Help must not hard-redirect via specialty referral.
 * Run: node backend/scripts/test-platform-help-no-specialty-referral.js
 */
import assert from 'assert';
import {
  tryBuildSpecialtyReferral,
  buildActiveChatNotifyHint,
} from '../src/services/specialty-referral.js';

const helpAgent = { id: 'platformhelp', is_coo: 0, name: 'Platform Help' };
const tenantHelp = { id: 'platformhelp', openclaw_agent_id: 't-ceo-x--platformhelp', is_coo: 0 };
const social = {
  id: 'socialasstant',
  is_coo: 0,
  name: 'SocialAssistant',
  role: 'Social',
  department: 'Social',
};

async function main() {
  const msg = 'i want to know how to capture contacts and leads for my business?';

  const helpRef = await tryBuildSpecialtyReferral('ceo-test', helpAgent, msg);
  assert.strictEqual(helpRef, null, 'platformhelp must not specialty-refer');

  const tenantRef = await tryBuildSpecialtyReferral('ceo-test', tenantHelp, msg);
  assert.strictEqual(tenantRef, null, 'tenant platformhelp must not specialty-refer');

  const wfbRef = await tryBuildSpecialtyReferral(
    'ceo-test',
    { id: 'workflowbuilder', is_coo: 0 },
    'please do deep research on quantum computing for me'
  );
  assert.strictEqual(wfbRef, null, 'workflowbuilder must not specialty-refer');

  const hint = buildActiveChatNotifyHint('platformhelp');
  assert.match(hint, /answer here first/i, 'Platform Help chat hint must be answer-first');
  assert.doesNotMatch(hint, /point to the best peer from ORG\.md/i);

  // Peer specialists still may refer when out of specialty (if AGENTS.md + classifier allow).
  // We only assert the helper path returns null-ish shape when message too short.
  const short = await tryBuildSpecialtyReferral('ceo-test', social, 'hi');
  assert.strictEqual(short, null);

  console.log('PASS: Platform Help specialty-referral exempt + answer-first hint');
}

main().catch((e) => {
  console.error('FAIL:', e.message || e);
  process.exit(1);
});